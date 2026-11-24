import { existsSync, statSync, openSync, readSync, closeSync } from "node:fs";
import { resolve, relative, isAbsolute, normalize, join } from "node:path";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { openDatabase, type ResearchDatabase } from "./db/connection.ts";
import { addEvidence } from "./dataset.ts";
import {
  canonical,
  decode,
  checksum,
  digest,
  parse,
  lines,
  INPUT_KINDS,
  type Data,
} from "./shared.ts";
import type { SourceRecord } from "./capture.ts";
const MAX_SCAN = 128 * 1024 * 1024,
  MAX_RECORDS = 12,
  MAX_FILE = 65536;
export interface RecoveryRow {
  context_id: string;
  observation_id: string;
  message_id: string;
  record_json: string;
  text: string;
}
type Entry = [number, string, string, string];
export function timestamp(value: unknown): number | undefined {
  if (typeof value === "number")
    return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "string" || !/(?:Z|[+-]\d\d:\d\d)$/.test(value)) return;
  const n = Date.parse(value);
  return Number.isFinite(n) ? n : undefined;
}
export function textOf(p: unknown): string {
  if (typeof p === "string") return p;
  if (!p || typeof p !== "object" || Array.isArray(p)) return "";
  const r = p as SourceRecord;
  for (const k of [
    "text",
    "message",
    "prompt",
    "output",
    "arguments",
    "input",
    "result",
    "aggregatedOutput",
    "command",
  ])
    if (typeof r[k] === "string") return r[k];
  if (
    ["arguments", "input", "result", "command", "aggregatedOutput"].some(
      (k) => k in r,
    )
  )
    return canonical(
      Object.fromEntries(
        [
          "type",
          "toolName",
          "tool",
          "name",
          "arguments",
          "input",
          "result",
          "command",
          "aggregatedOutput",
          "error",
        ]
          .filter((k) => k in r)
          .map((k) => [k, r[k]]),
      ),
    );
  return Array.isArray(r.content)
    ? r.content
        .filter((x: SourceRecord) => typeof x?.text === "string")
        .map((x: SourceRecord) => x.text)
        .join("\n")
    : "";
}
export class Recovery {
  db: ResearchDatabase;
  connections = new Map<string, ResearchDatabase>();
  sessions = new Map<string, SourceRecord>();
  nativePaths = new Map<string, string>();
  t3Native = new Map<string, string[]>();
  refs = new Map<string, SourceRecord>();
  repos = new Map<string, string | null>();
  toolCache = new Map<string, { rows: [string, string][]; capped: boolean }>();
  sourceGaps: string[] = [];
  caches = new Map<string, { records: SourceRecord[]; hash: string }>();
  constructor(
    db: ResearchDatabase,
    opts: { codexState?: string; t3Db?: string } = {},
  ) {
    this.db = db;
    try {
      const s = openDatabase(
        opts.codexState ?? join(homedir(), ".codex/state_5.sqlite"),
        { readOnly: true, initialize: false },
      );
      try {
        for (const r of s.all<{ id: string; rollout_path: string }>(
          "SELECT id,rollout_path FROM threads",
        ))
          this.nativePaths.set(r.id, r.rollout_path);
      } finally {
        s.close();
      }
    } catch {
      this.sourceGaps.push("Codex state mapping unavailable");
    }
    try {
      const t = openDatabase(
        opts.t3Db ?? join(homedir(), ".t3/userdata/statev2.sqlite"),
        { readOnly: true, initialize: false },
      );
      try {
        for (const r of t.all<{ thread_id: string; payload_json: string }>(
          "SELECT thread_id,payload_json FROM orchestration_v2_projection_provider_threads",
        )) {
          const n = parse<SourceRecord>(r.payload_json).nativeThreadRef
            ?.nativeId;
          if (n)
            this.t3Native.set(r.thread_id, [
              ...(this.t3Native.get(r.thread_id) ?? []),
              n,
            ]);
        }
      } finally {
        t.close();
      }
    } catch {
      this.sourceGaps.push("T3 native-thread mapping unavailable");
    }
  }
  close() {
    for (const d of this.connections.values()) d.close();
  }
  database(path: string) {
    if (!this.connections.has(path))
      this.connections.set(
        path,
        openDatabase(path, { readOnly: true, initialize: false }),
      );
    return this.connections.get(path)!;
  }
  sessionMetadata(o: SourceRecord): SourceRecord {
    const mapped = this.t3Native.get(o.thread_id) ?? [];
    if (!o.native_thread_id && !o.original_rollout && mapped.length > 1)
      return {
        mapping_candidates: mapped.length,
        gap: "multiple recorded provider sessions; observation does not identify one",
      };
    const candidates = [
      o.original_rollout,
      ...[o.native_thread_id, ...mapped].map((n) => this.nativePaths.get(n)),
    ].filter((p): p is string => typeof p === "string");
    const found: SourceRecord[] = [];
    for (const path of new Set(candidates)) {
      if (!this.sessions.has(path)) {
        let result: SourceRecord = {};
        try {
          const fd = openSync(path, "r"),
            prefix = Buffer.alloc(Math.min(statSync(path).size, 1024 * 1024));
          try {
            readSync(fd, prefix);
          } finally {
            closeSync(fd);
          }
          for (const line of prefix
            .toString("utf8")
            .split(/\r?\n/)
            .slice(0, 32)) {
            const r = parse<SourceRecord>(line);
            if (r.type === "session_meta") {
              const p = r.payload ?? {};
              result = {
                ...Object.fromEntries(
                  ["id", "cwd", "git", "source", "originator", "timestamp"].map(
                    (k) => [k, p[k] ?? null],
                  ),
                ),
                timestamp: p.timestamp ?? r.timestamp ?? null,
                provenance: {
                  path,
                  record_sha256: digest(line),
                  lookup:
                    "first 32 lines within 1 MiB; state/provider mapping is a locator only",
                },
              };
              break;
            }
          }
        } catch {}
        this.sessions.set(path, result);
      }
      const candidate = this.sessions.get(path)!;
      if (!Object.keys(candidate).length) continue;
      const started = timestamp(candidate.timestamp),
        observed = timestamp(o.timestamp ?? o.timestamp_ms);
      if (started !== undefined && observed !== undefined && started > observed)
        continue;
      if (
        !o.native_thread_id &&
        !o.original_rollout &&
        (started === undefined || observed === undefined)
      )
        continue;
      found.push(candidate);
    }
    return found.length === 1
      ? found[0]
      : {
          mapping_candidates: found.length,
          gap: "no unique recorded session metadata",
        };
  }
  rollout(path: string, targets: Set<number>) {
    const selected = new Map<number, [Entry[], SourceRecord]>();
    let recent: Entry[] = [],
      assignment: Entry | undefined,
      user: Entry | undefined,
      instructions: Entry | undefined,
      meta: SourceRecord = {},
      session: Entry[] = [],
      developers: Entry[] = [],
      errors: number[] = [],
      scanned = 0;
    const hash = createHash("sha256"),
      size = statSync(path).size;
    for (const { line: n, raw } of lines(path, MAX_SCAN)) {
      scanned += raw.length;
      hash.update(raw);
      if (targets.has(n)) {
        const unique = new Map<string, Entry>();
        for (const e of [
          ...session,
          ...developers,
          assignment,
          user,
          instructions,
          ...recent,
        ])
          if (e) unique.set(e[0] + ":" + e[1], e);
        selected.set(n, [[...unique.values()], { ...meta }]);
      }
      let r: SourceRecord;
      try {
        r = parse(decode(raw));
      } catch {
        errors.push(n);
        continue;
      }
      const p = r.payload;
      if (!p || typeof p !== "object" || Array.isArray(p)) continue;
      if (r.type === "session_meta") {
        meta = Object.fromEntries(
          ["id", "cwd", "git", "source", "originator"].map((k) => [
            k,
            p[k] ?? null,
          ]),
        );
        for (const key of ["base_instructions", "developer_instructions"]) {
          const value = typeof p[key] === "object" ? p[key]?.text : p[key];
          if (typeof value === "string")
            session.push([n, "recorded_" + key, value, digest(raw)]);
        }
      }
      if (r.type === "turn_context")
        instructions = [n, "recorded_turn_context", canonical(p), digest(raw)];
      const txt = textOf(p);
      if (!txt) continue;
      const kind = p.role ?? p.type ?? r.type;
      if (["developer", "system"].includes(kind) && r.type === "response_item")
        developers = [
          ...developers,
          [n, "recorded_" + kind + "_instructions", txt, digest(raw)] as Entry,
        ].slice(-8);
      if (kind === "user") {
        user = [n, "preceding_user", txt, digest(raw)];
        assignment ??= [n, "first_recorded_user", txt, digest(raw)];
      }
      if (
        r.type === "response_item" &&
        [
          "user",
          "assistant",
          "function_call",
          "function_call_output",
          "custom_tool_call",
          "custom_tool_call_output",
        ].includes(kind)
      )
        recent = [
          ...recent,
          [n, "preceding_" + kind, txt, digest(raw)] as Entry,
        ].slice(-MAX_RECORDS);
    }
    const binding = {
      path,
      prefix_sha256: hash.digest("hex"),
      bytes_scanned: scanned,
      initial_bytes: size,
      omitted_bytes: Math.max(0, size - scanned),
      parse_error_lines: errors.slice(0, 100),
      parse_error_count: errors.length,
      selection:
        "session base/developer instructions, last 8 developer/system response items, first recorded user, latest preceding user, latest turn context, last 12 text response items; older items omitted and prior unrelated turns may occur",
    };
    return { selected, binding };
  }
  t3Tools(path: string, tid: string) {
    const key = canonical([path, tid]);
    if (!this.toolCache.has(key)) {
      if (this.toolCache.size >= 8)
        this.toolCache.delete(this.toolCache.keys().next().value!);
      const rows = this.database(path).all<SourceRecord>(
        "SELECT json_extract(payload_json,'$.startedAt') stamp,turn_item_id FROM orchestration_v2_projection_turn_items WHERE thread_id=? AND json_extract(payload_json,'$.startedAt') IS NOT NULL ORDER BY json_extract(payload_json,'$.startedAt') DESC LIMIT 20001",
        tid,
      );
      this.toolCache.set(key, {
        rows: rows
          .slice(0, 20000)
          .filter((r) => typeof r.stamp === "string")
          .map((r) => [r.stamp, r.turn_item_id] as [string, string])
          .sort(([a, x], [b, y]) => (a < b ? -1 : a > b ? 1 : x < y ? -1 : 1)),
        capped: rows.length > 20000,
      });
    }
    return this.toolCache.get(key)!;
  }
  recoverGroup(rows: RecoveryRow[]) {
    const obs = rows.map((r) => parse<SourceRecord>(r.record_json)),
      path = obs[0].locator,
      source = obs[0].source;
    let roll = new Map<number, [Entry[], SourceRecord]>(),
      binding: SourceRecord = {},
      failure: string | null = null;
    if (source === "codex_rollout")
      try {
        const result = this.rollout(path, new Set(obs.map((o) => o.line)));
        roll = result.selected;
        binding = result.binding;
      } catch (e) {
        failure = String(e);
      }
    rows.forEach((row, i) => {
      const o = obs[i],
        cid = row.context_id,
        gaps: SourceRecord[] = [];
      let meta: SourceRecord =
        source === "codex_rollout" ? {} : this.sessionMetadata(o);
      let bind: SourceRecord = source === "codex_rollout" ? binding : {};
      let records: [string, string][] = [];
      if (source === "codex_rollout") {
        const [entries, session] = roll.get(o.line) ?? [[], {}];
        meta = session;
        if (!roll.has(o.line))
          gaps.push({
            reason: "rollout_unavailable_or_target_outside_scan",
            error: failure,
          });
        for (const [line, kind, text, hash] of entries)
          addEvidence(this.db, cid, kind, text, {
            ...bind,
            line,
            record_sha256: hash,
          });
        gaps.push({ reason: "bounded_preceding_selection", ...bind });
      } else if (
        [
          "t3_messages",
          "t3_turn_items",
          "t3_subagents",
          "codex_history",
        ].includes(source)
      )
        try {
          const d = this.database(path);
          if (source === "codex_history") {
            const anchor = d.get<{
              rollout_ordinal: number;
              item_json: string;
            }>(
              "SELECT rollout_ordinal,item_json FROM thread_items WHERE thread_id=? AND item_id=? ORDER BY rollout_ordinal LIMIT 1",
              o.native_thread_id,
              o.item_id,
            );
            if (anchor) {
              records = d
                .all<{ item_id: string; item_json: string }>(
                  "SELECT item_id,item_json FROM thread_items WHERE thread_id=? AND rollout_ordinal<? ORDER BY rollout_ordinal DESC LIMIT ?",
                  o.native_thread_id,
                  anchor.rollout_ordinal,
                  MAX_RECORDS,
                )
                .map((r) => [r.item_id, r.item_json]);
              const first = d.get<{ item_id: string; item_json: string }>(
                "SELECT item_id,item_json FROM thread_items WHERE thread_id=? AND item_type='userMessage' AND rollout_ordinal<? ORDER BY rollout_ordinal LIMIT 1",
                o.native_thread_id,
                anchor.rollout_ordinal,
              );
              if (first) records.push([first.item_id, first.item_json]);
              bind = {
                database: path,
                anchor_sha256: digest(anchor.item_json),
                anchor_ordinal: anchor.rollout_ordinal,
              };
            } else gaps.push({ reason: "history_anchor_missing" });
          } else {
            const [table, idcol] = (
              {
                t3_messages: [
                  "orchestration_v2_projection_messages",
                  "message_id",
                ],
                t3_turn_items: [
                  "orchestration_v2_projection_turn_items",
                  "turn_item_id",
                ],
                t3_subagents: [
                  "orchestration_v2_projection_subagents",
                  "subagent_id",
                ],
              } as Record<string, string[]>
            )[source];
            const anchor = d.get<{ payload_json: string }>(
              `SELECT payload_json FROM ${table} WHERE ${idcol}=?`,
              o.item_id,
            );
            bind = {
              database: path,
              anchor_sha256: anchor ? digest(anchor.payload_json) : null,
            };
            if (!anchor) gaps.push({ reason: "t3_anchor_missing" });
            if (o.timestamp) {
              records = d
                .all<{ message_id: string; payload_json: string }>(
                  "SELECT message_id,payload_json FROM orchestration_v2_projection_messages WHERE thread_id=? AND created_at<? ORDER BY created_at DESC LIMIT ?",
                  o.thread_id,
                  o.timestamp,
                  MAX_RECORDS,
                )
                .map((r) => [r.message_id, r.payload_json]);
              const first = d.get<{ message_id: string; payload_json: string }>(
                "SELECT message_id,payload_json FROM orchestration_v2_projection_messages WHERE thread_id=? AND role='user' AND created_at<? ORDER BY created_at LIMIT 1",
                o.thread_id,
                o.timestamp,
              );
              if (first) records.push([first.message_id, first.payload_json]);
              const tools = this.t3Tools(path, o.thread_id),
                eligible = tools.rows
                  .filter(([stamp]) => stamp < o.timestamp)
                  .slice(-4);
              for (const [, id] of eligible) {
                const r = d.get<{ turn_item_id: string; payload_json: string }>(
                  "SELECT turn_item_id,payload_json FROM orchestration_v2_projection_turn_items WHERE turn_item_id=?",
                  id,
                );
                if (r) records.push([r.turn_item_id, r.payload_json]);
              }
              if (tools.capped)
                gaps.push({
                  reason: "tool_index_cap",
                  most_recent_tool_records_retained: 20000,
                  older_records_omitted: true,
                });
            } else
              gaps.push({
                reason:
                  "historical_timestamp_unavailable_no_preceding_order_assumed",
              });
          }
          for (const [id, raw] of records) {
            const p = parse<SourceRecord>(raw),
              text = textOf(p);
            if (text)
              addEvidence(
                this.db,
                cid,
                "preceding_recorded_" + (p.role ?? p.type ?? "item"),
                text,
                {
                  ...bind,
                  item_id: id,
                  record_sha256: digest(raw),
                  selection:
                    "first preceding user plus up to 12 preceding messages and 4 tools",
                },
                source === "t3_messages" ? "unknown" : "sender_context",
              );
          }
          gaps.push({
            reason:
              "bounded_projection_context; earlier context and provider-private state not reconstructed",
            selected_records: records.length,
          });
        } catch (e) {
          gaps.push({ reason: "source_unavailable", error: String(e) });
        }
      else if (source === "audit_cache")
        try {
          if (statSync(path).size > MAX_SCAN)
            throw Error("cache exceeds bound");
          if (!this.caches.has(path)) {
            const fd = openSync(path, "r"),
              buffer = Buffer.alloc(statSync(path).size);
            try {
              readSync(fd, buffer);
            } finally {
              closeSync(fd);
            }
            this.caches.set(path, {
              records: parse<SourceRecord[]>(buffer.toString()),
              hash: digest(buffer),
            });
          }
          const cache = this.caches.get(path)!,
            r = cache.records[Number(o.item_id)];
          if (r.context)
            addEvidence(
              this.db,
              cid,
              "recorded_cache_context",
              canonical(r.context),
              { path, sha256: cache.hash, index: o.item_id },
              "unknown",
            );
          gaps.push({
            reason:
              "cache_only; original conversation ordering and recipient access unavailable",
            original_rollout: o.original_rollout ?? null,
          });
        } catch (e) {
          gaps.push({ reason: "cache_unavailable", error: String(e) });
        }
      addEvidence(
        this.db,
        cid,
        "recorded_handoff_body",
        row.text,
        {
          observation_id: row.observation_id,
          source,
          locator: path,
          line: o.line ?? null,
          item_id: o.item_id ?? null,
          body_sha256: row.message_id,
        },
        (INPUT_KINDS.has(o.kind) ||
          ["native_agent_prompt", "native_agent_message"].includes(o.kind)) &&
          source !== "audit_cache"
          ? "recipient_visible"
          : "unknown",
      );
      gaps.push({
        reason:
          "recipient_access_to_sender_history_unknown; mirrors_not_unique_deliveries",
      });
      this.references(cid, row.text, meta, o);
      this.db.run(
        "UPDATE contexts SET status=?,metadata_json=? WHERE context_id=?",
        this.hasAuxiliary(cid) ? "partial" : "unavailable",
        canonical({
          gaps,
          historical_session: meta,
          source_binding: bind,
          collector_version: "context-collector-1",
        }),
        cid,
      );
    });
  }
  hasAuxiliary(cid: string) {
    return (
      Number(
        this.db.get<{ n: number }>(
          "SELECT count(*) n FROM context_evidence ce JOIN evidence e USING(evidence_id) WHERE context_id=? AND kind!='recorded_handoff_body'",
          cid,
        )!.n,
      ) +
        Number(
          this.db.get<{ n: number }>(
            "SELECT count(*) n FROM context_references WHERE context_id=? AND json_extract(record_json,'$.availability')='recovered'",
            cid,
          )!.n,
        ) >
      0
    );
  }
  references(cid: string, text: string, meta: SourceRecord, o: SourceRecord) {
    const cwd = meta.cwd ?? o.cwd,
      revision = meta.git?.commit_hash ?? null;
    const paths = [
      ...new Set(
        text.match(
          /(?<![\w])(?:\/[\w.~-]+)+(?:\.[\w-]+)?|(?:[\w.-]+\/)*[\w.-]+\.(?:md|rs|py|ts|json|toml|yaml|yml)\b|\b[A-Z][A-Z0-9]+-\d+\b/g,
        ) ?? [],
      ),
    ];
    if (revision && cwd)
      for (const p of ["AGENTS.md", "SPEC.md", "README.md"])
        if (!paths.includes(p)) paths.push(p);
    paths.slice(0, 24).forEach((path, i) => {
      const ref: SourceRecord = {
        path,
        historical_revision: revision,
        availability: "unavailable",
        text: null,
        visibility: "unknown",
        provenance: {
          recorded_cwd: cwd ?? null,
          revision_source: revision
            ? "recorded_session_meta.git.commit_hash"
            : null,
        },
      };
      if (/^[A-Z][A-Z0-9]+-\d+$/.test(path))
        ref.reason = "issue tracker unavailable offline; identifier only";
      else if (!cwd || !revision)
        ref.reason =
          "historical repository revision unavailable; current documents not used";
      else {
        const key = canonical([cwd, revision, path]);
        if (!this.refs.has(key))
          this.refs.set(key, this.gitReference(cwd, revision, path));
        Object.assign(ref, this.refs.get(key));
      }
      this.db.run(
        "INSERT OR IGNORE INTO context_references VALUES(?,?,?)",
        "ref-" + digest(cid + ":" + i + ":" + path),
        cid,
        canonical(ref),
      );
    });
    if (paths.length > 24)
      this.db.run(
        "INSERT OR IGNORE INTO context_references VALUES(?,?,?)",
        "ref-" + digest(cid + ":cap"),
        cid,
        canonical({
          path: null,
          availability: "omitted",
          reason: "reference cap",
          candidate_count: paths.length,
          omitted_count: paths.length - 24,
        }),
      );
  }
  gitReference(cwd: string, revision: string, path: string): SourceRecord {
    if (!/^[0-9a-fA-F]{40,64}$/.test(revision))
      return { reason: "invalid recorded revision" };
    const git = (dir: string, args: string[]) =>
      spawnSync("git", ["-c", "protocol.allow=never", "-C", dir, ...args], {
        timeout: 5000,
        maxBuffer: MAX_FILE + 1024,
        env: {
          ...process.env,
          GIT_NO_LAZY_FETCH: "1",
          GIT_TERMINAL_PROMPT: "0",
          GIT_OPTIONAL_LOCKS: "0",
          GIT_NO_REPLACE_OBJECTS: "1",
        },
      });
    try {
      if (!this.repos.has(cwd)) {
        const r = git(cwd, ["rev-parse", "--show-toplevel"]);
        this.repos.set(cwd, r.status === 0 ? r.stdout.toString().trim() : null);
      }
      const root = this.repos.get(cwd);
      if (!root) return { reason: "recorded repository unavailable" };
      const name = relative(root, resolve(cwd, path));
      if (name === ".." || name.startsWith("../") || isAbsolute(name))
        return { reason: "reference outside recorded repository" };
      const spec = revision + ":" + name,
        size = git(root, ["cat-file", "-s", spec]);
      if (size.status)
        return { reason: "path or revision unavailable in local git objects" };
      const n = Number(size.stdout.toString());
      if (n > MAX_FILE)
        return {
          reason: "historical blob exceeds 65536-byte cap",
          omitted_bytes: n,
        };
      const result = git(root, ["show", spec]);
      if (result.status || result.stdout.includes(0))
        return { reason: "historical blob unavailable or nontext" };
      const text = new TextDecoder("utf-8", { fatal: true }).decode(
        result.stdout,
      );
      return {
        availability: "recovered",
        text,
        blob_sha256: digest(result.stdout),
        repository: root,
        repository_path: name,
        reason:
          "recorded session revision; this does not prove recipient read access or file state at handoff time",
      };
    } catch {
      return { reason: "historical git read failed" };
    }
  }
  cacheOrigins() {
    const groups = new Map<string, SourceRecord[]>();
    for (const row of this.db.all<SourceRecord>(
      "SELECT c.context_id,c.message_id,c.metadata_json,o.record_json FROM contexts c JOIN observations o USING(observation_id) JOIN messages m ON m.message_id=c.message_id WHERE o.source='audit_cache' AND m.is_input=1 AND json_extract(c.metadata_json,'$.cache_original_rollout_recovery') IS NULL",
    )) {
      const o = parse<SourceRecord>(row.record_json);
      if (o.original_rollout)
        groups.set(o.original_rollout, [
          ...(groups.get(o.original_rollout) ?? []),
          row,
        ]);
    }
    for (const [path, rows] of groups) {
      const wanted = new Set(rows.map((r) => r.message_id)),
        anchors = new Map<string, number[]>(),
        matches = new Map<string, number>();
      let errors = 0,
        scanned = 0,
        size = 0,
        failure: string | null = null;
      const hash = createHash("sha256");
      let selected = new Map<number, [Entry[], SourceRecord]>(),
        binding: SourceRecord = {};
      try {
        size = statSync(path).size;
        for (const { line, raw } of lines(path, MAX_SCAN)) {
          scanned += raw.length;
          hash.update(raw);
          try {
            const p = parse<SourceRecord>(decode(raw)).payload ?? {};
            let a = p.arguments;
            if (typeof a === "string")
              try {
                a = JSON.parse(a);
              } catch {
                a = null;
              }
            const found = new Set(
              [
                textOf(p),
                p.text,
                p.message,
                p.prompt,
                a?.task,
                a?.message,
                a?.prompt,
              ]
                .filter((x) => typeof x === "string" && x)
                .map(digest),
            );
            for (const mid of found)
              if (wanted.has(mid)) {
                matches.set(mid, (matches.get(mid) ?? 0) + 1);
                if ((anchors.get(mid) ?? []).length < 3)
                  anchors.set(mid, [...(anchors.get(mid) ?? []), line]);
              }
          } catch {
            errors++;
          }
        }
        if (anchors.size) {
          const result = this.rollout(
            path,
            new Set([...anchors.values()].flat()),
          );
          selected = result.selected;
          binding = result.binding;
        } else
          binding = {
            prefix_sha256: hash.copy().digest("hex"),
            bytes_scanned: scanned,
            initial_bytes: size,
            omitted_bytes: Math.max(0, size - scanned),
          };
      } catch (e) {
        failure = String(e);
      }
      const scanHash = hash.digest("hex"),
        changed = anchors.size > 0 && binding.prefix_sha256 !== scanHash;
      if (changed) selected.clear();
      this.db.transaction(() => {
        for (const row of rows) {
          const cid = row.context_id,
            mid = row.message_id,
            info = {
              path,
              exact_body_matches: matches.get(mid) ?? 0,
              anchor_lines: anchors.get(mid) ?? [],
              omitted_anchor_count: Math.max(0, (matches.get(mid) ?? 0) - 3),
              scan_parse_errors: errors,
              source_binding: binding,
              matching_scan_sha256: scanHash,
              source_changed_between_passes: changed,
              error: failure,
              limitation:
                "exact body match links evidence only; delivery identity and recipient visibility are unproven",
            };
          for (const anchor of anchors.get(mid) ?? [])
            for (const [n, kind, text, recordHash] of selected.get(
              anchor,
            )?.[0] ?? [])
              addEvidence(
                this.db,
                cid,
                "cache_origin_" + kind,
                text,
                {
                  ...binding,
                  path,
                  line: n,
                  record_sha256: recordHash,
                  matched_body_line: anchor,
                  link_basis: "exact body hash in referenced rollout",
                },
                "unknown",
              );
          const meta = parse<SourceRecord>(row.metadata_json);
          meta.cache_original_rollout_recovery = info;
          if (!matches.get(mid))
            meta.gaps = [
              ...(meta.gaps ?? []),
              {
                reason:
                  "referenced_cache_rollout_has_no_exact_recorded_body_match_within_scan",
              },
            ];
          this.db.run(
            "UPDATE contexts SET status=?,metadata_json=? WHERE context_id=?",
            this.hasAuxiliary(cid) ? "partial" : "unavailable",
            canonical(meta),
            cid,
          );
        }
      });
    }
  }
}
export function recover(
  db: ResearchDatabase,
  opts: ConstructorParameters<typeof Recovery>[1] = {},
) {
  db.transaction(() =>
    db.run(
      "UPDATE contexts SET status='unavailable',metadata_json=? WHERE status='pending' AND message_id IN (SELECT message_id FROM messages WHERE is_input=0)",
      canonical({
        gaps: [
          {
            reason:
              "non_input_output_path_not_enriched; body and provenance retained",
          },
        ],
      }),
    ),
  );
  const r = new Recovery(db, opts),
    groups = new Map<string, RecoveryRow[]>();
  try {
    for (const row of db.all<RecoveryRow>(
      "SELECT c.context_id,c.observation_id,c.message_id,o.record_json,m.text FROM contexts c JOIN observations o USING(observation_id) JOIN messages m ON m.message_id=c.message_id WHERE c.status='pending' ORDER BY o.export_line",
    )) {
      const o = parse<SourceRecord>(row.record_json),
        key = canonical([o.source, o.locator]);
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }
    for (const [key, rows] of groups) {
      const batch =
        parse<string[]>(key)[0] === "codex_rollout" ? rows.length : 100;
      for (let i = 0; i < rows.length; i += batch)
        db.transaction(() => r.recoverGroup(rows.slice(i, i + batch)));
    }
    r.cacheOrigins();
  } finally {
    r.close();
  }
}
