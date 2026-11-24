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
export const RUBRIC_VERSION = "handoff-v7";
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
export interface Issue {
  kind: string;
  quote: string;
  effect: string;
  repair: string;
}
export interface Score {
  score: number | null;
  reason: string;
  issues?: Issue[];
}
export interface Review {
  message_id: string;
  context_id: string | null;
  full_message_reviewed: true;
  exchange: { sender: string; recipient: string; type: string };
  situation: string;
  intent: Score & { statement: string };
  content: Score;
  presentation: Score;
  rewrite?: { of?: string; text: string };
}
export type Verdict = "send" | "revise" | "rewrite" | "unknown";
/** Derived from the scores; reviewers never judge it separately. */
export function verdict(
  review: Record<Dimension, { score: number | null }>,
): Verdict {
  const scores = DIMENSIONS.map((d) => review[d]?.score).filter(
    (n): n is number => typeof n === "number",
  );
  if (!scores.length) return "unknown";
  const lowest = Math.min(...scores);
  return lowest >= 3 ? "send" : lowest === 2 ? "revise" : "rewrite";
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
) {
  const config = parse<ReviewConfig>(readFileSync(configPath, "utf8"));
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
    for (const [name, count] of Object.entries(mix)) {
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
    invariant(
      value &&
        text(value.reason) &&
        (value.score === null ||
          (Number.isInteger(value.score) &&
            value.score >= 1 &&
            value.score <= 4)),
      `${key}: use score 1–4 or null, with a reason`,
    );
    invariant(
      value.score === null || value.score === 4 || value.issues?.length,
      `${key}: a score below 4 needs at least one issue`,
    );
    for (const issue of value.issues ?? []) {
      invariant(
        (ISSUE_KINDS[key] as readonly string[]).includes(issue.kind),
        `${key}: unknown issue kind ${issue.kind}; use one of ${ISSUE_KINDS[key].join(", ")}`,
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
  const low =
    record.presentation.score !== null && record.presentation.score <= 2;
  invariant(
    !low || text(record.rewrite?.text),
    "presentation 1 or 2 needs a plain-English rewrite",
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
  db.transaction(() =>
    put(db, run, "review", record.message_id, record, record.message_id),
  );
  return { recorded: record.message_id, verdict: verdict(record) };
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
