/**
 * Handoff Guard for Pi: rewrites or blocks a handoff before another agent gets it.
 *
 * Pi loads this file with its own TypeScript loader, which also resolves the
 * `@earendil-works/*` imports. It is not part of this repository's `tsc` check.
 * See README.md in this directory for installation and settings.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { completeSimple } from "@earendil-works/pi-ai/compat";
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

type Mode = "rewrite" | "rewrite-flagged" | "block" | "observe";
const MODES: Mode[] = ["rewrite", "rewrite-flagged", "block", "observe"];

// The same tool-name suffixes and text fields as the compiled hook (src/lib.rs).
const DEFAULT_TOOLS = "(spawn_agent|send_message|send_input|followup_task|delegate_task|t3_thread_send|t3_thread_launch)$";
const TEXT_FIELDS = ["message", "task", "prompt"];
const ENTRY_TYPE = "handoff-guard-rewrite";

const setting = (name: string) => process.env[name]?.trim() || undefined;
const requested = setting("HANDOFF_GUARD_MODE");
const MODE: Mode = MODES.includes(requested as Mode) ? (requested as Mode) : "rewrite";
const TOOLS = new RegExp(setting("HANDOFF_GUARD_TOOLS") ?? DEFAULT_TOOLS);
const MIN_REWRITE_CHARS = Number(setting("HANDOFF_GUARD_MIN_REWRITE_CHARS") ?? 400);
const REWRITE_TIMEOUT_MS = Number(setting("HANDOFF_GUARD_REWRITE_TIMEOUT_MS") ?? 90_000);
const LOG_PATH = setting("HANDOFF_GUARD_LOG");

function guardBinary(): string {
  const configured = setting("HANDOFF_GUARD_BIN");
  if (configured) return configured;
  const installed = join(homedir(), ".local/bin/handoff-guard");
  return existsSync(installed) ? installed : "handoff-guard";
}

interface Verdict {
  /** False when the executable could not be run, so nothing is known. */
  ran: boolean;
  denied: boolean;
  rule: string | null;
  reason: string | null;
}

/** Ask the compiled guard about a tool call, exactly as the Codex hook would. */
function guard(toolName: string, input: unknown): Verdict {
  const res = spawnSync(guardBinary(), ["hook"], {
    input: JSON.stringify({ hook_event_name: "PreToolUse", tool_name: toolName, tool_input: input }),
    encoding: "utf8",
    timeout: 5000,
  });
  if (res.error || res.status !== 0) {
    return { ran: false, denied: false, rule: null, reason: res.error?.message ?? res.stderr?.trim() ?? null };
  }
  try {
    const out = JSON.parse(res.stdout).hookSpecificOutput;
    if (out?.permissionDecision !== "deny") return { ran: true, denied: false, rule: null, reason: null };
    const reason = String(out.permissionDecisionReason ?? "");
    return { ran: true, denied: true, rule: reason.match(/\[(\w+)\]/)?.[1] ?? null, reason };
  } catch {
    return { ran: false, denied: false, rule: null, reason: "the guard printed something that is not JSON" };
  }
}

function log(record: Record<string, unknown>) {
  if (!LOG_PATH) return;
  try {
    mkdirSync(dirname(LOG_PATH), { recursive: true });
    appendFileSync(LOG_PATH, JSON.stringify({ ts: new Date().toISOString(), pid: process.pid, mode: MODE, ...record }) + "\n");
  } catch {
    // A log that cannot be written must not stop a handoff.
  }
}

/** The `v4` editor prompt from docs/experiments/forked-rewriter.md. */
function editorPrompt(draft: string): string {
  return [
    "Pause execution and switch to technical editor mode.",
    "You just drafted the following handoff message to another agent:",
    "",
    "<draft>",
    draft,
    "</draft>",
    "",
    "Think carefully about the recipient: what they already know from their role, their existing thread, or files and records you can point them to, and what they actually need from you right now to take their next step well.",
    "",
    "Provide the minimal amount of information possible in clear, ordinary English:",
    "- Lead with the exact ask or decision.",
    "- Include concrete pointers (task/item IDs, commits, file paths) so the recipient can read full details directly instead of having them repeated.",
    "- Include only the essential, task-specific facts or constraints the recipient needs for their next step.",
    "- Write every technical term, identifier, and instruction plainly so a reader can understand it in one pass.",
    "",
    "First, in 2-3 short bullets, note what the recipient actually needs for their next step and what they can already get from their thread or linked records.",
    "Then output ONLY the edited handoff inside <rewritten>...</rewritten> tags.",
  ].join("\n");
}

/** The one text field a rewrite can replace, or null when the text is spread over several places. */
function rewritableField(input: Record<string, unknown>): string | null {
  const filled = TEXT_FIELDS.filter((key) => typeof input[key] === "string" && (input[key] as string).trim() !== "");
  if (filled.length !== 1 || Array.isArray(input.items)) return null;
  return filled[0]!;
}

// Pi's idle prompt-cache refresh replays the conversation with a token budget
// of one, which the Responses API raises to 16. No sender request is that small.
const CACHE_REFRESH_MAX_OUTPUT_TOKENS = 64;

/** Put the rewritten text into the sender's own record of its earlier tool calls. */
function applyRewrites(messages: any[], rewrites: Map<string, { field: string; text: string }>): boolean {
  let changed = false;
  for (const message of messages) {
    if (message?.role !== "assistant" || !Array.isArray(message.content)) continue;
    for (const block of message.content) {
      const rewrite = block?.type === "toolCall" ? rewrites.get(block.id) : undefined;
      if (!rewrite || !block.arguments || block.arguments[rewrite.field] === rewrite.text) continue;
      block.arguments = { ...block.arguments, [rewrite.field]: rewrite.text };
      changed = true;
    }
  }
  return changed;
}

export default function handoffGuard(pi: ExtensionAPI) {
  // Tool call id to the text that was delivered in place of the draft.
  const rewrites = new Map<string, { field: string; text: string }>();
  let parentPayload: Record<string, any> | null = null;
  let warned = false;

  const warnOnce = (ctx: ExtensionContext, text: string) => {
    if (warned) return;
    warned = true;
    try {
      ctx.ui.notify(text, "warning");
    } catch {
      // No interface to notify in this mode.
    }
  };

  // A resumed session has to keep showing the sender the delivered text, so
  // the rewrites are stored in the session file and read back here.
  pi.on("session_start", async (_event, ctx) => {
    rewrites.clear();
    for (const entry of ctx.sessionManager.getEntries() as any[]) {
      if (entry.type !== "custom" || entry.customType !== ENTRY_TYPE) continue;
      const { toolCallId, field, text } = entry.data ?? {};
      if (typeof toolCallId === "string" && typeof field === "string" && typeof text === "string") {
        rewrites.set(toolCallId, { field, text });
      }
    }
  });

  // The rewrite reuses the sender's last request, so the model provider serves
  // the conversation from its prompt cache. Handlers run in extension load
  // order, so an extension loaded after this one can still change the request
  // that is sent; the README says to list this extension last.
  pi.on("before_provider_request", async (event) => {
    const payload = event.payload as Record<string, any> | undefined;
    if (!payload || !Array.isArray(payload.input)) {
      parentPayload = null;
      return;
    }
    // A cache refresh can arrive while a tool runs. Replaying it would give the
    // editor its tiny budget and cut the rewrite short, so keep the sender's.
    const budget = payload.max_output_tokens;
    if (typeof budget === "number" && budget <= CACHE_REFRESH_MAX_OUTPUT_TOKENS) return;
    parentPayload = structuredClone(payload);
  });

  /** One tool-free model call that continues the sender's conversation with the editor prompt. */
  async function rewrite(ctx: ExtensionContext, draft: string) {
    if (!ctx.model) return { failure: "no model is selected" };
    if (!parentPayload) return { failure: "the model's API is not OpenAI Responses, the only one the rewriter supports" };
    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
    if (!auth.ok) return { failure: "no credentials for the model" };
    const base = structuredClone(parentPayload);
    const timeout = AbortSignal.timeout(REWRITE_TIMEOUT_MS);
    const started = Date.now();
    const response = await completeSimple(
      ctx.model,
      { messages: [{ role: "user", content: [{ type: "text", text: "placeholder" }], timestamp: Date.now() }] },
      {
        apiKey: auth.apiKey,
        headers: auth.headers,
        sessionId: ctx.sessionManager.getSessionId(),
        signal: ctx.signal ? AbortSignal.any([ctx.signal, timeout]) : timeout,
        onPayload: () => ({
          ...base,
          input: [...base.input, { role: "user", content: [{ type: "input_text", text: editorPrompt(draft) }] }],
          tool_choice: "none",
        }),
      } as any,
    );
    if (response.stopReason === "error" || response.stopReason === "aborted") {
      return { failure: `the model call failed: ${response.errorMessage ?? response.stopReason}` };
    }
    const raw = response.content
      .filter((block: any) => block.type === "text")
      .map((block: any) => block.text)
      .join("\n");
    // Without the tags the answer may still hold the editor's notes, which
    // must not reach the recipient.
    const text = raw.match(/<rewritten>\s*([\s\S]*?)\s*<\/rewritten>/i)?.[1]?.trim();
    if (!text) return { failure: "the model's answer had no <rewritten> text" };
    return { text, usage: response.usage, latencyMs: Date.now() - started };
  }

  pi.on("tool_call", async (event, ctx) => {
    if (!TOOLS.test(event.toolName)) return;
    const input = event.input as Record<string, unknown>;
    // A call made from inside another tool, such as a codemode script.
    const nested = typeof (event as any).parentToolCallId === "string";
    const before = guard(event.toolName, input);
    if (!before.ran) {
      warnOnce(ctx, `Handoff Guard could not run ${guardBinary()} (${before.reason}), so handoffs are not being checked. Install it or set HANDOFF_GUARD_BIN.`);
    }

    const field = rewritableField(input);
    const draft = field ? (input[field] as string) : "";
    const record: Record<string, unknown> = {
      tool: event.toolName,
      toolCallId: event.toolCallId,
      nested,
      draftChars: draft.length,
      guardBefore: { ran: before.ran, rule: before.rule },
      draft: field ? draft : TEXT_FIELDS.map((key) => input[key]).filter((v) => typeof v === "string"),
    };

    const wanted =
      field !== null &&
      (before.denied || (MODE === "rewrite" && draft.length >= MIN_REWRITE_CHARS)) &&
      (MODE === "rewrite" || MODE === "rewrite-flagged");
    if (wanted && field) {
      let result: Awaited<ReturnType<typeof rewrite>>;
      try {
        result = await rewrite(ctx, draft);
      } catch (error) {
        result = { failure: `the model call threw: ${error instanceof Error ? error.message : String(error)}` };
      }
      if ("text" in result && result.text) {
        const after = guard(event.toolName, { ...input, [field]: result.text });
        // A draft the guard denied is replaced only by text the guard has
        // passed. If the guard never ran, there was no denial to clear.
        if (after.ran ? !after.denied : !before.ran) {
          input[field] = result.text;
          // A nested call has no entry of its own in the conversation: the
          // draft sits inside the calling script, which is left as written.
          if (!nested) {
            rewrites.set(event.toolCallId, { field, text: result.text });
            try {
              pi.appendEntry(ENTRY_TYPE, { toolCallId: event.toolCallId, field, text: result.text });
            } catch (error) {
              // The handoff still goes out rewritten, and this process keeps
              // showing the sender the rewrite. Only a later resume loses it.
              record.persistFailed = error instanceof Error ? error.message : String(error);
            }
          }
          log({ event: "rewritten", ...record, rewrittenChars: result.text.length, rewritten: result.text, latencyMs: result.latencyMs, usage: result.usage });
          return;
        }
        record.rewriteDiscarded = { ran: after.ran, rule: after.rule, rewritten: result.text };
      } else if ("failure" in result) {
        record.rewriteFailed = result.failure;
        warnOnce(ctx, `Handoff Guard could not rewrite a handoff: ${result.failure}. Flagged handoffs are blocked instead.`);
      }
    }

    if (before.denied && MODE !== "observe") {
      log({ event: "blocked", ...record });
      return { block: true, reason: before.reason ?? "Handoff Guard blocked this message." };
    }
    log({ event: "passed", ...record });
  });

  // Every later request shows the sender the text that was delivered, not its draft.
  pi.on("context", async (event) => {
    if (rewrites.size === 0) return;
    const messages = structuredClone(event.messages);
    if (applyRewrites(messages as any[], rewrites)) return { messages };
  });

  // The same for the messages a compaction summarizes, so a draft cannot come back through the summary.
  pi.on("session_before_compact", async (event) => {
    if (rewrites.size === 0) return;
    const preparation = event.preparation as any;
    for (const key of ["messagesToSummarize", "turnPrefixMessages"]) {
      if (Array.isArray(preparation?.[key])) applyRewrites(preparation[key], rewrites);
    }
  });

  // And for the branch a /tree navigation summarizes, which Pi reads from the
  // saved entries without going through the context handler.
  pi.on("session_before_tree", async (event) => {
    if (rewrites.size === 0) return;
    const entries = (event.preparation as any)?.entriesToSummarize;
    if (!Array.isArray(entries)) return;
    applyRewrites(entries.map((entry: any) => entry?.message).filter(Boolean), rewrites);
  });
}
