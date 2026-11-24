import { eq, and, sql } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as t from "./db/schema.ts";
import type { ResearchDatabase } from "./db/connection.ts";
import {
  ROOT,
  canonical,
  checksum,
  digest,
  invariant,
  parse,
  type Data,
} from "./shared.ts";
import { createRun, put, records } from "./research-store.ts";
import type { Split } from "./analysis.ts";
export interface Review {
  message_id: string;
  context_id: string | null;
  full_message_reviewed: true;
  classification: { task: string };
  purpose: { reason: string };
  information_selection: Score;
  presentation: Score;
  evidence_ids?: string[];
}
interface Score {
  score: number | null;
  reason: string;
  issues?: { quote: string; effect: string; repair: string }[];
}
export function sampleReview(
  db: ResearchDatabase,
  run: string,
  n: number,
  reviewer: string,
  configPath = resolve(ROOT, "config/review.json"),
) {
  const config = parse<{ seed: number; rubric: string }>(
    readFileSync(configPath, "utf8"),
  );
  invariant(
    Number.isInteger(n) && n > 0 && reviewer,
    "Provide a positive count and reviewer",
  );
  invariant(
    !db.orm
      .select()
      .from(t.analysisRuns)
      .where(eq(t.analysisRuns.run_id, run))
      .get(),
    "Sample already frozen",
  );
  const rows = db.orm
    .select({ message_id: t.messages.message_id, split: t.splits.record_json })
    .from(t.messages)
    .innerJoin(t.splits, eq(t.messages.message_id, t.splits.message_id))
    .where(eq(t.messages.is_input, 1))
    .orderBy(t.messages.message_id)
    .all()
    .sort((a, b) =>
      digest(String(config.seed) + a.message_id).localeCompare(
        digest(String(config.seed) + b.message_id),
      ),
    );
  invariant(n <= rows.length, "Sample exceeds available inputs");
  db.transaction(() => {
    createRun(db, run, "manual-review", {
      config_path: configPath,
      config_sha256: checksum(configPath),
      rubric_path: config.rubric,
      rubric_sha256: checksum(resolve(ROOT, config.rubric)),
      reviewer,
      sample_count: n,
    });
    for (const row of rows.slice(0, n)) {
      const context = db.orm
        .select({ context_id: t.contexts.context_id })
        .from(t.contexts)
        .where(eq(t.contexts.message_id, row.message_id))
        .orderBy(
          sql`CASE ${t.contexts.status} WHEN 'recovered' THEN 0 WHEN 'partial' THEN 1 ELSE 2 END`,
          t.contexts.context_id,
        )
        .limit(1)
        .get();
      put(
        db,
        run,
        "sample",
        row.message_id,
        { ...parse<Split>(row.split), context_id: context?.context_id ?? null },
        row.message_id,
      );
    }
  });
  return { run_id: run, sample_count: n };
}
export function recordReview(
  db: ResearchDatabase,
  run: string,
  record: Review,
) {
  const source = db.orm
    .select()
    .from(t.analysisRecords)
    .where(
      and(
        eq(t.analysisRecords.run_id, run),
        eq(t.analysisRecords.kind, "sample"),
        eq(t.analysisRecords.message_id, record.message_id),
      ),
    )
    .get();
  invariant(source, "Message outside frozen sample");
  const sample = parse<{ context_id: string | null }>(source.record_json);
  invariant(
    record.context_id === sample.context_id &&
      record.full_message_reviewed === true,
    "Identify frozen context and confirm full reading",
  );
  const message = db.orm
    .select()
    .from(t.messages)
    .where(eq(t.messages.message_id, record.message_id))
    .get()!;
  for (const key of ["information_selection", "presentation"] as const) {
    const value = record[key];
    invariant(
      value &&
        typeof value.reason === "string" &&
        value.reason &&
        (value.score === null ||
          (Number.isInteger(value.score) &&
            value.score >= 1 &&
            value.score <= 5)),
      "Use score 1–5 or null with reason",
    );
    invariant(
      value.score === null || value.score === 5 || value.issues?.length,
      "Scores below 5 need quoted issue and repair",
    );
    for (const issue of value.issues ?? [])
      invariant(
        typeof issue.quote === "string" &&
          issue.quote &&
          message.text.includes(issue.quote) &&
          issue.effect &&
          issue.repair,
        "Issue needs exact quote, effect and repair",
      );
  }
  invariant(
    record.classification?.task && record.purpose?.reason,
    "State situation and intent",
  );
  const allowed = new Set(
    db.orm
      .select({ id: t.contextEvidence.evidence_id })
      .from(t.contextEvidence)
      .where(eq(t.contextEvidence.context_id, sample.context_id ?? ""))
      .all()
      .map((r) => r.id),
  );
  invariant(
    (record.evidence_ids ?? []).every((id) => allowed.has(id)),
    "Evidence belongs to another context",
  );
  db.transaction(() =>
    put(db, run, "review", record.message_id, record, record.message_id),
  );
  return { recorded: record.message_id };
}
export function insertLegacyReview(
  db: ResearchDatabase,
  run: string,
  context: string,
  mid: string,
  r: Data,
) {
  const metadata = db.orm
    .select()
    .from(t.reviewRuns)
    .where(eq(t.reviewRuns.run_id, run))
    .get();
  invariant(metadata, "Create review run first");
  for (const key of [
    "purpose",
    "information_selection",
    "clarity",
    "overall",
  ]) {
    const value = r[key] as { grade: string; reason: string };
    invariant(
      value &&
        ["pass", "fail", "ambiguous", "unknown"].includes(value.grade) &&
        typeof value.reason === "string",
      "Invalid dimension " + key,
    );
  }
  invariant(
    typeof r.rationale === "string" &&
      Array.isArray(r.evidence_ids) &&
      r.evidence_ids.every((x) => typeof x === "string"),
    "Invalid rationale or evidence",
  );
  const c = db.orm
    .select()
    .from(t.contexts)
    .where(
      and(eq(t.contexts.context_id, context), eq(t.contexts.message_id, mid)),
    )
    .get();
  invariant(c, "Context belongs to another message");
  const allowed = new Set(
    db.orm
      .select()
      .from(t.contextEvidence)
      .where(eq(t.contextEvidence.context_id, context))
      .all()
      .map((r) => r.evidence_id),
  );
  invariant(
    (r.evidence_ids as string[]).every((x) => allowed.has(x)),
    "Evidence belongs to another context",
  );
  const id =
    typeof r.review_id === "string"
      ? r.review_id
      : "review-" + digest(canonical([run, context, mid, r]));
  db.orm
    .insert(t.reviews)
    .values({
      review_id: id,
      run_id: run,
      context_id: context,
      message_id: mid,
      record_json: canonical({
        ...r,
        review_id: id,
        run_id: run,
        rubric_version: metadata.rubric_version,
        reviewer: metadata.reviewer,
      }),
    })
    .run();
  return id;
}
