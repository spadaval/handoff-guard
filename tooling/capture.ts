/** Read historical stores as data. Recorded commands and JavaScript are never executed. */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { resolve, join, basename } from "node:path";
import { homedir } from "node:os";
import { openDatabase, type ResearchDatabase } from "./db/connection.ts";
import * as t from "./db/schema.ts";
import {
  canonical,
  decode,
  digest,
  now,
  chars,
  words,
  lines,
  parse,
  INPUT_KINDS,
  invariant,
} from "./shared.ts";
// Provider envelopes are heterogeneous. Shape guards are applied at extraction boundaries.
export type SourceRecord = Record<string, any>;
const TOOLS: Record<string, [string, string]> = {
  spawn_agent: ["message", "assignment"],
  delegate_task: ["task", "assignment"],
  send_message: ["message", "agent_message"],
  followup_task: ["message", "followup_assignment"],
  assign_task: ["message", "followup_assignment"],
  send_input: ["message", "agent_message"],
  t3_thread_send: ["message", "agent_message"],
  t3_thread_launch: ["message", "peer_thread_request"],
};
export const toolTail = (name: string) =>
  name?.split(/__|[./:]|(?<=code)_/).at(-1) ?? "";
export function textParts(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  if (Array.isArray(v))
    return v
      .filter((x) => x && typeof x.text === "string")
      .map((x) => x.text)
      .join("\n");
}
export function ciphertext(v: string) {
  if (!/^gAAAA[A-Za-z0-9_=-]+$/.test(v)) return false;
  const raw = Buffer.from(v, "base64url");
  return raw.length >= 73 && raw[0] === 128;
}
export class Corpus {
  db: ResearchDatabase;
  seen = new Set<string>();
  messages = new Map<
    string,
    {
      message_id: string;
      text: string;
      characters: number;
      words: number;
      kinds: Set<string>;
      projects: Set<string>;
    }
  >();
  counts: Record<string, number> = {};
  sources: Record<string, number> = {};
  opaque = new Set<string>();
  ordinal = 0;
  gapLine = 0;
  started = now();
  constructor(db: ResearchDatabase) {
    this.db = db;
  }
  inc(key: string) {
    this.counts[key] = (this.counts[key] ?? 0) + 1;
  }
  gap(reason: string, where: SourceRecord = {}) {
    this.inc("gap:" + reason);
    this.db.orm
      .insert(t.corpusGaps)
      .values({
        line: ++this.gapLine,
        record_json: canonical({ reason, ...where }),
      })
      .run();
  }
  add(text: unknown, kind: string, where: SourceRecord, encrypted = false) {
    if (typeof text !== "string" || words(text) === 0) return;
    const id = digest(text),
      key = canonical([
        where.source,
        where.locator,
        where.item_id,
        where.line,
        where.field,
        kind,
        id,
      ]);
    if (this.seen.has(key)) return;
    this.seen.add(key);
    if (encrypted || ciphertext(text)) {
      this.inc("opaque_observations");
      this.opaque.add(id);
      return;
    }
    const record = { message_id: id, kind, ...where };
    this.inc("plaintext_observations");
    this.sources[where.source ?? "unknown"] =
      (this.sources[where.source ?? "unknown"] ?? 0) + 1;
    let row = this.messages.get(id);
    if (!row) {
      row = {
        message_id: id,
        text,
        characters: chars(text),
        words: words(text),
        kinds: new Set(),
        projects: new Set(),
      };
      this.messages.set(id, row);
      this.db.orm
        .insert(t.messages)
        .values({
          message_id: id,
          text,
          characters: row.characters,
          words: row.words,
          kinds: "[]",
          projects: "[]",
          is_input: 0,
        })
        .run();
    }
    row.kinds.add(kind);
    row.projects.add(where.project || "unknown");
    const encoded = canonical(record),
      line = ++this.ordinal,
      oid = digest(line + ":" + encoded);
    this.db.orm
      .insert(t.observations)
      .values({
        observation_id: oid,
        message_id: id,
        export_line: line,
        source: where.source,
        record_json: encoded,
      })
      .run();
    this.db.orm
      .insert(t.contexts)
      .values({
        context_id: "ctx-" + oid,
        observation_id: oid,
        message_id: id,
        status: "pending",
        metadata_json: "{}",
      })
      .run();
  }
  tool(
    name: string,
    args: unknown,
    where: SourceRecord,
    encrypted: string[] = [],
  ) {
    const tail = toolTail(name);
    if (!(tail in TOOLS) && tail !== "create_threads") return;
    try {
      args = typeof args === "string" ? JSON.parse(args) : args;
    } catch {
      this.gap("invalid_tool_arguments", { tool: name, ...where });
      return;
    }
    if (!args || typeof args !== "object" || Array.isArray(args)) {
      this.gap("unstructured_tool_arguments", { tool: name, ...where });
      return;
    }
    const a = args as SourceRecord;
    if (tail === "create_threads") {
      for (const [i, child] of (a.threads ?? []).entries())
        if (child && typeof child === "object")
          this.add(child.prompt, "peer_thread_request", {
            ...where,
            tool: name,
            field: `threads[${i}].prompt`,
          });
      return;
    }
    let [field, kind] = TOOLS[tail],
      value = a[field];
    if (value == null && tail === "send_input") {
      value = textParts(a.items);
      field = "items";
    }
    this.add(
      value,
      kind,
      {
        ...where,
        tool: name,
        field,
        target: a.target ?? a.id ?? a.threadId ?? null,
      },
      encrypted.includes(field),
    );
  }
  finish(coverage: SourceRecord = {}) {
    for (const r of this.messages.values()) {
      const kinds = [...r.kinds].sort();
      this.db.run(
        "UPDATE messages SET kinds=?,projects=?,is_input=? WHERE message_id=?",
        canonical(kinds),
        canonical([...r.projects].sort()),
        Number(kinds.some((k) => INPUT_KINDS.has(k))),
        r.message_id,
      );
    }
    this.counts.unique_plaintext_bodies = this.messages.size;
    this.counts.unique_opaque_payloads = this.opaque.size;
    const manifest = {
      schema_version: 1,
      started_at: this.started,
      completed_at: now(),
      counts: this.counts,
      plaintext_observations_by_source: this.sources,
      coverage,
      files: {},
      limitations: [
        "Observations include mirrors, not unique deliveries.",
        "Opaque payloads are counted but excluded from plaintext research.",
        "Live sources are not an atomic cross-source snapshot.",
        "Attachments are not expanded; commands are not executed.",
      ],
    };
    this.db.orm
      .insert(t.metadata)
      .values([
        { key: "manifest", value: canonical(manifest) },
        { key: "collector_version", value: "context-collector-1" },
      ])
      .run();
    return manifest;
  }
}
export function exportT3(c: Corpus, path: string) {
  const d = openDatabase(path, { readOnly: true, initialize: false }),
    threads = new Map<string, SourceRecord>(),
    native = new Map<string, SourceRecord>();
  try {
    const projects = new Map(
      d
        .all<{ project_id: string; title: string }>(
          "SELECT project_id,title FROM projection_projects",
        )
        .map((r) => [r.project_id, r.title]),
    );
    for (const r of d.all<SourceRecord>(
      "SELECT thread_id,project_id,title,payload_json FROM orchestration_v2_projection_threads",
    )) {
      const p = parse<SourceRecord>(r.payload_json);
      threads.set(r.thread_id, {
        project: projects.get(r.project_id) ?? r.project_id,
        project_id: r.project_id,
        thread_id: r.thread_id,
        thread_title: r.title,
        is_child: p.lineage?.relationshipToParent === "subagent",
        saved_model_selection: p.modelSelection?.model ?? null,
      });
    }
    for (const r of d.all<SourceRecord>(
      "SELECT thread_id,payload_json FROM orchestration_v2_projection_provider_threads",
    )) {
      const id = parse<SourceRecord>(r.payload_json).nativeThreadRef?.nativeId;
      if (id && threads.has(r.thread_id))
        native.set(id, threads.get(r.thread_id)!);
    }
    for (const r of d.all<SourceRecord>(
      "SELECT message_id,thread_id,role,created_at,payload_json FROM orchestration_v2_projection_messages",
    )) {
      const p = parse<SourceRecord>(r.payload_json),
        thread = threads.get(r.thread_id) ?? { thread_id: r.thread_id };
      const kind =
        r.role === "user" && p.createdBy === "agent"
          ? p.delegatedCompletion
            ? "completion_notification"
            : "agent_delivery"
          : r.role === "assistant" && thread.is_child
            ? "worker_assistant_output"
            : null;
      if (kind)
        c.add(p.text, kind, {
          source: "t3_messages",
          ...thread,
          locator: path,
          item_id: r.message_id,
          timestamp: r.created_at,
          sender_thread_id: p.senderThreadId ?? null,
          role: r.role,
        });
    }
    for (const r of d.all<SourceRecord>(
      "SELECT turn_item_id,thread_id,type,payload_json FROM orchestration_v2_projection_turn_items WHERE type IN ('dynamic_tool','subagent')",
    )) {
      const p = parse<SourceRecord>(r.payload_json),
        where = {
          source: "t3_turn_items",
          locator: path,
          item_id: r.turn_item_id,
          ...(threads.get(r.thread_id) ?? { thread_id: r.thread_id }),
          timestamp: p.startedAt ?? null,
        };
      if (r.type === "dynamic_tool") c.tool(p.toolName, p.input, where);
      else
        for (const [field, kind] of [
          ["prompt", "assignment"],
          ["result", "worker_report"],
        ])
          c.add(textParts(p[field]), kind, {
            ...where,
            field,
            target_thread_id: p.childThreadId ?? null,
          });
    }
    for (const r of d.all<SourceRecord>(
      "SELECT subagent_id,thread_id,payload_json FROM orchestration_v2_projection_subagents",
    )) {
      const p = parse<SourceRecord>(r.payload_json),
        where = {
          source: "t3_subagents",
          locator: path,
          item_id: r.subagent_id,
          ...(threads.get(r.thread_id) ?? { thread_id: r.thread_id }),
          timestamp: p.startedAt ?? null,
        };
      for (const [field, kind] of [
        ["prompt", "assignment"],
        ["result", "worker_report"],
      ])
        c.add(textParts(p[field]), kind, { ...where, field });
      if (!p.prompt) c.gap("subagent_prompt_not_recorded", where);
    }
    return { native, threads };
  } finally {
    d.close();
  }
}
export function exportHistory(
  c: Corpus,
  path: string,
  native: Map<string, SourceRecord>,
) {
  const d = openDatabase(path, { readOnly: true, initialize: false });
  try {
    for (const r of d.all<SourceRecord>(
      "SELECT thread_id,item_id,created_at_ms,item_type,item_json FROM thread_items WHERE item_type IN ('collabAgentToolCall','mcpToolCall','agentMessage')",
    )) {
      const p = parse<SourceRecord>(r.item_json),
        meta = native.get(r.thread_id) ?? {},
        where = {
          source: "codex_history",
          locator: path,
          item_id: r.item_id,
          ...meta,
          native_thread_id: r.thread_id,
          timestamp_ms: r.created_at_ms,
        };
      if (r.item_type === "collabAgentToolCall") {
        if (p.prompt)
          c.add(p.prompt, "native_agent_prompt", { ...where, tool: p.tool });
        else if (
          [
            "spawnAgent",
            "spawn_agent",
            "sendMessage",
            "send_message",
            "followupTask",
          ].includes(p.tool)
        )
          c.gap("projected_native_prompt_unavailable", where);
        for (const [target, state] of Object.entries(p.agentsStates ?? {}))
          c.add((state as SourceRecord)?.message, "worker_report", {
            ...where,
            field: target,
          });
      } else if (r.item_type === "mcpToolCall")
        c.tool(p.tool, p.arguments, where);
      else if (meta.is_child)
        c.add(p.text, "worker_" + (p.phase ?? "assistant_output"), where);
    }
  } finally {
    d.close();
  }
}
export function exportRollout(
  c: Corpus,
  path: string,
  meta: SourceRecord = {},
) {
  let model = null,
    sid = meta.native_thread_id ?? null,
    child = meta.is_child ?? false;
  try {
    for (const { line, raw } of lines(path)) {
      const text = raw.toString();
      if (
        ![
          '"session_meta"',
          '"turn_context"',
          '"function_call"',
          "collab_agent_",
          '"agent_message"',
          '"role": "assistant"',
          '"role":"assistant"',
        ].some((s) => text.includes(s))
      )
        continue;
      let record: SourceRecord;
      try {
        record = JSON.parse(decode(raw));
      } catch {
        c.gap("invalid_rollout_json", { locator: path, line });
        continue;
      }
      const p = record.payload;
      if (!p || typeof p !== "object" || Array.isArray(p)) continue;
      if (record.type === "session_meta") {
        sid = p.id ?? sid;
        child =
          child ||
          (p.source &&
            typeof p.source === "object" &&
            JSON.stringify(p.source).includes("thread_spawn"));
      }
      if (record.type === "turn_context") model = p.model ?? model;
      const where = {
        source: "codex_rollout",
        locator: path,
        line,
        ...meta,
        native_thread_id: sid,
        timestamp: record.timestamp ?? null,
        model,
        model_attribution: model ? "preceding_turn_context" : "unknown",
      };
      if (record.type === "response_item" && p.type === "function_call")
        c.tool(
          (p.namespace ? p.namespace + "." : "") + (p.name ?? ""),
          p.arguments,
          { ...where, item_id: p.call_id ?? null },
          p.encrypted_function_args,
        );
      else if (
        record.type === "event_msg" &&
        p.type?.startsWith("collab_agent_")
      ) {
        c.add(p.prompt, "native_agent_prompt", {
          ...where,
          item_id: p.call_id ?? null,
          field: "prompt",
          event: p.type,
        });
        c.add(p.message, "native_agent_message", {
          ...where,
          item_id: p.call_id ?? null,
          field: "message",
          event: p.type,
        });
      } else if (
        child &&
        record.type === "response_item" &&
        p.role === "assistant"
      )
        c.add(
          textParts(p.content),
          "worker_" + (p.phase ?? "assistant_output"),
          { ...where, item_id: p.id ?? null },
        );
      else if (
        child &&
        record.type === "event_msg" &&
        p.type === "agent_message"
      )
        c.add(p.message, "worker_report", where);
    }
  } catch (e) {
    c.gap("unreadable_rollout", { locator: path, error: String(e) });
  }
}
function walk(path: string): string[] {
  if (!existsSync(path)) return [];
  return readdirSync(path, { withFileTypes: true }).flatMap((x) =>
    x.isDirectory()
      ? walk(join(path, x.name))
      : x.name.endsWith(".jsonl")
        ? [join(path, x.name)]
        : [],
  );
}
export function capture(
  db: ResearchDatabase,
  opts: { codexHome?: string; t3Db?: string; evidenceCache?: string[] } = {},
) {
  invariant(
    !db.orm
      .select({ id: t.messages.message_id })
      .from(t.messages)
      .limit(1)
      .get(),
    "Capture requires a new database",
  );
  const home = opts.codexHome ?? join(homedir(), ".codex"),
    t3 = opts.t3Db ?? join(homedir(), ".t3/userdata/statev2.sqlite");
  return db.transaction(() => {
    const c = new Corpus(db);
    let native = new Map<string, SourceRecord>(),
      threads = new Map<string, SourceRecord>();
    try {
      ({ native, threads } = exportT3(c, t3));
    } catch (e) {
      c.gap("t3_unavailable", { locator: t3, error: String(e) });
    }
    const paths = new Map<string, SourceRecord>();
    try {
      const state = openDatabase(join(home, "state_5.sqlite"), {
        readOnly: true,
        initialize: false,
      });
      try {
        for (const r of state.all<SourceRecord>(
          "SELECT id,rollout_path,source,cwd,title FROM threads",
        )) {
          const item = {
            ...native.get(r.id),
            native_thread_id: r.id,
            cwd: r.cwd,
            native_thread_title: r.title,
            is_child:
              Boolean(native.get(r.id)?.is_child) ||
              String(r.source).includes("thread_spawn"),
          };
          native.set(r.id, item);
          paths.set(r.rollout_path, item);
        }
      } finally {
        state.close();
      }
    } catch (e) {
      c.gap("codex_state_unavailable", { error: String(e) });
    }
    for (const item of native.values())
      if (!item.project)
        for (const name of [
          "ai-assistant",
          "atelier",
          "team-standup",
          ".agents",
          "webexctl",
          "jiracli",
          "dc34",
        ])
          if (
            String(item.cwd)
              .split("/")
              .some((p) => p === name || p.startsWith(name + "-"))
          ) {
            item.project = name;
            item.project_attribution = "inferred_from_cwd";
            break;
          }
    try {
      exportHistory(c, join(home, "thread_history_1.sqlite"), native);
    } catch (e) {
      c.gap("codex_history_unavailable", { error: String(e) });
    }
    for (const folder of ["sessions", "archived_sessions"])
      for (const path of walk(join(home, folder)))
        if (!paths.has(path)) paths.set(path, {});
    for (const [path, meta] of [...paths].sort(([a], [b]) =>
      a.localeCompare(b),
    ))
      exportRollout(c, path, meta);
    const caches: string[] = [];
    for (const dir of opts.evidenceCache ?? [])
      for (const name of [
        "other-raw-handoffs.json",
        "other-inspectable-handoffs.json",
        "model-control-calls.json",
        "model-control-finals.json",
        "other-control-returns.json",
        "positive-model-attribution.json",
      ]) {
        const path = join(dir, name);
        if (!existsSync(path)) continue;
        const records = parse<unknown>(readFileSync(path, "utf8"));
        if (!Array.isArray(records)) continue;
        caches.push(path);
        records.forEach((r: SourceRecord, i) => {
          if (!r || typeof r !== "object") return;
          const sid = r.session ?? r.sid,
            tid = r.thread ?? r.sender;
          c.add(
            r.text || r.body || r.item?.text,
            /final|return/.test(name)
              ? "cached_worker_report"
              : "cached_agent_message",
            {
              source: "audit_cache",
              locator: path,
              ...(native.get(sid) ?? threads.get(tid)),
              item_id: String(i),
              native_thread_id: sid ?? null,
              cache_thread_id: tid ?? null,
              cwd: r.cwd ?? null,
              timestamp: r.date ?? null,
              tool: r.tool ?? null,
              original_rollout: r.path ?? null,
              model: r.context?.model ?? null,
              model_attribution:
                "evidence_cache; inspect original context for attribution",
            },
          );
        });
      }
    return c.finish({
      t3_database: t3,
      t3_threads: threads.size,
      codex_state_database: join(home, "state_5.sqlite"),
      codex_history_database: join(home, "thread_history_1.sqlite"),
      rollout_files_attempted: paths.size,
      evidence_caches: caches,
      filters: { projects: "all", dates: "all", models: "all" },
    });
  });
}
