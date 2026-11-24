/**
 * Read-only API for the review dashboard in `dashboard/`.
 *
 * Every endpoint answers GET only, opens SQLite read-only and returns JSON.
 * Aggregates use the stored hook reports in `mechanical_results`; the
 * single-message endpoint also runs the current hook binary on that message so
 * the reader always shows the current rules.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { resolve } from "node:path";
import {
  openDatabase,
  type ResearchDatabase,
} from "../tooling/db/connection.ts";
import {
  DIMENSIONS,
  ISSUE_KINDS,
  RUBRIC_VERSION,
  verdict,
  type Review,
  type Verdict,
} from "../tooling/reviews.ts";

const ROOT = resolve(import.meta.dirname, "..");
export const PREFIX = "/api";
const ID = /^[a-f0-9]{64}$/;
const STRATA = ["random", "pilot", "fused", "long"] as const;
const SIZE_BUCKETS = [
  { key: "under 500", max: 500 },
  { key: "500–1,999", max: 2000 },
  { key: "2,000–4,999", max: 5000 },
  { key: "5,000–11,999", max: 12000 },
  { key: "12,000 and over", max: Infinity },
];
const EXCERPT = 1000;

export interface DashboardApiOptions {
  database: string;
  rubric?: string;
  guard?: string;
  /** Milliseconds allowed for one live hook run. */
  guardTimeout?: number;
}

/** The hook report as printed by `handoff-guard inspect`. Rendered generically. */
export interface HookCheck {
  rule: string;
  category?: string;
  status: string;
  reason?: string | null;
  measurements?: Record<string, unknown>;
  thresholds?: Record<string, unknown>;
  spans?: { start: number; end: number; [k: string]: unknown }[];
  [k: string]: unknown;
}
export interface HookReport {
  blocked: boolean;
  decision_rule?: string | null;
  checks: HookCheck[];
  [k: string]: unknown;
}
type Basis = "recorded" | "thread";
type ReviewerClass = "bad" | "fine" | "unknown" | "unreviewed";
type HookClass = "blocked" | "warned" | "passed" | "unassessed";

interface Input {
  id: string;
  characters: number;
  words: number;
  kinds: string[];
  project: string;
  first_seen: string | null;
  month: string | null;
  size: string;
  recorded_model: string | null;
  thread_model: string | null;
  thread_title: string | null;
  hook: {
    blocked: boolean;
    decision_rule: string | null;
    flags: { rule: string; status: string }[];
    statuses: Record<string, string>;
  } | null;
}
interface Sample {
  run_id: string;
  message_id: string;
  stratum: string;
  split: string | null;
  context_id: string | null;
}
interface ReviewRow {
  run_id: string;
  reviewer: string | null;
  rubric_version: string | null;
  message_id: string;
  record: Review;
  verdict: Verdict;
}
interface Index {
  version: number;
  loaded_at: string;
  bodies: number;
  inputs: Input[];
  byId: Map<string, Input>;
  runs: {
    run_id: string;
    reviewer: string | null;
    rubric_version: string | null;
    created_at: string;
    sampled: number;
    reviewed: number;
  }[];
  samples: Map<string, Sample[]>;
  reviews: Map<string, ReviewRow[]>;
  hookRun: {
    run_id: string;
    created_at: string;
    binary_sha256: string | null;
  } | null;
}

const decode = <T = any>(value: unknown): T | null =>
  typeof value === "string" && value ? (JSON.parse(value) as T) : null;
const scalars = (text: string) => Array.from(text).length;

/** Wilson score interval for k of n at 95%. */
export function wilson(k: number, n: number) {
  if (!n) return null;
  const z = 1.959963984540054,
    p = k / n,
    d = 1 + (z * z) / n,
    c = (p + (z * z) / (2 * n)) / d,
    h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return { k, n, p, low: Math.max(0, c - h), high: Math.min(1, c + h) };
}

function sizeBucket(characters: number) {
  return SIZE_BUCKETS.find((b) => characters < b.max)!.key;
}
function mostCommon(values: (string | null | undefined)[]) {
  const counts = new Map<string, number>();
  for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0] ?? null;
}
function timestampOf(o: any): string | null {
  const raw = o.timestamp ?? o.timestamp_ms ?? null;
  if (raw === null || raw === "") return null;
  const n = typeof raw === "number" || /^\d{12,}$/.test(String(raw)) ? Number(raw) : NaN;
  const date = Number.isFinite(n) ? new Date(n) : new Date(String(raw));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
function reviewerClass(
  rows: ReviewRow[] | undefined,
  criterion: string,
): ReviewerClass {
  const r = rows?.[0];
  if (!r) return "unreviewed";
  if (criterion === "presentation") {
    const s = r.record.presentation?.score;
    return s === null || s === undefined ? "unknown" : s <= 2 ? "bad" : "fine";
  }
  return r.verdict === "unknown"
    ? "unknown"
    : r.verdict === "send"
      ? "fine"
      : "bad";
}
function scoreKey(rows: ReviewRow[] | undefined, d: "intent" | "content" | "presentation") {
  if (!rows?.length) return "none";
  return String(rows[0].record[d]?.score ?? "null");
}
function hookClass(input: Input): HookClass {
  if (!input.hook) return "unassessed";
  if (input.hook.blocked) return "blocked";
  return input.hook.flags.length ? "warned" : "passed";
}
function modelOf(input: Input, basis: Basis) {
  return (
    input.recorded_model ??
    (basis === "thread" ? input.thread_model : null) ??
    "unknown"
  );
}
function modelBasis(input: Input) {
  return input.recorded_model
    ? "recorded"
    : input.thread_model
      ? "thread"
      : null;
}

function choice<T extends string>(
  params: URLSearchParams,
  name: string,
  allowed: readonly T[],
  fallback: T,
): T {
  const value = params.get(name);
  if (value === null || value === "") return fallback;
  if (!(allowed as readonly string[]).includes(value))
    throw new RangeError(`Invalid ${name}: use one of ${allowed.join(", ")}`);
  return value as T;
}
function integer(
  params: URLSearchParams,
  name: string,
  fallback: number,
  min: number,
  max: number,
) {
  const raw = params.get(name);
  if (raw === null || raw === "") return fallback;
  if (!/^\d+$/.test(raw) || Number(raw) < min || Number(raw) > max)
    throw new RangeError(`Invalid ${name}: use a whole number from ${min} to ${max}`);
  return Number(raw);
}

/** Run the hook binary on one message. Resolves to null when it is missing. */
export function inspect(
  binary: string,
  message_id: string,
  text: string,
  timeout = 10000,
): Promise<{ report: HookReport | null; error: string | null }> {
  if (!existsSync(binary))
    return Promise.resolve({ report: null, error: "Hook binary not found at " + binary });
  return new Promise((done) => {
    const child = spawn(binary, ["inspect"], { stdio: ["pipe", "pipe", "pipe"] });
    let out = "",
      err = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      done({ report: null, error: `Hook did not answer within ${timeout} ms` });
    }, timeout);
    child.stdout.setEncoding("utf8").on("data", (d) => (out += d));
    child.stderr.setEncoding("utf8").on("data", (d) => (err += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      done({ report: null, error: e.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const line = out.split("\n").find((l) => l.trim());
      try {
        if (!line) throw new Error(err.trim() || `Hook exited with code ${code} and no report`);
        done({ report: JSON.parse(line), error: null });
      } catch (e) {
        done({ report: null, error: e instanceof Error ? e.message : String(e) });
      }
    });
    // A binary that exits without reading closes the pipe. The close handler
    // above reports that; without this listener the EPIPE would crash Node.
    child.stdin.on("error", () => {});
    child.stdin.end(JSON.stringify({ message_id, text }) + "\n");
  });
}

function sha256(path: string) {
  try {
    return createHash("sha256").update(readFileSync(path)).digest("hex");
  } catch {
    return null;
  }
}

/** Pull readable prose out of a recorded tool-call envelope, if there is one. */
export function evidenceProse(raw: string): string {
  try {
    const value = JSON.parse(raw);
    for (let candidate of [value?.input, value?.arguments, value]) {
      if (typeof candidate === "string") {
        try {
          candidate = JSON.parse(candidate);
        } catch {
          continue;
        }
      }
      if (!candidate || typeof candidate !== "object") continue;
      for (const key of ["message", "prompt", "task", "text"])
        if (typeof candidate[key] === "string") return candidate[key];
      if (Array.isArray(candidate.content)) {
        const texts = candidate.content
          .filter((c: any) => c?.type === "text" && typeof c.text === "string")
          .map((c: any) => c.text);
        if (texts.length) return texts.join("\n\n");
      }
    }
  } catch {}
  return raw;
}
function excerpt(text: string) {
  const chars = Array.from(text);
  return chars.length <= EXCERPT
    ? { text, characters: chars.length, omitted: 0 }
    : {
        text: chars.slice(0, EXCERPT).join(""),
        characters: chars.length,
        omitted: chars.length - EXCERPT,
      };
}

export function createDashboardApi(options: DashboardApiOptions) {
  const rubricPath = options.rubric ?? resolve(ROOT, "docs/communication-rubric.md");
  const guard = options.guard ?? resolve(ROOT, "target/release/handoff-guard");
  let db: ResearchDatabase | undefined;
  let index: Index | undefined;
  let guardHash: { mtime: number; sha: string | null } | undefined;

  function database() {
    db ??= openDatabase(options.database, { readOnly: true, initialize: false });
    return db;
  }
  function has(table: string) {
    return !!database().get(
      "SELECT 1 FROM sqlite_master WHERE name=? AND type IN ('table','view')",
      table,
    );
  }
  function guardSha() {
    try {
      const mtime = statSync(guard).mtimeMs;
      if (guardHash?.mtime !== mtime) guardHash = { mtime, sha: sha256(guard) };
      return guardHash.sha;
    } catch {
      return null;
    }
  }

  /** Rebuild the in-memory index whenever another connection has committed. */
  function load(): Index {
    const d = database();
    const version = Number(Object.values(d.get("PRAGMA data_version")!)[0]);
    if (index && index.version === version) return index;
    const inputs: Input[] = [];
    const byId = new Map<string, Input>();
    for (const m of d.all<any>(
      "SELECT message_id,characters,words,kinds,projects FROM messages WHERE is_input=1",
    )) {
      const projects = decode<string[]>(m.projects) ?? [];
      const input: Input = {
        id: m.message_id,
        characters: m.characters,
        words: m.words,
        kinds: decode<string[]>(m.kinds) ?? [],
        project: projects.filter((p) => p !== "unknown")[0] ?? "unknown",
        first_seen: null,
        month: null,
        size: sizeBucket(m.characters),
        recorded_model: null,
        thread_model: null,
        thread_title: null,
        hook: null,
      };
      inputs.push(input);
      byId.set(input.id, input);
    }
    const observed = new Map<string, any[]>();
    for (const o of d.all<{ message_id: string; record_json: string }>(
      "SELECT o.message_id,o.record_json FROM observations o JOIN messages m USING(message_id) WHERE m.is_input=1",
    )) {
      const list = observed.get(o.message_id) ?? [];
      list.push(JSON.parse(o.record_json));
      observed.set(o.message_id, list);
    }
    for (const [id, list] of observed) {
      const input = byId.get(id);
      if (!input) continue;
      const times = list.map(timestampOf).filter((t): t is string => !!t).sort();
      input.first_seen = times[0] ?? null;
      input.month = input.first_seen?.slice(0, 7) ?? null;
      input.recorded_model = mostCommon(list.map((o) => o.model));
      // A t3_messages record belongs to the recipient's thread, so its saved
      // model selection describes the recipient, not the sender.
      input.thread_model = mostCommon(
        list.filter((o) => o.source !== "t3_messages").map((o) => o.saved_model_selection),
      );
      input.thread_title = mostCommon(list.map((o) => o.thread_title));
      if (input.project === "unknown")
        input.project = mostCommon(list.map((o) => o.project)) ?? "unknown";
    }
    let hookRun: Index["hookRun"] = null;
    if (has("mechanical_results")) {
      for (const r of d.all<{ message_id: string; result_json: string }>(
        // Only the newest run counts. Mixing in older runs would report results
        // from rules the current binary no longer has.
        `SELECT message_id,result_json FROM mechanical_results
          WHERE run_id=(SELECT run_id FROM mechanical_runs ORDER BY created_at DESC,run_id DESC LIMIT 1)`,
      )) {
        const input = byId.get(r.message_id);
        const report = decode<HookReport>(r.result_json);
        if (!input || !report) continue;
        const checks = Array.isArray(report.checks) ? report.checks : [];
        input.hook = {
          blocked: !!report.blocked,
          decision_rule: report.decision_rule ?? null,
          flags: checks
            .filter((c) => c.status !== "pass")
            .map((c) => ({ rule: c.rule, status: c.status })),
          statuses: Object.fromEntries(checks.map((c) => [c.rule, c.status])),
        };
      }
      const run = d.get<any>(
        "SELECT run_id,created_at,metadata_json FROM mechanical_runs ORDER BY created_at DESC,run_id DESC LIMIT 1",
      );
      if (run)
        hookRun = {
          run_id: run.run_id,
          created_at: run.created_at,
          binary_sha256: decode<any>(run.metadata_json)?.binary_sha256 ?? null,
        };
    }
    const runs: Index["runs"] = [];
    const samples = new Map<string, Sample[]>();
    const reviews = new Map<string, ReviewRow[]>();
    if (has("analysis_runs")) {
      const reviewers = new Map<string, string | null>();
      const versions = new Map<string, string | null>();
      for (const r of d.all<any>(
        "SELECT run_id,created_at,metadata_json FROM analysis_runs WHERE kind='manual-review' ORDER BY run_id",
      )) {
        const metadata = decode<any>(r.metadata_json) ?? {};
        const reviewer = metadata.reviewer ?? null;
        const rubric_version = metadata.rubric_version ?? null;
        reviewers.set(r.run_id, reviewer);
        versions.set(r.run_id, rubric_version);
        runs.push({ run_id: r.run_id, reviewer, rubric_version, created_at: r.created_at, sampled: 0, reviewed: 0 });
      }
      for (const r of d.all<any>(
        "SELECT r.run_id,r.kind,r.message_id,r.record_json FROM analysis_records r JOIN analysis_runs a USING(run_id) WHERE a.kind='manual-review' AND r.kind IN ('sample','review') ORDER BY r.run_id,r.record_key",
      )) {
        const record = JSON.parse(r.record_json);
        const id = r.message_id ?? record.message_id;
        const run = runs.find((x) => x.run_id === r.run_id)!;
        if (r.kind === "sample") {
          run.sampled++;
          const list = samples.get(id) ?? [];
          list.push({
            run_id: r.run_id,
            message_id: id,
            stratum: record.stratum ?? "unknown",
            split: record.split ?? null,
            context_id: record.context_id ?? null,
          });
          samples.set(id, list);
        } else {
          run.reviewed++;
          const list = reviews.get(id) ?? [];
          list.push({
            run_id: r.run_id,
            reviewer: reviewers.get(r.run_id) ?? null,
            rubric_version: versions.get(r.run_id) ?? null,
            message_id: id,
            record,
            verdict: verdict(record),
          });
          reviews.set(id, list);
        }
      }
    }
    const bodies = Number(Object.values(d.get("SELECT count(*) FROM messages")!)[0]);
    index = {
      version,
      loaded_at: new Date().toISOString(),
      bodies,
      inputs,
      byId,
      runs,
      samples,
      reviews,
      hookRun,
    };
    return index;
  }

  /** Inputs in the chosen sample, i.e. frozen in a review run under that stratum. */
  function inSample(ix: Index, input: Input, sample: string) {
    const list = ix.samples.get(input.id);
    if (!list) return false;
    return sample === "all" || list.some((s) => s.stratum === sample);
  }

  function meta() {
    const ix = load();
    const months = [...new Set(ix.inputs.map((i) => i.month).filter((m): m is string => !!m))].sort();
    const count = (f: (i: Input) => string) => {
      const m = new Map<string, number>();
      for (const i of ix.inputs) m.set(f(i), (m.get(f(i)) ?? 0) + 1);
      return [...m].sort((a, b) => b[1] - a[1]).map(([value, n]) => ({ value, n }));
    };
    const rules = new Map<string, { category: string | null; statuses: Record<string, number> }>();
    for (const i of ix.inputs)
      for (const [rule, status] of Object.entries(i.hook?.statuses ?? {})) {
        const r = rules.get(rule) ?? { category: null, statuses: {} };
        r.statuses[status] = (r.statuses[status] ?? 0) + 1;
        rules.set(rule, r);
      }
    const current = guardSha();
    return {
      rubric_version: RUBRIC_VERSION,
      dimensions: DIMENSIONS,
      issue_kinds: ISSUE_KINDS,
      strata: STRATA,
      size_buckets: SIZE_BUCKETS.map((b) => b.key),
      corpus: {
        bodies: ix.bodies,
        inputs: ix.inputs.length,
        with_recorded_model: ix.inputs.filter((i) => i.recorded_model).length,
        with_thread_model: ix.inputs.filter((i) => !i.recorded_model && i.thread_model).length,
        with_hook_report: ix.inputs.filter((i) => i.hook).length,
      },
      runs: ix.runs,
      sampled: ix.samples.size,
      reviewed: ix.reviews.size,
      strata_counts: STRATA.map((s) => ({
        stratum: s,
        sampled: ix.inputs.filter((i) => inSample(ix, i, s)).length,
        reviewed: ix.inputs.filter((i) => inSample(ix, i, s) && ix.reviews.has(i.id)).length,
      })),
      hook: {
        stored_run: ix.hookRun,
        binary: existsSync(guard) ? guard : null,
        binary_sha256: current,
        stored_matches_binary:
          ix.hookRun?.binary_sha256 && current ? ix.hookRun.binary_sha256 === current : null,
        rules: [...rules].map(([rule, r]) => ({ rule, statuses: r.statuses })),
      },
      facets: {
        months,
        projects: count((i) => i.project),
        kinds: count((i) => i.kinds[0] ?? "unknown"),
        models: count((i) => modelOf(i, "thread")),
        recorded_models: count((i) => modelOf(i, "recorded")),
      },
      legacy_reviews: has("reviews")
        ? Number(
            Object.values(
              database().get(
                "SELECT count(*) FROM reviews r JOIN review_runs rr USING(run_id) WHERE rr.rubric_version='intentionality-v2'",
              )!,
            )[0],
          )
        : 0,
      loaded_at: ix.loaded_at,
    };
  }

  function overview(params: URLSearchParams) {
    const ix = load();
    const sample = choice(params, "sample", [...STRATA, "all"] as const, "random");
    const criterion = choice(params, "criterion", ["verdict", "presentation"] as const, "verdict");
    const basis = choice(params, "basis", ["recorded", "thread"] as const, "recorded");
    const sampled = ix.inputs.filter((i) => inSample(ix, i, sample));
    const reviewed = sampled.filter((i) => ix.reviews.has(i.id));
    const N = reviewed.length;
    const verdicts = Object.fromEntries(
      (["send", "revise", "rewrite", "unknown"] as const).map((v) => [
        v,
        wilson(reviewed.filter((i) => ix.reviews.get(i.id)![0].verdict === v).length, N),
      ]),
    );
    const dimensions = Object.fromEntries(
      DIMENSIONS.map((d) => [
        d,
        Object.fromEntries(
          ["4", "3", "2", "1", "null"].map((s) => [
            s,
            reviewed.filter((i) => String(ix.reviews.get(i.id)![0].record[d]?.score ?? "null") === s)
              .length,
          ]),
        ),
      ]),
    );
    // Kinds come from the current rubric plus any older kind a recorded review used.
    const kindsUsed = (d: (typeof DIMENSIONS)[number]) => {
      const current = ISSUE_KINDS[d] as readonly string[];
      const seen = reviewed.flatMap((i) => (ix.reviews.get(i.id)![0].record[d]?.issues ?? []).map((x) => x.kind));
      return [...new Set([...current, ...seen])].map((kind) => ({ kind, retired: !current.includes(kind) }));
    };
    const issues = DIMENSIONS.flatMap((d) =>
      kindsUsed(d).map(({ kind, retired }) => ({
        dimension: d,
        kind,
        retired,
        ...wilson(
          reviewed.filter((i) =>
            (ix.reviews.get(i.id)![0].record[d]?.issues ?? []).some((x) => x.kind === kind),
          ).length,
          N,
        )!,
      })),
    ).filter((x) => x.n !== undefined);
    const group = (key: (i: Input) => string | null, order?: string[]) => {
      const rows = new Map<string, Input[]>();
      for (const k of order ?? []) rows.set(k, []);
      for (const i of ix.inputs) {
        const k = key(i) ?? "unknown";
        rows.set(k, [...(rows.get(k) ?? []), i]);
      }
      return [...rows].map(([k, all]) => {
        const s = all.filter((i) => inSample(ix, i, sample));
        const r = s.filter((i) => ix.reviews.has(i.id));
        const classes = r.map((i) => reviewerClass(ix.reviews.get(i.id), criterion));
        const assessed = all.filter((i) => i.hook);
        return {
          key: k,
          inputs: all.length,
          hook_blocked: wilson(assessed.filter((i) => i.hook!.blocked).length, assessed.length),
          hook_flagged: wilson(
            assessed.filter((i) => i.hook!.blocked || i.hook!.flags.length).length,
            assessed.length,
          ),
          sampled: s.length,
          reviewed: r.length,
          bad: wilson(
            classes.filter((c) => c === "bad").length,
            classes.filter((c) => c === "bad" || c === "fine").length,
          ),
          verdicts: Object.fromEntries(
            (["send", "revise", "rewrite", "unknown"] as const).map((v) => [
              v,
              r.filter((i) => ix.reviews.get(i.id)![0].verdict === v).length,
            ]),
          ),
        };
      });
    };
    const months = [...new Set(ix.inputs.map((i) => i.month).filter(Boolean) as string[])].sort();
    const span: string[] = [];
    if (months.length) {
      let [y, m] = months[0].split("-").map(Number);
      const [ly, lm] = months.at(-1)!.split("-").map(Number);
      while (y < ly || (y === ly && m <= lm)) {
        span.push(`${y}-${String(m).padStart(2, "0")}`);
        m++;
        if (m > 12) (m = 1), y++;
      }
    }
    const byMonth = group((i) => i.month, span).sort((a, b) =>
      a.key === "unknown" ? 1 : b.key === "unknown" ? -1 : a.key < b.key ? -1 : 1,
    );
    const firstMonth = (f: (i: Input) => boolean) =>
      ix.inputs
        .filter((i) => i.month && f(i))
        .map((i) => i.month!)
        .sort()[0] ?? null;
    const sortRows = <T extends { key: string; inputs: number }>(rows: T[]) =>
      rows.sort((a, b) =>
        a.key === "unknown" ? 1 : b.key === "unknown" ? -1 : b.inputs - a.inputs,
      );
    const matrix = screening(ix, sampled, criterion);
    return {
      sample,
      criterion,
      basis,
      sampled: sampled.length,
      reviewed: N,
      verdicts,
      dimensions,
      issues,
      breakdowns: {
        model: sortRows(group((i) => modelOf(i, basis))),
        project: sortRows(group((i) => i.project)),
        size: group((i) => i.size, SIZE_BUCKETS.map((b) => b.key)).filter(
          (r) => r.key !== "unknown" || r.inputs,
        ),
        month: byMonth,
      },
      onset: {
        first_fused_words: firstMonth((i) =>
          (ix.reviews.get(i.id)?.[0].record.presentation?.issues ?? []).some(
            (x) => x.kind === "fused_words",
          ),
        ),
        first_hook_block: firstMonth((i) => !!i.hook?.blocked),
        first_input: span[0] ?? null,
      },
      screening: matrix,
    };
  }

  /** Hook result against reviewer judgment, as a screening test. */
  function screening(ix: Index, sampled: Input[], criterion: string) {
    const cells: Record<string, Record<string, number>> = {};
    for (const h of ["blocked", "warned", "passed", "unassessed"])
      cells[h] = { bad: 0, fine: 0, unknown: 0, unreviewed: 0 };
    for (const i of sampled) cells[hookClass(i)][reviewerClass(ix.reviews.get(i.id), criterion)]++;
    const tp = cells.blocked.bad,
      fp = cells.blocked.fine,
      fn = cells.warned.bad + cells.passed.bad,
      tn = cells.warned.fine + cells.passed.fine;
    const rules = new Map<string, Record<string, Record<string, number>>>();
    for (const i of sampled) {
      const c = reviewerClass(ix.reviews.get(i.id), criterion);
      if (c !== "bad" && c !== "fine") continue;
      for (const [rule, status] of Object.entries(i.hook?.statuses ?? {})) {
        const r = rules.get(rule) ?? {};
        r[status] ??= { bad: 0, fine: 0 };
        r[status][c]++;
        rules.set(rule, r);
      }
    }
    return {
      cells,
      sensitivity: wilson(tp, tp + fn),
      specificity: wilson(tn, tn + fp),
      ppv: wilson(tp, tp + fp),
      npv: wilson(tn, tn + fn),
      flagged_sensitivity: wilson(tp + cells.warned.bad, tp + fn),
      rules: [...rules].map(([rule, statuses]) => ({ rule, statuses })),
    };
  }

  function list(params: URLSearchParams) {
    const ix = load();
    const page = integer(params, "page", 0, 0, 100000);
    const pageSize = integer(params, "page_size", 50, 1, 200);
    const criterion = choice(params, "criterion", ["verdict", "presentation"] as const, "verdict");
    const basis = choice(params, "basis", ["recorded", "thread"] as const, "thread");
    const sort = choice(
      params,
      "sort",
      ["severity", "newest", "oldest", "longest", "shortest"] as const,
      "severity",
    );
    const query = (params.get("q") ?? "").trim();
    if (query.length > 1000) throw new RangeError("Search must be at most 1,000 characters");
    const filters: Record<string, (i: Input) => string[]> = {
      sample: (i) => {
        const s = ix.samples.get(i.id);
        return s ? s.map((x) => x.stratum).concat("any") : ["none"];
      },
      run: (i) => (ix.samples.get(i.id) ?? []).map((x) => x.run_id),
      split: (i) => (ix.samples.get(i.id) ?? []).map((x) => x.split ?? "unknown"),
      review: (i) => {
        const r = ix.reviews.get(i.id);
        return r ? [r[0].verdict, "reviewed"] : ix.samples.has(i.id) ? ["pending"] : ["none"];
      },
      reviewer: (i) => [reviewerClass(ix.reviews.get(i.id), criterion)],
      hook: (i) => {
        const c = hookClass(i);
        return c === "warned" || c === "passed" ? [c, "allowed"] : [c];
      },
      flag: (i) => (i.hook?.flags ?? []).map((f) => `${f.rule}:${f.status}`),
      issue: (i) =>
        DIMENSIONS.flatMap((d) => (ix.reviews.get(i.id)?.[0].record[d]?.issues ?? []).map((x) => x.kind)),
      intent: (i) => [scoreKey(ix.reviews.get(i.id), "intent")],
      content: (i) => [scoreKey(ix.reviews.get(i.id), "content")],
      presentation: (i) => [scoreKey(ix.reviews.get(i.id), "presentation")],
      model: (i) => [modelOf(i, basis)],
      project: (i) => [i.project],
      month: (i) => [i.month ?? "unknown"],
      size: (i) => [i.size],
      kind: (i) => (i.kinds.length ? i.kinds : ["unknown"]),
      rewrite: (i) => [ix.reviews.get(i.id)?.[0].record.rewrite ? "yes" : "no"],
    };
    const active = Object.keys(filters)
      .map((name) => [name, params.getAll(name).flatMap((v) => v.split(",")).filter(Boolean)] as const)
      .filter(([, values]) => values.length);
    let pool = ix.inputs;
    let snippets = new Map<string, string>();
    if (query) {
      const rows = database().all<{ message_id: string; at: number }>(
        "SELECT message_id,instr(lower(text),lower(?)) AS at FROM messages WHERE is_input=1 AND (instr(lower(text),lower(?))>0 OR message_id LIKE ?)",
        query,
        query,
        // Only a hexadecimal query can be the start of a message ID. Anything
        // else gets NULL, which LIKE never matches.
        /^[0-9a-f]{4,64}$/i.test(query) ? query.toLowerCase() + "%" : null,
      );
      const hits = new Set(rows.map((r) => r.message_id));
      pool = pool.filter((i) => hits.has(i.id));
      snippets = new Map(rows.filter((r) => r.at > 0).map((r) => [r.message_id, String(r.at)]));
    }
    const matches = (i: Input, skip?: string) =>
      active.every(([name, values]) => name === skip || filters[name](i).some((v) => values.includes(v)));
    const rows = pool.filter((i) => matches(i));
    const facets = Object.fromEntries(
      Object.keys(filters).map((name) => {
        const counts = new Map<string, number>();
        for (const i of pool)
          if (matches(i, name))
            for (const v of new Set(filters[name](i))) counts.set(v, (counts.get(v) ?? 0) + 1);
        return [name, Object.fromEntries(counts)];
      }),
    );
    const severity = (i: Input) => {
      const r = ix.reviews.get(i.id)?.[0];
      const v = r ? { rewrite: 0, revise: 1, unknown: 3, send: 4 }[r.verdict] : ix.samples.has(i.id) ? 5 : 6;
      return v * 10 + (i.hook?.blocked ? 0 : i.hook?.flags.length ? 1 : 2);
    };
    const by: Record<typeof sort, (a: Input, b: Input) => number> = {
      severity: (a, b) => severity(a) - severity(b) || b.characters - a.characters,
      newest: (a, b) => (b.first_seen ?? "").localeCompare(a.first_seen ?? ""),
      oldest: (a, b) => (a.first_seen ?? "￿").localeCompare(b.first_seen ?? "￿"),
      longest: (a, b) => b.characters - a.characters,
      shortest: (a, b) => a.characters - b.characters,
    };
    rows.sort((a, b) => by[sort](a, b) || a.id.localeCompare(b.id));
    const last = Math.max(0, Math.ceil(rows.length / pageSize) - 1);
    const actual = Math.min(page, last);
    const slice = rows.slice(actual * pageSize, (actual + 1) * pageSize);
    const previews = new Map<string, string>();
    if (slice.length) {
      const stmt = database().raw.prepare(
        "SELECT substr(text,max(1,?-80),240) AS t FROM messages WHERE message_id=?",
      );
      for (const i of slice) {
        const at = Number(snippets.get(i.id) ?? 1);
        previews.set(i.id, (stmt.get(at, i.id) as any).t);
      }
    }
    return {
      total: rows.length,
      corpus: ix.inputs.length,
      page: actual,
      page_size: pageSize,
      ids: params.get("ids") === "1" ? rows.map((i) => i.id) : undefined,
      facets,
      messages: slice.map((i) => summary(ix, i, previews.get(i.id) ?? "", !!snippets.get(i.id) && Number(snippets.get(i.id)) > 81)),
    };
  }

  function summary(ix: Index, i: Input, preview: string, clipped: boolean) {
    const r = ix.reviews.get(i.id)?.[0];
    const s = ix.samples.get(i.id)?.[0];
    return {
      message_id: i.id,
      preview,
      preview_clipped: clipped,
      characters: i.characters,
      words: i.words,
      kinds: i.kinds,
      project: i.project,
      first_seen: i.first_seen,
      model: i.recorded_model ?? i.thread_model,
      model_basis: modelBasis(i),
      hook: i.hook && { blocked: i.hook.blocked, decision_rule: i.hook.decision_rule, flags: i.hook.flags },
      sample: s ? { run_id: s.run_id, stratum: s.stratum, split: s.split } : null,
      review: r
        ? {
            verdict: r.verdict,
            scores: Object.fromEntries(DIMENSIONS.map((d) => [d, r.record[d]?.score ?? null])),
            rewrite: !!r.record.rewrite,
          }
        : null,
    };
  }

  async function detail(id: string) {
    if (!ID.test(id)) return null;
    const d = database();
    const ix = load();
    const m = d.get<any>(
      "SELECT message_id,text,characters,words,kinds,projects,is_input FROM messages WHERE message_id=?",
      id,
    );
    if (!m) return null;
    const input = ix.byId.get(id);
    const observations = d
      .all<any>(
        "SELECT observation_id,source,record_json FROM observations WHERE message_id=? ORDER BY export_line",
        id,
      )
      .map((o) => {
        const r = JSON.parse(o.record_json);
        return {
          observation_id: o.observation_id,
          source: r.source ?? o.source,
          kind: r.kind ?? null,
          tool: r.tool ?? null,
          project: r.project ?? null,
          timestamp: timestampOf(r),
          thread_title: r.thread_title ?? null,
          model: r.model ?? null,
          model_attribution: r.model_attribution ?? null,
          saved_model_selection: r.saved_model_selection ?? null,
          role: r.role ?? null,
          field: r.field ?? null,
          is_child: r.is_child ?? null,
        };
      });
    const samples = ix.samples.get(id) ?? [];
    const reviewed = ix.reviews.get(id) ?? [];
    const preferred = [...samples.map((s) => s.context_id), ...reviewed.map((r) => r.record.context_id)].filter(Boolean);
    const contexts = has("contexts")
      ? d
          .all<any>(
            "SELECT context_id,observation_id,status,metadata_json FROM contexts WHERE message_id=? ORDER BY context_id",
            id,
          )
          .sort((a, b) => Number(preferred.includes(b.context_id)) - Number(preferred.includes(a.context_id)))
          .map((c) => ({
            context_id: c.context_id,
            observation_id: c.observation_id,
            status: c.status,
            reviewed: preferred.includes(c.context_id),
            availability: decode(c.metadata_json),
            evidence: has("evidence")
              ? d
                  .all<any>(
                    "SELECT e.evidence_id,e.kind,e.text,e.provenance,e.visibility FROM evidence e JOIN context_evidence ce USING(evidence_id) WHERE ce.context_id=? ORDER BY e.evidence_id",
                    c.context_id,
                  )
                  .map((e) => {
                    const prose = evidenceProse(e.text);
                    return {
                      evidence_id: e.evidence_id,
                      kind: e.kind,
                      visibility: e.visibility,
                      provenance: decode(e.provenance),
                      extracted: prose !== e.text,
                      ...excerpt(prose),
                    };
                  })
              : [],
            references: has("context_references")
              ? d
                  .all<any>(
                    "SELECT reference_id,record_json FROM context_references WHERE context_id=? ORDER BY reference_id",
                    c.context_id,
                  )
                  .map((r) => {
                    const rec = decode<any>(r.record_json) ?? {};
                    const { text, ...rest } = rec;
                    return {
                      reference_id: r.reference_id,
                      ...rest,
                      ...(typeof text === "string" ? { text: excerpt(text) } : {}),
                    };
                  })
              : [],
          }))
      : [];
    const legacy = has("reviews")
      ? d
          .all<any>(
            "SELECT r.review_id,r.context_id,r.record_json,rr.reviewer,rr.created_at,rr.rubric_version FROM reviews r JOIN review_runs rr USING(run_id) WHERE r.message_id=? AND rr.rubric_version='intentionality-v2' ORDER BY rr.created_at DESC",
            id,
          )
          .map((r) => ({
            review_id: r.review_id,
            context_id: r.context_id,
            reviewer: r.reviewer,
            created_at: r.created_at,
            rubric_version: r.rubric_version,
            record: decode(r.record_json),
          }))
      : [];
    const stored = has("mechanical_results")
      ? d.get<any>(
          "SELECT mr.result_json,r.run_id,r.created_at FROM mechanical_results mr JOIN mechanical_runs r USING(run_id) WHERE mr.message_id=? AND r.run_id=(SELECT run_id FROM mechanical_runs ORDER BY created_at DESC,run_id DESC LIMIT 1)",
          id,
        )
      : undefined;
    const live = await inspect(guard, id, m.text, options.guardTimeout);
    return {
      message_id: m.message_id,
      text: m.text,
      characters: m.characters,
      lines: m.text.split("\n").length,
      words: m.words,
      scalars: scalars(m.text),
      is_input: !!m.is_input,
      kinds: decode(m.kinds),
      projects: decode(m.projects),
      project: input?.project ?? null,
      first_seen: input?.first_seen ?? null,
      thread_title: input?.thread_title ?? null,
      model: {
        recorded: input?.recorded_model ?? null,
        thread: input?.thread_model ?? null,
        basis: input ? modelBasis(input) : null,
      },
      observations,
      samples,
      reviews: reviewed.map((r) => ({
        run_id: r.run_id,
        reviewer: r.reviewer,
        rubric_version: r.rubric_version,
        verdict: r.verdict,
        record: r.record,
      })),
      legacy_reviews: legacy,
      hook: {
        live: live.report,
        live_error: live.error,
        live_binary_sha256: live.report ? guardSha() : null,
        stored: decode<HookReport>(stored?.result_json),
        stored_run: stored ? { run_id: stored.run_id, created_at: stored.created_at } : null,
      },
      contexts,
    };
  }

  function rubric() {
    return { path: "docs/communication-rubric.md", markdown: readFileSync(rubricPath, "utf8") };
  }

  async function middleware(req: IncomingMessage, res: ServerResponse, next: () => void) {
    let url: URL;
    try {
      url = new URL(req.url || "/", "http://localhost");
    } catch {
      res.statusCode = 400;
      res.end("Malformed request URL.");
      return;
    }
    if (url.pathname !== PREFIX && !url.pathname.startsWith(PREFIX + "/")) return next();
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    const send = (status: number, value: unknown) => {
      res.statusCode = status;
      res.end(JSON.stringify(value));
    };
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.setHeader("Allow", "GET, HEAD");
      return send(405, { error: "This API is read-only. Use GET." });
    }
    const path = url.pathname.slice(PREFIX.length);
    try {
      if (path === "/meta") return send(200, meta());
      if (path === "/overview") return send(200, overview(url.searchParams));
      if (path === "/messages") return send(200, list(url.searchParams));
      if (path === "/rubric") return send(200, rubric());
      if (path.startsWith("/messages/")) {
        const m = await detail(decodeURIComponent(path.slice("/messages/".length)));
        return send(m ? 200 : 404, m ?? { error: "No handoff input or body has that message ID." });
      }
      send(404, { error: "Unknown endpoint." });
    } catch (e) {
      if (e instanceof RangeError || e instanceof URIError)
        return send(400, { error: e.message });
      console.error("Dashboard API:", e);
      send(503, {
        error: "The review database could not be read. Check that data/handoffs.sqlite3 exists, then retry.",
      });
    }
  }

  return {
    middleware,
    meta,
    overview,
    list,
    detail,
    rubric,
    close() {
      db?.close();
      db = undefined;
      index = undefined;
    },
  };
}
