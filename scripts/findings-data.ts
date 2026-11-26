#!/usr/bin/env node
/**
 * Build the data block of docs/findings/report.html from the review database.
 *
 * The block is the only message-derived data in Git, so this script decides
 * what may leave SQLite: counts and shares only. Project, mission and thread
 * names become letters and numbers, and no message text, title, ID or hash is
 * written. It reads through the dashboard API, so the report and the
 * dashboard cannot disagree about a definition.
 *
 *   node scripts/findings-data.ts            print the block
 *   node scripts/findings-data.ts --write    replace it in report.html
 *
 * The prose in report.html, README.md and the glued-values comparison table
 * are written by hand. Reread them against the new figures after --write.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createDashboardApi } from "./dashboard-api.ts";
import { openDatabase } from "../tooling/db/connection.ts";
import { ROOT, DATABASE, invariant } from "../tooling/shared.ts";

const REPORT = resolve(ROOT, "docs/findings/report.html");
const database = process.env.HANDOFF_DB ?? DATABASE;
type Share = { k: number; n: number; low?: number; high?: number } | null;

const round = (x: number) => Math.round(x * 1000) / 1000;
/** A share keeps its counts and interval, and drops the redundant proportion. */
const share = (v: any): Share =>
  v ? { k: v.k, n: v.n, ...(v.low === undefined ? {} : { low: round(v.low), high: round(v.high) }) } : null;
const row = (b: any, key: string) => ({
  key,
  inputs: b.inputs,
  blocked: share(b.hook_blocked),
  reviewed: b.reviewed,
  needs_work: share(b.needs_work),
  lowest: b.lowest,
});
const letter = (i: number) => String.fromCharCode(65 + (i % 26)) + (i >= 26 ? Math.floor(i / 26) : "");
const quantile = (sorted: number[], p: number) =>
  round(sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]);

const api = createDashboardApi({ database });
const meta: any = api.meta();
const fair: any = api.overview(new URLSearchParams("sample=fair&basis=recorded"));
const byThread: any = api.overview(new URLSearchParams("sample=fair&basis=thread"));
const agreement: any = api.agreement();
api.close();

// Names that identify the work are replaced in the order the dashboard lists them.
const projects = new Map<string, string>();
for (const p of fair.breakdowns.project)
  projects.set(p.key, p.key === "unknown" ? "Unknown" : "Project " + letter(projects.size));
const missions = new Map<string, string>(
  fair.missions.top.map((m: any, i: number) => [m.key, "Mission " + letter(i)]),
);

// How much longer the reviewer's plain-English rewrite is than the text it
// replaces, over the reference reviewer's reviews under the current rubric.
const db = openDatabase(database, { readOnly: true, initialize: false });
const reviews = db.all<{ record_json: string; characters: number }>(
  `SELECT r.record_json, m.characters FROM analysis_records r
     JOIN analysis_runs a ON a.run_id = r.run_id
     JOIN messages m ON m.message_id = r.message_id
    WHERE r.kind = 'review' AND a.kind = 'manual-review'
      AND json_extract(a.metadata_json, '$.reviewer') = ?
      AND json_extract(a.metadata_json, '$.rubric_version') = ?`,
  meta.reference_reviewer,
  meta.rubric_version,
);
db.close();
const length = (s: string) => Array.from(s).length;
const ratios: number[] = [];
let unclear = 0;
for (const r of reviews) {
  const rewrite = JSON.parse(r.record_json).rewrite;
  if (!rewrite?.text) continue;
  ratios.push(length(rewrite.text) / (rewrite.of ? length(rewrite.of) : Number(r.characters)));
  if (rewrite.text.includes("[unclear")) unclear++;
}
ratios.sort((a, b) => a - b);

const newest = [meta.hook.stored_run?.created_at, ...meta.runs.map((r: any) => r.created_at)]
  .filter(Boolean)
  .sort()
  .at(-1) as string;

const data = {
  as_of: newest.slice(0, 10),
  corpus: meta.corpus,
  needs_work: share(fair.needs_work),
  lowest: Object.fromEntries(Object.entries(fair.lowest_scores).map(([k, v]) => [k, share(v)])),
  dimensions: fair.dimensions,
  cause: fair.cause,
  issues: fair.issues.map((i: any) => ({ dimension: i.dimension, kind: i.kind, ...share(i) })),
  by_model: fair.breakdowns.model.map((b: any) => row(b, b.key)),
  by_model_thread: byThread.breakdowns.model.map((b: any) => row(b, b.key)),
  by_project: fair.breakdowns.project.map((b: any) => row(b, projects.get(b.key)!)),
  by_size: fair.breakdowns.size.map((b: any) => row(b, b.key)),
  by_month: fair.breakdowns.month.map((b: any) => row(b, b.key)),
  missions: {
    count: fair.missions.count,
    busiest_days: fair.missions.busiest_days,
    top: fair.missions.top.map((m: any) => ({
      ...row(m, missions.get(m.key)!),
      first_day: m.first_day,
      last_day: m.last_day,
      days: m.days.map((d: any) => row(d, d.key)),
    })),
  },
  drift: {
    min_handoffs: fair.drift.min_handoffs,
    without_sender: fair.drift.without_sender,
    qualifying_handoffs: fair.drift.qualifying_handoffs,
    rising: fair.drift.rising,
    falling: fair.drift.falling,
    pooled: fair.drift.pooled.map((p: any) => ({
      part: p.part + 1,
      blocked: share(p.hook_blocked),
      reviewed: p.reviewed,
      presentation_low: share(p.presentation_low),
    })),
    threads: fair.drift.threads.map((t: any, i: number) => ({
      key: "Thread " + (i + 1),
      mission: missions.get(t.mission) ?? "Other",
      handoffs: t.handoffs,
      first_half: share(t.first_half),
      second_half: share(t.second_half),
      parts: t.parts.map((p: any) => share(p.hook_blocked)),
    })),
  },
  screening: {
    cells: fair.screening.cells,
    blocked_low: share(fair.screening.blocked_low),
    allowed_high: share(fair.screening.allowed_high),
    outside: fair.screening.outside,
    checks: fair.screening.checks.map((c: any) => ({ rule: c.rule, corpus: c.corpus })),
    // Both counts cover handoffs with a stored hook report, as the API's do.
    corpus_blocked: {
      k: fair.breakdowns.project.reduce((a: number, b: any) => a + (b.hook_blocked?.k ?? 0), 0),
      n: fair.breakdowns.project.reduce((a: number, b: any) => a + (b.hook_blocked?.n ?? 0), 0),
    },
  },
  agreement: agreement.comparisons
    .filter((c: any) => c.kind !== "different-both")
    .map((c: any) => ({
      kind: c.kind,
      a: c.a.reviewer + " @ " + c.a.rubric_version,
      b: c.b.reviewer + " @ " + c.b.rubric_version,
      messages: c.messages,
      questions: Object.fromEntries(
        Object.entries<any>(c.questions).map(([q, v]) => [
          q,
          { table: v.table, exact: share(v.exact), unknown_in_one: v.unknown_in_one },
        ]),
      ),
      needs_work: { agree: share(c.needs_work.agree) },
    })),
  rewrites: {
    with_rewrite: ratios.length,
    with_unclear: unclear,
    ratio: ratios.length
      ? {
          min: round(ratios[0]),
          q1: quantile(ratios, 0.25),
          median: quantile(ratios, 0.5),
          q3: quantile(ratios, 0.75),
          max: round(ratios.at(-1)!),
        }
      : null,
  },
};

// Refuse to publish any text this script did not expect. Every string in the
// block must be a label made above, a date, or a term from a fixed vocabulary:
// rubric questions and issue kinds, hook rule names, size buckets, model names
// and rater names. A project, mission or thread name matches none of these.
// First, the corpus block rate is only meaningful when every handoff has a report.
invariant(
  data.screening.corpus_blocked.n === meta.corpus.inputs,
  "Some handoffs have no stored hook report; run `node scripts/handoff.ts mechanics` first",
);
const vocabulary = new Set<string>([
  "Unknown",
  "Other",
  "unknown",
  "different-raters",
  "changed-rubric",
  ...meta.dimensions,
  ...Object.values<string[]>(meta.issue_kinds).flat(),
  ...fair.issues.map((i: any) => i.kind),
  ...meta.hook.rules.map((r: any) => r.rule),
  ...meta.size_buckets,
  ...Object.values<any[]>(meta.facets.models).flatMap((list) => list.map((m) => m.value)),
  ...meta.raters.map((r: any) => r.reviewer + " @ " + r.rubric_version),
]);
const real = new Set<string>(
  [
    ...projects.keys(),
    ...fair.missions.top.flatMap((m: any) => [m.key, m.title]),
    ...fair.drift.threads.flatMap((t: any) => [t.key, t.title, t.mission_title]),
  ].filter((s) => typeof s === "string" && s !== "unknown"),
);
const label = /^(?:\d{4}-\d{2}(?:-\d{2})?|(?:Project|Mission) [A-Z]\d*|Thread \d+)$/;
(function check(value: unknown): void {
  if (typeof value === "string")
    invariant(
      !real.has(value) && (label.test(value) || vocabulary.has(value)),
      "Unexpected text in the data block: " + JSON.stringify(value),
    );
  else if (value && typeof value === "object") Object.values(value).forEach(check);
})(data);
const json = JSON.stringify(data).replace(/</g, "\\u003c");

if (process.argv.includes("--write")) {
  const html = readFileSync(REPORT, "utf8");
  const block = /(<script id="data" type="application\/json">)[\s\S]*?(<\/script>)/;
  invariant(block.test(html), "report.html has no data block");
  writeFileSync(REPORT, html.replace(block, (_, open, close) => open + json + close));
  console.log(`Wrote ${json.length} characters of data, as of ${data.as_of}, to ${REPORT}`);
} else {
  console.log(json);
}
