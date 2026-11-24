import { eq, and, sql } from "drizzle-orm";
import { readFileSync, existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import type { ResearchDatabase } from "./db/connection.ts";
import * as t from "./db/schema.ts";
import {
  canonical,
  decode,
  digest,
  checksum,
  parse,
  invariant,
  INPUT_KINDS,
  lines,
  chars,
  type Data,
} from "./shared.ts";
export function bindFile(db: ResearchDatabase, path: string, purpose: string) {
  path = resolve(path);
  const hash = checksum(path),
    old = db.orm
      .select()
      .from(t.sourceFiles)
      .where(eq(t.sourceFiles.path, path))
      .get();
  invariant(!old || old.sha256 === hash, "Source changed; use a new database");
  db.orm
    .insert(t.sourceFiles)
    .values({ path, sha256: hash, bytes: statSync(path).size, purpose })
    .onConflictDoNothing()
    .run();
  return hash;
}
export function importCorpus(db: ResearchDatabase, directory: string) {
  const manifest = parse<{ files: Record<string, { sha256: string }> }>(
    readFileSync(resolve(directory, "manifest.json"), "utf8"),
  );
  db.transaction(() => {
    for (const [name, value] of Object.entries(manifest.files))
      invariant(
        bindFile(db, resolve(directory, name), "exact corpus export") ===
          value.sha256,
        "Manifest checksum mismatch",
      );
    bindFile(db, resolve(directory, "manifest.json"), "manifest");
    db.orm
      .insert(t.metadata)
      .values([
        { key: "manifest", value: canonical(manifest) },
        { key: "collector_version", value: "context-collector-1" },
      ])
      .onConflictDoNothing()
      .run();
    for (const { raw } of lines(resolve(directory, "messages.jsonl"))) {
      if (!raw.toString().trim()) continue;
      const r = parse<
        Omit<t.Message, "kinds" | "projects"> & {
          kinds: string[];
          projects: string[];
        }
      >(decode(raw));
      invariant(
        typeof r.text === "string" && digest(r.text) === r.message_id,
        "Body hash mismatch",
      );
      db.orm
        .insert(t.messages)
        .values({
          ...r,
          kinds: canonical(r.kinds),
          projects: canonical(r.projects),
          is_input: Number(r.kinds.some((k) => INPUT_KINDS.has(k))),
        })
        .onConflictDoNothing()
        .run();
    }
    for (const { line, raw } of lines(
      resolve(directory, "observations.jsonl"),
    )) {
      if (!raw.toString().trim()) continue;
      const r = parse<{ message_id: string; source: string }>(decode(raw));
      const encoded = canonical(r),
        id = digest(line + ":" + encoded);
      db.orm
        .insert(t.observations)
        .values({
          observation_id: id,
          message_id: r.message_id,
          export_line: line,
          source: r.source,
          record_json: encoded,
        })
        .onConflictDoNothing()
        .run();
      db.orm
        .insert(t.contexts)
        .values({
          context_id: "ctx-" + id,
          observation_id: id,
          message_id: r.message_id,
          status: "pending",
          metadata_json: "{}",
        })
        .onConflictDoNothing()
        .run();
    }
    for (const name of [
      "labels.jsonl",
      "triage-20261123/labels-full.jsonl",
      "triage-sol-20261123/labels-sol.jsonl",
      "triage-sol-20261123/labels-reconciled.jsonl",
    ]) {
      const path = resolve(directory, name);
      if (!existsSync(path)) continue;
      bindFile(db, path, "historical review ledger");
      for (const { line, raw } of lines(path)) {
        const r = parse<{ message_id: string }>(decode(raw));
        db.orm
          .insert(t.historicalReviews)
          .values({
            id: digest(path + ":" + line),
            message_id: r.message_id,
            source_path: path,
            record_json: canonical(r),
          })
          .onConflictDoNothing()
          .run();
      }
    }
    const split = resolve(directory, "split.jsonl");
    if (existsSync(split)) {
      bindFile(db, split, "frozen split");
      for (const { raw } of lines(split)) {
        const r = parse<{ message_id: string }>(decode(raw));
        db.orm
          .insert(t.splits)
          .values({ message_id: r.message_id, record_json: canonical(r) })
          .onConflictDoNothing()
          .run();
      }
    }
    const gaps = resolve(directory, "gaps.jsonl");
    if (existsSync(gaps))
      for (const { line, raw } of lines(gaps))
        db.orm
          .insert(t.corpusGaps)
          .values({ line, record_json: canonical(parse(decode(raw))) })
          .onConflictDoNothing()
          .run();
  });
}
export function summary(db: ResearchDatabase) {
  const result: Data = {};
  for (const name of [
    "messages",
    "observations",
    "contexts",
    "evidence",
    "context_references",
    "historical_reviews",
    "splits",
    "reviews",
    "review_runs",
    "corpus_gaps",
  ])
    result[name] = Number(
      db.get<{ n: number }>(`SELECT count(*) n FROM ${name}`)!.n,
    );
  result.input_bodies = db.orm
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(t.messages)
    .where(eq(t.messages.is_input, 1))
    .get()!.n;
  result.context_status = Object.fromEntries(
    db
      .all<{ status: string; n: number }>(
        "SELECT status,count(*) n FROM contexts GROUP BY status",
      )
      .map((r) => [r.status, r.n]),
  );
  const n = (where: string) =>
    db.get<{ n: number }>(
      "SELECT count(DISTINCT c.message_id) n FROM contexts c JOIN context_evidence ce USING(context_id) JOIN evidence e USING(evidence_id) WHERE " +
        where,
    )!.n;
  result.input_bodies_with_auxiliary_evidence = n(
    "e.kind!='recorded_handoff_body'",
  );
  result.input_bodies_with_preceding_evidence = n(
    "e.kind LIKE 'preceding_%' OR e.kind='first_recorded_user' OR e.kind LIKE 'cache_origin_preceding_%' OR e.kind='cache_origin_first_recorded_user'",
  );
  result.input_bodies_with_historical_files = db.get<{ n: number }>(
    "SELECT count(DISTINCT c.message_id) n FROM contexts c JOIN context_references r USING(context_id) WHERE json_extract(r.record_json,'$.availability')='recovered'",
  )!.n;
  result.reference_availability = Object.fromEntries(
    db
      .all<{ a: string; n: number }>(
        "SELECT json_extract(record_json,'$.availability') a,count(*) n FROM context_references GROUP BY 1",
      )
      .map((r) => [r.a, r.n]),
  );
  return result;
}
export function validate(db: ResearchDatabase) {
  invariant(
    Object.values(db.get("PRAGMA integrity_check")!)[0] === "ok" &&
      !db.all("PRAGMA foreign_key_check").length,
    "Database integrity failed",
  );
  invariant(
    !db.get<{ n: number }>(
      "SELECT count(*) n FROM observations o LEFT JOIN contexts c USING(observation_id) WHERE c.context_id IS NULL",
    )!.n,
    "Missing contexts",
  );
  for (const row of db.orm
    .select({ message_id: t.messages.message_id, text: t.messages.text })
    .from(t.messages)
    .all())
    invariant(digest(row.text) === row.message_id, "Stored text hash mismatch");
  for (const row of db.orm.select().from(t.observations).all()) {
    const r = parse<{ message_id: string }>(row.record_json);
    invariant(
      digest(row.export_line + ":" + row.record_json) === row.observation_id &&
        r.message_id === row.message_id,
      "Stored observation binding mismatch",
    );
  }
  invariant(
    !db.get<{ n: number }>(
      "SELECT count(*) n FROM contexts c JOIN observations o USING(observation_id) WHERE c.message_id!=o.message_id OR c.context_id!='ctx-'||o.observation_id",
    )!.n,
    "Context binding mismatch",
  );
  for (const r of db.orm.select().from(t.contextTexts).all())
    invariant(
      digest(r.text) === r.sha256.toString("hex"),
      "Shared context text hash mismatch",
    );
  const stored = db.orm
    .select()
    .from(t.metadata)
    .where(eq(t.metadata.key, "manifest"))
    .get();
  invariant(stored, "Missing manifest");
  const manifest = parse<{
      counts: {
        unique_plaintext_bodies: number;
        plaintext_observations: number;
      };
    }>(stored.value),
    s = summary(db);
  invariant(
    s.messages === manifest.counts.unique_plaintext_bodies &&
      s.observations === manifest.counts.plaintext_observations,
    "Manifest count mismatch",
  );
  invariant(
    !(s.context_status as Record<string, number>).pending,
    "Recovery incomplete; rerun collect",
  );
  return s;
}
export const MAX_TEXT = 24000;
export function addEvidence(
  db: ResearchDatabase,
  cid: string,
  kind: string,
  text: string,
  provenance: Data,
  visibility = "sender_context",
) {
  if (!text) return;
  provenance = {
    ...provenance,
    original_characters: chars(text),
    omitted_characters: Math.max(0, chars(text) - MAX_TEXT),
  };
  text = Array.from(text).slice(0, MAX_TEXT).join("");
  const eid = "ev-" + digest(canonical([kind, text, provenance, visibility]));
  db.run(
    "INSERT OR IGNORE INTO evidence VALUES(?,?,?,?,?)",
    eid,
    kind,
    text,
    canonical(provenance),
    visibility,
  );
  db.orm
    .insert(t.contextEvidence)
    .values({ context_id: cid, evidence_id: eid })
    .onConflictDoNothing()
    .run();
  return eid;
}
