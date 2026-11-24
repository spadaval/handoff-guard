import {
  sqliteTable,
  text,
  integer,
  blob,
  primaryKey,
  uniqueIndex,
  index,
  foreignKey,
  sqliteView,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
export const metadata = sqliteTable("metadata", {
  key: text().primaryKey(),
  value: text().notNull(),
});
export const sourceFiles = sqliteTable("source_files", {
  path: text().primaryKey(),
  sha256: text().notNull(),
  bytes: integer().notNull(),
  purpose: text().notNull(),
});
export const messages = sqliteTable("messages", {
  message_id: text().primaryKey(),
  text: text().notNull(),
  characters: integer().notNull(),
  words: integer().notNull(),
  kinds: text().notNull(),
  projects: text().notNull(),
  is_input: integer().notNull(),
});
export const observations = sqliteTable(
  "observations",
  {
    observation_id: text().primaryKey(),
    message_id: text()
      .notNull()
      .references(() => messages.message_id),
    export_line: integer().notNull().unique(),
    source: text().notNull(),
    record_json: text().notNull(),
  },
  (t) => [index("obs_message").on(t.message_id)],
);
export const contexts = sqliteTable(
  "contexts",
  {
    context_id: text().primaryKey(),
    observation_id: text()
      .notNull()
      .unique()
      .references(() => observations.observation_id),
    message_id: text()
      .notNull()
      .references(() => messages.message_id),
    status: text({
      enum: ["pending", "partial", "recovered", "unavailable"],
    }).notNull(),
    metadata_json: text().notNull(),
  },
  (t) => [
    uniqueIndex("context_message").on(t.context_id, t.message_id),
    index("ctx_message").on(t.message_id),
    index("ctx_status").on(t.status),
  ],
);
export const contextTexts = sqliteTable("context_texts", {
  text_id: integer().primaryKey(),
  sha256: blob({ mode: "buffer" }).notNull().unique(),
  text: text().notNull(),
});
export const evidenceRecords = sqliteTable("evidence_records", {
  evidence_id: text().primaryKey(),
  kind: text().notNull(),
  text_id: integer()
    .notNull()
    .references(() => contextTexts.text_id),
  provenance: blob({ mode: "buffer" }).notNull(),
  visibility: text({
    enum: ["sender_context", "recipient_visible", "unknown"],
  }).notNull(),
});
export const referenceRecords = sqliteTable(
  "reference_records",
  {
    reference_id: text().primaryKey(),
    context_id: text()
      .notNull()
      .references(() => contexts.context_id),
    text_id: integer().references(() => contextTexts.text_id),
    metadata: blob({ mode: "buffer" }).notNull(),
  },
  (t) => [index("reference_context").on(t.context_id)],
);
export const contextEvidence = sqliteTable(
  "context_evidence",
  {
    context_id: text()
      .notNull()
      .references(() => contexts.context_id),
    evidence_id: text()
      .notNull()
      .references(() => evidenceRecords.evidence_id),
  },
  (t) => [primaryKey({ columns: [t.context_id, t.evidence_id] })],
);
export const historicalReviews = sqliteTable(
  "historical_reviews",
  {
    id: text().primaryKey(),
    message_id: text()
      .notNull()
      .references(() => messages.message_id),
    source_path: text().notNull(),
    record_json: text().notNull(),
  },
  (t) => [index("history_message").on(t.message_id)],
);
export const splits = sqliteTable("splits", {
  message_id: text()
    .primaryKey()
    .references(() => messages.message_id),
  record_json: text().notNull(),
});
export const corpusGaps = sqliteTable("corpus_gaps", {
  line: integer().primaryKey(),
  record_json: text().notNull(),
});
export const reviewRuns = sqliteTable("review_runs", {
  run_id: text().primaryKey(),
  rubric_version: text().notNull(),
  reviewer: text().notNull(),
  created_at: text().notNull(),
  metadata_json: text().notNull(),
});
export const reviews = sqliteTable(
  "reviews",
  {
    review_id: text().primaryKey(),
    run_id: text()
      .notNull()
      .references(() => reviewRuns.run_id),
    context_id: text().notNull(),
    message_id: text().notNull(),
    record_json: text().notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.context_id, t.message_id],
      foreignColumns: [contexts.context_id, contexts.message_id],
    }),
    index("review_context").on(t.context_id),
  ],
);
export const mechanicalRuns = sqliteTable("mechanical_runs", {
  run_id: text().primaryKey(),
  created_at: text().notNull(),
  metadata_json: text().notNull(),
});
export const mechanicalResults = sqliteTable(
  "mechanical_results",
  {
    run_id: text()
      .notNull()
      .references(() => mechanicalRuns.run_id),
    message_id: text()
      .notNull()
      .references(() => messages.message_id),
    result_json: text().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.run_id, t.message_id] }),
    index("mechanics_message").on(t.message_id),
  ],
);
export const analysisRuns = sqliteTable("analysis_runs", {
  run_id: text().primaryKey(),
  kind: text().notNull(),
  created_at: text().notNull(),
  metadata_json: text().notNull(),
});
export const analysisRecords = sqliteTable(
  "analysis_records",
  {
    run_id: text()
      .notNull()
      .references(() => analysisRuns.run_id),
    kind: text().notNull(),
    record_key: text().notNull(),
    message_id: text().references(() => messages.message_id),
    record_json: text().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.run_id, t.kind, t.record_key] }),
    index("analysis_message").on(t.message_id),
  ],
);
export const evidence = sqliteView("evidence", {
  evidence_id: text().notNull(),
  kind: text().notNull(),
  text: text().notNull(),
  provenance: text().notNull(),
  visibility: text().notNull(),
}).existing();
export const references = sqliteView("context_references", {
  reference_id: text().notNull(),
  context_id: text().notNull(),
  record_json: text().notNull(),
}).existing();
export type Message = typeof messages.$inferSelect;
export type Observation = typeof observations.$inferSelect;
export type Context = typeof contexts.$inferSelect;
