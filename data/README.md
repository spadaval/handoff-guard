# Delegation message corpus

`private/` contains exact historical message text. It is ignored by Git and
created with owner-only permissions. Keep these files local; use sanitized
fixtures for public regression tests.

## Files

- `messages.jsonl`: one record per distinct plaintext body, deduplicated by
  SHA-256 of its exact UTF-8 bytes. Includes character/word counts, observed
  kinds and projects, and an observation count. Text is not trimmed or repaired.
  For multipart provider messages, recorded text blocks are joined with a
  newline; non-text blocks are not expanded.
- `messages.csv`: the same bodies and metadata for inspection, with blank
  `style_label` and `notes` columns. CSV fields can contain quoted newlines.
- `observations.jsonl`: provenance for every recovered observation. References
  `message_id`; records the database item or rollout line, project/thread,
  tool, timestamp, and model attribution when known. Observations are **not**
  distinct delivery counts: forks, event mirrors, and projections can repeat
  the same message.
- `opaque.jsonl`: ciphertext or explicitly encrypted payloads. These are
  excluded from the plaintext evaluation set; they are not decoded or labeled.
- `gaps.jsonl`: unavailable fields, unreadable sources, and parse failures.
  An omitted projection field may still be recovered from another source;
  gap records are not counts of definitively lost messages.
- `manifest.json`: source coverage, counts, extraction window, and file checksums.

Assignment and inter-agent message kinds are the primary handoff inputs.
Worker commentary, final reports, completion notifications, and peer-thread
requests are separate kinds. Select the relevant kinds when evaluating a
specific hook path. Do not equate all worker output with a delivered handoff.

## Coverage

The exporter reads the local T3 SQLite projections, Codex thread history and
raw session/archived-session rollouts, and existing evidence caches from the
preceding handoff investigation. It does not apply a project, date, or model
filter. T3/other-provider records are retained when locally available; this
does not claim an independent audit of every provider's private log format.

Only recorded tool arguments and recorded messages are extracted. JavaScript
source that happens to contain a delegation call is not executed or guessed
at. Recorded nested calls or their T3 delivery records provide evidence instead.
Attachments and referenced documents are not expanded into the message body.

Model attribution is explicit: original preceding rollout context is strongest;
saved thread selections and evidence-cache metadata are identified separately.
The latest thread model is never silently presented as the historical model.

The export is a read-only, best-effort capture of live sources during the
manifest's extraction window, not an atomic snapshot across all stores.
Regeneration replaces the export. Save manual labels separately, keyed by
`message_id`, before regenerating; the generated CSV is not a label database.

[coverage.json](coverage.json) records aggregate counts for the prepared export
without its raw message text. It is an inventory, not a classifier scorecard.

## Guard evaluation

`python3 scripts/evaluate_corpus.py prepare` freezes connected-thread splits
before tuning; it refuses to overwrite `private/split.jsonl`. Threads sharing
an exact body or sender/recipient relationship stay together. Bodies without
thread provenance split by message hash. Component sizes can make the reserved
body fraction differ substantially from 20%.

Manual labels go in `private/labels.jsonl` as records with `message_id`,
`style_label` (`normal`, `pathological`, or `ambiguous`), `reviewer`, `basis`,
and `notes`. Keep review depth explicit. An unlabeled body is `unassessed`.
Ambiguous labels do not enter style confusion counts. Size policy is reported
separately from style labels.

`python3 scripts/evaluate_corpus.py evaluate` runs the compiled release binary
against the entire plaintext set and emits aggregate `evaluation.json` plus
local-only `private/evaluation.jsonl`. See [the evidence report](../docs/evaluation.md)
for annotation limits, reserved-set contamination, false positives and misses.
Do not regenerate the corpus without preserving your labels and split ledger.

## Full-input triage baseline

The 23 November 2026 Python/Luna review covers all 3,464 handoff input bodies.
See [the triage report](../docs/triage.md) and aggregate [triage.json](triage.json).
The final full-message ledger is `private/triage-20261123/labels-full.jsonl`.
It retains ambiguous reviewer and wrapper-family disagreements. First-pass
batch outputs contain quarantined mapping errors and must not be used as final
labels. The old 80-excerpt labels remain untouched.

## Blind 6.1 Sol second pass

The subsequent [Sol review](../docs/triage-sol.md) covers all 559 ambiguous
bodies and seeded random samples of 100 normal and 100 pathological bodies.
Aggregate transitions are in [triage-sol.json](triage-sol.json). Raw Sol labels
and a separate provisional reconciliation are in
`private/triage-sol-20261123/labels-sol.jsonl` and `labels-reconciled.jsonl`.
The original Luna baseline is unchanged. The reconciliation mixes reviewed and
unreviewed definite labels; its global counts are not an all-Sol census.

## Context database and rubric pilot

`private/handoffs.sqlite3` links exact bodies, original observations, recovered
context, historical references, earlier labels and new context-dependent grades.
See the [database guide](../docs/context-database.md). Observations can be mirrors;
context rows are not asserted to be unique deliveries. Original exports and
reserved splits are preserved.

The [communication rubric](../docs/communication-rubric.md) separates purpose,
information selection and clarity. The [initial pilot](../docs/context-pilot.md)
reviews a frozen random sample of 30 distinct input bodies. Missing evidence
remains unknown. It is neither a whole-corpus grade nor a hook evaluation.

The local [dashboard](../docs/context-dashboard.md) reads `private/handoffs.sqlite3`
through a read-only API. It requests paginated previews and selected details;
there is no published corpus snapshot or per-message JSON directory.
`private/dashboard.json` remains an optional analysis export. The user permits
serving agent messages locally; keep raw text and database files out of Git.
