/**
 * Read-only API for the review dashboard in `dashboard/`.
 *
 * Every endpoint answers GET only, opens SQLite read-only and returns JSON.
 * Aggregates use the stored hook reports of the newest run in
 * `mechanical_results`; the single-message endpoint also runs the current hook
 * binary on that message so the reader always shows the current rules.
 *
 * Two questions, one definition each:
 * - A handoff needs work when its lowest score is 1 (Broken) or 2 (Costly).
 *   Scores always come from `score()` in `tooling/reviews.ts`, which reads a
 *   written score from older reviews and the worst issue severity from newer
 *   ones.
 * Each message has one reference review: the configured reference reviewer's
 * review under the newest rubric version. Every figure uses it.
 * - The hook is judged against the presentation score only, because spacing,
 *   size and repetition are all it measures.
 * Prevalence comes from the fair sample (`probabilitySample()`), or from every
 * reviewed message when the reader asks for it, labelled as skewed.
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { relative, resolve } from "node:path";
import {
  openDatabase,
  type ResearchDatabase,
} from "../tooling/db/connection.ts";
import {
  DIMENSIONS,
  ISSUE_KINDS,
  RUBRIC_VERSION,
  probabilitySample,
  lowest as lowestOf,
  needsWork as needsWorkOf,
  scores as scoresOf,
  SEVERITIES,
  type Finding,
  type Review,
} from "../tooling/reviews.ts";

const ROOT = resolve(import.meta.dirname, "..");
export const PREFIX = "/api";
const ID = /^[a-f0-9]{64}$/;
/** How each sampled message was picked, as `sampleReview` records it. */
export const PICKED = ["random", "fused", "long", "pilot"] as const;
export const SAMPLES = ["fair", "all"] as const;
const SIZE_BUCKETS = [
  { key: "under 500", max: 500 },
  { key: "500–1,999", max: 2000 },
  { key: "2,000–4,999", max: 5000 },
  { key: "5,000–11,999", max: 12000 },
  { key: "12,000 and over", max: Infinity },
];
const EXCERPT = 1000;
/** Points from fewer reviewed messages than this are shown but not joined into a line. */
export const SPARSE = 5;
const MISSIONS_SHOWN = 10;

export interface DashboardApiOptions {
  database: string;
  rubric?: string;
  guard?: string;
  /** `config/review.json`, which holds the seed of the sampling order. */
  reviewConfig?: string;
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
type Sample = (typeof SAMPLES)[number];
type Dim = (typeof DIMENSIONS)[number];

interface Input {
  id: string;
  characters: number;
  words: number;
  kinds: string[];
  project: string;
  first_seen: string | null;
  month: string | null;
  day: string | null;
  size: string;
  mission: string | null;
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
interface Pick {
  run_id: string;
  message_id: string;
  picked: string;
  split: string | null;
  context_id: string | null;
}
interface ReviewRow {
  run_id: string;
  run_created_at: string;
  reviewer: string | null;
  rubric_version: string | null;
  rubric_sha256: string | null;
  message_id: string;
  record: Review;
  /** reviewer@rubric_version: one rater under one rubric. */
  rater: string;
  scores: Record<Dim, number | null>;
  low: { score: number | null; questions: Dim[] };
  needs: boolean | null;
}
interface Unreadable {
  run_id: string;
  kind: string;
  reviewer: string | null;
  error: string;
}
/** Why a stored review cannot be read safely, or null when it can. */
function reviewProblem(record: any): string | null {
  if (!record || typeof record !== "object") return "the record is not an object";
  for (const d of DIMENSIONS) {
    const f = record[d];
    if (f === undefined) continue;
    if (!f || typeof f !== "object") return `${d} is not an object`;
    if (f.issues !== undefined && !Array.isArray(f.issues)) return `${d}.issues is not a list`;
    for (const issue of f.issues ?? [])
      if (!issue || typeof issue !== "object" || typeof issue.kind !== "string") return `${d} has an issue without a kind`;
  }
  return null;
}
interface Run {
  run_id: string;
  reviewer: string | null;
  rubric_version: string | null;
  created_at: string;
  sampled: number;
  reviewed: number;
}
interface Index {
  version: number;
  loaded_at: string;
  bodies: number;
  inputs: Input[];
  byId: Map<string, Input>;
  runs: Run[];
  picks: Map<string, Pick[]>;
  /** Every review of a message, earliest run first. */
  reviews: Map<string, ReviewRow[]>;
  /** The one review per message that figures use. */
  reference: Map<string, ReviewRow>;
  /** How each message was first picked, ignoring rerate draws. */
  firstPick: Map<string, string>;
  referenceReviewer: string | null;
  /** Stored review or sample records that could not be read, by message. */
  unreadable: Map<string, Unreadable[]>;
  /** Messages the rubric quotes as worked examples. Not a fair test of agreement. */
  rubricExamples: Set<string>;
  fair: Set<string> | null;
  hookRun: { run_id: string; created_at: string; binary_sha256: string | null } | null;
  missions: Map<string, { title: string | null; inputs: number }>;
}

const decode = <T = any>(value: unknown): T | null =>
  typeof value === "string" && value ? (JSON.parse(value) as T) : null;
const scalars = (text: string) => Array.from(text).length;

/** Wilson score interval for k of n at 95%. For sample estimates only. */
export function wilson(k: number, n: number) {
  if (!n) return null;
  const z = 1.959963984540054,
    p = k / n,
    d = 1 + (z * z) / n,
    c = (p + (z * z) / (2 * n)) / d,
    h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return { k, n, p, low: Math.max(0, c - h), high: Math.min(1, c + h) };
}
/** An exact share over the whole corpus. It has no interval. */
function exact(k: number, n: number) {
  return n ? { k, n, p: k / n } : null;
}

function countBy(values: string[]) {
  const m = new Map<string, number>();
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1]).map(([value, n]) => ({ value, n }));
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
const needsWork = (r: ReviewRow | undefined) => r?.needs === true;
/** Settled: the review says whether the handoff needs work. */
const settled = (r: ReviewRow | undefined) => !!r && r.needs !== null;
const lowestScore = (r: ReviewRow) => r.low.score;
const lowest = (r: ReviewRow) => r.low.questions;
const lowestKey = (r: ReviewRow | undefined) => (!r ? "none" : r.low.score === null ? "unknown" : String(r.low.score));
function presentationKey(r: ReviewRow | undefined) {
  return r ? String(r.scores.presentation ?? "null") : "none";
}
const versionNumber = (v: string | null) => Number(/(\d+)\s*$/.exec(v ?? "")?.[1] ?? -1);
const QUESTIONS = ["intent", "content", "presentation", "lowest"] as const;
type Question = (typeof QUESTIONS)[number];
/** The score of one question, or the lowest score, as a table key. */
function keyOf(r: ReviewRow, q: Question) {
  const v = q === "lowest" ? r.low.score : r.scores[q];
  return v === null ? "null" : String(v);
}
/**
 * One review per rater for a message: the earliest, since `list` is in run
 * order. A rater's later reviews of the same message are repeats and are not
 * used in agreement.
 */
function perRater(list: ReviewRow[]) {
  const seen = new Map<string, ReviewRow>();
  for (const r of list) if (!seen.has(r.rater)) seen.set(r.rater, r);
  return [...seen.values()];
}
/**
 * Every pair of raters that reviewed one message, each with its earliest
 * review, in a stable rater order. Agreement figures and the filters that
 * open their cells both use this, so a message counts once per comparison.
 */
function pairsOf(list: ReviewRow[]) {
  const one = perRater(list);
  const out: [ReviewRow, ReviewRow][] = [];
  for (let i = 0; i < one.length; i++)
    for (let j = i + 1; j < one.length; j++) out.push(one[i].rater <= one[j].rater ? [one[i], one[j]] : [one[j], one[i]]);
  return out;
}
/**
 * Outside what the hook can see: the handoff needs work while its
 * presentation is Minor or Clean. The hook page's count and its link both use
 * this.
 */
function outsideHook(r: ReviewRow | undefined) {
  const p = r?.scores.presentation;
  return needsWork(r) && typeof p === "number" && p >= 3;
}
/** Needs work, but the presentation score is unknown, so neither side of the hook question applies. */
function presentationUnknown(r: ReviewRow | undefined) {
  return needsWork(r) && r!.scores.presentation === null;
}
/** How the score of one question was reached, for the reader. */
function scoring(f: Finding | undefined) {
  const written = f?.score !== undefined;
  const issues = f?.issues ?? [];
  let decidedBy: number | null = null;
  if (!written && !f?.unknown) {
    let worst = 4;
    issues.forEach((issue, i) => {
      const v = SEVERITIES[issue.severity as keyof typeof SEVERITIES] ?? 4;
      if (v < worst) (worst = v), (decidedBy = i);
    });
  }
  return { written, unknown: !!f?.unknown, decided_by: decidedBy };
}
function hookKey(input: Input) {
  return !input.hook ? "unassessed" : input.hook.blocked ? "blocked" : "allowed";
}
function modelOf(input: Input, basis: Basis) {
  return input.recorded_model ?? (basis === "thread" ? input.thread_model : null) ?? "unknown";
}
function modelBasis(input: Input) {
  return input.recorded_model ? "recorded" : input.thread_model ? "thread" : null;
}

function choice<T extends string>(params: URLSearchParams, name: string, allowed: readonly T[], fallback: T): T {
  const value = params.get(name);
  if (value === null || value === "") return fallback;
  if (!(allowed as readonly string[]).includes(value))
    throw new RangeError(`Invalid ${name}: use one of ${allowed.join(", ")}`);
  return value as T;
}
function integer(params: URLSearchParams, name: string, fallback: number, min: number, max: number) {
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
  if (!existsSync(binary)) return Promise.resolve({ report: null, error: "Hook binary not found at " + binary });
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

function sha256(data: string | Buffer) {
  return createHash("sha256").update(data).digest("hex");
}
function fileSha256(path: string) {
  try {
    return sha256(readFileSync(path));
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
      for (const key of ["message", "prompt", "task", "text"]) if (typeof candidate[key] === "string") return candidate[key];
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
    : { text: chars.slice(0, EXCERPT).join(""), characters: chars.length, omitted: chars.length - EXCERPT };
}

export function createDashboardApi(options: DashboardApiOptions) {
  const rubricPath = options.rubric ?? resolve(ROOT, "docs/communication-rubric.md");
  const guard = options.guard ?? resolve(ROOT, "target/release/handoff-guard");
  const reviewConfig = options.reviewConfig ?? resolve(ROOT, "config/review.json");
  let db: ResearchDatabase | undefined;
  let index: Index | undefined;
  let guardHash: { mtime: number; sha: string | null } | undefined;
  const rubricHistory = new Map<string, { commit: string; markdown: string } | null>();

  function database() {
    db ??= openDatabase(options.database, { readOnly: true, initialize: false });
    return db;
  }
  function has(table: string) {
    return !!database().get("SELECT 1 FROM sqlite_master WHERE name=? AND type IN ('table','view')", table);
  }
  function guardSha() {
    try {
      const mtime = statSync(guard).mtimeMs;
      if (guardHash?.mtime !== mtime) guardHash = { mtime, sha: fileSha256(guard) };
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
    for (const m of d.all<any>("SELECT message_id,characters,words,kinds,projects FROM messages WHERE is_input=1")) {
      const projects = decode<string[]>(m.projects) ?? [];
      const input: Input = {
        id: m.message_id,
        characters: m.characters,
        words: m.words,
        kinds: decode<string[]>(m.kinds) ?? [],
        project: projects.filter((p) => p !== "unknown")[0] ?? "unknown",
        first_seen: null,
        month: null,
        day: null,
        size: sizeBucket(m.characters),
        mission: null,
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
      const times = list
        .map(timestampOf)
        .filter((t): t is string => !!t)
        .sort();
      input.first_seen = times[0] ?? null;
      input.month = input.first_seen?.slice(0, 7) ?? null;
      input.day = input.first_seen?.slice(0, 10) ?? null;
      input.recorded_model = mostCommon(list.map((o) => o.model));
      // A t3_messages record belongs to the recipient's thread, so its saved
      // model selection describes the recipient, not the sender.
      input.thread_model = mostCommon(list.filter((o) => o.source !== "t3_messages").map((o) => o.saved_model_selection));
      input.thread_title = mostCommon(list.map((o) => o.thread_title));
      if (input.project === "unknown") input.project = mostCommon(list.map((o) => o.project)) ?? "unknown";
    }
    if (has("splits"))
      for (const s of d.all<{ message_id: string; record_json: string }>("SELECT message_id,record_json FROM splits")) {
        const input = byId.get(s.message_id);
        if (input) input.mission = decode<any>(s.record_json)?.component ?? null;
      }
    const missions = new Map<string, { title: string | null; inputs: number }>();
    {
      const groups = new Map<string, Input[]>();
      for (const i of inputs) if (i.mission) groups.set(i.mission, [...(groups.get(i.mission) ?? []), i]);
      for (const [key, list] of groups)
        missions.set(key, { title: mostCommon(list.map((i) => i.thread_title)), inputs: list.length });
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
          flags: checks.filter((c) => c.status !== "pass").map((c) => ({ rule: c.rule, status: c.status })),
          statuses: Object.fromEntries(checks.map((c) => [c.rule, c.status])),
        };
      }
      const run = d.get<any>("SELECT run_id,created_at,metadata_json FROM mechanical_runs ORDER BY created_at DESC,run_id DESC LIMIT 1");
      if (run)
        hookRun = {
          run_id: run.run_id,
          created_at: run.created_at,
          binary_sha256: decode<any>(run.metadata_json)?.binary_sha256 ?? null,
        };
    }
    const runs: Run[] = [];
    const picks = new Map<string, Pick[]>();
    const reviews = new Map<string, ReviewRow[]>();
    let fair: Set<string> | null = null;
    const firstPick = new Map<string, string>();
    const unreadable = new Map<string, Unreadable[]>();
    if (has("analysis_runs")) {
      const meta = new Map<string, { reviewer: string | null; rubric_version: string | null; rubric_sha256: string | null; created_at: string }>();
      for (const r of d.all<any>(
        "SELECT run_id,created_at,metadata_json FROM analysis_runs WHERE kind='manual-review' ORDER BY created_at,run_id",
      )) {
        const m = decode<any>(r.metadata_json) ?? {};
        const row = {
          reviewer: m.reviewer ?? null,
          rubric_version: m.rubric_version ?? null,
          rubric_sha256: m.rubric_sha256 ?? null,
          created_at: r.created_at,
        };
        meta.set(r.run_id, row);
        runs.push({ run_id: r.run_id, reviewer: row.reviewer, rubric_version: row.rubric_version, created_at: r.created_at, sampled: 0, reviewed: 0 });
      }
      for (const r of d.all<any>(
        "SELECT r.run_id,r.kind,r.message_id,r.record_json FROM analysis_records r JOIN analysis_runs a USING(run_id) WHERE a.kind='manual-review' AND r.kind IN ('sample','review') ORDER BY a.created_at,r.run_id,r.record_key",
      )) {
        const run = runs.find((x) => x.run_id === r.run_id)!;
        const m = meta.get(r.run_id)!;
        let record: any;
        let derived: { scores: ReviewRow["scores"]; low: ReviewRow["low"]; needs: ReviewRow["needs"] } | null = null;
        // One unreadable record is set aside for its message; it must not take
        // the whole index down.
        try {
          record = JSON.parse(r.record_json);
          if (r.kind === "review") {
            const problem = reviewProblem(record);
            if (problem) throw new Error(problem);
            derived = { scores: scoresOf(record), low: lowestOf(record), needs: needsWorkOf(record) };
          }
        } catch (e) {
          if (r.message_id)
            unreadable.set(r.message_id, [
              ...(unreadable.get(r.message_id) ?? []),
              { run_id: r.run_id, kind: r.kind, reviewer: m.reviewer, error: e instanceof Error ? e.message : String(e) },
            ]);
          continue;
        }
        const id = r.message_id ?? record.message_id;
        if (r.kind === "sample") {
          run.sampled++;
          // A rerate draw re-reviews a message already picked; it says nothing about how it was picked.
          if (record.stratum !== "rerate" && !firstPick.has(id)) firstPick.set(id, record.stratum ?? "random");
          picks.set(id, [
            ...(picks.get(id) ?? []),
            { run_id: r.run_id, message_id: id, picked: record.stratum ?? "random", split: record.split ?? null, context_id: record.context_id ?? null },
          ]);
        } else {
          run.reviewed++;
          reviews.set(id, [
            ...(reviews.get(id) ?? []),
            {
              run_id: r.run_id,
              run_created_at: m.created_at,
              reviewer: m.reviewer,
              rubric_version: m.rubric_version,
              rubric_sha256: m.rubric_sha256,
              message_id: id,
              record,
              rater: `${m.reviewer ?? "unknown reviewer"}@${m.rubric_version ?? "unknown rubric"}`,
              ...derived!,
            },
          ]);
        }
      }
      try {
        const head = existsSync(reviewConfig) && has("messages") ? probabilitySample(d, reviewConfig) : null;
        fair = head ? new Set(head) : null;
      } catch (e) {
        console.error("Dashboard API: could not compute the fair sample:", e);
        fair = null;
      }
    }
    let referenceReviewer: string | null = null;
    let rubricExamples = new Set<string>();
    try {
      const config = existsSync(reviewConfig) ? JSON.parse(readFileSync(reviewConfig, "utf8")) : {};
      referenceReviewer = config.reference_reviewer ?? null;
      rubricExamples = new Set(Array.isArray(config.rubric_example_messages) ? config.rubric_example_messages : []);
    } catch {}
    const reference = new Map<string, ReviewRow>();
    for (const [id, list] of reviews) {
      const own = referenceReviewer ? list.filter((r) => r.reviewer === referenceReviewer) : list;
      if (!own.length) continue;
      const newest = Math.max(...own.map((r) => versionNumber(r.rubric_version)));
      reference.set(id, own.find((r) => versionNumber(r.rubric_version) === newest)!);
    }
    const bodies = Number(Object.values(d.get("SELECT count(*) FROM messages")!)[0]);
    index = { version, loaded_at: new Date().toISOString(), bodies, inputs, byId, runs, picks, reviews, reference, firstPick, referenceReviewer, unreadable, rubricExamples, fair, hookRun, missions };
    return index;
  }

  /**
   * The reference review: the reference reviewer's review under the newest
   * rubric version, earliest run first within that version. Without a
   * configured reference reviewer, any reviewer counts.
   */
  const first = (ix: Index, id: string) => ix.reference.get(id);
  /** The messages a sample covers: the fair sample, or every frozen message. */
  function sampleOf(ix: Index, sample: Sample) {
    if (sample === "fair") return ix.fair ? ix.inputs.filter((i) => ix.fair!.has(i.id)) : [];
    return ix.inputs.filter((i) => ix.picks.has(i.id) || ix.reviews.has(i.id));
  }

  function meta() {
    const ix = load();
    const months = [...new Set(ix.inputs.map((i) => i.month).filter((m): m is string => !!m))].sort();
    const count = (f: (i: Input) => string) => {
      const m = new Map<string, number>();
      for (const i of ix.inputs) m.set(f(i), (m.get(f(i)) ?? 0) + 1);
      return [...m].sort((a, b) => b[1] - a[1]).map(([value, n]) => ({ value, n }));
    };
    const rules = new Map<string, Record<string, number>>();
    for (const i of ix.inputs)
      for (const [rule, status] of Object.entries(i.hook?.statuses ?? {})) {
        const r = rules.get(rule) ?? {};
        r[status] = (r[status] ?? 0) + 1;
        rules.set(rule, r);
      }
    const current = guardSha();
    const reviewed = [...ix.reviews.keys()];
    const fair = sampleOf(ix, "fair");
    const all = sampleOf(ix, "all");
    return {
      rubric_version: RUBRIC_VERSION,
      dimensions: DIMENSIONS,
      issue_kinds: ISSUE_KINDS,
      picked: PICKED,
      size_buckets: SIZE_BUCKETS.map((b) => b.key),
      sparse: SPARSE,
      corpus: {
        bodies: ix.bodies,
        inputs: ix.inputs.length,
        with_recorded_model: ix.inputs.filter((i) => i.recorded_model).length,
        with_thread_model: ix.inputs.filter((i) => !i.recorded_model && i.thread_model).length,
        with_hook_report: ix.inputs.filter((i) => i.hook).length,
        missions: ix.missions.size,
      },
      runs: ix.runs,
      samples: {
        fair: {
          available: !!ix.fair,
          size: fair.length,
          reviewed: fair.filter((i) => ix.reference.has(i.id)).length,
        },
        all: { size: all.length, reviewed: all.filter((i) => ix.reference.has(i.id)).length },
      },
      reviewed: reviewed.length,
      reviews_total: [...ix.reviews.values()].reduce((s, r) => s + r.length, 0),
      several_reviews: reviewed.filter((id) => ix.reviews.get(id)!.length > 1).length,
      review_rubrics: [...new Set([...ix.reviews.values()].flat().map((r) => r.rubric_version ?? "unknown"))],
      unreadable_reviews: [...ix.unreadable.values()].flat().filter((u) => u.kind === "review").length,
      reference_reviewer: ix.referenceReviewer,
      reference_rubrics: countBy([...ix.reference.values()].map((r) => r.rubric_version ?? "unknown")),
      raters: countBy([...ix.reviews.values()].flat().map((r) => r.rater)).map(({ value, n }) => {
        const [reviewer, rubric_version] = value.split("@");
        return { rater: value, reviewer, rubric_version, reviews: n };
      }),
      hook: {
        stored_run: ix.hookRun,
        binary: existsSync(guard) ? guard : null,
        binary_sha256: current,
        stored_matches_binary: ix.hookRun?.binary_sha256 && current ? ix.hookRun.binary_sha256 === current : null,
        rules: [...rules].map(([rule, statuses]) => ({ rule, statuses })),
      },
      facets: {
        months,
        projects: count((i) => i.project),
        kinds: count((i) => i.kinds[0] ?? "unknown"),
        models: { recorded: count((i) => modelOf(i, "recorded")), thread: count((i) => modelOf(i, "thread")) },
      },
      legacy_reviews: has("reviews")
        ? Number(
            Object.values(
              database().get("SELECT count(*) FROM reviews r JOIN review_runs rr USING(run_id) WHERE rr.rubric_version='intentionality-v2'")!,
            )[0],
          )
        : 0,
      loaded_at: ix.loaded_at,
    };
  }

  /** One row of a breakdown: exact corpus counts beside sample estimates. */
  function row(ix: Index, key: string, all: Input[], inSample: Set<string>) {
    const s = all.filter((i) => inSample.has(i.id));
    const r = s.map((i) => first(ix, i.id)).filter(settled) as ReviewRow[];
    const assessed = all.filter((i) => i.hook);
    return {
      key,
      inputs: all.length,
      hook_blocked: exact(assessed.filter((i) => i.hook!.blocked).length, assessed.length),
      in_sample: s.length,
      reviewed: r.length,
      needs_work: wilson(r.filter(needsWork).length, r.length),
      sparse: r.length < SPARSE,
      lowest: Object.fromEntries(["1", "2", "3", "4"].map((k) => [k, r.filter((x) => String(lowestScore(x)) === k).length])),
    };
  }

  function overview(params: URLSearchParams) {
    const ix = load();
    const sample = choice(params, "sample", SAMPLES, "fair");
    const basis = choice(params, "basis", ["recorded", "thread"] as const, "recorded");
    const members = sampleOf(ix, sample);
    const inSample = new Set(members.map((i) => i.id));
    const rows = members.map((i) => first(ix, i.id)).filter((r): r is ReviewRow => !!r);
    const scored = rows.filter(settled);
    const N = scored.length;
    const needing = scored.filter(needsWork);
    const lowestScores = Object.fromEntries(
      ["1", "2", "3", "4"].map((k) => [k, wilson(scored.filter((r) => String(lowestScore(r)) === k).length, N)]),
    );
    const dimensions = Object.fromEntries(
      DIMENSIONS.map((d) => [
        d,
        Object.fromEntries(["4", "3", "2", "1", "null"].map((s) => [s, rows.filter((r) => String(r.scores[d] ?? "null") === s).length])),
      ]),
    );
    // Which question holds the lowest score among handoffs that need work.
    const combos = new Map<string, number>();
    for (const r of needing) {
      const key = lowest(r).join("+");
      combos.set(key, (combos.get(key) ?? 0) + 1);
    }
    const cause = {
      needs_work: needing.length,
      by_dimension: Object.fromEntries(DIMENSIONS.map((d) => [d, needing.filter((r) => lowest(r).includes(d)).length])),
      combinations: [...combos].sort((a, b) => b[1] - a[1]).map(([key, k]) => ({ dimensions: key.split("+"), k })),
      // The lowest score lies in intent or content only. Not the same as the
      // hook page's "outside", which asks whether presentation is Minor or Clean.
      intent_content_only: needing.filter((r) => !lowest(r).includes("presentation")).length,
    };
    // Kinds come from the current rubric plus any older kind a recorded review used.
    const kindsUsed = (d: Dim) => {
      const current = ISSUE_KINDS[d] as readonly string[];
      const seen = rows.flatMap((r) => (r.record[d]?.issues ?? []).map((x) => x.kind));
      return [...new Set([...current, ...seen])].map((kind) => ({ kind, retired: !current.includes(kind) }));
    };
    const issues = DIMENSIONS.flatMap((d) =>
      kindsUsed(d).map(({ kind, retired }) => ({
        dimension: d,
        kind,
        retired,
        ...wilson(rows.filter((r) => (r.record[d]?.issues ?? []).some((x) => x.kind === kind)).length, rows.length)!,
      })),
    ).filter((x) => x.n !== undefined);
    const group = (key: (i: Input) => string | null, order?: string[]) => {
      const g = new Map<string, Input[]>();
      for (const k of order ?? []) g.set(k, []);
      for (const i of ix.inputs) {
        const k = key(i) ?? "unknown";
        g.set(k, [...(g.get(k) ?? []), i]);
      }
      return [...g].map(([k, all]) => row(ix, k, all, inSample));
    };
    const sortRows = <T extends { key: string; inputs: number }>(r: T[]) =>
      r.sort((a, b) => (a.key === "unknown" ? 1 : b.key === "unknown" ? -1 : b.inputs - a.inputs));
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
    // The same model, by how it was attributed.
    const modelRecords = [...new Set(ix.inputs.map((i) => i.recorded_model ?? i.thread_model).filter(Boolean) as string[])]
      .map((model) => {
        const rec = ix.inputs.filter((i) => i.recorded_model === model && i.hook);
        const thr = ix.inputs.filter((i) => !i.recorded_model && i.thread_model === model && i.hook);
        return {
          model,
          recorded: exact(rec.filter((i) => i.hook!.blocked).length, rec.length),
          thread_only: exact(thr.filter((i) => i.hook!.blocked).length, thr.length),
        };
      })
      .filter((m) => (m.recorded?.n ?? 0) >= 20 && (m.thread_only?.n ?? 0) >= 20);
    return {
      sample,
      basis,
      sample_size: members.length,
      rubric_mix: countBy(rows.map((r) => r.rubric_version ?? "unknown")),
      reference_reviewer: ix.referenceReviewer,
      reviewed: rows.length,
      scored: N,
      unscored: rows.length - N,
      needs_work: wilson(needing.length, N),
      lowest_scores: lowestScores,
      dimensions,
      cause,
      issues,
      breakdowns: {
        model: sortRows(group((i) => modelOf(i, basis))),
        project: sortRows(group((i) => i.project)),
        size: group((i) => i.size, SIZE_BUCKETS.map((b) => b.key)).filter((r) => r.key !== "unknown" || r.inputs),
        month: byMonth,
      },
      model_records: modelRecords,
      missions: missionsOf(ix, inSample),
      screening: screening(ix, members),
    };
  }

  /** The largest missions, each with its days. */
  function missionsOf(ix: Index, inSample: Set<string>) {
    const groups = new Map<string, Input[]>();
    for (const i of ix.inputs) if (i.mission) groups.set(i.mission, [...(groups.get(i.mission) ?? []), i]);
    const ordered = [...groups].sort((a, b) => b[1].length - a[1].length);
    const top = ordered.slice(0, MISSIONS_SHOWN).map(([key, list]) => {
      const days = new Map<string, Input[]>();
      for (const i of list) days.set(i.day ?? "unknown", [...(days.get(i.day ?? "unknown") ?? []), i]);
      const models = new Map<string, number>();
      for (const i of list) {
        const m = i.recorded_model ?? (i.thread_model ? i.thread_model + " (thread setting)" : "unknown");
        models.set(m, (models.get(m) ?? 0) + 1);
      }
      const dated = list.map((i) => i.day).filter(Boolean).sort() as string[];
      return {
        ...row(ix, key, list, inSample),
        title: ix.missions.get(key)?.title ?? null,
        first_day: dated[0] ?? null,
        last_day: dated.at(-1) ?? null,
        models: [...models].sort((a, b) => b[1] - a[1]).map(([model, n]) => ({ model, n })),
        days: [...days]
          .sort((a, b) => (a[0] === "unknown" ? 1 : b[0] === "unknown" ? -1 : a[0] < b[0] ? -1 : 1))
          .map(([day, d]) => row(ix, day, d, inSample)),
      };
    });
    const busiest = new Map<string, number>();
    for (const i of ix.inputs) if (i.day) busiest.set(i.day, (busiest.get(i.day) ?? 0) + 1);
    const topDays = [...busiest].sort((a, b) => b[1] - a[1]).slice(0, 3);
    return {
      count: groups.size,
      unassigned: ix.inputs.filter((i) => !i.mission).length,
      largest: ordered[0] ? { key: ordered[0][0], inputs: ordered[0][1].length } : null,
      busiest_days: topDays.map(([day, n]) => ({ day, n })),
      top,
    };
  }

  /** The hook against the presentation score, the only question it can see. */
  function screening(ix: Index, members: Input[]) {
    const rows = ["blocked", "allowed", "unassessed"];
    const cols = ["1", "2", "3", "4", "null"];
    const cells: Record<string, Record<string, number>> = Object.fromEntries(rows.map((r) => [r, Object.fromEntries(cols.map((c) => [c, 0]))]));
    let unreviewed = 0;
    for (const i of members) {
      const r = first(ix, i.id);
      if (!r) {
        unreviewed++;
        continue;
      }
      cells[hookKey(i)][presentationKey(r)]++;
    }
    const shown = Object.values(cells).reduce((t, row) => t + Object.values(row).reduce((a, b) => a + b, 0), 0);
    const low = cells.blocked["1"] + cells.blocked["2"] + cells.allowed["1"] + cells.allowed["2"];
    const high = cells.blocked["3"] + cells.blocked["4"] + cells.allowed["3"] + cells.allowed["4"];
    const reviewed = members.filter((i) => ix.reference.has(i.id));
    const needing = reviewed.map((i) => first(ix, i.id)!).filter(needsWork);
    // Per check, over the corpus and among sampled messages by presentation.
    const corpus = new Map<string, Record<string, number>>();
    for (const i of ix.inputs)
      for (const [rule, status] of Object.entries(i.hook?.statuses ?? {})) {
        const c = corpus.get(rule) ?? {};
        c[status] = (c[status] ?? 0) + 1;
        corpus.set(rule, c);
      }
    const checks = [...corpus].map(([rule, statuses]) => {
      const marked = (band: "low" | "high", status: string) =>
        reviewed.filter((i) => {
          const s = first(ix, i.id)!.scores.presentation;
          const inBand = typeof s === "number" && (band === "low" ? s <= 2 : s >= 3);
          return inBand && i.hook?.statuses[rule] === status;
        }).length;
      const nonPass = Object.keys(statuses).filter((s) => s !== "pass");
      return {
        rule,
        fires: nonPass.length > 0,
        corpus: statuses,
        sample: Object.fromEntries(nonPass.map((st) => [st, { low: marked("low", st), high: marked("high", st) }])),
        // A warning on a message that another check blocked never shows in the
        // "allows" row, because the message is not allowed.
        warned_but_blocked: {
          corpus: ix.inputs.filter((i) => i.hook?.statuses[rule] === "warn" && i.hook.blocked).length,
          // Shown after the Costly-or-Broken count, so it counts that band only.
          sample_low: reviewed.filter((i) => {
            const p = first(ix, i.id)!.scores.presentation;
            return typeof p === "number" && p <= 2 && i.hook?.statuses[rule] === "warn" && i.hook.blocked;
          }).length,
        },
      };
    });
    return {
      cells,
      unreviewed,
      shown,
      low,
      high,
      blocked_low: wilson(cells.blocked["1"] + cells.blocked["2"], low),
      allowed_high: wilson(cells.allowed["3"] + cells.allowed["4"], high),
      outside: {
        k: needing.filter(outsideHook).length,
        presentation_unknown: needing.filter(presentationUnknown).length,
        needs_work: needing.length,
        reviewed: reviewed.length,
      },
      checks: checks.filter((c) => c.fires),
      silent: checks.filter((c) => !c.fires).map((c) => c.rule),
    };
  }

  /** Agreement between every pair of raters that reviewed the same messages. */
  function agreement() {
    const ix = load();
    const groups = new Map<string, [ReviewRow, ReviewRow][]>();
    const excluded = new Map<string, number>();
    // Reviews a rater wrote of a message it had already reviewed under the same rubric.
    const repeats = new Map<string, number>();
    for (const list of ix.reviews.values())
      for (const r of list.filter((r) => !perRater(list).includes(r))) repeats.set(r.rater, (repeats.get(r.rater) ?? 0) + 1);
    for (const [id, list] of ix.reviews) {
      if (ix.rubricExamples.has(id)) {
        // A reviewer who meets a rubric example has been shown its severity.
        for (const [x, y] of pairsOf(list)) excluded.set(`${x.rater}|${y.rater}`, (excluded.get(`${x.rater}|${y.rater}`) ?? 0) + 1);
        continue;
      }
      for (const pair of pairsOf(list)) {
        const key = `${pair[0].rater}|${pair[1].rater}`;
        groups.set(key, [...(groups.get(key) ?? []), pair]);
      }
    }
    const kindOf = (a: ReviewRow, b: ReviewRow) =>
      a.reviewer === b.reviewer
        ? a.rubric_version === b.rubric_version
          ? "same-rater"
          : "changed-rubric"
        : a.rubric_version === b.rubric_version
          ? "different-raters"
          : "different-both";
    const order: Record<string, number> = { "different-raters": 0, "changed-rubric": 1, "different-both": 2, "same-rater": 3 };
    const keys = ["1", "2", "3", "4", "null"];
    const comparisons = [...groups].map(([key, pairs]) => {
      const [a, b] = pairs[0];
      const questions = Object.fromEntries(
        QUESTIONS.map((q) => {
          const table = Object.fromEntries(keys.map((x) => [x, Object.fromEntries(keys.map((y) => [y, 0]))]));
          for (const [x, y] of pairs) table[keyOf(x, q)][keyOf(y, q)]++;
          const both = pairs.filter(([x, y]) => keyOf(x, q) !== "null" && keyOf(y, q) !== "null");
          return [q, { table, exact: wilson(both.filter(([x, y]) => keyOf(x, q) === keyOf(y, q)).length, both.length), unknown_in_one: pairs.length - both.length }];
        }),
      );
      const settledPairs = pairs.filter(([x, y]) => x.needs !== null && y.needs !== null);
      const needs = { table: { true: { true: 0, false: 0, null: 0 }, false: { true: 0, false: 0, null: 0 }, null: { true: 0, false: 0, null: 0 } } as Record<string, Record<string, number>> };
      for (const [x, y] of pairs) needs.table[String(x.needs)][String(y.needs)]++;
      return {
        key,
        kind: kindOf(a, b),
        a: { rater: a.rater, reviewer: a.reviewer, rubric_version: a.rubric_version },
        b: { rater: b.rater, reviewer: b.reviewer, rubric_version: b.rubric_version },
        messages: pairs.length,
        rubric_examples_left_out: excluded.get(key) ?? 0,
        questions,
        needs_work: { ...needs, agree: wilson(settledPairs.filter(([x, y]) => x.needs === y.needs).length, settledPairs.length) },
      };
    });
    comparisons.sort((x, y) => order[x.kind] - order[y.kind] || y.messages - x.messages);
    return {
      rubric_examples: ix.rubricExamples.size,
      rubric_examples_with_several_reviews: [...ix.rubricExamples].filter((id) => (ix.reviews.get(id)?.length ?? 0) > 1).length,
      several_reviews: [...ix.reviews.values()].filter((l) => l.length > 1).length,
      raters: countBy([...ix.reviews.values()].flat().map((r) => r.rater)),
      repeat_reviews_unused: [...repeats].map(([rater, n]) => ({ rater, n })),
      comparisons,
    };
  }

  function list(params: URLSearchParams) {
    const ix = load();
    const page = integer(params, "page", 0, 0, 100000);
    const pageSize = integer(params, "page_size", 50, 1, 200);
    const basis = choice(params, "basis", ["recorded", "thread"] as const, "recorded");
    const sort = choice(params, "sort", ["severity", "newest", "oldest", "longest", "shortest"] as const, "severity");
    const query = (params.get("q") ?? "").trim();
    if (query.length > 1000) throw new RangeError("Search must be at most 1,000 characters");
    const score = (d: Dim) => (i: Input) => {
      const r = first(ix, i.id);
      return [r ? String(r.scores[d] ?? "null") : "none"];
    };
    const filters: Record<string, (i: Input) => string[]> = {
      sample: (i) => {
        const out: string[] = [];
        if (ix.fair?.has(i.id)) out.push("fair");
        if (ix.reference.has(i.id)) out.push("reviewed");
        else if (ix.picks.has(i.id)) out.push("waiting");
        else out.push("none");
        return out;
      },
      picked: (i) => (ix.firstPick.has(i.id) ? [ix.firstPick.get(i.id)!] : []),
      lowest: (i) => [lowestKey(first(ix, i.id))],
      outside: (i) => {
        const r = first(ix, i.id);
        return outsideHook(r) ? ["yes"] : presentationUnknown(r) ? ["unknown"] : [];
      },
      cause: (i) => {
        const r = first(ix, i.id);
        if (!r || !needsWork(r)) return [];
        return lowest(r).includes("presentation") ? ["presentation"] : ["intent-content"];
      },
      hook: (i) => [hookKey(i)],
      flag: (i) => (i.hook?.flags ?? []).map((f) => `${f.rule}:${f.status}`),
      issue: (i) => DIMENSIONS.flatMap((d) => (first(ix, i.id)?.record[d]?.issues ?? []).map((x) => x.kind)),
      presentation: score("presentation"),
      content: score("content"),
      intent: score("intent"),
      clear: (i) => {
        const r = first(ix, i.id);
        return r ? [r.record.rewrite ? "yes" : "no"] : [];
      },
      rater: (i) => [...new Set((ix.reviews.get(i.id) ?? []).map((r) => r.rater))],
      several: (i) => [(ix.reviews.get(i.id)?.length ?? 0) > 1 ? "yes" : "no"],
      pair: (i) => (ix.rubricExamples.has(i.id) ? [] : pairsOf(ix.reviews.get(i.id) ?? []).map(([x, y]) => `${x.rater}|${y.rater}`)),
      example: (i) => [ix.rubricExamples.has(i.id) ? "yes" : "no"],
      agree: (i) => (ix.rubricExamples.has(i.id) ? [] : pairsOf(ix.reviews.get(i.id) ?? [])).flatMap(([x, y]) => {
        const key = `${x.rater}|${y.rater}`;
        return [
          ...QUESTIONS.map((q) => `${key}|${q}|${keyOf(x, q)}|${keyOf(y, q)}`),
          `${key}|needs|${String(x.needs)}|${String(y.needs)}`,
        ];
      }),
      mission: (i) => [i.mission ?? "none"],
      day: (i) => [i.day ?? "unknown"],
      model: (i) => [modelOf(i, basis)],
      project: (i) => [i.project],
      month: (i) => [i.month ?? "unknown"],
      size: (i) => [i.size],
      kind: (i) => (i.kinds.length ? i.kinds : ["unknown"]),
    };
    const active = Object.keys(filters)
      .map((name) => [name, params.getAll(name).flatMap((v) => v.split(",")).filter(Boolean)] as const)
      .filter(([, values]) => values.length);
    let pool = ix.inputs;
    let snippets = new Map<string, number>();
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
      snippets = new Map(rows.filter((r) => r.at > 0).map((r) => [r.message_id, r.at]));
    }
    const matches = (i: Input, skip?: string) =>
      active.every(([name, values]) => name === skip || filters[name](i).some((v) => values.includes(v)));
    const rows = pool.filter((i) => matches(i));
    const facets = Object.fromEntries(
      Object.keys(filters).filter((name) => name !== "agree").map((name) => {
        const counts = new Map<string, number>();
        for (const i of pool) if (matches(i, name)) for (const v of new Set(filters[name](i))) counts.set(v, (counts.get(v) ?? 0) + 1);
        return [name, Object.fromEntries(counts)];
      }),
    );
    const severity = (i: Input) => {
      const r = first(ix, i.id);
      const k = lowestKey(r);
      const v = k === "none" ? (ix.picks.has(i.id) ? 6 : 7) : k === "unknown" ? 5 : Number(k);
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
      const stmt = database().raw.prepare("SELECT substr(text,max(1,?-80),240) AS t FROM messages WHERE message_id=?");
      for (const i of slice) previews.set(i.id, (stmt.get(snippets.get(i.id) ?? 1, i.id) as any).t);
    }
    const missionTitles = Object.fromEntries(
      [...new Set([...(facets.mission ? Object.keys(facets.mission) : [])])].map((k) => [k, ix.missions.get(k)?.title ?? null]),
    );
    return {
      total: rows.length,
      corpus: ix.inputs.length,
      page: actual,
      page_size: pageSize,
      basis,
      ids: params.get("ids") === "1" ? rows.map((i) => i.id) : undefined,
      facets,
      mission_titles: missionTitles,
      messages: slice.map((i) => summary(ix, i, previews.get(i.id) ?? "", (snippets.get(i.id) ?? 0) > 81)),
    };
  }

  function summary(ix: Index, i: Input, preview: string, clipped: boolean) {
    const reviews = ix.reviews.get(i.id) ?? [];
    const r = first(ix, i.id);
    const p = (ix.picks.get(i.id) ?? []).find((x) => x.picked !== "rerate");
    return {
      message_id: i.id,
      preview,
      preview_clipped: clipped,
      characters: i.characters,
      words: i.words,
      kinds: i.kinds,
      project: i.project,
      first_seen: i.first_seen,
      mission: i.mission,
      model: i.recorded_model ?? i.thread_model,
      model_basis: modelBasis(i),
      hook: i.hook && { blocked: i.hook.blocked, decision_rule: i.hook.decision_rule, flags: i.hook.flags },
      picked: p ? { run_id: p.run_id, picked: p.picked } : null,
      in_fair_sample: !!ix.fair?.has(i.id),
      review: r
        ? {
            lowest: lowestKey(r),
            scores: r.scores,
            rubric_version: r.rubric_version,
            clear_version: !!r.record.rewrite,
            reviews: reviews.length,
          }
        : null,
    };
  }

  async function detail(id: string) {
    if (!ID.test(id)) return null;
    const d = database();
    const ix = load();
    const m = d.get<any>("SELECT message_id,text,characters,words,kinds,projects,is_input FROM messages WHERE message_id=?", id);
    if (!m) return null;
    const input = ix.byId.get(id);
    const observations = d
      .all<any>("SELECT observation_id,source,record_json FROM observations WHERE message_id=? ORDER BY export_line", id)
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
    const picks = ix.picks.get(id) ?? [];
    const reviewed = ix.reviews.get(id) ?? [];
    const preferred = [...picks.map((s) => s.context_id), ...reviewed.map((r) => r.record.context_id)].filter(Boolean);
    const contexts = has("contexts")
      ? d
          .all<any>("SELECT context_id,observation_id,status,metadata_json FROM contexts WHERE message_id=? ORDER BY context_id", id)
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
                  .all<any>("SELECT reference_id,record_json FROM context_references WHERE context_id=? ORDER BY reference_id", c.context_id)
                  .map((r) => {
                    const rec = decode<any>(r.record_json) ?? {};
                    const { text, ...rest } = rec;
                    return { reference_id: r.reference_id, ...rest, ...(typeof text === "string" ? { text: excerpt(text) } : {}) };
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
      mission: input?.mission ? { key: input.mission, title: ix.missions.get(input.mission)?.title ?? null, inputs: ix.missions.get(input.mission)?.inputs ?? 0 } : null,
      model: {
        recorded: input?.recorded_model ?? null,
        thread: input?.thread_model ?? null,
        basis: input ? modelBasis(input) : null,
      },
      in_fair_sample: !!ix.fair?.has(id),
      rubric_example: ix.rubricExamples.has(id),
      unreadable_reviews: (ix.unreadable.get(id) ?? []).filter((u) => u.kind === "review"),
      observations,
      picks,
      reviews: reviewed.map((r) => ({
        run_id: r.run_id,
        run_created_at: r.run_created_at,
        reviewer: r.reviewer,
        rubric_version: r.rubric_version,
        rubric_sha256: r.rubric_sha256,
        rater: r.rater,
        reference: r === first(ix, id),
        scores: r.scores,
        lowest: { score: r.low.score, questions: r.low.questions },
        needs_work: r.needs,
        scoring: Object.fromEntries(DIMENSIONS.map((d) => [d, scoring(r.record[d])])),
        record: r.record,
      })),
      current_rubric: RUBRIC_VERSION,
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

  /**
   * The rubric file as written. With `sha256`, the version a review run
   * recorded, found by hashing the file at each commit that changed it.
   */
  function rubric(params: URLSearchParams) {
    const current = readFileSync(rubricPath, "utf8");
    const path = relative(ROOT, rubricPath);
    const wanted = params.get("sha256");
    const base = { path, markdown: current, current: true, commit: null as string | null, requested: wanted, found: !wanted };
    if (!wanted) return base;
    if (!/^[a-f0-9]{64}$/.test(wanted)) throw new RangeError("Invalid sha256: use 64 lowercase hexadecimal characters");
    if (sha256(current) === wanted) return { ...base, found: true };
    if (!rubricHistory.has(wanted)) {
      let hit: { commit: string; markdown: string } | null = null;
      const log = spawnSync("git", ["log", "--format=%H", "--", path], { cwd: ROOT, encoding: "utf8" });
      for (const commit of log.status === 0 ? log.stdout.split("\n").filter(Boolean) : []) {
        const show = spawnSync("git", ["show", `${commit}:${path}`], { cwd: ROOT, encoding: "utf8", maxBuffer: 4 << 20 });
        if (show.status === 0 && sha256(show.stdout) === wanted) {
          hit = { commit, markdown: show.stdout };
          break;
        }
      }
      rubricHistory.set(wanted, hit);
    }
    const hit = rubricHistory.get(wanted);
    return hit ? { ...base, markdown: hit.markdown, current: false, commit: hit.commit, found: true } : { ...base, found: false };
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
      if (path === "/rubric") return send(200, rubric(url.searchParams));
      if (path === "/agreement") return send(200, agreement());
      if (path.startsWith("/messages/")) {
        const m = await detail(decodeURIComponent(path.slice("/messages/".length)));
        return send(m ? 200 : 404, m ?? { error: "No handoff input or body has that message ID." });
      }
      send(404, { error: "Unknown endpoint." });
    } catch (e) {
      if (e instanceof RangeError || e instanceof URIError) return send(400, { error: e.message });
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
    agreement,
    close() {
      db?.close();
      db = undefined;
      index = undefined;
    },
  };
}
