import { statSync, createWriteStream, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { once } from "node:events";
import { eq, desc } from "drizzle-orm";
import type { ResearchDatabase } from "./db/connection.ts";
import { fingerprint } from "./db/connection.ts";
import * as t from "./db/schema.ts";
import {
  canonical,
  parse,
  invariant,
  isPrivatePath,
  chars,
  cut,
  now,
  type Data,
} from "./shared.ts";
import { validate, summary } from "./dataset.ts";
import type { SourceRecord } from "./capture.ts";
const KEEP = [
  "messages",
  "observations",
  "contexts",
  "evidence",
  "context_references",
  "context_evidence",
  "historical_reviews",
  "splits",
  "review_runs",
  "reviews",
  "corpus_gaps",
  "source_files",
];
export function compact(db: ResearchDatabase) {
  const beforeBytes = statSync(db.path).size,
    before = Object.fromEntries(KEEP.map((n) => [n, fingerprint(db, n)]));
  const latest = () =>
    Object.fromEntries(
      db
        .all<{ message_id: string; result_json: string }>(
          `SELECT message_id,result_json FROM (SELECT r.*,row_number() OVER(PARTITION BY message_id ORDER BY m.created_at DESC,r.run_id DESC) n FROM mechanical_results r JOIN mechanical_runs m USING(run_id)) WHERE n=1`,
        )
        .map((r) => [r.message_id, r.result_json]),
    );
  const retained = latest();
  db.transaction(() => {
    db.run(
      `DELETE FROM mechanical_results WHERE rowid IN (SELECT rid FROM (SELECT r.rowid rid,row_number() OVER(PARTITION BY message_id ORDER BY m.created_at DESC,r.run_id DESC) n FROM mechanical_results r JOIN mechanical_runs m USING(run_id)) WHERE n>1)`,
    );
    db.run(
      "DELETE FROM mechanical_runs WHERE run_id NOT IN (SELECT run_id FROM mechanical_results)",
    );
    const seen = new Set<string>(),
      messageCount = db.get<{ n: number }>(
        "SELECT count(*) n FROM messages",
      )!.n;
    for (const row of db.orm
      .select()
      .from(t.analysisRuns)
      .orderBy(desc(t.analysisRuns.created_at), desc(t.analysisRuns.run_id))
      .all()) {
      let remove = ["migration", "hook-integration"].includes(row.kind);
      if (row.kind === "style-calibration")
        remove = !db.get(
          "SELECT 1 FROM analysis_records WHERE run_id=? AND kind='label' LIMIT 1",
          row.run_id,
        );
      if (row.kind === "corpus-evaluation") {
        const key = String(parse<Data>(row.metadata_json).label_source);
        invariant(
          db.get<{ n: number }>(
            "SELECT count(*) n FROM analysis_records WHERE run_id=? AND kind='prediction'",
            row.run_id,
          )!.n === messageCount,
          "Incomplete evaluation; inspect before pruning",
        );
        remove = seen.has(key);
        seen.add(key);
      }
      if (remove) {
        db.orm
          .delete(t.analysisRecords)
          .where(eq(t.analysisRecords.run_id, row.run_id))
          .run();
        db.orm
          .delete(t.analysisRuns)
          .where(eq(t.analysisRuns.run_id, row.run_id))
          .run();
      }
    }
    invariant(
      canonical(before) ===
        canonical(Object.fromEntries(KEEP.map((n) => [n, fingerprint(db, n)]))),
      "Essential research changed during cleanup",
    );
    invariant(
      canonical(retained) === canonical(latest()),
      "Latest diagnostics changed",
    );
    validate(db);
  });
  db.raw.exec("PRAGMA wal_checkpoint(TRUNCATE); VACUUM; PRAGMA optimize");
  validate(db);
  db.raw.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  return {
    before_bytes: beforeBytes,
    after_bytes: statSync(db.path).size,
    preserved_tables: KEEP,
    latest_diagnostics: Object.keys(retained).length,
  };
}
export async function exportSnapshot(
  db: ResearchDatabase,
  target: string,
  textLimit = 1000,
) {
  target = resolve(target);
  invariant(
    isPrivatePath(target),
    "Message exports must be outside Git or under ignored data/",
  );
  mkdirSync(dirname(target), { recursive: true });
  const stream = createWriteStream(target, { mode: 0o600, flags: "wx" });
  const write = async (text: string) => {
    if (!stream.write(text)) await once(stream, "drain");
  };
  try {
    await write(
      '{"schema_version":1,"generated_at":' +
        canonical(now()) +
        ',"database_path":' +
        canonical(resolve(db.path)) +
        ',"summary":' +
        canonical(summary(db)) +
        ',"messages":[',
    );
    let first = true;
    for (const m of db.orm
      .select()
      .from(t.messages)
      .orderBy(t.messages.message_id)
      .all()) {
      const mechanical = db.get<{ result_json: string }>(
        "SELECT r.result_json FROM mechanical_results r JOIN mechanical_runs mr USING(run_id) WHERE message_id=? ORDER BY mr.created_at DESC,mr.run_id DESC LIMIT 1",
        m.message_id,
      );
      const contexts = db
        .all<SourceRecord>(
          "SELECT c.*,o.record_json FROM contexts c JOIN observations o USING(observation_id) WHERE c.message_id=? ORDER BY context_id",
          m.message_id,
        )
        .map((c) => {
          const o = parse<SourceRecord>(c.record_json),
            ctx: SourceRecord = Object.fromEntries(
              [
                "kind",
                "tool",
                "timestamp",
                "project",
                "source",
                "locator",
                "sender_thread_id",
                "target_thread_id",
              ].map((k) => [k, o[k] ?? null]),
            );
          if (!ctx.timestamp && o.timestamp_ms != null)
            ctx.timestamp = new Date(o.timestamp_ms).toISOString();
          Object.assign(ctx, {
            source_item_id: o.item_id ?? null,
            source_line: o.line ?? null,
            source_thread_id: o.thread_id ?? null,
            native_thread_id: o.native_thread_id ?? null,
            model: o.model ?? null,
            model_attribution: o.model_attribution ?? null,
            recorded_target: o.target ?? null,
            context_id: c.context_id,
            task_summary: null,
            context_status: c.status,
            availability: parse(c.metadata_json),
            observation_id: c.observation_id,
          });
          ctx.evidence = db
            .all<SourceRecord>(
              "SELECT e.* FROM evidence e JOIN context_evidence ce USING(evidence_id) WHERE context_id=? ORDER BY evidence_id",
              c.context_id,
            )
            .map((e) => ({ ...e, provenance: parse(e.provenance) }));
          ctx.references = db
            .all<{ record_json: string; reference_id: string }>(
              "SELECT * FROM context_references WHERE context_id=? ORDER BY reference_id",
              c.context_id,
            )
            .map((r) => ({
              ...parse(r.record_json),
              reference_id: r.reference_id,
            }));
          for (const item of [...ctx.evidence, ...ctx.references])
            if (
              textLimit &&
              typeof item.text === "string" &&
              chars(item.text) > textLimit
            ) {
              item.snapshot_original_characters = chars(item.text);
              item.snapshot_omitted_characters = chars(item.text) - textLimit;
              item.text = cut(item.text, textLimit);
            }
          ctx.analyses = db
            .all<{ record_json: string; created_at: string }>(
              "SELECT r.record_json,rr.created_at FROM reviews r JOIN review_runs rr USING(run_id) WHERE context_id=? ORDER BY rr.created_at DESC,review_id DESC",
              c.context_id,
            )
            .map((r) => ({
              ...parse(r.record_json),
              reviewed_at: r.created_at,
            }));
          return ctx;
        });
      const historical = db.orm
        .select()
        .from(t.historicalReviews)
        .where(eq(t.historicalReviews.message_id, m.message_id))
        .orderBy(t.historicalReviews.id)
        .all()
        .map((r) => ({ ...parse(r.record_json), source_path: r.source_path }));
      await write(
        (first ? "" : ",") +
          canonical({
            ...m,
            kinds: parse(m.kinds),
            projects: parse(m.projects),
            mechanical: mechanical ? parse(mechanical.result_json) : null,
            historical_reviews: historical,
            contexts,
          }),
      );
      first = false;
    }
    await write("]}\n");
    stream.end();
    await once(stream, "finish");
  } catch (e) {
    stream.destroy();
    throw e;
  }
}
