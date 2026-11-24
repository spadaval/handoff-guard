/** Backend tests use invented data. No UI tests or real corpus fixtures. */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { eq } from "drizzle-orm";
import {
  openDatabase,
  fingerprint,
  schemaSignature,
} from "../tooling/db/connection.ts";
import * as t from "../tooling/db/schema.ts";
import {
  canonical,
  digest,
  checksum,
  chars,
  words,
  ROOT,
  parse,
  now,
} from "../tooling/shared.ts";
import { importCorpus, validate, addEvidence } from "../tooling/dataset.ts";
import {
  Corpus,
  exportRollout,
  exportT3,
  exportHistory,
  textParts,
  ciphertext,
} from "../tooling/capture.ts";
import { recover, Recovery, timestamp } from "../tooling/recovery.ts";
import {
  createRun,
  put,
  records,
  compiled,
  type Prediction,
} from "../tooling/research-store.ts";
import {
  sampleReview,
  recordReview,
  writePackets,
  verdict,
  insertLegacyReview,
  type Review,
} from "../tooling/reviews.ts";
import {
  prepareSplit,
  evaluate,
  analyzeMechanics,
  prepareCalibration,
  labelCalibration,
  summarizeCalibration,
  type CalibrationLabel,
} from "../tooling/analysis.ts";
import { compact, exportSnapshot } from "../tooling/maintenance.ts";
const binary = resolve(ROOT, "target/release/handoff-guard");
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "handoff-ts-"));
  const path = join(root, "db.sqlite3");
  let db = openDatabase(path);
  return {
    root,
    path,
    get db() {
      return db;
    },
    reopen() {
      db.close();
      db = openDatabase(path);
      return db;
    },
    close() {
      db.close();
      rmSync(root, { recursive: true, force: true });
    },
    recovery: {
      codexState: join(root, "missing-state"),
      t3Db: join(root, "missing-t3"),
    },
  };
}
function body(f: ReturnType<typeof fixture>, text: string, input = 1) {
  const mid = digest(text);
  f.db.orm
    .insert(t.messages)
    .values({
      message_id: mid,
      text,
      characters: chars(text),
      words: words(text),
      kinds: canonical([input ? "assignment" : "worker_report"]),
      projects: '["synthetic"]',
      is_input: input,
    })
    .run();
  return mid;
}
function manifest(
  f: ReturnType<typeof fixture>,
  count: number,
  observations = 0,
) {
  f.db.orm
    .insert(t.metadata)
    .values({
      key: "manifest",
      value: canonical({
        counts: {
          unique_plaintext_bodies: count,
          plaintext_observations: observations,
        },
      }),
    })
    .run();
}
function split(f: ReturnType<typeof fixture>, mid: string, subset = "tuning") {
  f.db.orm
    .insert(t.splits)
    .values({
      message_id: mid,
      record_json: canonical({
        message_id: mid,
        component: mid,
        split: subset,
      }),
    })
    .run();
}
function imported(f: ReturnType<typeof fixture>) {
  const dir = join(f.root, "source");
  mkdirSync(dir);
  const rollout = join(f.root, "rollout.jsonl");
  const records = [
    {
      type: "session_meta",
      payload: { id: "synthetic", cwd: "/missing/synthetic" },
    },
    {
      type: "response_item",
      payload: {
        role: "user",
        content: [{ text: "Check the invented example." }],
      },
    },
    {
      type: "response_item",
      payload: {
        type: "function_call_output",
        output: "Invented tool result.",
      },
    },
    {
      type: "response_item",
      payload: { type: "function_call", name: "spawn_agent", arguments: "{}" },
    },
  ];
  writeFileSync(rollout, records.map((r) => canonical(r) + "\n").join(""));
  const text = "Check sample.rs.\nKeep exact whitespace. 😀 ",
    mid = digest(text),
    msg = {
      message_id: mid,
      text,
      characters: chars(text),
      words: words(text),
      kinds: ["assignment", "worker_report"],
      projects: ["synthetic"],
    },
    obs = {
      message_id: mid,
      kind: "assignment",
      source: "codex_rollout",
      locator: rollout,
      line: 4,
    };
  writeFileSync(join(dir, "messages.jsonl"), canonical(msg) + "\n");
  writeFileSync(
    join(dir, "observations.jsonl"),
    canonical(obs) + "\n" + canonical({ ...obs, kind: "worker_report" }) + "\n",
  );
  writeFileSync(
    join(dir, "manifest.json"),
    canonical({
      files: Object.fromEntries(
        ["messages.jsonl", "observations.jsonl"].map((n) => [
          n,
          { sha256: checksum(join(dir, n)) },
        ]),
      ),
      counts: { unique_plaintext_bodies: 1, plaintext_observations: 2 },
    }),
  );
  return { dir, mid, text };
}
test("checked-in baseline creates a database and adopts v2 without altering records", () => {
  const f = fixture();
  try {
    const mid = body(f, "An invented fixture.");
    const before = fingerprint(f.db, "messages"),
      signature = schemaSignature(f.db.raw);
    f.db.raw.exec("DROP TABLE __drizzle_migrations");
    f.reopen();
    assert.equal(fingerprint(f.db, "messages"), before);
    assert.equal(schemaSignature(f.db.raw), signature);
    assert.equal(
      f.db.orm
        .select()
        .from(t.messages)
        .where(eq(t.messages.message_id, mid))
        .get()!.text,
      "An invented fixture.",
    );
    assert.equal(f.db.all("SELECT * FROM __drizzle_migrations").length, 1);
    f.db.raw.exec(
      "DROP TABLE __drizzle_migrations; CREATE TABLE unexpected_schema(x)",
    );
    f.db.close();
    assert.throws(() => openDatabase(f.path), /schema differs/);
  } finally {
    try {
      f.close();
    } catch {
      rmSync(f.root, { recursive: true, force: true });
    }
  }
});
test("import and recovery preserve exact text, mirrors, visibility and source hashes", async () => {
  const f = fixture();
  try {
    const data = imported(f);
    importCorpus(f.db, data.dir);
    recover(f.db, f.recovery);
    const before = validate(f.db);
    importCorpus(f.db, data.dir);
    recover(f.db, f.recovery);
    assert.deepEqual(validate(f.db), before);
    assert.equal(before.observations, 2);
    assert.equal(before.input_bodies_with_preceding_evidence, 1);
    const contexts = f.db.orm.select().from(t.contexts).all();
    for (const c of contexts) {
      const evidence = f.db.all<{
        kind: string;
        text: string;
        visibility: string;
      }>(
        "SELECT e.* FROM evidence e JOIN context_evidence ce USING(evidence_id) WHERE context_id=?",
        c.context_id,
      );
      const obs = f.db.orm
        .select()
        .from(t.observations)
        .where(eq(t.observations.observation_id, c.observation_id))
        .get()!;
      assert.equal(
        evidence.find((e) => e.kind === "recorded_handoff_body")!.visibility,
        parse<{ kind: string }>(obs.record_json).kind === "assignment"
          ? "recipient_visible"
          : "unknown",
      );
      assert(evidence.some((e) => e.kind === "preceding_function_call_output"));
      assert(
        evidence
          .filter((e) => e.kind !== "recorded_handoff_body")
          .every((e) => e.visibility === "sender_context"),
      );
    }
    const snapshot = join(f.root, "snapshot.json");
    await exportSnapshot(f.db, snapshot, 20);
    const saved = parse<{ messages: { text: string; contexts: unknown[] }[] }>(
      readFileSync(snapshot, "utf8"),
    );
    assert.equal(saved.messages[0].text, data.text);
    assert.equal(saved.messages[0].contexts.length, 2);
    writeFileSync(join(data.dir, "messages.jsonl"), "changed");
    assert.throws(() => importCorpus(f.db, data.dir), /Source changed/);
    rmSync(data.dir, { recursive: true });
    assert.deepEqual(validate(f.db), before);
  } finally {
    f.close();
  }
});
test("capture separates ciphertext, exact bodies and recorded tool arguments from JavaScript", () => {
  const f = fixture();
  try {
    const c = new Corpus(f.db),
      rollout = join(f.root, "capture.jsonl");
    writeFileSync(
      rollout,
      [
        { type: "turn_context", payload: { model: "historical-model" } },
        {
          type: "response_item",
          payload: {
            type: "function_call",
            namespace: "agents",
            name: "spawn_agent",
            call_id: "call-1",
            arguments: JSON.stringify({ message: "Actual invented task." }),
          },
        },
        {
          type: "response_item",
          payload: {
            type: "custom_tool_call",
            name: "exec",
            input:
              'await tools.spawn_agent({message:"Not a recorded message"})',
          },
        },
      ]
        .map((r) => JSON.stringify(r))
        .join("\n"),
    );
    exportRollout(c, rollout);
    c.add("😀 Exact. \n", "assignment", {
      source: "synthetic",
      locator: "one",
    });
    c.add("😀 Exact. \n", "assignment", {
      source: "synthetic",
      locator: "two",
    });
    c.add(
      "encrypted transport",
      "assignment",
      { source: "synthetic", locator: "cipher" },
      true,
    );
    c.tool(
      "mcp__t3_code__delegate_task",
      { task: "Another invented task." },
      { source: "synthetic", locator: "three" },
    );
    const result = c.finish();
    assert.equal(result.counts.unique_plaintext_bodies, 3);
    assert.equal(result.counts.plaintext_observations, 4);
    assert.equal(result.counts.opaque_observations, 1);
    assert.equal(
      f.db.get<{ n: number }>(
        "SELECT count(*) n FROM messages WHERE instr(text,'Not a recorded')>0",
      )!.n,
      0,
    );
    const obs = f.db.orm
      .select()
      .from(t.observations)
      .where(eq(t.observations.export_line, 1))
      .get()!;
    assert.equal(
      parse<{ model: string }>(obs.record_json).model,
      "historical-model",
    );
    assert.equal(words("a\u0085b\u001cc"), 3);
    assert.equal(chars("😀"), 1);
    assert.equal(
      textParts([{ text: "first" }, { text: "second" }]),
      "first\nsecond",
    );
    assert.equal(ciphertext("ordinary text"), false);
  } finally {
    f.close();
  }
});
test("shared evidence retains separate provenance and explicit Unicode omissions", () => {
  const f = fixture();
  try {
    const data = imported(f);
    importCorpus(f.db, data.dir);
    const c = f.db.orm.select().from(t.contexts).get()!,
      text = "😀".repeat(24001);
    addEvidence(f.db, c.context_id, "synthetic", text, { line: 1 });
    addEvidence(f.db, c.context_id, "synthetic", text, { line: 2 });
    const rows = f.db.all<{ text: string; provenance: string }>(
      "SELECT * FROM evidence",
    );
    assert.equal(rows.length, 2);
    assert.equal(f.db.orm.select().from(t.contextTexts).all().length, 1);
    assert.equal(chars(rows[0].text), 24000);
    assert.equal(
      parse<{ omitted_characters: number }>(rows[0].provenance)
        .omitted_characters,
      1,
    );
  } finally {
    f.close();
  }
});
test("historical Git recovery uses recorded revisions and caps source reads", () => {
  const f = fixture();
  try {
    const git = (...args: string[]) => {
      const r = spawnSync("git", ["-C", f.root, ...args], { encoding: "utf8" });
      assert.equal(r.status, 0, r.stderr);
      return r.stdout.trim();
    };
    git("init", "-q");
    writeFileSync(join(f.root, "README.md"), "Recorded old instructions.");
    git("add", "README.md");
    git(
      "-c",
      "user.name=Synthetic",
      "-c",
      "user.email=synthetic@example.invalid",
      "commit",
      "-qm",
      "fixture",
    );
    const revision = git("rev-parse", "HEAD");
    writeFileSync(
      join(f.root, "README.md"),
      "Current file must not be substituted.",
    );
    const r = new Recovery(f.db, f.recovery);
    try {
      assert.equal(
        r.gitReference(f.root, revision, "README.md").text,
        "Recorded old instructions.",
      );
      assert.equal(
        r.gitReference(f.root, revision, "../../outside.md").reason,
        "reference outside recorded repository",
      );
      assert.equal(
        r.gitReference(f.root, "not-a-revision", "README.md").reason,
        "invalid recorded revision",
      );
    } finally {
      r.close();
    }
  } finally {
    f.close();
  }
});
test("later sessions cannot supply earlier revisions and missing timestamps stay unknown", () => {
  const f = fixture();
  try {
    const path = join(f.root, "session.jsonl");
    writeFileSync(
      path,
      canonical({
        type: "session_meta",
        timestamp: "2026-02-02T00:00:00Z",
        payload: { id: "s", cwd: f.root, git: { commit_hash: "a".repeat(40) } },
      }) + "\n",
    );
    const r = new Recovery(f.db, f.recovery);
    try {
      r.nativePaths.set("s", path);
      r.t3Native.set("thread", ["s"]);
      assert.equal(
        r.sessionMetadata({
          thread_id: "thread",
          timestamp: "2026-01-01T00:00:00Z",
        }).gap,
        "no unique recorded session metadata",
      );
      assert.equal(
        r.sessionMetadata({ thread_id: "thread" }).gap,
        "no unique recorded session metadata",
      );
      assert.equal(
        r.sessionMetadata({
          thread_id: "thread",
          timestamp: "2026-03-01T00:00:00Z",
        }).id,
        "s",
      );
    } finally {
      r.close();
    }
    assert.equal(timestamp("2026-01-01T00:00:00"), undefined);
  } finally {
    f.close();
  }
});
test("cache origins require exact body matches and retain unknown visibility", () => {
  const f = fixture();
  try {
    const text = "An invented cached handoff.",
      rollout = join(f.root, "original.jsonl"),
      cache = join(f.root, "cache.json");
    writeFileSync(
      rollout,
      [
        { type: "session_meta", payload: { id: "s" } },
        {
          type: "response_item",
          payload: {
            role: "user",
            content: [{ text: "An earlier invented instruction." }],
          },
        },
        {
          type: "response_item",
          payload: {
            type: "function_call",
            arguments: JSON.stringify({ task: text }),
          },
        },
      ]
        .map((r) => canonical(r) + "\n")
        .join(""),
    );
    writeFileSync(
      cache,
      JSON.stringify([{ text, context: { model: "synthetic" } }]),
    );
    const c = new Corpus(f.db);
    c.add(text, "cached_agent_message", {
      source: "audit_cache",
      locator: cache,
      item_id: "0",
      original_rollout: rollout,
    });
    c.finish();
    recover(f.db, f.recovery);
    const context = f.db.orm.select().from(t.contexts).get()!,
      meta = parse<{
        cache_original_rollout_recovery: { exact_body_matches: number };
      }>(context.metadata_json);
    assert.equal(meta.cache_original_rollout_recovery.exact_body_matches, 1);
    const evidence = f.db.all<{ kind: string; visibility: string }>(
      "SELECT * FROM evidence",
    );
    assert(evidence.some((e) => e.kind === "cache_origin_first_recorded_user"));
    assert(evidence.every((e) => e.visibility === "unknown"));
    const before = fingerprint(f.db, "evidence_records");
    recover(f.db, f.recovery);
    assert.equal(fingerprint(f.db, "evidence_records"), before);
  } finally {
    f.close();
  }
});
test("immutable research records reject conflicting writes and foreign message IDs", () => {
  const f = fixture();
  try {
    const mid = body(f, "Check the invented fixture.");
    f.db.transaction(() => {
      createRun(f.db, "r", "review", { rubric: "test" });
      put(f.db, "r", "label", mid, { label: "normal" }, mid);
    });
    createRun(f.db, "r", "review", { rubric: "test" });
    put(f.db, "r", "label", mid, { label: "normal" }, mid);
    assert.throws(
      () => put(f.db, "r", "label", mid, { label: "pathological" }, mid),
      /overwrite/,
    );
    assert.throws(() => put(f.db, "r", "label", "x", {}, "missing"));
    assert.deepEqual(records(f.db, "r", "label"), [{ label: "normal" }]);
  } finally {
    f.close();
  }
});
test("manual reviews bind frozen IDs, contexts, evidence and anchored score repairs", () => {
  const f = fixture();
  try {
    const data = imported(f);
    importCorpus(f.db, data.dir);
    recover(f.db, f.recovery);
    split(f, data.mid);
    sampleReview(f.db, "review", 1, "synthetic");
    const sample = records<{ message_id: string; context_id: string }>(
      f.db,
      "review",
      "sample",
    )[0];
    const r: Review = {
      message_id: sample.message_id,
      context_id: sample.context_id,
      full_message_reviewed: true,
      exchange: {
        sender: "coordinator",
        recipient: "implementer",
        type: "instruction",
      },
      situation: "An invented task is underway.",
      intent: {
        statement: "Check a fixture.",
        score: 4,
        reason: "The ask is the first sentence.",
      },
      content: { score: null, reason: "Recipient access is unknown." },
      presentation: { score: 4, reason: "Ordinary instruction." },
    };
    assert.equal(recordReview(f.db, "review", r).verdict, "send");
    assert.throws(
      () => recordReview(f.db, "review", { ...r, message_id: "unknown" }),
      /outside/,
    );
    assert.throws(
      () =>
        recordReview(f.db, "review", {
          ...r,
          presentation: { score: 3, reason: "Needs revision." },
        }),
      /needs at least one issue/,
    );
    const issue = {
      kind: "fused_words",
      quote: "not in the message at all",
      effect: "The reader must split the words.",
      repair: "Add spaces.",
    };
    assert.throws(
      () =>
        recordReview(f.db, "review", {
          ...r,
          presentation: { score: 3, reason: "Fused.", issues: [issue] },
        }),
      /exact substring/,
    );
    assert.throws(
      () =>
        recordReview(f.db, "review", {
          ...r,
          presentation: {
            score: 3,
            reason: "Wrong list.",
            issues: [{ ...issue, kind: "no_ask", quote: "" }],
          },
        }),
      /unknown issue kind/,
    );
    assert.throws(
      () =>
        recordReview(f.db, "review", {
          ...r,
          presentation: {
            score: 2,
            reason: "Fused.",
            issues: [{ ...issue, quote: data.text.slice(0, 5) }],
          },
        }),
      /rewrite/,
    );
    assert.equal(
      verdict({
        intent: { score: 4 },
        content: { score: 1 },
        presentation: { score: null },
      }),
      "rewrite",
    );
    assert.throws(
      () => sampleReview(f.db, "second", 1, "synthetic"),
      /exceeds stratum/,
    );
    assert.throws(
      () => writePackets(f.db, "review", "packets-in-git"),
      /ignored/,
    );
    const packets = writePackets(f.db, "review", join(f.root, "packets"));
    assert.equal(packets.files.length, 1);
    assert.ok(readFileSync(packets.files[0], "utf8").includes(data.text));
    assert.throws(() => sampleReview(f.db, "review", 1, "synthetic"), /frozen/);
    const c = f.db.orm.select().from(t.contexts).get()!;
    f.db.orm
      .insert(t.reviewRuns)
      .values({
        run_id: "legacy",
        rubric_version: "v1",
        reviewer: "synthetic",
        created_at: now(),
        metadata_json: "{}",
      })
      .run();
    const old = Object.fromEntries(
      ["purpose", "information_selection", "clarity", "overall"].map((k) => [
        k,
        { grade: "unknown", reason: "Missing evidence." },
      ]),
    );
    insertLegacyReview(f.db, "legacy", c.context_id, data.mid, {
      ...old,
      rationale: "Invented example.",
      evidence_ids: [],
    });
    assert.throws(
      () =>
        insertLegacyReview(f.db, "legacy", c.context_id, "other", {
          ...old,
          rationale: "x",
          evidence_ids: [],
        }),
      /another message/,
    );
  } finally {
    f.close();
  }
});
test("thread splits connect shared bodies and sender/recipient threads and stay frozen", () => {
  const f = fixture();
  try {
    const c = new Corpus(f.db);
    c.add("Shared invented body.", "assignment", {
      source: "synthetic",
      locator: "one",
      thread_id: "a",
      sender_thread_id: "b",
    });
    c.add("Second invented body.", "assignment", {
      source: "synthetic",
      locator: "two",
      thread_id: "b",
    });
    c.finish();
    prepareSplit(f.db);
    const rows = f.db.orm
      .select()
      .from(t.splits)
      .all()
      .map((r) => parse<{ component: string }>(r.record_json));
    assert.equal(rows[0].component, rows[1].component);
    assert.throws(() => prepareSplit(f.db), /already exists/);
  } finally {
    f.close();
  }
});
test(
  "compiled evaluation covers outputs separately and retains size/style distinction",
  { skip: !existsSync(binary) },
  () => {
    const f = fixture();
    try {
      const a = body(f, "Review the ordinary invented task."),
        b = body(f, "collapsedwords".repeat(35)),
        c = body(f, "ordinary ".repeat(1600), 0);
      for (const mid of [a, b, c]) split(f, mid);
      manifest(f, 3);
      for (const [id, label] of [
        [a, "normal"],
        [b, "pathological"],
        [c, "normal"],
      ])
        f.db.orm
          .insert(t.historicalReviews)
          .values({
            id,
            message_id: id,
            source_path: "/synthetic/labels-full.jsonl",
            record_json: canonical({ message_id: id, style_label: label }),
          })
          .run();
      const result = evaluate(f.db, binary);
      assert.equal(result.groups["all_plaintext:all"].counts.bodies, 3);
      assert.equal(result.groups["handoff_inputs:all"].counts.bodies, 2);
      assert.equal(
        result.groups["handoff_inputs:all"].style_confusion.true_positive,
        1,
      );
      assert.equal(
        result.groups["worker_output_only:all"].style_confusion
          .excluded_size_policy,
        1,
      );
      const run = analyzeMechanics(f.db, binary);
      assert.equal(run.bodies, 2);
      assert.deepEqual(analyzeMechanics(f.db, binary), run);
      assert.equal(f.db.orm.select().from(t.mechanicalResults).all().length, 2);
    } finally {
      f.close();
    }
  },
);
test(
  "calibration freezes samples, compares compiled policy, and preserves ambiguous labels",
  { skip: !existsSync(binary) },
  () => {
    const f = fixture();
    try {
      const a = body(f, "Read the first invented fixture."),
        b = body(f, "Read the second invented fixture.");
      split(f, a);
      split(f, b, "heldout");
      createRun(f.db, "baseline", "policy-baseline", {});
      for (const r of compiled<Prediction>(f.db, binary, "evaluate"))
        put(f.db, "baseline", "prediction", r.message_id, r, r.message_id);
      const prepared = prepareCalibration(
        f.db,
        "trial",
        binary,
        undefined,
        "baseline",
      );
      assert.equal(prepared.sample_count, 2);
      assert.equal(records(f.db, "trial", "inspection").length, 0);
      assert.throws(
        () => prepareCalibration(f.db, "trial", binary, undefined, "baseline"),
        /frozen/,
      );
      const label = (mid: string): CalibrationLabel => ({
        message_id: mid,
        style_label: "ambiguous",
        punctuation_spacing: "absent",
        needless_shorthand: "ambiguous",
        note: "Invented ambiguity.",
        reviewer: "synthetic",
      });
      assert.throws(
        () => labelCalibration(f.db, "trial", "tuning", [label(a), label(b)]),
        /exact frozen/,
      );
      labelCalibration(f.db, "trial", "tuning", [label(a)]);
      labelCalibration(f.db, "trial", "heldout", [label(b)]);
      const summary = summarizeCalibration(f.db, "trial");
      assert.equal(
        (summary.results.heldout.needless_shorthand as { ambiguous: number })
          .ambiguous,
        1,
      );
      assert.throws(
        () =>
          labelCalibration(f.db, "trial", "tuning", [
            { ...label(a), note: "Conflicting decision." },
          ]),
        /overwrite/,
      );
    } finally {
      f.close();
    }
  },
);
test("compaction preserves canonical data and only newest diagnostic per body", () => {
  const f = fixture();
  try {
    const mid = body(f, "An invented maintenance fixture.");
    manifest(f, 1);
    for (const [run, date] of [
      ["old", "2020"],
      ["new", "2021"],
    ]) {
      f.db.orm
        .insert(t.mechanicalRuns)
        .values({ run_id: run, created_at: date, metadata_json: "{}" })
        .run();
      f.db.orm
        .insert(t.mechanicalResults)
        .values({
          run_id: run,
          message_id: mid,
          result_json: canonical({ message_id: mid, run }),
        })
        .run();
    }
    createRun(f.db, "scratch", "migration", {});
    const before = fingerprint(f.db, "messages");
    compact(f.db);
    assert.equal(
      f.db.orm.select().from(t.mechanicalResults).get()!.run_id,
      "new",
    );
    assert.equal(f.db.orm.select().from(t.analysisRuns).all().length, 0);
    assert.equal(fingerprint(f.db, "messages"), before);
  } finally {
    f.close();
  }
});

test("T3 and history capture recover bounded preceding records without future messages", () => {
  const f = fixture();
  try {
    const path = join(f.root, "t3.sqlite3"),
      source = new DatabaseSync(path);
    source.exec(`CREATE TABLE projection_projects(project_id TEXT,title TEXT);
 CREATE TABLE orchestration_v2_projection_threads(thread_id TEXT,project_id TEXT,title TEXT,payload_json TEXT);
 CREATE TABLE orchestration_v2_projection_provider_threads(thread_id TEXT,payload_json TEXT);
 CREATE TABLE orchestration_v2_projection_messages(message_id TEXT,thread_id TEXT,role TEXT,created_at TEXT,payload_json TEXT);
 CREATE TABLE orchestration_v2_projection_turn_items(turn_item_id TEXT,thread_id TEXT,type TEXT,payload_json TEXT);
 CREATE TABLE orchestration_v2_projection_subagents(subagent_id TEXT,thread_id TEXT,payload_json TEXT);`);
    source
      .prepare("INSERT INTO projection_projects VALUES(?,?)")
      .run("p", "Synthetic");
    source
      .prepare(
        "INSERT INTO orchestration_v2_projection_threads VALUES(?,?,?,?)",
      )
      .run(
        "tid",
        "p",
        "Invented child",
        JSON.stringify({
          lineage: { relationshipToParent: "subagent" },
          modelSelection: { model: "saved-setting" },
        }),
      );
    source
      .prepare(
        "INSERT INTO orchestration_v2_projection_provider_threads VALUES(?,?)",
      )
      .run("tid", JSON.stringify({ nativeThreadRef: { nativeId: "native" } }));
    for (const [id, role, stamp, payload] of [
      [
        "prior",
        "user",
        "2026-01-01T00:00:00Z",
        { text: "Prior invented instruction." },
      ],
      [
        "handoff",
        "user",
        "2026-01-01T00:00:20Z",
        { createdBy: "agent", text: "Perform the invented task." },
      ],
      [
        "future",
        "assistant",
        "2026-01-01T00:00:30Z",
        { text: "Future text must not enter earlier context." },
      ],
    ])
      source
        .prepare(
          "INSERT INTO orchestration_v2_projection_messages VALUES(?,?,?,?,?)",
        )
        .run(
          id as string,
          "tid",
          role as string,
          stamp as string,
          JSON.stringify(payload),
        );
    source
      .prepare(
        "INSERT INTO orchestration_v2_projection_turn_items VALUES(?,?,?,?)",
      )
      .run(
        "tool",
        "tid",
        "dynamic_tool",
        JSON.stringify({
          toolName: "spawn_agent",
          input: { message: "Another invented assignment." },
          startedAt: "2026-01-01T00:00:15Z",
        }),
      );
    source.close();
    const c = new Corpus(f.db),
      maps = exportT3(c, path);
    const historyPath = join(f.root, "history.sqlite3"),
      history = new DatabaseSync(historyPath);
    history.exec(
      "CREATE TABLE thread_items(thread_id TEXT,item_id TEXT,created_at_ms INT,item_type TEXT,item_json TEXT,rollout_ordinal INT)",
    );
    history
      .prepare("INSERT INTO thread_items VALUES(?,?,?,?,?,?)")
      .run(
        "native",
        "h1",
        1000,
        "mcpToolCall",
        JSON.stringify({
          tool: "send_message",
          arguments: { message: "An invented history message." },
        }),
        1,
      );
    history.close();
    exportHistory(c, historyPath, maps.native);
    c.finish();
    recover(f.db, { ...f.recovery, t3Db: path });
    validate(f.db);
    const context = f.db.get<{ context_id: string }>(
      `SELECT context_id FROM contexts c JOIN observations o USING(observation_id) WHERE json_extract(o.record_json,'$.item_id')='handoff'`,
    )!;
    const evidence = f.db.all<{ text: string }>(
      `SELECT e.text FROM evidence e JOIN context_evidence ce USING(evidence_id) WHERE context_id=?`,
      context.context_id,
    );
    assert(
      evidence.some((e) => e.text.includes("Prior invented instruction.")),
    );
    assert(
      evidence.every(
        (e) => !e.text.includes("Future text must not enter earlier context."),
      ),
    );
    assert(
      f.db.orm
        .select()
        .from(t.messages)
        .all()
        .some((m) => m.text === "An invented history message."),
    );
  } finally {
    f.close();
  }
});
