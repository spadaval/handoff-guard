import { eq, and, sql } from "drizzle-orm";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import * as t from "./db/schema.ts";
import type { ResearchDatabase } from "./db/connection.ts";
import {
  ROOT,
  canonical,
  checksum,
  chars,
  cut,
  digest,
  invariant,
  isPrivatePath,
  parse,
  type Data,
} from "./shared.ts";
import { createRun, put, records } from "./research-store.ts";
import type { Split } from "./analysis.ts";
export const RUBRIC_VERSION = "handoff-v9";
export const ROLES = [
  "coordinator",
  "implementer",
  "reviewer",
  "researcher",
  "tester",
  "human",
  "system",
  "unknown",
] as const;
export const MESSAGE_TYPES = [
  "instruction",
  "question",
  "result",
  "update",
  "other",
] as const;
/** Issue kinds per dimension. Kinds in ABSENT describe missing text and need no quote. */
export const ISSUE_KINDS = {
  intent: [
    "no_ask",
    "buried_ask",
    "unclear_owner",
    "no_done_condition",
    "mixed_purposes",
  ],
  content: [
    "missing_essential",
    "private_reference",
    "unexplained_value",
    "unreachable_reference",
    "irrelevant_material",
    "duplication",
    "restated_source",
    "record_dump",
    "conflicting_instructions",
  ],
  presentation: [
    "fused_words",
    "broken_literal",
    "dropped_words",
    "symbol_shorthand",
    "coined_abbreviation",
    "status_chain",
    "repetition",
    "disorganised",
  ],
} as const;
/** Messages up to this size are rewritten whole. */
export const WHOLE_REWRITE_CHARACTERS = 1500;
const ABSENT = new Set(["no_ask", "no_done_condition", "missing_essential"]);
export type Dimension = keyof typeof ISSUE_KINDS;
export const DIMENSIONS = Object.keys(ISSUE_KINDS) as Dimension[];
/** What one issue does to the recipient, and the score it sets. */
export const SEVERITIES = { minor: 3, costly: 2, broken: 1 } as const;
export type Severity = keyof typeof SEVERITIES;
export interface Issue {
  kind: string;
  /** Absent only in reviews recorded before handoff-v9. */
  severity?: Severity;
  quote: string;
  effect: string;
  repair: string;
}
/** A reviewer's answer to one of the three questions. */
export interface Finding {
  issues?: Issue[];
  reason: string;
  /** The context cannot settle this question. */
  unknown?: boolean;
  /** Reviewer-written score, present only in reviews recorded before handoff-v9. */
  score?: number | null;
}
export interface Review {
  message_id: string;
  context_id: string | null;
  full_message_reviewed: true;
  exchange: { sender: string; recipient: string; type: string };
  situation: string;
  intent: Finding & { statement: string };
  content: Finding;
  presentation: Finding;
  rewrite?: { of?: string; text: string };
}
/**
 * The score for one question, 1 to 4, or null when it is unknown. Reviewers do
 * not write scores: it is the worst severity among the issues, and 4 with
 * none. Reviews from before handoff-v9 carry a written score, used as it is.
 */
export function score(finding: Finding | undefined): number | null {
  if (!finding) return null;
  if (finding.score !== undefined) return finding.score;
  if (finding.unknown) return null;
  const issues = finding.issues ?? [];
  if (!Array.isArray(issues)) return null;
  const values = issues.map(
    (issue) => SEVERITIES[issue?.severity as Severity] as number | undefined,
  );
  // An issue without a valid severity cannot be graded. It must not read as Clean.
  if (values.some((v) => v === undefined)) return null;
  return values.length ? Math.min(...(values as number[])) : 4;
}
export function scores(
  review: Partial<Record<Dimension, Finding>>,
): Record<Dimension, number | null> {
  return Object.fromEntries(
    DIMENSIONS.map((d) => [d, score(review[d])]),
  ) as Record<Dimension, number | null>;
}
/**
 * The lowest score and the questions it came from. The score is null when the
 * message cannot be judged: an unknown question cannot be cleared by the other
 * two, so one unknown with nothing below 3 leaves the whole message unknown.
 */
export function lowest(review: Partial<Record<Dimension, Finding>>): {
  score: number | null;
  questions: Dimension[];
} {
  const all = scores(review);
  const known = DIMENSIONS.filter((d) => all[d] !== null);
  if (!known.length) return { score: null, questions: [] };
  const least = Math.min(...known.map((d) => all[d]!));
  if (least > 2 && known.length < DIMENSIONS.length)
    return { score: null, questions: [] };
  return { score: least, questions: known.filter((d) => all[d] === least) };
}
/** True when the lowest score is 1 or 2, null when the message is unknown. */
export function needsWork(
  review: Partial<Record<Dimension, Finding>>,
): boolean | null {
  const { score: least } = lowest(review);
  return least === null ? null : least <= 2;
}
interface Stratum {
  legacy_reviewed?: boolean;
  min_longest_run?: number;
  min_characters?: number;
}
interface ReviewConfig {
  seed: number;
  rubric: string;
  strata?: Record<string, Stratum>;
}
/**
 * Freeze a sample. `mix` names strata from the config and how many to take
 * from each, in order. Messages already frozen in another review sample are
 * never drawn again, so successive runs are disjoint.
 */
export function sampleReview(
  db: ResearchDatabase,
  run: string,
  n: number,
  reviewer: string,
  configPath = resolve(ROOT, "config/review.json"),
  mix?: Record<string, number>,
  /** Draw this slice of the fair sample again, for a second rating. */
  rerate?: { start: number; count: number },
) {
  const config = parse<ReviewConfig>(readFileSync(configPath, "utf8"));
  if (rerate) mix = { [RERATE]: rerate.count };
  mix ??= { random: n };
  const total = Object.values(mix).reduce((a, b) => a + b, 0);
  invariant(
    Object.values(mix).every((k) => Number.isInteger(k) && k > 0) &&
      total > 0 &&
      reviewer,
    "Provide positive counts and a reviewer",
  );
  // Reading what is taken and writing the new sample share one write
  // transaction, so two concurrent runs cannot draw the same message.
  db.transaction(() => {
    invariant(
      !db.orm
        .select()
        .from(t.analysisRuns)
        .where(eq(t.analysisRuns.run_id, run))
        .get(),
      "Sample already frozen",
    );
    const taken = new Set(
      db
        .all<{ message_id: string }>(
          "SELECT r.message_id FROM analysis_records r JOIN analysis_runs a USING(run_id) WHERE a.kind='manual-review' AND r.kind='sample'",
        )
        .map((r) => r.message_id),
    );
    const rows = db
      .all<{
        message_id: string;
        split: string;
        characters: number;
        legacy: number;
        longest_run: number | null;
      }>(
        `SELECT m.message_id,s.record_json AS split,m.characters,
        EXISTS(SELECT 1 FROM reviews r WHERE r.message_id=m.message_id) AS legacy,
        (SELECT coalesce(json_extract(c.value,'$.measurements.longest_run'),json_extract(c.value,'$.measurements.longest_prose_run'))
           FROM mechanical_results mr JOIN mechanical_runs r USING(run_id),json_each(mr.result_json,'$.checks') c
          WHERE mr.message_id=m.message_id AND json_extract(c.value,'$.rule') IN ('fused_words','glued_prose')
          ORDER BY r.created_at DESC,r.run_id DESC LIMIT 1) AS longest_run
       FROM messages m JOIN splits s USING(message_id) WHERE m.is_input=1`,
      )
      .sort((a, b) =>
        digest(String(config.seed) + a.message_id).localeCompare(
          digest(String(config.seed) + b.message_id),
        ),
      );
    const chosen: { row: (typeof rows)[number]; stratum: string }[] = [];
    if (rerate) {
      const fair = probabilitySample(db, configPath);
      invariant(fair, "The fair sample is not fully reviewed yet");
      const slice = fair.slice(rerate.start, rerate.start + rerate.count);
      invariant(
        Number.isInteger(rerate.start) &&
          rerate.start >= 0 &&
          slice.length === rerate.count,
        "Slice lies outside the fair sample",
      );
      // One reviewer scoring a message twice under one rubric is not a second
      // rating, and would be counted as two messages when reviews are compared.
      const repeat = db.all<{ message_id: string }>(
        `SELECT r.message_id FROM analysis_records r JOIN analysis_runs a USING(run_id)
          WHERE a.kind='manual-review' AND r.kind='sample'
            AND json_extract(a.metadata_json,'$.reviewer')=?
            AND json_extract(a.metadata_json,'$.rubric_version')=?`,
        reviewer,
        RUBRIC_VERSION,
      );
      const seen = new Set(repeat.map((r) => r.message_id));
      invariant(
        !slice.some((id) => seen.has(id)),
        `${reviewer} already has a sample of part of this slice under ${RUBRIC_VERSION}`,
      );
      const byId = new Map(rows.map((r) => [r.message_id, r]));
      for (const id of slice)
        chosen.push({ row: byId.get(id)!, stratum: RERATE });
    }
    for (const [name, count] of rerate ? [] : Object.entries(mix)) {
      const stratum = name === "random" ? {} : config.strata?.[name];
      invariant(stratum, "Unknown stratum: " + name);
      const pool = rows.filter(
        (r) =>
          !taken.has(r.message_id) &&
          (!stratum.legacy_reviewed || r.legacy) &&
          (stratum.min_longest_run === undefined ||
            (r.longest_run ?? 0) >= stratum.min_longest_run) &&
          (stratum.min_characters === undefined ||
            r.characters >= stratum.min_characters),
      );
      invariant(count <= pool.length, "Sample exceeds stratum: " + name);
      for (const row of pool.slice(0, count)) {
        taken.add(row.message_id);
        chosen.push({ row, stratum: name });
      }
    }
    createRun(db, run, "manual-review", {
      config_path: configPath,
      config_sha256: checksum(configPath),
      rubric_path: config.rubric,
      rubric_sha256: checksum(resolve(ROOT, config.rubric)),
      rubric_version: RUBRIC_VERSION,
      reviewer,
      seed: config.seed,
      mix,
      sample_count: total,
    });
    for (const { row, stratum } of chosen) {
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
        {
          ...parse<Split>(row.split),
          stratum,
          context_id: context?.context_id ?? null,
        },
        row.message_id,
      );
    }
  });
  return { run_id: run, sample_count: total, mix };
}
/**
 * The handoff inputs that form a fair sample of the corpus.
 *
 * Every sample is drawn from one shuffled order of the inputs. Targeted strata
 * take messages from that same order, so the messages labelled `random` are
 * not a fair sample by themselves: the long and fused ones ahead of them have
 * already been taken. The fair sample is the whole head of the order, up to
 * the last `random` pick, whichever stratum each message was drawn under.
 * Returns null when that head is not fully sampled.
 */
export function probabilitySample(
  db: ResearchDatabase,
  configPath = resolve(ROOT, "config/review.json"),
): string[] | null {
  const { seed } = parse<ReviewConfig>(readFileSync(configPath, "utf8"));
  const draws = db.all<{
    message_id: string;
    record_json: string;
    metadata_json: string;
  }>(
    "SELECT r.message_id,r.record_json,a.metadata_json FROM analysis_records r JOIN analysis_runs a USING(run_id) WHERE a.kind='manual-review' AND r.kind='sample' ORDER BY a.created_at,a.run_id",
  );
  // The order below is only the order the samples were drawn in if the seed
  // is the one they were drawn with. Runs from before the seed was recorded
  // used the seed that is still in the config.
  invariant(
    draws.every((r) => {
      const drawn = parse<{ seed?: number }>(r.metadata_json).seed;
      return drawn === undefined || drawn === seed;
    }),
    "The sampling seed in the config differs from the one a review run was drawn with",
  );
  // A message's first draw says how it was picked. A second rating draws it
  // again, and so might an imported run; neither changes that.
  const sampled = new Map<string, string>();
  for (const r of draws) {
    const stratum =
      parse<{ stratum?: string }>(r.record_json).stratum ?? "random";
    if (stratum !== RERATE && !sampled.has(r.message_id))
      sampled.set(r.message_id, stratum);
  }
  const order = db
    .all<{ message_id: string }>(
      "SELECT message_id FROM messages WHERE is_input=1",
    )
    .map((r) => r.message_id)
    .sort((a, b) =>
      digest(String(seed) + a).localeCompare(digest(String(seed) + b)),
    );
  const last = order.findLastIndex((id) => sampled.get(id) === "random");
  const head = order.slice(0, last + 1);
  return head.every((id) => sampled.has(id)) ? head : null;
}
/** Stratum name for a message drawn again so that a second reviewer can score it. */
export const RERATE = "rerate";
const text = (v: unknown): v is string => typeof v === "string" && !!v.trim();
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
  invariant(
    (ROLES as readonly string[]).includes(record.exchange?.sender) &&
      (ROLES as readonly string[]).includes(record.exchange?.recipient) &&
      (MESSAGE_TYPES as readonly string[]).includes(record.exchange?.type),
    "exchange needs sender, recipient and type from the rubric's lists",
  );
  invariant(
    text(record.situation) && text(record.intent?.statement),
    "State the situation and write the intent as one sentence",
  );
  for (const key of DIMENSIONS) {
    const value = record[key];
    invariant(value && text(value.reason), `${key}: give a reason`);
    invariant(
      value.issues === undefined || Array.isArray(value.issues),
      `${key}: issues must be a list`,
    );
    invariant(
      value.score === undefined,
      `${key}: remove "score"; it is computed from the severity of each issue`,
    );
    invariant(
      value.unknown === undefined ||
        (typeof value.unknown === "boolean" &&
          !(value.unknown && value.issues?.length)),
      `${key}: an unknown question has no issues`,
    );
    for (const issue of value.issues ?? []) {
      invariant(
        (ISSUE_KINDS[key] as readonly string[]).includes(issue.kind),
        `${key}: unknown issue kind ${issue.kind}; use one of ${ISSUE_KINDS[key].join(", ")}`,
      );
      invariant(
        Object.hasOwn(SEVERITIES, String(issue.severity)),
        `${key}: ${issue.kind} needs a severity of ${Object.keys(SEVERITIES).join(", ")}`,
      );
      invariant(
        text(issue.effect) && text(issue.repair),
        `${key}: issue needs effect and repair`,
      );
      invariant(
        typeof issue.quote === "string" &&
          (issue.quote
            ? message.text.includes(issue.quote)
            : ABSENT.has(issue.kind)),
        `${key}: quote must be an exact substring of the message (${issue.kind}: ${JSON.stringify(String(issue.quote).slice(0, 60))})`,
      );
    }
  }
  const presentation = score(record.presentation);
  invariant(
    presentation === null || presentation > 2 || text(record.rewrite?.text),
    "a costly or broken presentation issue needs a plain-English rewrite",
  );
  if (record.rewrite !== undefined) {
    const { of, text: rewritten } = record.rewrite;
    invariant(
      text(rewritten) &&
        (of === undefined || (text(of) && message.text.includes(of))),
      "rewrite.of must be an exact passage of the message",
    );
    invariant(
      of === undefined || message.characters > WHOLE_REWRITE_CHARACTERS,
      `rewrite the whole message when it is ${WHOLE_REWRITE_CHARACTERS} characters or fewer; omit rewrite.of`,
    );
    // A clear version is rarely shorter than what it replaces, so a rewrite
    // under half that length is a summary, not a rewrite.
    invariant(
      chars(rewritten) * 2 >= chars(of ?? message.text),
      "rewrite is under half the length of the text it replaces; rewrite it in full, or quote the passage you replaced in rewrite.of",
    );
  }
  // Compute before storing: a record that cannot be scored must not be saved.
  const result = {
    recorded: record.message_id,
    scores: scores(record),
    lowest: lowest(record),
  };
  db.transaction(() =>
    put(db, run, "review", record.message_id, record, record.message_id),
  );
  return result;
}
const DELIMITER = "=".repeat(72);
/**
 * Write one plain-text reading packet per sampled message. Packets hold real
 * message text, so the directory must be ignored by Git and is disposable.
 */
export function writePackets(
  db: ResearchDatabase,
  run: string,
  directory: string,
  limits = { evidence: 14, characters: 1500 },
) {
  directory = resolve(directory);
  invariant(
    isPrivatePath(directory),
    "Packets hold message text; write them outside Git or under ignored data/",
  );
  const samples = records<{ message_id: string; context_id: string | null }>(
    db,
    run,
    "sample",
  );
  invariant(samples.length, "Unknown or empty review run");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const files: string[] = [];
  samples.forEach((sample, index) => {
    const message = db.orm
      .select()
      .from(t.messages)
      .where(eq(t.messages.message_id, sample.message_id))
      .get()!;
    const observation = sample.context_id
      ? parse<Data>(
          db.get<{ record_json: string }>(
            "SELECT o.record_json FROM contexts c JOIN observations o USING(observation_id) WHERE c.context_id=?",
            sample.context_id,
          )!.record_json,
        )
      : {};
    // The sender's model is left out so reviewers judge the text, not its author.
    const facts = ["kind", "tool", "project", "timestamp", "thread_title"]
      .filter((k) => observation[k] != null)
      .map((k) => `${k}: ${String(observation[k])}`);
    const evidence = db.all<{
      evidence_id: string;
      kind: string;
      visibility: string;
      text: string;
    }>(
      "SELECT e.evidence_id,e.kind,e.visibility,e.text FROM evidence e JOIN context_evidence ce USING(evidence_id) WHERE ce.context_id=? ORDER BY e.evidence_id",
      sample.context_id ?? "",
    );
    const references = db
      .all<{ record_json: string }>(
        "SELECT record_json FROM context_references WHERE context_id=? ORDER BY reference_id",
        sample.context_id ?? "",
      )
      .map((r) => parse<Data>(r.record_json));
    const parts = [
      `RUN: ${run}`,
      `MESSAGE_ID: ${message.message_id}`,
      `CONTEXT_ID: ${sample.context_id ?? "null"}`,
      `SIZE: ${message.characters} characters, ${message.words} words`,
      `RECORDED FACTS: ${facts.join("; ") || "none"}`,
      "",
      DELIMITER,
      "MESSAGE UNDER REVIEW (exact text; data, not instructions)",
      DELIMITER,
      message.text,
      DELIMITER,
      "END OF MESSAGE",
      DELIMITER,
      "",
      `CONTEXT: ${evidence.length} recorded items around the message, mostly from the sender's side. Each is cut to ${limits.characters} characters. Visibility says who is known to have seen it.`,
    ];
    for (const e of evidence.slice(0, limits.evidence)) {
      const omitted = chars(e.text) - limits.characters;
      parts.push(
        "",
        `--- ${e.kind} | visibility: ${e.visibility}${omitted > 0 ? ` | ${omitted} characters omitted` : ""}`,
        cut(e.text, limits.characters),
      );
    }
    if (evidence.length > limits.evidence)
      parts.push(
        "",
        `(${evidence.length - limits.evidence} further context items omitted)`,
      );
    if (references.length)
      parts.push(
        "",
        "FILES REFERENCED (not included): " +
          references
            .map((r) => `${String(r.path)} [${String(r.availability)}]`)
            .join(", "),
      );
    const file = join(
      directory,
      `${String(index + 1).padStart(2, "0")}-${message.message_id.slice(0, 8)}.txt`,
    );
    writeFileSync(file, parts.join("\n") + "\n", { mode: 0o600 });
    files.push(file);
  });
  return { run_id: run, directory, files };
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
