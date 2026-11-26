# Calibrate signals without experiment folders

The sampling settings live in [config/calibration.json](../config/calibration.json).
The anchors live in [the communication rubric](communication-rubric.md). Both are
tracked files. Frozen IDs, compiled predictions, rule labels and results live in
the ignored SQLite database.

```sh
cargo build --release --locked
node scripts/handoff.ts calibrate prepare --run my-calibration
node scripts/handoff.ts calibrate show --run my-calibration --split tuning
node scripts/handoff.ts calibrate label --run my-calibration --split tuning < /dev/stdin
node scripts/handoff.ts calibrate show --run my-calibration --split heldout
node scripts/handoff.ts calibrate label --run my-calibration --split heldout < /dev/stdin
node scripts/handoff.ts calibrate summarize --run my-calibration
```

Preparation compares the compiled guard's full-corpus rule/reason predictions
with the stored `pre-style-signals-policy` baseline. An incomplete baseline or a
changed policy fails preparation. No old executable is required. Each experiment
freezes binary, detector source, rubric and config hashes before review. Tuning
and heldout samples retain the existing thread-component split. To change a rule,
start a new run. Do not reopen a reserved set and call it untouched.

Read full messages. Send a JSON list of labels for the exact split through stdin.
Each entry contains `message_id`, `style_label` (normal/pathological/ambiguous),
`punctuation_spacing` and `needless_shorthand` (present/absent/ambiguous), `note`
and `reviewer`. Coverage must be exact. Conflicting replacement labels are refused.
Overall style labels and the two narrow detector labels are separate judgments.

Summaries are saved in the same database and printed. They report false positives,
misses, correct predictions and ambiguities separately. Targeted signal hits and
controls do not estimate corpus prevalence or establish overall accuracy. A small
sample or one heldout component cannot justify promotion to a blocking rule.

Earlier runs can be inspected without recreating their working folders:

```sh
node scripts/handoff.ts calibrate summarize --run style-signals-v3
node scripts/handoff.ts review records style-signals-v3 label
```

Per-message measurements and labels stay out of Git. Findings worth keeping are
written up in [findings/](findings/README.md) with identifying detail replaced.
This document defines the procedure rather than carrying results.
