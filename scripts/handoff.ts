#!/usr/bin/env node
/** One entry point for local research. The installed Rust hook remains independent. */
import { parseArgs } from "node:util";
import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { eq, desc } from "drizzle-orm";
import { openDatabase, fingerprint } from "../tooling/db/connection.ts";
import * as t from "../tooling/db/schema.ts";
import {
  ROOT,
  DATABASE,
  canonical,
  parse,
  invariant,
} from "../tooling/shared.ts";
import { capture } from "../tooling/capture.ts";
import { recover } from "../tooling/recovery.ts";
import { importCorpus, validate, summary } from "../tooling/dataset.ts";
import {
  prepareSplit,
  evaluate,
  analyzeMechanics,
  prepareCalibration,
  labelCalibration,
  summarizeCalibration,
  frozenCalibration,
  type CalibrationLabel,
} from "../tooling/analysis.ts";
import {
  sampleReview,
  recordReview,
  writePackets,
  type Review,
} from "../tooling/reviews.ts";
import { records } from "../tooling/research-store.ts";
import { compact, exportSnapshot } from "../tooling/maintenance.ts";
import { hookTest } from "../tooling/hook-test.ts";
const help = `Usage: npm run handoff -- COMMAND [options]

migrate                    Apply checked-in migrations; adopt the existing v2 database.
validate                   Verify hashes, context links, manifest and SQLite integrity.
collect                    Resume local context recovery.
capture                    Capture local sources into a NEW --database.
import --directory PATH    Import a frozen legacy corpus into a new database.
split                      Freeze thread-component tuning/heldout assignments once.
evaluate                   Evaluate every body with the compiled Rust guard.
mechanics                  Store compiled diagnostics for handoff inputs.
calibrate prepare|show|label|summarize --run RUN [--split tuning|heldout]
review sample RUN --reviewer NAME [--count 30 | --mix pilot:3,random:6 | --rerate START:COUNT]
review packet RUN --out DIR  Write one reading packet per sampled message (ignored path).
review record RUN          Read one manual review JSON record from stdin.
review runs                List saved runs.
review records RUN KIND [--key KEY]
review message ID [--context ID]
compact                    Remove obsolete runs and reclaim pages; stop dashboard first.
export --snapshot PATH     Explicit ignored snapshot for external tools.
hook-test [--scenario denied|normal|startup-error|timeout|exit-one|mcp]

Common: --database PATH --binary PATH --config PATH --help
Controls remain files. Messages and derived records remain in ignored SQLite.
`;
export async function main(args = process.argv.slice(2)) {
  const { values: v, positionals: p } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      database: { type: "string" },
      binary: { type: "string" },
      directory: { type: "string" },
      run: { type: "string" },
      split: { type: "string", default: "tuning" },
      labels: { type: "string", default: "labels-full.jsonl" },
      config: { type: "string" },
      "baseline-run": { type: "string", default: "pre-style-signals-policy" },
      count: { type: "string", default: "30" },
      mix: { type: "string" },
      rerate: { type: "string" },
      out: { type: "string" },
      reviewer: { type: "string" },
      key: { type: "string" },
      context: { type: "string" },
      snapshot: { type: "string" },
      "snapshot-text-limit": { type: "string", default: "1000" },
      scenario: { type: "string", default: "denied" },
      "codex-home": { type: "string" },
      "t3-db": { type: "string" },
      "evidence-cache": { type: "string", multiple: true },
      help: { type: "boolean" },
    },
  });
  if (v.help || !p.length) {
    console.log(help);
    return;
  }
  const command = p[0],
    path = resolve(v.database ?? DATABASE),
    binary = resolve(v.binary ?? join(ROOT, "target/release/handoff-guard"));
  if (command === "hook-test") {
    console.log(canonical(await hookTest(binary, v.scenario)));
    return;
  }
  if (command === "capture")
    invariant(
      !existsSync(path),
      "Capture requires a new --database path; existing reviews and splits are frozen",
    );
  const db = openDatabase(path);
  let result: unknown;
  try {
    switch (command) {
      case "migrate":
        result = {
          schema_version: db.get<{ user_version: number }>(
            "PRAGMA user_version",
          )!.user_version,
        };
        break;
      case "validate":
        result = validate(db);
        break;
      case "capture":
        capture(db, {
          codexHome: v["codex-home"],
          t3Db: v["t3-db"],
          evidenceCache: v["evidence-cache"],
        });
        recover(db, {
          codexState: v["codex-home"]
            ? join(v["codex-home"], "state_5.sqlite")
            : undefined,
          t3Db: v["t3-db"],
        });
        result = validate(db);
        break;
      case "import":
        invariant(v.directory, "Provide --directory");
        invariant(
          !db.orm.select().from(t.messages).limit(1).get(),
          "Import requires an empty database",
        );
        importCorpus(db, resolve(v.directory));
        recover(db);
        result = validate(db);
        break;
      case "collect":
        recover(db);
        result = validate(db);
        break;
      case "split":
        result = prepareSplit(db);
        break;
      case "evaluate":
        invariant(
          [
            "labels-full.jsonl",
            "labels-sol.jsonl",
            "labels-reconciled.jsonl",
            "labels.jsonl",
            "none",
          ].includes(v.labels!),
          "Unknown label source",
        );
        result = evaluate(db, binary, v.labels);
        break;
      case "mechanics":
        result = analyzeMechanics(db, binary);
        break;
      case "calibrate": {
        invariant(v.run, "Provide --run");
        invariant(["tuning", "heldout"].includes(v.split!), "Unknown split");
        if (p[1] === "prepare")
          result = prepareCalibration(
            db,
            v.run,
            binary,
            v.config ? resolve(v.config) : undefined,
            v["baseline-run"],
          );
        else if (p[1] === "label")
          result = labelCalibration(
            db,
            v.run,
            v.split!,
            parse<CalibrationLabel[]>(readFileSync(0, "utf8")),
          );
        else if (p[1] === "summarize") result = summarizeCalibration(db, v.run);
        else if (p[1] === "show") {
          frozenCalibration(db, v.run, true);
          result = records<{ message_id: string; split: string }>(
            db,
            v.run,
            "sample",
          )
            .filter((r) => r.split === v.split)
            .map((r) => ({
              ...r,
              text: db.orm
                .select()
                .from(t.messages)
                .where(eq(t.messages.message_id, r.message_id))
                .get()!.text,
            }));
        } else throw Error("Unknown calibrate action");
        break;
      }
      case "review": {
        const [, action, run, kind] = p;
        if (action === "runs")
          result = [
            ...db.orm
              .select()
              .from(t.analysisRuns)
              .orderBy(t.analysisRuns.created_at, t.analysisRuns.run_id)
              .all(),
            ...db.orm
              .select()
              .from(t.reviewRuns)
              .orderBy(t.reviewRuns.created_at, t.reviewRuns.run_id)
              .all(),
            ...db.orm
              .select()
              .from(t.mechanicalRuns)
              .orderBy(t.mechanicalRuns.created_at, t.mechanicalRuns.run_id)
              .all(),
          ];
        else if (action === "sample") {
          invariant(run && v.reviewer, "Provide run and --reviewer");
          result = sampleReview(
            db,
            run,
            Number(v.count),
            v.reviewer,
            v.config ? resolve(v.config) : undefined,
            v.mix
              ? Object.fromEntries(
                  v.mix.split(",").map((part) => {
                    const [name, count] = part.split(":");
                    return [name, Number(count)];
                  }),
                )
              : undefined,
            v.rerate
              ? {
                  start: Number(v.rerate.split(":")[0]),
                  count: Number(v.rerate.split(":")[1]),
                }
              : undefined,
          );
        } else if (action === "packet") {
          invariant(run && v.out, "Provide run and --out");
          result = writePackets(db, run, v.out);
        } else if (action === "record") {
          invariant(run, "Provide run");
          result = recordReview(
            db,
            run,
            parse<Review>(readFileSync(0, "utf8")),
          );
        } else if (action === "records") {
          invariant(run && kind, "Provide run and kind");
          const rows = records(db, run, kind);
          result = v.key
            ? db.get<{ record_json: string }>(
                "SELECT record_json FROM analysis_records WHERE run_id=? AND kind=? AND record_key=?",
                run,
                kind,
                v.key,
              )
            : rows;
          if (v.key) {
            invariant(result, "Unknown record");
            result = parse((result as { record_json: string }).record_json);
          }
        } else if (action === "message") {
          invariant(run, "Provide message ID");
          const message = db.orm
            .select()
            .from(t.messages)
            .where(eq(t.messages.message_id, run))
            .get();
          invariant(message, "Unknown message");
          const contexts = db.orm
            .select()
            .from(t.contexts)
            .where(eq(t.contexts.message_id, run))
            .orderBy(t.contexts.context_id)
            .all();
          result = { ...message, contexts };
          if (v.context) {
            invariant(
              contexts.some((c) => c.context_id === v.context),
              "Context belongs to another message",
            );
            Object.assign(result as object, {
              evidence: db.all(
                "SELECT e.* FROM evidence e JOIN context_evidence ce USING(evidence_id) WHERE context_id=?",
                v.context,
              ),
              references: db.all(
                "SELECT * FROM context_references WHERE context_id=?",
                v.context,
              ),
            });
          }
        } else throw Error("Unknown review action");
        break;
      }
      case "compact":
        result = compact(db);
        break;
      case "export":
        invariant(v.snapshot, "Provide explicit --snapshot path");
        await exportSnapshot(db, v.snapshot, Number(v["snapshot-text-limit"]));
        result = { snapshot: resolve(v.snapshot) };
        break;
      default:
        throw Error("Unknown command: " + command);
    }
    console.log(canonical(result));
  } finally {
    db.close();
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(import.meta.filename)
)
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
