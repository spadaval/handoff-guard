/**
 * Tests for the read-only dashboard API. Every message text here is invented.
 */
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { connect } from "node:net";
import { createDashboardApi, wilson } from "../scripts/dashboard-api.ts";
import { openDatabase } from "../tooling/db/connection.ts";
import { probabilitySample } from "../tooling/reviews.ts";

let directory: string, path: string, guard: string, rubric: string, config: string;
let api: ReturnType<typeof createDashboardApi>, server: Server, base: string;
const id = (n: number) => n.toString(16).padStart(64, "0");
const FUSED = "Checkdoneshipitnowpleasethanks";
const texts: Record<number, string> = {
  1: `${FUSED} and then report back.`,
  2: "Please review the parser change; status=green, next=ship.",
  3: "Could you confirm the build passes on the main branch?",
  4: "Ordinary introduction. ".repeat(20) + "Find the deep needle here.",
  5: "Summarise the three failing tests and what each one checks.",
  6: "Rename the helper and update its two callers.",
  7: "Worker output that is not a handoff input.",
  8: "Another worker output.",
};
const score = (n: number | null, kind: string, quote = "") => ({
  score: n,
  reason: "Invented reason.",
  issues: n !== null && n < 4 ? [{ kind, quote, effect: "Invented effect.", repair: "Invented repair." }] : [],
});
const review = (n: number, s: { intent?: number | null; content?: number | null; presentation?: number | null; quote?: string; kind?: string }) => ({
  message_id: id(n),
  context_id: n === 1 ? "ctx-1" : null,
  full_message_reviewed: true,
  exchange: { sender: "coordinator", recipient: "implementer", type: "instruction" },
  situation: "Invented situation.",
  intent: { statement: "Invented intent.", ...score(s.intent === undefined ? 4 : s.intent, "buried_ask") },
  content: score(s.content === undefined ? 4 : s.content, s.kind ?? "private_reference"),
  presentation: score(s.presentation === undefined ? 4 : s.presentation, "fused_words", s.quote ?? ""),
  ...(s.presentation != null && s.presentation <= 2 ? { rewrite: { text: "Check that it is done, ship it now, then report back." } } : {}),
});
/** A review under handoff-v9: no written scores, a severity on every issue. */
const v9 = (n: number, f: { presentation?: string; content?: "unknown" }) => ({
  message_id: id(n),
  context_id: null,
  full_message_reviewed: true,
  exchange: { sender: "coordinator", recipient: "implementer", type: "instruction" },
  situation: "Invented situation.",
  intent: { statement: "Invented intent.", reason: "Invented reason.", issues: [] },
  content: f.content === "unknown" ? { unknown: true, reason: "The context cannot settle it.", issues: [] } : { reason: "Invented reason.", issues: [] },
  presentation: {
    reason: "Invented reason.",
    issues: f.presentation
      ? [
          { kind: "symbol_shorthand", severity: "minor", quote: "", effect: "e", repair: "r" },
          { kind: "fused_words", severity: f.presentation, quote: "", effect: "e", repair: "r" },
        ]
      : [],
  },
});
const report = (blocked: boolean, status: Record<string, string>) => ({
  blocked,
  decision_rule: blocked ? Object.keys(status).find((k) => status[k] === "block") : null,
  checks: Object.entries(status).map(([rule, s]) => ({ rule, category: "style", status: s, reason: null, measurements: {}, thresholds: {}, spans: [] })),
});

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), "handoff-api-"));
  path = join(directory, "test.sqlite3");
  rubric = join(directory, "rubric.md");
  writeFileSync(rubric, "# Invented rubric\n\n## 1. Intent\n\nText.\n");
  config = join(directory, "review.json");
  // Message 3 is quoted in the rubric as a worked example.
  writeFileSync(config, JSON.stringify({ seed: 7, rubric: "rubric.md", reference_reviewer: "fixture-reviewer", rubric_example_messages: [id(3)] }));
  guard = join(directory, "guard.sh");
  writeFileSync(
    guard,
    `#!/bin/sh\nread line\necho '{"blocked":true,"decision_rule":"invented_rule","checks":[{"rule":"invented_rule","category":"style","status":"block","reason":"Invented reason","measurements":{"runs":2},"thresholds":{"minimum":1},"spans":[{"start":0,"end":30}]}]}'\n`,
  );
  chmodSync(guard, 0o755);
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE messages(message_id TEXT PRIMARY KEY,text TEXT,characters INT,words INT,kinds TEXT,projects TEXT,is_input INT);
    CREATE TABLE observations(observation_id TEXT PRIMARY KEY,message_id TEXT,export_line INT,source TEXT,record_json TEXT);
    CREATE TABLE splits(message_id TEXT PRIMARY KEY,record_json TEXT);
    CREATE TABLE contexts(context_id TEXT PRIMARY KEY,observation_id TEXT,message_id TEXT,status TEXT,metadata_json TEXT);
    CREATE TABLE evidence_records(evidence_id TEXT PRIMARY KEY,kind TEXT,text TEXT,provenance BLOB,visibility TEXT);
    CREATE VIEW evidence AS SELECT evidence_id,kind,text,unpack_text(provenance) AS provenance,visibility FROM evidence_records;
    CREATE TABLE context_evidence(context_id TEXT,evidence_id TEXT);
    CREATE TABLE context_references(reference_id TEXT,context_id TEXT,record_json TEXT);
    CREATE TABLE review_runs(run_id TEXT PRIMARY KEY,rubric_version TEXT,reviewer TEXT,created_at TEXT,metadata_json TEXT);
    CREATE TABLE reviews(review_id TEXT PRIMARY KEY,run_id TEXT,context_id TEXT,message_id TEXT,record_json TEXT);
    CREATE TABLE mechanical_runs(run_id TEXT PRIMARY KEY,created_at TEXT,metadata_json TEXT);
    CREATE TABLE mechanical_results(run_id TEXT,message_id TEXT,result_json TEXT);
    CREATE TABLE analysis_runs(run_id TEXT PRIMARY KEY,kind TEXT,created_at TEXT,metadata_json TEXT);
    CREATE TABLE analysis_records(run_id TEXT,kind TEXT,record_key TEXT,message_id TEXT,record_json TEXT);`);
  const insert = (sql: string, ...values: any[]) => db.prepare(sql).run(...values);
  for (const [n, text] of Object.entries(texts).map(([k, v]) => [Number(k), v] as const))
    insert(
      "INSERT INTO messages VALUES(?,?,?,?,?,?,?)",
      id(n),
      text,
      text.length,
      text.split(/\s+/).length,
      JSON.stringify([n <= 6 ? "assignment" : "worker_report"]),
      JSON.stringify([n === 5 ? "Beta" : "Alpha"]),
      n <= 6 ? 1 : 0,
    );
  let line = 0;
  const observe = (n: number, record: object) =>
    insert("INSERT INTO observations VALUES(?,?,?,?,?)", `obs-${++line}`, id(n), line, (record as any).source, JSON.stringify(record));
  observe(1, { source: "codex_rollout", kind: "assignment", model: "model-a", thread_title: "Invented mission A", timestamp: "2026-10-05T10:00:00Z" });
  observe(1, { source: "t3_messages", kind: "agent_delivery", saved_model_selection: "model-recipient", timestamp: "2026-10-05T10:00:01Z" });
  observe(2, { source: "t3_turn_items", kind: "assignment", saved_model_selection: "model-b", thread_title: "Invented mission A", timestamp: "2026-11-02T10:00:00Z" });
  observe(3, { source: "t3_messages", kind: "agent_delivery", saved_model_selection: "model-c", timestamp_ms: Date.parse("2026-06-10T10:00:00Z") });
  for (const n of [5, 6]) observe(n, { source: "codex_rollout", kind: "assignment", model: "model-a", thread_title: "Invented mission B", timestamp: "2026-11-20T10:00:00Z" });
  for (const [n, mission] of [[1, "m-a"], [2, "m-a"], [3, "m-a"], [5, "m-b"], [6, "m-b"]] as const)
    insert("INSERT INTO splits VALUES(?,?)", id(n), JSON.stringify({ message_id: id(n), component: mission, split: "heldout" }));
  insert("INSERT INTO mechanical_runs VALUES(?,?,?)", "mech-old", "2026-01-01", JSON.stringify({ binary_sha256: "old" }));
  insert("INSERT INTO mechanical_runs VALUES(?,?,?)", "mech-new", "2026-02-01", JSON.stringify({ binary_sha256: "new" }));
  insert("INSERT INTO mechanical_results VALUES(?,?,?)", "mech-old", id(3), JSON.stringify(report(true, { size: "block" })));
  const hook: Record<number, object> = {
    1: report(true, { glued: "block", spacing: "warn", silent: "pass" }),
    2: report(false, { glued: "pass", spacing: "warn", silent: "pass" }),
  };
  for (const n of [1, 2, 3, 4, 5, 6])
    insert("INSERT INTO mechanical_results VALUES(?,?,?)", "mech-new", id(n), JSON.stringify(hook[n] ?? report(false, { glued: "pass", spacing: "pass", silent: "pass" })));
  const rubricSha = createHash("sha256").update(readFileSync(rubric)).digest("hex");
  insert("INSERT INTO analysis_runs VALUES(?,?,?,?)", "run-a", "manual-review", "2026-11-24T01:00:00Z", JSON.stringify({ reviewer: "fixture-reviewer", rubric_version: "handoff-v6", rubric_sha256: rubricSha }));
  insert("INSERT INTO analysis_runs VALUES(?,?,?,?)", "run-b", "manual-review", "2026-11-25T01:00:00Z", JSON.stringify({ reviewer: "second-reviewer", rubric_version: "handoff-v8" }));
  insert("INSERT INTO analysis_runs VALUES(?,?,?,?)", "run-c", "manual-review", "2026-11-26T01:00:00Z", JSON.stringify({ reviewer: "fixture-reviewer", rubric_version: "handoff-v9" }));
  insert("INSERT INTO analysis_runs VALUES(?,?,?,?)", "other", "corpus-evaluation", "2026-11-24", "{}");
  // A re-review draw: it says nothing about how the message was first picked.
  for (const n of [2, 3])
    insert("INSERT INTO analysis_records VALUES(?,?,?,?,?)", "run-c", "sample", id(n), id(n), JSON.stringify({ message_id: id(n), stratum: "rerate", split: "heldout", context_id: null }));
  // Every input is picked, so the fair sample is always fully sampled.
  for (const [n, picked] of [[1, "random"], [2, "random"], [3, "random"], [4, "long"], [5, "fused"], [6, "random"]] as const)
    insert("INSERT INTO analysis_records VALUES(?,?,?,?,?)", "run-a", "sample", id(n), id(n), JSON.stringify({ message_id: id(n), stratum: picked, split: "heldout", context_id: n === 1 ? "ctx-1" : null }));
  const reviews: [string, number, object][] = [
    ["run-a", 1, review(1, { presentation: 1, quote: FUSED })],
    ["run-a", 2, review(2, { presentation: 2, quote: "status=green" })],
    ["run-a", 3, review(3, {})],
    ["run-a", 5, review(5, { content: 2, kind: "retired_kind" })],
    ["run-a", 6, review(6, { presentation: null })],
    // A second opinion on message 2 from another reviewer.
    ["run-b", 2, review(2, {})],
    // The reference reviewer again, under a newer rubric.
    ["run-c", 2, v9(2, { presentation: "broken" })],
    ["run-c", 3, v9(3, { content: "unknown" })],
  ];
  for (const [run, n, r] of reviews) insert("INSERT INTO analysis_records VALUES(?,?,?,?,?)", run, "review", id(n), id(n), JSON.stringify(r));
  insert("INSERT INTO analysis_records VALUES(?,?,?,?,?)", "other", "prediction", id(4), id(4), "{}");
  insert("INSERT INTO contexts VALUES(?,?,?,?,?)", "ctx-1", "obs-1", id(1), "partial", JSON.stringify({ gaps: [{ reason: "invented gap" }] }));
  insert("INSERT INTO evidence_records VALUES(?,?,?,?,?)", "ev-1", "preceding_user", "😀".repeat(1010), JSON.stringify({ line: 7 }), "sender_context");
  insert("INSERT INTO evidence_records VALUES(?,?,?,?,?)", "ev-2", "preceding_function_call", JSON.stringify({ arguments: JSON.stringify({ message: "Readable invented prose." }) }), "{}", "unknown");
  insert("INSERT INTO context_evidence VALUES(?,?)", "ctx-1", "ev-1");
  insert("INSERT INTO context_evidence VALUES(?,?)", "ctx-1", "ev-2");
  insert("INSERT INTO context_references VALUES(?,?,?)", "ref-1", "ctx-1", JSON.stringify({ path: "NOTES.md", availability: "recovered", text: "Invented file." }));
  insert("INSERT INTO review_runs VALUES(?,?,?,?,?)", "legacy-v2", "intentionality-v2", "legacy reviewer", "2026-11-23", "{}");
  insert("INSERT INTO review_runs VALUES(?,?,?,?,?)", "legacy-v1", "intentionality-v1", "legacy reviewer", "2026-11-22", "{}");
  insert("INSERT INTO reviews VALUES(?,?,?,?,?)", "old-2", "legacy-v2", "ctx-1", id(1), JSON.stringify({ clarity: { rating: "difficult" } }));
  insert("INSERT INTO reviews VALUES(?,?,?,?,?)", "old-1", "legacy-v1", "ctx-1", id(1), JSON.stringify({ clarity: { rating: "clear" } }));
  db.close();
  api = createDashboardApi({ database: path, guard, rubric, reviewConfig: config });
  server = createServer((req, res) =>
    api.middleware(req, res, () => {
      res.statusCode = 404;
      res.end();
    }),
  );
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as any).port}/api`;
});
afterEach(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  api.close();
  rmSync(directory, { recursive: true });
});
const get = async (p: string) => {
  const res = await fetch(base + p);
  return { status: res.status, body: (await res.json()) as any };
};

test("meta counts handoffs, reviews, sender-model tiers and second reviews", async () => {
  const { body } = await get("/meta");
  assert.equal(body.corpus.bodies, 8);
  assert.equal(body.corpus.inputs, 6);
  assert.equal(body.reviewed, 5);
  assert.equal(body.reviews_total, 8);
  assert.equal(body.several_reviews, 2, "second reviews are counted, not dropped");
  assert.equal(body.reference_reviewer, "fixture-reviewer");
  assert.deepEqual(body.reference_rubrics, [{ value: "handoff-v6", n: 3 }, { value: "handoff-v9", n: 2 }]);
  assert.equal(body.samples.all.size, 6);
  // Recorded at send for 1, 5 and 6; message 2 only has its own thread's setting.
  assert.equal(body.corpus.with_recorded_model, 3);
  assert.equal(body.corpus.with_thread_model, 1);
  // A t3_messages record names the recipient's thread, so message 3 stays unknown.
  assert.equal(body.facets.models.thread.find((m: any) => m.value === "unknown").n, 2);
  assert.equal(body.facets.models.recorded.find((m: any) => m.value === "unknown").n, 3);
  assert.equal(body.facets.models.thread.find((m: any) => m.value === "model-recipient"), undefined);
  assert.equal(body.corpus.missions, 2);
  assert.deepEqual(body.review_rubrics.sort(), ["handoff-v6", "handoff-v8", "handoff-v9"]);
  assert.equal(body.hook.stored_run.run_id, "mech-new");
});

test("the fair sample is the one probabilitySample returns", async () => {
  const db = openDatabase(path, { readOnly: true, initialize: false });
  const fair = probabilitySample(db, config)!;
  db.close();
  assert.ok(fair.length > 0);
  const { body } = await get("/meta");
  assert.equal(body.samples.fair.size, fair.length);
  const list = (await get("/messages?sample=fair&ids=1&page_size=1")).body;
  assert.deepEqual([...list.ids].sort(), [...fair].sort());
  assert.equal((await get("/overview")).body.sample, "fair", "the fair sample is the default");
});

test("figures use the reference review and score() for every score", async () => {
  const { body } = await get("/overview?sample=all");
  assert.equal(body.reviewed, 5, "each handoff counts once however many reviews it has");
  assert.deepEqual(body.rubric_mix, [{ value: "handoff-v6", n: 3 }, { value: "handoff-v9", n: 2 }]);
  // Messages 3 and 6 each have an unknown question with nothing below 3.
  assert.equal(body.unscored, 2);
  assert.deepEqual(body.needs_work, wilson(3, 3));
  assert.deepEqual(
    Object.fromEntries(Object.entries(body.lowest_scores).map(([k, v]: any) => [k, v.k])),
    { "1": 2, "2": 1, "3": 0, "4": 0 },
    "message 2's broken issue under handoff-v9 sets its lowest score to 1",
  );
  assert.equal(body.cause.needs_work, 3);
  assert.deepEqual(body.cause.by_dimension, { intent: 0, content: 1, presentation: 2 });
  assert.equal(body.cause.intent_content_only, 1);
  assert.ok(body.issues.find((i: any) => i.kind === "retired_kind" && i.retired && i.k === 1), "kinds from older rubrics stay visible");
});

test("the hook is judged against the presentation score", async () => {
  const s = (await get("/overview?sample=all")).body.screening;
  assert.equal(s.cells.blocked["1"], 1);
  assert.equal(s.cells.allowed["1"], 1, "a warning does not block, so this is a miss");
  assert.equal(s.cells.allowed["4"], 2);
  assert.equal(s.cells.allowed.null, 1);
  assert.deepEqual(s.blocked_low, wilson(1, 2));
  assert.deepEqual(s.allowed_high, wilson(2, 2));
  assert.deepEqual(s.outside, { k: 1, presentation_unknown: 0, needs_work: 3, reviewed: 5 });
  // Checks are taken from the reports. One that never fires is listed apart.
  assert.deepEqual(s.checks.map((c: any) => c.rule).sort(), ["glued", "spacing"]);
  assert.deepEqual(s.silent, ["silent"]);
  const spacing = s.checks.find((c: any) => c.rule === "spacing");
  assert.deepEqual(spacing.sample.warn, { low: 2, high: 0 });
  assert.deepEqual(spacing.warned_but_blocked, { corpus: 1, sample_low: 1 });
});

test("agreement cross-tables pair every two reviews of a message", async () => {
  const { body } = await get("/agreement");
  assert.equal(body.several_reviews, 2);
  assert.equal(body.rubric_examples, 1);
  assert.equal(body.rubric_examples_with_several_reviews, 1);
  const rubric = body.comparisons.find((c: any) => c.key === "fixture-reviewer@handoff-v6|fixture-reviewer@handoff-v9");
  assert.equal(rubric.kind, "changed-rubric");
  assert.equal(rubric.messages, 1, "the rubric example is left out");
  assert.equal(rubric.rubric_examples_left_out, 1);
  assert.equal(rubric.questions.presentation.table["2"]["1"], 1);
  assert.equal(rubric.questions.presentation.table["4"]["4"], 0);
  assert.deepEqual(rubric.questions.presentation.exact, wilson(0, 1));
  assert.deepEqual(rubric.needs_work.agree, wilson(1, 1));
  assert.equal(body.comparisons.length, 3);
  const cell = (await get("/messages?agree=" + encodeURIComponent("fixture-reviewer@handoff-v6|fixture-reviewer@handoff-v9|presentation|2|1"))).body;
  assert.deepEqual(cell.messages.map((m: any) => m.message_id), [id(2)]);
  assert.equal((await get("/messages?pair=" + encodeURIComponent(rubric.key))).body.total, 1, "cell links leave the example out too");
  assert.equal((await get("/messages?example=yes")).body.messages[0].message_id, id(3));
  assert.equal((await get("/messages/" + id(3))).body.rubric_example, true);
  // A pair where one review cannot be judged counts apart from agreement.
  const db = new DatabaseSync(path);
  db.prepare("INSERT INTO analysis_records VALUES(?,?,?,?,?)").run("run-c", "review", id(5), id(5), JSON.stringify(v9(5, { content: "unknown" })));
  db.close();
  const again = (await get("/agreement")).body.comparisons.find((c: any) => c.key === rubric.key);
  assert.equal(again.questions.content.unknown_in_one, 1);
  assert.equal(again.needs_work.table.true.null, 1);
  assert.deepEqual(again.needs_work.agree, wilson(1, 1));
});

test("breakdowns keep exact corpus counts apart from sample estimates", async () => {
  const { body } = await get("/overview?sample=all");
  const model = Object.fromEntries(body.breakdowns.model.map((r: any) => [r.key, r]));
  assert.equal(model["model-a"].inputs, 3);
  assert.equal(model.unknown.inputs, 3);
  assert.deepEqual(model["model-a"].hook_blocked, { k: 1, n: 3, p: 1 / 3 }, "a count over every handoff has no interval");
  assert.equal(model["model-a"].needs_work.low !== undefined, true, "a sample estimate has one");
  assert.equal(model["model-a"].sparse, true);
  assert.equal((await get("/overview?sample=all&basis=thread")).body.breakdowns.model.find((r: any) => r.key === "model-b").inputs, 1);
  assert.deepEqual(
    body.breakdowns.month.map((r: any) => [r.key, r.inputs]),
    [["2026-06", 1], ["2026-07", 0], ["2026-08", 0], ["2026-09", 0], ["2026-10", 1], ["2026-11", 3], ["unknown", 1]],
  );
  const missions = body.missions;
  assert.equal(missions.count, 2);
  assert.equal(missions.unassigned, 1);
  assert.deepEqual(missions.largest, { key: "m-a", inputs: 3 });
  const a = missions.top.find((m: any) => m.key === "m-a");
  assert.equal(a.title, "Invented mission A");
  assert.deepEqual(a.days.map((d: any) => [d.key, d.inputs, d.hook_blocked.k]), [["2026-06-10", 1, 0], ["2026-10-05", 1, 1], ["2026-11-02", 1, 0]]);
});

test("list filters, facets, search and pagination run against the whole corpus", async () => {
  const misses = (await get("/messages?sample=reviewed&hook=allowed&presentation=1,2")).body;
  assert.deepEqual(misses.messages.map((m: any) => m.message_id), [id(2)]);
  assert.equal(misses.messages[0].review.lowest, "1");
  assert.equal(misses.messages[0].review.reviews, 3);
  assert.equal((await get("/messages?lowest=1,2")).body.total, 3);
  assert.equal((await get("/messages?lowest=unknown")).body.total, 2);
  assert.deepEqual((await get("/messages?cause=intent-content")).body.messages.map((m: any) => m.message_id), [id(5)]);
  assert.deepEqual((await get("/messages?sample=waiting")).body.messages.map((m: any) => m.message_id), [id(4)]);
  assert.equal((await get("/messages?picked=random")).body.total, 4, "a rerate draw does not change how a message was picked");
  assert.equal((await get("/messages?picked=rerate")).body.total, 0);
  assert.equal((await get("/messages?several=yes")).body.total, 2);
  assert.equal((await get("/messages?rater=" + encodeURIComponent("second-reviewer@handoff-v8"))).body.total, 1);
  assert.equal((await get("/messages?mission=m-a&day=2026-11-02")).body.messages[0].message_id, id(2));
  const found = (await get("/messages?q=deep%20needle")).body;
  assert.equal(found.total, 1);
  assert.ok(found.messages[0].preview.includes("deep needle"), "search shows the matching passage");
  assert.equal((await get("/messages?model=unknown")).body.total, 3, "the list attributes models as recorded by default");
  assert.equal((await get("/messages?model=unknown&basis=thread")).body.total, 2);
  assert.equal((await get("/messages?flag=spacing:warn")).body.total, 2);
  assert.equal((await get("/messages?issue=fused_words&presentation=1")).body.total, 2);
  const all = (await get("/messages?page_size=2&ids=1&sort=longest")).body;
  assert.equal(all.total, 6);
  assert.equal(all.ids.length, 6);
  assert.equal(all.messages[0].message_id, id(4));
  assert.equal((await get("/messages?page_size=2&page=99")).body.page, 2);
  assert.equal((await get("/messages")).body.ids, undefined);
  const facets = (await get("/messages?lowest=1")).body.facets;
  assert.equal(facets.lowest["2"], 1, "a facet counts as if its own filter were off");
  assert.equal(facets.project.Alpha, 2);
  assert.equal(facets.agree, undefined, "pair-by-pair values are a filter, not a facet");
});

test("detail returns exact text, every review with its scoring, live hook result and bounded context", async () => {
  const { body } = await get("/messages/" + id(2));
  assert.deepEqual(body.reviews.map((r: any) => [r.run_id, r.reviewer, r.rubric_version, r.reference]), [
    ["run-a", "fixture-reviewer", "handoff-v6", false],
    ["run-b", "second-reviewer", "handoff-v8", false],
    ["run-c", "fixture-reviewer", "handoff-v9", true],
  ]);
  assert.deepEqual(body.reviews[0].lowest, { score: 2, questions: ["presentation"] });
  assert.deepEqual(body.reviews[0].scoring.presentation, { written: true, unknown: false, decided_by: null });
  assert.deepEqual(body.reviews[2].lowest, { score: 1, questions: ["presentation"] });
  assert.deepEqual(body.reviews[2].scoring.presentation, { written: false, unknown: false, decided_by: 1 }, "the broken issue sets the score");
  assert.equal(body.reviews[2].needs_work, true);
  assert.equal(body.mission.key, "m-a");
  assert.deepEqual(body.picks.map((p: any) => p.picked), ["random", "rerate"]);
  const three = (await get("/messages/" + id(3))).body;
  assert.deepEqual(three.reviews.at(-1).scoring.content, { written: false, unknown: true, decided_by: null });
  assert.equal(three.reviews.at(-1).needs_work, null);
  const one = (await get("/messages/" + id(1))).body;
  assert.equal(one.text, texts[1]);
  assert.equal(one.hook.live.decision_rule, "invented_rule");
  assert.deepEqual(one.hook.live.checks[0].spans, [{ start: 0, end: 30 }]);
  assert.equal(one.hook.stored.decision_rule, "glued");
  assert.equal(one.model.recorded, "model-a");
  assert.equal(one.legacy_reviews.length, 1, "intentionality-v1 reviews are left out");
  const ctx = one.contexts[0];
  assert.equal(ctx.reviewed, true);
  const emoji = ctx.evidence.find((e: any) => e.evidence_id === "ev-1");
  assert.equal(Array.from(emoji.text as string).length, 1000);
  assert.equal(emoji.omitted, 10);
  assert.deepEqual(emoji.provenance, { line: 7 });
  const prose = ctx.evidence.find((e: any) => e.evidence_id === "ev-2");
  assert.equal(prose.text, "Readable invented prose.");
  assert.equal(prose.extracted, true);
  assert.equal(ctx.references[0].text.text, "Invented file.");

  api.close();
  const missing = createDashboardApi({ database: path, guard: join(directory, "absent"), rubric, reviewConfig: config });
  const fallback = (await missing.detail(id(1)))!;
  assert.equal(fallback.hook.live, null);
  assert.match(fallback.hook.live_error!, /not found/);
  assert.equal(fallback.hook.stored!.decision_rule, "glued");
  missing.close();
});
test("the rubric endpoint serves the file a review was scored under when it can find it", async () => {
  const current = (await get("/rubric")).body;
  assert.equal(current.markdown, readFileSync(rubric, "utf8"));
  const sha = createHash("sha256").update(readFileSync(rubric)).digest("hex");
  const same = (await get("/rubric?sha256=" + sha)).body;
  assert.equal(same.found, true);
  assert.equal(same.current, true);
  const unknown = (await get("/rubric?sha256=" + "0".repeat(64))).body;
  assert.equal(unknown.found, false, "an unknown version falls back to the current file and says so");
  assert.equal(unknown.markdown, current.markdown);
  assert.equal((await get("/rubric?sha256=nothex")).status, 400);
});

test("new reviews written by another connection appear without a restart", async () => {
  assert.equal((await get("/overview?sample=all")).body.reviewed, 5);
  const db = new DatabaseSync(path);
  db.prepare("INSERT INTO analysis_records VALUES(?,?,?,?,?)").run("run-a", "review", id(4), id(4), JSON.stringify(review(4, { presentation: 3, kind: "x" })));
  db.close();
  assert.equal((await get("/overview?sample=all")).body.reviewed, 6);
});

test("the API is read-only and rejects bad input without touching SQLite", async () => {
  const before = createHash("sha256").update(readFileSync(path)).digest("hex");
  for (const method of ["POST", "PUT", "DELETE", "PATCH"]) assert.equal((await fetch(base + "/messages", { method })).status, 405);
  for (const query of ["/messages?page=-1", "/messages?page_size=1000", "/messages?sort=bad", "/overview?sample=random", "/overview?basis=bad", "/messages?q=" + "x".repeat(1001)])
    assert.equal((await get(query)).status, 400, query);
  assert.equal((await get("/messages/not-an-id")).status, 404);
  assert.equal((await get("/messages/" + id(999))).status, 404);
  assert.equal((await get("/nothing")).status, 404);
  assert.equal((await get("/messages?q=" + encodeURIComponent("'; DROP TABLE messages; --"))).body.total, 0);
  // A wildcard is searched for literally; it is not a message-ID pattern.
  for (const q of ["%25", "_"]) assert.equal((await get("/messages?q=" + q)).body.total, 0, q);
  assert.equal((await get("/messages?q=" + id(4))).body.total, 1);
  assert.equal((await fetch(base + "/messages/%E0%A4%A")).status, 400);
  assert.equal(createHash("sha256").update(readFileSync(path)).digest("hex"), before);
});

test("a malformed request line gets a 400 and the server keeps answering", async () => {
  const port = (server.address() as any).port;
  const reply = await new Promise<string>((done, fail) => {
    const socket = connect(port, "127.0.0.1", () => socket.write("GET //[ HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n"));
    let data = "";
    socket.on("data", (d) => (data += d));
    socket.on("end", () => done(data));
    socket.on("error", fail);
  });
  assert.match(reply, /^HTTP\/1\.1 400/);
  assert.equal((await get("/meta")).status, 200);
});

test("a hook binary that exits without reading falls back to the stored report", async () => {
  api.close();
  api = createDashboardApi({ database: path, guard: "/bin/true", rubric, reviewConfig: config });
  const m = (await api.detail(id(1)))!;
  assert.equal(m.hook.live, null);
  assert.ok(m.hook.live_error);
  assert.ok(m.hook.stored);
});

test("outside what the hook can see uses one rule for the count and its link", async () => {
  const db = new DatabaseSync(path);
  // Message 4: needs work for intent (1), with presentation Costly (2). Presentation
  // is not the lowest score, but it is within the hook's view, so it is not outside.
  db.prepare("INSERT INTO analysis_records VALUES(?,?,?,?,?)").run("run-a", "review", id(4), id(4), JSON.stringify(review(4, { intent: 1, presentation: 2 })));
  // Message 6: a newer review that needs work for intent while presentation is unknown.
  const six = { ...v9(6, {}), intent: { statement: "s", reason: "r", issues: [{ kind: "buried_ask", severity: "broken", quote: "", effect: "e", repair: "r" }] }, presentation: { unknown: true, reason: "r", issues: [] } };
  db.prepare("INSERT INTO analysis_records VALUES(?,?,?,?,?)").run("run-c", "review", id(6), id(6), JSON.stringify(six));
  db.close();
  const s = (await get("/overview?sample=all")).body.screening;
  assert.equal(s.outside.k, 1);
  assert.equal(s.outside.presentation_unknown, 1);
  const linked = (await get("/messages?sample=reviewed&outside=yes")).body;
  assert.equal(linked.total, s.outside.k, "the link opens exactly the handoffs the count counts");
  assert.deepEqual(linked.messages.map((m: any) => m.message_id), [id(5)]);
  assert.deepEqual((await get("/messages?sample=reviewed&outside=unknown")).body.messages.map((m: any) => m.message_id), [id(6)]);
  // The overview's "intent or content alone" is a different question: where the lowest score lies.
  assert.ok((await get("/messages?cause=intent-content")).body.messages.some((m: any) => m.message_id === id(4)));
});

test("agreement counts each handoff once per comparison, using each rater's earliest review", async () => {
  const db = new DatabaseSync(path);
  db.prepare("INSERT INTO analysis_runs VALUES(?,?,?,?)").run("run-a2", "manual-review", "2026-11-27T01:00:00Z", JSON.stringify({ reviewer: "fixture-reviewer", rubric_version: "handoff-v6" }));
  // A repeat review of message 2 by the same reviewer under the same rubric, disagreeing with the first.
  db.prepare("INSERT INTO analysis_records VALUES(?,?,?,?,?)").run("run-a2", "review", id(2), id(2), JSON.stringify(review(2, { presentation: 4 })));
  db.close();
  const { body } = await get("/agreement");
  const key = "fixture-reviewer@handoff-v6|fixture-reviewer@handoff-v9";
  const c = body.comparisons.find((x: any) => x.key === key);
  assert.equal(c.messages, 1);
  assert.equal(c.questions.presentation.table["2"]["1"], 1, "the earliest v6 review is used");
  assert.equal(c.questions.presentation.table["4"]["1"], 0);
  assert.equal((await get("/messages?pair=" + encodeURIComponent(key))).body.total, c.messages);
  assert.deepEqual(body.repeat_reviews_unused, [{ rater: "fixture-reviewer@handoff-v6", n: 1 }]);
  assert.equal(body.comparisons.some((x: any) => x.a.rater === x.b.rater), false, "a rater is never compared with itself");
});

test("the hook table caption counts every cell the table shows", async () => {
  const s = (await get("/overview?sample=all")).body.screening;
  const cells = Object.values(s.cells).flatMap((row: any) => Object.values(row) as number[]).reduce((a, b) => a + b, 0);
  assert.equal(s.shown, cells);
  assert.equal(s.shown, 5);
  assert.equal(s.low + s.high, 4, "the rates use only cells with a known presentation score and a stored report");
});

test("the warning note counts only Costly or Broken presentation", async () => {
  const db = new DatabaseSync(path);
  // Message 3 (presentation 4 in its reference review) is now blocked by one check and warned by another.
  db.prepare("UPDATE mechanical_results SET result_json=? WHERE run_id='mech-new' AND message_id=?").run(JSON.stringify(report(true, { glued: "block", spacing: "warn", silent: "pass" })), id(3));
  db.close();
  const spacing = (await get("/overview?sample=all")).body.screening.checks.find((c: any) => c.rule === "spacing");
  assert.equal(spacing.warned_but_blocked.corpus, 2);
  assert.equal(spacing.warned_but_blocked.sample_low, 1);
  assert.equal(spacing.sample.warn.low, 2);
});

test("an unreadable stored review is set aside without taking the API down", async () => {
  const db = new DatabaseSync(path);
  db.prepare("INSERT INTO analysis_records VALUES(?,?,?,?,?)").run("run-a", "review", id(4), id(4), JSON.stringify({ ...review(4, {}), presentation: { reason: "r", issues: "not a list" } }));
  db.prepare("INSERT INTO analysis_records VALUES(?,?,?,?,?)").run("run-b", "review", id(6), id(6), "{not json");
  db.close();
  for (const p of ["/meta", "/overview?sample=all", "/agreement", "/messages"]) assert.equal((await get(p)).status, 200, p);
  assert.equal((await get("/meta")).body.unreadable_reviews, 2);
  const four = (await get("/messages/" + id(4))).body;
  assert.equal(four.reviews.length, 0);
  assert.equal(four.unreadable_reviews.length, 1);
  assert.match(four.unreadable_reviews[0].error, /issues is not a list/);
  const six = (await get("/messages/" + id(6))).body;
  assert.equal(six.reviews.length, 1, "the readable review of the same message is still used");
  assert.equal(six.unreadable_reviews[0].run_id, "run-b");
});

test("drift orders each sender thread's handoffs and cuts it into fifths", async () => {
  const db = new DatabaseSync(path);
  const add = db.prepare("INSERT INTO messages VALUES(?,?,?,?,?,?,?)");
  const obs = db.prepare("INSERT INTO observations VALUES(?,?,?,?,?)");
  const hook = db.prepare("INSERT INTO mechanical_results VALUES(?,?,?)");
  for (let k = 0; k < 40; k++) {
    const m = id(100 + k);
    const text = `Invented drift handoff number ${k}.`;
    add.run(m, text, text.length, 5, JSON.stringify(["assignment"]), JSON.stringify(["Alpha"]), 1);
    const at = new Date(Date.UTC(2026, 10, 10, 10, k)).toISOString();
    // Half are recorded on the sender's own turn, half as deliveries naming the sender.
    const record =
      k % 2 === 0
        ? { source: "t3_turn_items", kind: "assignment", thread_id: "thread-s", thread_title: "Invented sender thread", timestamp: at }
        : { source: "t3_messages", kind: "agent_delivery", thread_id: "recipient-r", sender_thread_id: "thread-s", thread_title: "Invented recipient", timestamp: at };
    obs.run(`drift-${k}`, m, 1000 + k, record.source, JSON.stringify(record));
    hook.run("mech-new", m, JSON.stringify(report(k >= 24, { glued: k >= 24 ? "block" : "pass" })));
  }
  // A delivery that names only its recipient's thread has no sender thread.
  add.run(id(200), "Invented orphan delivery.", 25, 3, JSON.stringify(["agent_delivery"]), JSON.stringify(["Alpha"]), 1);
  obs.run("drift-orphan", id(200), 2000, "t3_messages", JSON.stringify({ source: "t3_messages", kind: "agent_delivery", thread_id: "recipient-r", timestamp: "2026-11-10T12:00:00Z" }));
  db.close();
  const d = (await get("/overview?sample=all")).body.drift;
  assert.equal(d.with_sender_and_time, 40);
  assert.equal(d.without_sender, 7, "the six fixture handoffs and the orphan delivery name no sender");
  assert.equal(d.threads.length, 1);
  const t = d.threads[0];
  assert.equal(t.key, "thread-s");
  assert.equal(t.title, "Invented sender thread", "the title comes from the sender's own records, not the recipient's");
  assert.deepEqual(t.parts.map((p: any) => [p.handoffs, p.hook_blocked.k]), [[8, 0], [8, 0], [8, 0], [8, 8], [8, 8]]);
  assert.deepEqual(d.pooled.map((p: any) => p.hook_blocked.p), [0, 0, 0, 1, 1]);
  assert.equal(d.pooled[0].hook_blocked.low, undefined, "a share over every handoff in the corpus has no interval");
  assert.deepEqual([t.first_half.p, t.second_half.p], [0, 0.8]);
  assert.deepEqual([d.rising, d.falling], [1, 0]);
  const last = (await get("/messages?sender=thread-s&part=5&sort=oldest&page_size=50")).body;
  assert.equal(last.total, 8);
  assert.equal(last.messages[0].message_id, id(132));
  assert.equal(last.sender_titles["thread-s"], "Invented sender thread");
  const one = (await get("/messages/" + id(132))).body;
  assert.deepEqual(one.sender, { key: "thread-s", title: "Invented sender thread", position: { index: 33, of: 40 } });
  assert.equal((await get("/messages/" + id(200))).body.sender, null);
});
