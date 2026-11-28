/** The Pi extension in the actual `pi` executable, against a loopback scripted provider, without remote calls. */
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ROOT, checksum, invariant } from "./shared.ts";
import { scriptedModel } from "./hook-test.ts";
import type { SourceRecord } from "./capture.ts";

export const PI_SCENARIOS = [
  "rewrite",
  "length",
  "block",
  "rewrite-fails",
  "recheck-fails",
  "observe",
  "resume",
  "tree",
  "codemode",
];

// Invented text. The draft runs words together, which the guard blocks.
const DRAFT =
  "Pleaseinspecttheimplementationandreporttheregression then " +
  "summarizethefailingassertionsandtheirlikelycauses before " +
  "proposingtheminimalfixandtheverificationcommand for the parser.";
const REWRITTEN =
  "Please inspect the parser implementation and report the regression. Summarize the failing assertions and their likely causes, then propose the smallest fix and the command that verifies it.";
const ORDINARY = "Please run the parser tests and tell me which ones fail.";
// Passes the guard, but is long enough to be edited in `rewrite` mode.
const LONG = Array.from({ length: 12 }, (_, i) => `Step ${i + 1}: please run the parser tests again and tell me which of them fail.`).join(" ");
const DELEGATE = "mcp__t3-code__delegate_task";
const SEND = "mcp__t3-code__t3_thread_send";

/**
 * A stand-in for T3 Code's own Pi extension: it registers two of T3's handoff
 * tools under their real names and records every call that reaches them.
 */
const stubSource = (calls: string) => `
import { appendFileSync } from "node:fs";
export default function (pi) {
  // Leaves the branch that holds the handoff and asks Pi to summarize it.
  pi.registerCommand("fixture-tree", {
    description: "Fixture tree navigation.",
    handler: async (_args, ctx) => {
      const first = ctx.sessionManager.getEntries().find((entry) => entry.type === "message");
      await ctx.navigateTree(first.id, { summarize: true });
    },
  });
  for (const [name, field] of [[${JSON.stringify(DELEGATE)}, "task"], [${JSON.stringify(SEND)}, "message"]]) {
    pi.registerTool({
      name, label: name, description: "Fixture handoff tool.",
      parameters: { type: "object", properties: { [field]: { type: "string" }, threadId: { type: "string" } }, required: [field] },
      async execute(_id, params) {
        appendFileSync(${JSON.stringify(calls)}, JSON.stringify({ name, params }) + "\\n");
        return { content: [{ type: "text", text: "delivered" }], details: {} };
      },
    });
  }
}`;

const functionCall = (n: number, name: string, args: SourceRecord) => ({
  type: "function_call",
  id: `fc_${n}`,
  call_id: `call_${n}`,
  name,
  arguments: JSON.stringify(args),
  status: "completed",
});
const message = (n: number, text: string) => ({
  type: "message",
  id: `msg_${n}`,
  role: "assistant",
  content: [{ type: "output_text", text, annotations: [] }],
  status: "completed",
});

const readJsonl = (path: string): SourceRecord[] =>
  existsSync(path)
    ? readFileSync(path, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line))
    : [];

/** The editor request is the one that ends with the editor prompt. */
const isEditorRequest = (request: SourceRecord) =>
  JSON.stringify(request.input?.at(-1) ?? "").includes("technical editor mode");
/** Tool results the sender has been shown, as text. */
const toolOutputs = (requests: SourceRecord[]) =>
  JSON.stringify(
    requests.flatMap((r) => (r.input ?? []).filter((x: SourceRecord) => String(x.type).endsWith("call_output"))),
  );
/** The arguments of the sender's own earlier tool calls, as later requests show them. */
const historyCalls = (request: SourceRecord) =>
  JSON.stringify((request.input ?? []).filter((x: SourceRecord) => String(x.type).endsWith("_call")));

export async function piTest(binary: string, scenario = "rewrite") {
  invariant(PI_SCENARIOS.includes(scenario), "Invalid scenario");
  binary = resolve(binary);
  const home = mkdtempSync(join(tmpdir(), "handoff-pi-")),
    agentDir = join(home, "agent"),
    sessions = join(home, "sessions"),
    calls = join(home, "delivered.jsonl"),
    logPath = join(home, "guard-log.jsonl"),
    stub = join(home, "stub-t3-tools.ts");
  mkdirSync(agentDir);
  writeFileSync(stub, stubSource(calls));
  // For `recheck-fails`: the guard answers its first call and fails every later one.
  const failing = join(home, "guard-once.mjs"),
    counter = join(home, "guard-calls");
  writeFileSync(
    failing,
    `#!${process.execPath}\nimport {readFileSync,appendFileSync,existsSync} from 'node:fs';import {spawnSync} from 'node:child_process';const input=readFileSync(0,'utf8');const first=!existsSync(${JSON.stringify(counter)});appendFileSync(${JSON.stringify(counter)},'x');if(!first)process.exit(1);const r=spawnSync(${JSON.stringify(binary)},['hook'],{input,encoding:'utf8'});process.stdout.write(r.stdout??'');`,
    { mode: 0o755 },
  );
  const mode =
    scenario === "block" ? "block" : scenario === "observe" ? "observe" : "rewrite";

  // What the sender does on each of its own turns. Editor requests are answered separately.
  const turns: ((n: number) => SourceRecord[])[] =
    scenario === "codemode"
      ? [
          (n) => [functionCall(n, "codemode", { code: `const r = await tools.mcp__t3_code__delegate_task({task: ${JSON.stringify(DRAFT)}}); text(r);` })],
          (n) => [message(n, "OK")],
        ]
      : scenario === "block"
        ? [
            (n) => [functionCall(n, DELEGATE, { task: DRAFT })],
            (n) => [functionCall(n, SEND, { threadId: "fixture", message: ORDINARY })],
            (n) => [message(n, "OK")],
          ]
        : scenario === "length"
          ? [
              (n) => [functionCall(n, SEND, { threadId: "fixture", message: LONG })],
              (n) => [message(n, "OK")],
            ]
          : [
            (n) => [functionCall(n, DELEGATE, { task: DRAFT })],
            (n) => [message(n, "OK")],
              // Only `resume` and `tree` get this far, in a second process.
              (n) => [message(n, scenario === "tree" ? "The branch delegated one task." : "OK again")],
            ];
  let turn = 0;
  const model = await scriptedModel((n, request) => {
    if (isEditorRequest(request))
      return [
        message(
          n,
          scenario === "rewrite-fails"
            ? "- The recipient needs the ask.\nNo tags here."
            : // The editor hands back the flagged draft, so only the recheck can stop it.
              `- The recipient needs the ask.\n<rewritten>\n${scenario === "recheck-fails" ? DRAFT : REWRITTEN}\n</rewritten>`,
        ),
      ];
    const next = turns[turn++];
    invariant(next !== undefined, "The sender made more requests than the scenario expects");
    return next(n);
  });
  writeFileSync(
    join(agentDir, "models.json"),
    JSON.stringify({
      providers: {
        fixture: {
          name: "Local integration fixture",
          baseUrl: `http://127.0.0.1:${model.port}/v1`,
          api: "openai-responses",
          apiKey: "fixture",
          models: [{ id: "fixture-model", cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
        },
      },
    }),
  );
  writeFileSync(join(agentDir, "settings.json"), "{}");

  const runPi = async (prompt: string, extra: string[] = []) => {
    const child = spawn(
      "pi",
      [
        "--no-extensions",
        ...(scenario === "codemode" ? ["-e", "builtin:codemode", "--tools", "+codemode"] : []),
        "-e", resolve(ROOT, "pi-extension/index.ts"),
        "-e", stub,
        "--no-skills", "--no-context-files", "--no-mcp", "--no-prompt-templates", "--no-themes", "--offline",
        "--agent-dir", agentDir,
        "--session-dir", sessions,
        "--model", "fixture/fixture-model",
        "--mode", "json",
        ...extra,
        "-p", prompt,
      ],
      {
        cwd: home,
        env: {
          ...process.env,
          HANDOFF_GUARD_BIN: scenario === "recheck-fails" ? failing : binary,
          HANDOFF_GUARD_MODE: mode,
          HANDOFF_GUARD_LOG: logPath,
          HANDOFF_GUARD_MIN_REWRITE_CHARS: "400",
        },
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 60000,
      },
    );
    let stdout = "", stderr = "";
    child.stdout.on("data", (b) => (stdout += b));
    child.stderr.on("data", (b) => (stderr += b));
    const [code] = await once(child, "close");
    invariant(code === 0, "Pi fixture failed: " + stderr + stdout.slice(-2000));
    return { stdout, stderr };
  };

  try {
    await runPi("Run the local scripted handoff fixture.");
    if (scenario === "resume") {
      const file = readdirSync(sessions, { recursive: true }).map(String).find((f) => f.endsWith(".jsonl"));
      invariant(file !== undefined, "Pi saved no session to resume");
      await runPi("Continue the fixture.", ["--session", join(sessions, file)]);
    }
    if (scenario === "tree") {
      const file = readdirSync(sessions, { recursive: true }).map(String).find((f) => f.endsWith(".jsonl"));
      invariant(file !== undefined, "Pi saved no session to navigate");
      await runPi("/fixture-tree", ["--session", join(sessions, file)]);
    }
    const requests = model.requests,
      delivered = readJsonl(calls),
      log = readJsonl(logPath),
      editor = requests.filter(isEditorRequest),
      sender = requests.filter((r) => !isEditorRequest(r)),
      outputs = toolOutputs(requests),
      deliveredText = JSON.stringify(delivered);

    if (["rewrite", "resume", "tree", "codemode"].includes(scenario)) {
      invariant(editor.length === 1, "Expected one editor request");
      invariant(editor[0].tool_choice === "none", "The editor request allowed tool calls");
      // The editor request is the sender's own request plus one message, so the prompt cache is reused.
      const parent = sender[0];
      invariant(
        JSON.stringify(editor[0].input.slice(0, -1)) === JSON.stringify(parent.input) &&
          JSON.stringify(editor[0].tools) === JSON.stringify(parent.tools) &&
          editor[0].instructions === parent.instructions,
        "The editor request does not start with the sender's request",
      );
      invariant(delivered.length === 1, "Expected one delivered handoff");
      invariant(delivered[0].params.task === REWRITTEN, "The recipient did not get the rewritten text");
      invariant(!deliveredText.includes(DRAFT), "The draft was delivered");
      invariant(log.some((r) => r.event === "rewritten"), "The rewrite was not logged");
    }
    if (scenario === "rewrite" || scenario === "resume") {
      // Every request after the handoff shows the sender the delivered text.
      for (const request of sender.slice(1)) {
        const history = historyCalls(request);
        invariant(history.includes(REWRITTEN), "The sender's history lacks the rewritten text");
        invariant(!history.includes(DRAFT), "The sender's history still shows its draft");
      }
    }
    if (scenario === "resume")
      invariant(sender.length === 3, "Expected a third sender request after the resume");
    if (scenario === "length") {
      invariant(editor.length === 1, "Expected one editor request");
      invariant(
        delivered.length === 1 && JSON.stringify(delivered[0].params) === JSON.stringify({ threadId: "fixture", message: REWRITTEN }),
        "Expected the rewritten message with its other arguments unchanged",
      );
      invariant(log.some((r) => r.event === "rewritten" && r.guardBefore.rule === null), "Expected an unflagged draft to be rewritten");
    }
    if (scenario === "recheck-fails") {
      invariant(editor.length === 1, "Expected one editor request");
      invariant(delivered.length === 0, "A flagged handoff was delivered without a passing recheck");
      invariant(outputs.includes("[fused_words]"), "The flagged draft was not blocked");
    }
    if (scenario === "tree") {
      // The request that summarizes the abandoned branch is the last one.
      const summary = JSON.stringify(requests.at(-1));
      invariant(requests.length === 4, "Expected a summary request after the navigation");
      invariant(summary.includes(REWRITTEN), "The branch summary input lacks the rewritten text");
      invariant(!summary.includes(DRAFT), "The branch summary input shows the draft");
    }
    if (scenario === "block") {
      invariant(editor.length === 0, "Block mode made an editor request");
      invariant(delivered.length === 1 && delivered[0].name === SEND, "Expected only the ordinary message to be delivered");
      invariant(outputs.includes("[fused_words]") && outputs.includes("nothing was sent"), "The sender was not told why its handoff was blocked");
    }
    if (scenario === "rewrite-fails") {
      invariant(editor.length === 1, "Expected one editor request");
      invariant(delivered.length === 0, "A handoff was delivered after its rewrite failed");
      invariant(outputs.includes("[fused_words]"), "The flagged draft was not blocked");
      invariant(!deliveredText.includes("No tags here"), "The editor's notes were delivered");
    }
    if (scenario === "observe") {
      invariant(editor.length === 0, "Observe mode made an editor request");
      invariant(delivered.length === 1 && delivered[0].params.task === DRAFT, "Observe mode changed or stopped the handoff");
      invariant(log.some((r) => r.event === "passed" && r.guardBefore.rule === "fused_words"), "The flagged draft was not logged");
    }
    return {
      scenario,
      mode,
      requests: requests.length,
      editor_requests: editor.length,
      delivered: delivered.map((d) => ({ tool: d.name, characters: Array.from(String(d.params.task ?? d.params.message ?? "")).length })),
      log: log.map((r) => ({ event: r.event, tool: r.tool, nested: r.nested })),
      assertions_passed: true,
      binary_sha256: checksum(binary),
    };
  } finally {
    await model.close();
    rmSync(home, { recursive: true, force: true });
  }
}
