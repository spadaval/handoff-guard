import { eq, and } from "drizzle-orm";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import type { ResearchDatabase } from "./db/connection.ts";
import { analysisRuns, analysisRecords, messages } from "./db/schema.ts";
import {
  canonical,
  digest,
  now,
  invariant,
  parse,
  type Data,
} from "./shared.ts";
export function createRun(
  db: ResearchDatabase,
  run_id: string,
  kind: string,
  metadata: unknown,
) {
  const metadata_json = canonical(metadata),
    old = db.orm
      .select()
      .from(analysisRuns)
      .where(eq(analysisRuns.run_id, run_id))
      .get();
  invariant(
    !old || (old.kind === kind && old.metadata_json === metadata_json),
    "Run already frozen with different metadata: " + run_id,
  );
  if (!old)
    db.orm
      .insert(analysisRuns)
      .values({ run_id, kind, created_at: now(), metadata_json })
      .run();
}
export function put(
  db: ResearchDatabase,
  run_id: string,
  kind: string,
  record_key: string,
  record: unknown,
  message_id: string | null = null,
) {
  const record_json = canonical(record),
    old = db.orm
      .select()
      .from(analysisRecords)
      .where(
        and(
          eq(analysisRecords.run_id, run_id),
          eq(analysisRecords.kind, kind),
          eq(analysisRecords.record_key, record_key),
        ),
      )
      .get();
  invariant(
    !old || (old.message_id === message_id && old.record_json === record_json),
    "Refusing to overwrite a different record: " + record_key,
  );
  if (!old)
    db.orm
      .insert(analysisRecords)
      .values({ run_id, kind, record_key, message_id, record_json })
      .run();
}
export function records<T = Data>(
  db: ResearchDatabase,
  run: string,
  kind: string,
): T[] {
  return db.orm
    .select({ record: analysisRecords.record_json })
    .from(analysisRecords)
    .where(and(eq(analysisRecords.run_id, run), eq(analysisRecords.kind, kind)))
    .orderBy(analysisRecords.record_key)
    .all()
    .map((r) => parse<T>(r.record));
}
export interface Prediction {
  message_id: string;
  rule: string | null;
  reason: string | null;
  [key: string]: unknown;
}
export interface Check {
  rule: string;
  status: string;
  enforcement?: string;
  measurements: Record<string, number>;
  spans: { start: number; end: number }[];
}
export interface Inspection {
  message_id: string;
  blocked: boolean;
  checks: Check[];
  policy_version: string;
  [key: string]: unknown;
}
export function compiled<T extends { message_id: string }>(
  db: ResearchDatabase,
  binary: string,
  command: "evaluate" | "inspect",
): T[] {
  const rows = db.orm
    .select({ message_id: messages.message_id, text: messages.text })
    .from(messages)
    .orderBy(messages.message_id)
    .all();
  for (const r of rows)
    invariant(digest(r.text) === r.message_id, "Original body hash mismatch");
  const run = spawnSync(resolve(binary), [command], {
    input: rows.map((r) => canonical(r) + "\n").join(""),
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  invariant(
    !run.error && run.status === 0,
    "Compiled guard failed: " + (run.error?.message ?? run.stderr),
  );
  const result = run.stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((s) => parse<T>(s));
  const expected = new Set(rows.map((r) => r.message_id));
  invariant(
    result.length === rows.length &&
      new Set(result.map((r) => r.message_id)).size === expected.size &&
      result.every((r) => expected.has(r.message_id)),
    "Compiled result coverage mismatch",
  );
  return result;
}
