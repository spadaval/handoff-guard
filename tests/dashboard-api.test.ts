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

let directory: string, path: string, guard: string, rubric: string;
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
const score = (n: number | null, kind?: string, quote = "") => ({
  score: n,
  reason: "Invented reason.",
  issues: n !== null && n < 4 ? [{ kind: kind ?? "fused_words", quote, effect: "Invented effect.", repair: "Invented repair." }] : [],
});
const review = (n: number, presentation: number | null, content = 4, quote = "") => ({
  message_id: id(n),
  context_id: null,
  full_message_reviewed: true,
  exchange: { sender: "coordinator", recipient: "implementer", type: "instruction" },
  situation: "Invented situation.",
  intent: { statement: "Invented intent.", ...score(4) },
  content: score(content, "private_reference"),
  presentation: score(presentation, "fused_words", quote),
  ...(presentation !== null && presentation <= 2 ? { rewrite: { text: "Check that it is done, ship it now, then report back." } } : {}),
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
  const observe = (n: number, record: object) => insert("INSERT INTO observations VALUES(?,?,?,?,?)", `obs-${++line}`, id(n), line, (record as any).source, JSON.stringify(record));
  observe(1, { source: "codex_rollout", kind: "assignment", model: "model-a", timestamp: "2026-10-05T10:00:00Z" });
  observe(1, { source: "t3_messages", kind: "agent_delivery", saved_model_selection: "model-recipient", timestamp: "2026-10-05T10:00:01Z" });
  observe(2, { source: "t3_turn_items", kind: "assignment", saved_model_selection: "model-b", timestamp: "2026-11-02T10:00:00Z" });
  observe(3, { source: "t3_messages", kind: "agent_delivery", saved_model_selection: "model-c", timestamp_ms: Date.parse("2026-06-10T10:00:00Z") });
  for (const n of [5, 6]) observe(n, { source: "codex_rollout", kind: "assignment", model: "model-a", timestamp: "2026-11-20T10:00:00Z" });
  insert("INSERT INTO mechanical_runs VALUES(?,?,?)", "mech-old", "2026-01-01", JSON.stringify({ binary_sha256: "old" }));
  insert("INSERT INTO mechanical_runs VALUES(?,?,?)", "mech-new", "2026-02-01", JSON.stringify({ binary_sha256: "new" }));
  insert("INSERT INTO mechanical_results VALUES(?,?,?)", "mech-old", id(3), JSON.stringify(report(true, { size: "block" })));
  const hook: Record<number, object> = {
    1: report(true, { glued: "block", spacing: "pass" }),
    2: report(false, { glued: "pass", spacing: "warn" }),
  };
  for (const n of [1, 2, 3, 4, 5, 6])
    insert("INSERT INTO mechanical_results VALUES(?,?,?)", "mech-new", id(n), JSON.stringify(hook[n] ?? report(false, { glued: "pass", spacing: "pass" })));
  insert("INSERT INTO analysis_runs VALUES(?,?,?,?)", "run-a", "manual-review", "2026-11-24", JSON.stringify({ reviewer: "fixture-reviewer", rubric_version: "handoff-v6" }));
  insert("INSERT INTO analysis_runs VALUES(?,?,?,?)", "other", "corpus-evaluation", "2026-11-24", "{}");
  for (const [n, stratum] of [[1, "random"], [2, "random"], [3, "random"], [5, "fused"], [6, "random"]] as const)
    insert("INSERT INTO analysis_records VALUES(?,?,?,?,?)", "run-a", "sample", id(n), id(n), JSON.stringify({ message_id: id(n), stratum, split: "heldout", context_id: n === 1 ? "ctx-1" : null }));
  const reviews: [number, object][] = [
    [1, review(1, 1, 4, FUSED)],
    [2, review(2, 2, 4, "status=green")],
    [3, review(3, 4)],
    [5, { ...review(5, 4, 3), content: { score: 3, reason: "r", issues: [{ kind: "retired_kind", quote: "", effect: "e", repair: "r" }] } }],
  ];
  for (const [n, r] of reviews) insert("INSERT INTO analysis_records VALUES(?,?,?,?,?)", "run-a", "review", id(n), id(n), JSON.stringify(r));
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
  api = createDashboardApi({ database: path, guard, rubric });
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

test("meta counts inputs, samples, reviews and both sender-model tiers", async () => {
  const { body } = await get("/meta");
  assert.equal(body.corpus.bodies, 8);
  assert.equal(body.corpus.inputs, 6);
  assert.equal(body.sampled, 5);
  assert.equal(body.reviewed, 4);
  assert.deepEqual(
    body.strata_counts.find((s: any) => s.stratum === "random"),
    { stratum: "random", sampled: 4, reviewed: 3 },
  );
  // Recorded at send for 1, 5 and 6; message 2 only has its own thread's setting.
  assert.equal(body.corpus.with_recorded_model, 3);
  assert.equal(body.corpus.with_thread_model, 1);
  // A t3_messages record names the recipient's thread, so message 3 stays unknown.
  assert.equal(body.facets.models.find((m: any) => m.value === "unknown").n, 2);
  assert.equal(body.facets.models.find((m: any) => m.value === "model-recipient"), undefined);
  assert.equal(body.runs[0].rubric_version, "handoff-v6");
  assert.equal(body.legacy_reviews, 1);
  assert.equal(body.hook.stored_run.run_id, "mech-new");
});

test("overview reports proportions with denominators, intervals and the screening table", async () => {
  const { body } = await get("/overview?sample=random");
  assert.equal(body.sampled, 4);
  assert.equal(body.reviewed, 3);
  assert.deepEqual(
    { k: body.verdicts.rewrite.k, n: body.verdicts.rewrite.n },
    { k: 1, n: 3 },
  );
  assert.deepEqual(body.verdicts.send, wilson(1, 3));
  const s = body.screening;
  assert.equal(s.cells.blocked.bad, 1);
  assert.equal(s.cells.warned.bad, 1, "a warning does not block, so it counts as a miss");
  assert.equal(s.cells.passed.fine, 1);
  assert.equal(s.cells.passed.unreviewed, 1);
  assert.deepEqual([s.sensitivity.k, s.sensitivity.n], [1, 2]);
  assert.deepEqual([s.specificity.k, s.specificity.n], [1, 1]);
  assert.deepEqual([s.flagged_sensitivity.k, s.flagged_sensitivity.n], [2, 2]);
  // Rules are taken from the reports, not from a list in the API.
  assert.deepEqual(s.rules.map((r: any) => r.rule).sort(), ["glued", "spacing"]);
  // Month rows span every month between the first and last, including empty ones.
  assert.deepEqual(
    body.breakdowns.month.map((r: any) => [r.key, r.inputs]),
    [["2026-06", 1], ["2026-07", 0], ["2026-08", 0], ["2026-09", 0], ["2026-10", 1], ["2026-11", 3], ["unknown", 1]],
  );
  assert.equal(body.onset.first_fused_words, "2026-10");
  assert.equal(body.onset.first_hook_block, "2026-10");
  const model = Object.fromEntries(body.breakdowns.model.map((r: any) => [r.key, r]));
  assert.equal(model["model-a"].inputs, 3);
  assert.equal(model.unknown.inputs, 3);
  const thread = (await get("/overview?sample=random&basis=thread")).body;
  assert.equal(thread.breakdowns.model.find((r: any) => r.key === "model-b").inputs, 1);
  const fused = (await get("/overview?sample=fused")).body;
  assert.equal(fused.reviewed, 1);
  assert.ok(fused.issues.find((i: any) => i.kind === "retired_kind" && i.retired && i.k === 1), "kinds from older rubrics stay visible");
  const presentation = (await get("/overview?sample=random&criterion=presentation")).body;
  assert.equal(presentation.screening.cells.warned.bad, 1);
});

test("list filters, facets, search and pagination run against the whole corpus", async () => {
  const misses = (await get("/messages?sample=random&hook=allowed&reviewer=bad")).body;
  assert.deepEqual(misses.messages.map((m: any) => m.message_id), [id(2)]);
  assert.equal(misses.messages[0].review.verdict, "revise");
  const found = (await get("/messages?q=deep%20needle")).body;
  assert.equal(found.total, 1);
  assert.ok(found.messages[0].preview.includes("deep needle"), "search shows the matching passage");
  assert.equal((await get("/messages?model=unknown&basis=recorded")).body.total, 3);
  assert.equal((await get("/messages?model=unknown")).body.total, 2);
  assert.equal((await get("/messages?flag=spacing:warn")).body.total, 1);
  assert.equal((await get("/messages?issue=fused_words&presentation=1")).body.total, 1);
  assert.equal((await get("/messages?review=pending")).body.messages[0].message_id, id(6));
  const all = (await get("/messages?page_size=2&ids=1&sort=longest")).body;
  assert.equal(all.total, 6);
  assert.equal(all.ids.length, 6);
  assert.equal(all.messages[0].message_id, id(4));
  assert.equal((await get("/messages?page_size=2&page=99")).body.page, 2);
  assert.equal((await get("/messages")).body.ids, undefined);
  const facets = (await get("/messages?review=rewrite")).body.facets;
  assert.equal(facets.review.revise, 1, "a facet counts as if its own filter were off");
  assert.equal(facets.project.Alpha, 1);
});

test("detail returns exact text, live hook result, stored fallback and bounded context", async () => {
  const { body } = await get("/messages/" + id(1));
  assert.equal(body.text, texts[1]);
  assert.equal(body.hook.live.decision_rule, "invented_rule");
  assert.deepEqual(body.hook.live.checks[0].spans, [{ start: 0, end: 30 }]);
  assert.equal(body.hook.stored.decision_rule, "glued");
  assert.equal(body.model.recorded, "model-a");
  assert.equal(body.reviews[0].verdict, "rewrite");
  assert.equal(body.reviews[0].rubric_version, "handoff-v6");
  assert.equal(body.legacy_reviews.length, 1, "intentionality-v1 reviews are left out");
  const ctx = body.contexts[0];
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
  const missing = createDashboardApi({ database: path, guard: join(directory, "absent"), rubric });
  const fallback = (await missing.detail(id(1)))!;
  assert.equal(fallback.hook.live, null);
  assert.match(fallback.hook.live_error!, /not found/);
  assert.equal(fallback.hook.stored!.decision_rule, "glued");
  missing.close();
});

test("the rubric endpoint serves the tracked file as written", async () => {
  const { body } = await get("/rubric");
  assert.equal(body.markdown, readFileSync(rubric, "utf8"));
});

test("new reviews written by another connection appear without a restart", async () => {
  assert.equal((await get("/overview?sample=random")).body.reviewed, 3);
  const db = new DatabaseSync(path);
  db.prepare("INSERT INTO analysis_records VALUES(?,?,?,?,?)").run("run-a", "review", id(6), id(6), JSON.stringify(review(6, 3)));
  db.close();
  assert.equal((await get("/overview?sample=random")).body.reviewed, 4);
});

test("the API is read-only and rejects bad input without touching SQLite", async () => {
  const before = createHash("sha256").update(readFileSync(path)).digest("hex");
  for (const method of ["POST", "PUT", "DELETE", "PATCH"])
    assert.equal((await fetch(base + "/messages", { method })).status, 405);
  for (const query of ["/messages?page=-1", "/messages?page_size=1000", "/messages?sort=bad", "/overview?sample=bad", "/overview?criterion=bad", "/messages?q=" + "x".repeat(1001)])
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
    const socket = connect(port, "127.0.0.1", () =>
      socket.write("GET //[ HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n"),
    );
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
  api = createDashboardApi({ database: path, guard: "/bin/true", rubric });
  const m = (await api.detail(id(1)))!;
  assert.equal(m.hook.live, null);
  assert.ok(m.hook.live_error);
  assert.ok(m.hook.stored);
});
