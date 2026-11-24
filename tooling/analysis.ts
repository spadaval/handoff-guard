import { eq, and, asc } from "drizzle-orm";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, relative } from "node:path";
import type { ResearchDatabase } from "./db/connection.ts";
import * as t from "./db/schema.ts";
import {
  ROOT,
  canonical,
  digest,
  checksum,
  parse,
  invariant,
  now,
  count,
  INPUT_KINDS,
  type Data,
} from "./shared.ts";
import { validate } from "./dataset.ts";
import {
  compiled,
  createRun,
  put,
  records,
  type Prediction,
  type Inspection,
  type Check,
} from "./research-store.ts";
export interface Split {
  message_id: string;
  component: string;
  split: "tuning" | "heldout";
}
export interface StyleLabel {
  message_id: string;
  style_label: "normal" | "pathological" | "ambiguous";
  [key: string]: unknown;
}
export function prepareSplit(db: ResearchDatabase) {
  invariant(
    !db.orm.select().from(t.splits).limit(1).get(),
    "Reserved split already exists; refusing to change it",
  );
  const config = parse<{ heldout_modulus: number; heldout_residue: number }>(
    readFileSync(resolve(ROOT, "config/review.json"), "utf8"),
  );
  const parent = new Map<string, string>(),
    first = new Map<string, string>();
  function root(x: string): string {
    if (!parent.has(x)) parent.set(x, x);
    if (parent.get(x) !== x) parent.set(x, root(parent.get(x)!));
    return parent.get(x)!;
  }
  for (const { record_json } of db.orm.select().from(t.observations).all()) {
    const r = parse<{
      message_id: string;
      thread_id?: string;
      sender_thread_id?: string;
    }>(record_json);
    for (const thread of [r.thread_id, r.sender_thread_id].filter(
      (x): x is string => !!x,
    )) {
      if (first.has(r.message_id)) {
        const a = root(thread),
          b = root(first.get(r.message_id)!);
        parent.set(a > b ? a : b, a < b ? a : b);
      } else {
        first.set(r.message_id, thread);
        root(thread);
      }
    }
  }
  const groups = new Map<string, string[]>();
  for (const thread of parent.keys())
    groups.set(root(thread), [...(groups.get(root(thread)) ?? []), thread]);
  const ids = new Map(
    [...groups].map(([k, v]) => [k, digest(v.sort().join("\n"))]),
  );
  const values = db.orm
    .select({ message_id: t.messages.message_id })
    .from(t.messages)
    .all()
    .map(({ message_id }) => {
      const component = first.has(message_id)
        ? ids.get(root(first.get(message_id)!))!
        : message_id;
      const split =
        Number.parseInt(component.slice(0, 8), 16) % config.heldout_modulus ===
        config.heldout_residue
          ? "heldout"
          : "tuning";
      return {
        message_id,
        record_json: canonical({ message_id, component, split }),
      };
    });
  db.transaction(() => {
    for (const r of values) db.orm.insert(t.splits).values(r).run();
  });
  return {
    bodies: count(values.map((r) => parse<Split>(r.record_json).split)),
    thread_components: groups.size,
    threads: parent.size,
  };
}
export function evaluate(
  db: ResearchDatabase,
  binary: string,
  labelSource = "labels-full.jsonl",
) {
  validate(db);
  const bodies = db.orm
      .select()
      .from(t.messages)
      .orderBy(t.messages.message_id)
      .all(),
    split = Object.fromEntries(
      db.orm
        .select()
        .from(t.splits)
        .all()
        .map((r) => [r.message_id, parse<Split>(r.record_json).split]),
    );
  const labels: Record<string, StyleLabel> = {};
  for (const r of db.orm
    .select()
    .from(t.historicalReviews)
    .orderBy(t.historicalReviews.id)
    .all())
    if (r.source_path.endsWith("/" + labelSource)) {
      const label = parse<StyleLabel>(r.record_json);
      invariant(
        ["normal", "pathological", "ambiguous"].includes(label.style_label),
        "Unknown style label",
      );
      labels[label.message_id] = label;
    }
  invariant(
    labelSource === "none" || Object.keys(labels).length,
    "No labels for requested source",
  );
  invariant(
    bodies.length === Object.keys(split).length &&
      bodies.every((r) => r.message_id in split),
    "Reserved split does not match corpus",
  );
  invariant(
    Object.keys(labels).every((mid) => mid in split),
    "Labels reference unknown bodies",
  );
  const predictions = compiled<Prediction>(db, binary, "evaluate"),
    byId = new Map(predictions.map((r) => [r.message_id, r]));
  const manifest = db.orm
    .select()
    .from(t.sourceFiles)
    .where(eq(t.sourceFiles.purpose, "manifest"))
    .get();
  const report = {
    manifest_sha256: manifest?.sha256 ?? null,
    label_records_sha256: digest(canonical(labels)),
    split_records_sha256: digest(canonical(split)),
    binary_sha256: checksum(binary),
    groups: {} as Record<
      string,
      {
        counts: Record<string, number>;
        style_confusion: Record<string, number>;
      }
    >,
    label_source: labelSource,
    annotation_limit:
      "Historical model reviews are fallible; reserved groups have been exposed to earlier triage. This is not an untouched accuracy estimate.",
    note: "Distinct bodies, not deliveries. Style errors use only manually reviewed normal/pathological labels. Unreviewed bodies are unassessed, not normal. Ambiguous labels are excluded from error rates.",
  };
  const worker = new Set([
    "worker_assistant_output",
    "worker_commentary",
    "worker_final_answer",
    "worker_report",
    "cached_worker_report",
    "completion_notification",
  ]);
  for (const scope of [
    "all_plaintext",
    "handoff_inputs",
    "worker_output_only",
    "other_plaintext",
  ])
    for (const subset of ["all", "tuning", "heldout"]) {
      const counts: Record<string, number> = {},
        matrix: Record<string, number> = {},
        inc = (x: Record<string, number>, k: string) =>
          (x[k] = (x[k] ?? 0) + 1);
      for (const r of bodies) {
        const kinds = parse<string[]>(r.kinds),
          input = kinds.some((k) => INPUT_KINDS.has(k)),
          output = kinds.some((k) => worker.has(k));
        if (
          !(
            scope === "all_plaintext" ||
            (scope === "handoff_inputs" && input) ||
            (scope === "worker_output_only" && output && !input) ||
            (scope === "other_plaintext" && !input && !output)
          ) ||
          (subset !== "all" && split[r.message_id] !== subset)
        )
          continue;
        const rule = byId.get(r.message_id)!.rule,
          label = labels[r.message_id]?.style_label ?? "unassessed",
          size = ["characters", "words"].includes(rule ?? ""),
          style = [
            "fused_words",
            "missing_spaces",
            "glued_prose",
            "repetition",
          ].includes(rule ?? "");
        inc(counts, "bodies");
        inc(counts, rule ? "denied" : "allowed");
        if (rule) inc(counts, "rule:" + rule);
        inc(counts, "label:" + label);
        if (size) inc(counts, "size_policy_denials");
        if (["normal", "pathological"].includes(label))
          inc(
            matrix,
            size
              ? "excluded_size_policy"
              : label === "normal"
                ? style
                  ? "false_positive"
                  : "true_negative"
                : style
                  ? "true_positive"
                  : "miss",
          );
      }
      report.groups[scope + ":" + subset] = { counts, style_confusion: matrix };
    }
  const existing = db.orm
    .select({ run_id: t.analysisRuns.run_id })
    .from(t.analysisRuns)
    .where(
      and(
        eq(t.analysisRuns.kind, "corpus-evaluation"),
        eq(t.analysisRuns.metadata_json, canonical(report)),
      ),
    )
    .get();
  const run =
    existing?.run_id ?? "evaluation-" + digest(canonical(report)).slice(0, 24);
  db.transaction(() => {
    createRun(db, run, "corpus-evaluation", report);
    for (const r of bodies)
      put(
        db,
        run,
        "prediction",
        r.message_id,
        {
          ...byId.get(r.message_id),
          split: split[r.message_id],
          kinds: parse(r.kinds),
          style_label: labels[r.message_id]?.style_label ?? "unassessed",
        },
        r.message_id,
      );
    put(db, run, "report", "summary", report);
  });
  return { run_id: run, ...report };
}
export function analyzeMechanics(db: ResearchDatabase, binary: string) {
  const rows = db.orm
    .select({ message_id: t.messages.message_id, text: t.messages.text })
    .from(t.messages)
    .where(eq(t.messages.is_input, 1))
    .orderBy(t.messages.message_id)
    .all();
  // The shared compiler helper checks complete coverage. Only input-path results are retained.
  const wanted = new Set(rows.map((r) => r.message_id)),
    results = compiled<Inspection>(db, binary, "inspect").filter((r) =>
      wanted.has(r.message_id),
    );
  const identity = checksum(binary),
    sources = Object.fromEntries(
      readdirSync(resolve(ROOT, "src"))
        .filter((p) => p.endsWith(".rs"))
        .map((p) => ["src/" + p, checksum(resolve(ROOT, "src", p))]),
    );
  const scriptHash = checksum(resolve(ROOT, "tooling/analysis.ts")),
    run =
      "rust-mechanics-" +
      digest(identity + canonical(sources) + scriptHash).slice(0, 24);
  const metadata = {
    engine: "compiled Rust",
    binary_sha256: identity,
    policy_version: results[0]?.policy_version ?? null,
    source_hashes: sources,
    analysis_script_sha256: scriptHash,
    scope: "all distinct handoff input bodies; not worker output hook coverage",
    changes_hook_configuration: false,
    composite_score: false,
  };
  db.transaction(() => {
    const old = db.orm
      .select()
      .from(t.mechanicalRuns)
      .where(eq(t.mechanicalRuns.run_id, run))
      .get();
    if (!old)
      db.orm
        .insert(t.mechanicalRuns)
        .values({
          run_id: run,
          created_at: now(),
          metadata_json: canonical(metadata),
        })
        .run();
    for (const result of results) {
      const value = { ...result, run_id: run, engine_metadata: metadata },
        saved = db.orm
          .select()
          .from(t.mechanicalResults)
          .where(
            and(
              eq(t.mechanicalResults.run_id, run),
              eq(t.mechanicalResults.message_id, result.message_id),
            ),
          )
          .get();
      invariant(
        !saved || saved.result_json === canonical(value),
        "Refusing to overwrite differing mechanical results",
      );
      if (!saved)
        db.orm
          .insert(t.mechanicalResults)
          .values({
            run_id: run,
            message_id: result.message_id,
            result_json: canonical(value),
          })
          .run();
    }
  });
  return {
    run_id: run,
    bodies: results.length,
    blocked: results.filter((r) => r.blocked).length,
    engine: "compiled Rust",
    changes_hook_configuration: false,
  };
}
interface CalibrationSample extends Split {
  is_input: boolean;
  characters: number;
  signals: Record<string, Check>;
}
export interface CalibrationLabel extends StyleLabel {
  punctuation_spacing: "present" | "absent" | "ambiguous";
  needless_shorthand: "present" | "absent" | "ambiguous";
  note: string;
  reviewer: string;
}
interface CalibrationConfig {
  seed: string;
  control_seed: string;
  maximum_characters: number;
  hits_per_rule_per_split: number;
  controls_per_split: number;
  rules: string[];
  splits: string[];
  rubric: string;
}
export function prepareCalibration(
  db: ResearchDatabase,
  run: string,
  binary: string,
  configPath = resolve(ROOT, "config/calibration.json"),
  baseline = "pre-style-signals-policy",
) {
  invariant(
    !db.orm
      .select()
      .from(t.analysisRuns)
      .where(eq(t.analysisRuns.run_id, run))
      .get(),
    "Experiment already frozen; choose a new run",
  );
  const config = parse<CalibrationConfig>(readFileSync(configPath, "utf8")),
    rows = db.orm
      .select()
      .from(t.messages)
      .orderBy(t.messages.message_id)
      .all(),
    split = new Map(
      db.orm
        .select()
        .from(t.splits)
        .all()
        .map((r) => [r.message_id, parse<Split>(r.record_json)]),
    );
  invariant(
    rows.length === split.size && rows.every((r) => split.has(r.message_id)),
    "Freeze a complete thread split before calibration",
  );
  const old = new Map(
    records<Prediction>(db, baseline, "prediction").map((r) => [
      r.message_id,
      r,
    ]),
  );
  invariant(
    old.size === rows.length && rows.every((r) => old.has(r.message_id)),
    "Baseline must cover entire corpus",
  );
  for (const r of compiled<Prediction>(db, binary, "evaluate"))
    invariant(
      canonical(old.get(r.message_id)) === canonical(r),
      "Denial policy changed",
    );
  const reports = new Map(
      compiled<Inspection>(db, binary, "inspect").map((r) => [r.message_id, r]),
    ),
    text = new Map(rows.map((r) => [r.message_id, r.text]));
  const all: CalibrationSample[] = rows.map((r) => ({
    ...split.get(r.message_id)!,
    is_input: !!r.is_input,
    characters: r.characters,
    signals: Object.fromEntries(
      config.rules.map((rule) => {
        const check = reports
          .get(r.message_id)!
          .checks.find((c) => c.rule === rule);
        invariant(check, "Missing compiled signal " + rule);
        return [rule, check];
      }),
    ),
  }));
  const eligible = all.filter(
      (r) => r.is_input && r.characters <= config.maximum_characters,
    ),
    sample: CalibrationSample[] = [];
  for (const subset of config.splits) {
    const chosen = new Set<string>();
    for (const rule of config.rules) {
      const unique = new Set<string>();
      const hits = eligible
        .filter((r) => r.split === subset && r.signals[rule].status === "warn")
        .sort((a, b) =>
          digest(config.seed + a.message_id).localeCompare(
            digest(config.seed + b.message_id),
          ),
        );
      for (const r of hits) {
        const sig = text.get(r.message_id)!.replace(/[0-9]+/g, "N");
        if (unique.has(sig)) continue;
        unique.add(sig);
        chosen.add(r.message_id);
        if (unique.size === config.hits_per_rule_per_split) break;
      }
    }
    const controls = eligible
      .filter(
        (r) =>
          r.split === subset &&
          !Object.values(r.signals).some((s) => s.status === "warn"),
      )
      .sort((a, b) =>
        digest(config.control_seed + a.message_id).localeCompare(
          digest(config.control_seed + b.message_id),
        ),
      );
    for (const r of controls.slice(0, config.controls_per_split))
      chosen.add(r.message_id);
    sample.push(...all.filter((r) => chosen.has(r.message_id)));
  }
  const components = new Set(
    sample.filter((r) => r.split === "tuning").map((r) => r.component),
  );
  invariant(
    !sample.some((r) => r.split === "heldout" && components.has(r.component)),
    "Thread components overlap",
  );
  const metadata = {
    config_path: relative(ROOT, configPath).startsWith("..")
      ? configPath
      : relative(ROOT, configPath),
    config_sha256: checksum(configPath),
    rubric_sha256: checksum(resolve(ROOT, config.rubric)),
    source_sha256: checksum(resolve(ROOT, "src/style_signals.rs")),
    binary_sha256: checksum(binary),
    baseline_run: baseline,
    corpus_bodies: rows.length,
    sample_count: sample.length,
    policy_differences: 0,
  };
  db.transaction(() => {
    createRun(db, run, "style-calibration", metadata);
    for (const r of sample)
      put(db, run, "sample", r.message_id, r, r.message_id);
  });
  return metadata;
}
export function frozenCalibration(
  db: ResearchDatabase,
  run: string,
  checkSource = false,
) {
  const row = db.orm
    .select()
    .from(t.analysisRuns)
    .where(
      and(
        eq(t.analysisRuns.run_id, run),
        eq(t.analysisRuns.kind, "style-calibration"),
      ),
    )
    .get();
  invariant(row, "Unknown calibration run");
  const meta = parse<Data>(row.metadata_json);
  invariant(
    !checkSource ||
      meta.source_sha256 === checksum(resolve(ROOT, "src/style_signals.rs")),
    "Rules changed after freeze; start a new run",
  );
  return meta;
}
export function labelCalibration(
  db: ResearchDatabase,
  run: string,
  split: string,
  labels: CalibrationLabel[],
) {
  frozenCalibration(db, run, true);
  invariant(Array.isArray(labels), "Expected a label list");
  const sample = records<CalibrationSample>(db, run, "sample").filter(
      (r) => r.split === split,
    ),
    expected = new Set(sample.map((r) => r.message_id));
  invariant(
    expected.size &&
      labels.length === expected.size &&
      new Set(labels.map((r) => r.message_id)).size === expected.size &&
      labels.every((r) => expected.has(r.message_id)),
    "Labels must cover exact frozen split once each",
  );
  for (const r of labels) {
    invariant(
      ["normal", "pathological", "ambiguous"].includes(r.style_label),
      "Invalid style label",
    );
    invariant(
      ["punctuation_spacing", "needless_shorthand"].every((k) =>
        ["present", "absent", "ambiguous"].includes(String(r[k])),
      ),
      "Label each signal",
    );
    invariant(
      typeof r.note === "string" &&
        r.note &&
        typeof r.reviewer === "string" &&
        r.reviewer,
      "Provide note and reviewer",
    );
  }
  db.transaction(() => {
    for (const r of labels)
      put(db, run, "label", r.message_id, r, r.message_id);
  });
  return { recorded: labels.length, split };
}
export function summarizeCalibration(db: ResearchDatabase, run: string) {
  const meta = frozenCalibration(db, run),
    sample = records<CalibrationSample>(db, run, "sample"),
    labels = new Map(
      records<CalibrationLabel>(db, run, "label").map((r) => [r.message_id, r]),
    );
  invariant(
    sample.length &&
      sample.length === labels.size &&
      sample.every((r) => labels.has(r.message_id)),
    "Manual review coverage mismatch",
  );
  const result = {
    corpus: meta,
    results: {} as Record<string, Data>,
    limitations: [
      "Targeted calibration sample, not a prevalence or corpus accuracy estimate.",
      "Preserve ambiguous labels; this command does not promote signals to blocking.",
    ],
  };
  for (const subset of ["tuning", "heldout"]) {
    const selected = sample.filter((r) => r.split === subset),
      summary: Data = {
        messages: selected.length,
        thread_components: new Set(selected.map((r) => r.component)).size,
      };
    for (const rule of ["punctuation_spacing", "needless_shorthand"]) {
      const n = {
        true_positive: 0,
        false_positive: 0,
        true_negative: 0,
        miss: 0,
        ambiguous: 0,
      };
      for (const r of selected) {
        const predicted = r.signals[rule].status === "warn",
          truth = labels.get(r.message_id)![rule];
        const key =
          truth === "ambiguous"
            ? "ambiguous"
            : truth === "present"
              ? predicted
                ? "true_positive"
                : "miss"
              : predicted
                ? "false_positive"
                : "true_negative";
        n[key]++;
      }
      summary[rule] = n;
    }
    result.results[subset] = summary;
  }
  db.transaction(() => put(db, run, "report", "evaluation-sqlite-v1", result));
  return result;
}
