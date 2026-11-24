# Full handoff triage, 23 November 2026

Luna-assisted review flags **851 of 3,464 distinct handoff inputs (24.6%)** as
pathological in readability. It labels **2,054 normal (59.3%)** and retains
**559 ambiguous (16.1%)**. These are model triage judgments, not a human-verified
count of bad messages. Reviewer consistency is a substantial limitation.

The earlier guard's 17 rejections measured its narrow rules, not the prevalence
of poor handoffs. This run leaves those rules and all Codex configuration alone.

## Scope and first pass

All 3,464 recovered distinct plaintext handoff input bodies were selected using
assignment, agent-message, follow-up, cached-message and delivered-input
provenance. Their full text totals 7,172,322 characters. Worker outputs and
automatic completion reports were excluded unless the same exact text also had
handoff-input provenance. No new source export or corpus filtering was done.

The standard-library Python first pass used broad hints: long alphabetic runs,
low whitespace, token/line repetition and brief length. It routed 1,027 bodies
to suspicious, 190 long briefs to needs-context and 2,247 to ordinary-candidate.
Those categories were not ground-truth labels. Every category received full
Luna review; heuristic-normal messages were never accepted without review.

## Full-text Luna review

The first review used 24 Luna agents with batches balanced by character count.
Each agent received the same [readability rubric](triage-rubric.md), complete
messages and no old labels, guard decisions or heuristic classifications.
Review labels assess prose readability, not correctness of the historical task.
Long readable briefs, code, paths, hashes and ordinary fragments can be normal.
Sustained missing word spacing or severe compression can be pathological.
Borderline examples remain ambiguous. Size policy is a separate dimension.

Auditing uncovered page/index drift, including reviewers assuming a fixed
number of messages per page, one unfinished batch, and an explicit disclaimer
about premature labels. Unique row counts alone had not prevented these errors.
Four first-pass batches were quarantined; other suspect page indices and all
missing decisions were included in fresh review. The original outputs remain
private for audit and were not silently rewritten.

Fresh review covered 911 bodies, including a 111-message independent calibration
sample. Large re-review assignments often stopped incomplete, so the remaining
work was split into jobs of at most three pages. The final recorder requires
exact source message hashes for every page, checks full-page read receipts,
and refuses to overwrite records. Coverage validation checks all source IDs,
page outputs and 3,464 final unique decisions. It does not prove model
comprehension or factual accuracy of the labels.

## Disagreement and final labels

Independent calibration reviewers disagreed on 44 of 111 messages. Of these,
14 switched directly between normal and pathological. The sample was stratified
by initial label and reviewer, not prevalence-weighted, so these numbers cannot
be extrapolated as an overall error rate. All 44 disagreements remain ambiguous
in the final ledger.

Removing only the exporter-authored role preamble groups the bodies into 2,929
wrapper families. Another consistency check found 103 families whose members
received different style labels. All 206 involved bodies were retained as
ambiguous. These overlap with other ambiguous cases and must not be added as
independent counts. A six-message qualitative spot audit by the parent Sol agent
also corrected one readable status update from pathological to normal.

The final 851/2,054/559 counts include these checks. Do not substitute the raw
first-pass labels or agents' chat summaries for the consolidated ledger.
High confidence is a model self-report, not a measured correctness guarantee.

Eight inputs exceed the existing 12,000-character policy; none exceed 1,500
whitespace-separated words. Those size decisions do not establish style
pathology. The aggregate [machine-readable report](../data/triage.json) includes
style/size cross-counts, heuristic strata, wrapper-family counts, uncertainty
checks and source/label fingerprints. Issue flags overlap and include possible
issues on ambiguous examples.

## Artifacts and reproduction

All raw text and per-message reasons remain Git-ignored under
`data/private/triage-20261123/`. The important files are:

- `heuristics.jsonl` and `inputs.jsonl`: first-pass features and exact scope.
- `manifest.json` and `batches/`: frozen source IDs and full-text review pages.
- `labels/` and `decisions-*.json`: original first-pass outputs, including
  quarantined results. These are not the final label database.
- `repair-manifest.json`, `repair-inputs/`, `repair-views/` and `repairs/`:
  independent re-review scope, input pages, read receipts and accepted decisions.
- `labels-full.jsonl`: the final 3,464-message ledger, with original message
  hashes, style, confidence, issues, reasons and reviewer metadata.
- `adjudications.jsonl`: the parent agent's explicit spot-check correction.
- `summary.json`: consolidation output. Public `data/triage.json` contains the same aggregate
  counts and fingerprints without copying historical text.

The offline helpers use Python's standard library:

```sh
# Once on a new run; refuses to replace this run's prepared source pages:
python3 scripts/triage_handoffs.py prepare --batches 24
# Primary page inspection and checked manual decision recording:
python3 scripts/triage_handoffs.py page BATCH PAGE
python3 scripts/triage_handoffs.py record BATCH DECISIONS_FILE
# Audit/freeze independent re-review scope; refuses to overwrite it:
python3 scripts/review_handoffs.py prepare --batches 8
python3 scripts/review_handoffs.py page REPAIR_BATCH PAGE
python3 scripts/review_handoffs.py record REPAIR_BATCH PAGE DECISIONS_FILE
# Validate complete coverage and build final private ledger:
python3 scripts/review_handoffs.py finalize --public-report data/triage.json
python3 -m unittest discover -s tests -v
```

This is a dated, immutable local review run; the scripts name its directory
explicitly. Preserve the ledger before preparing any future run. Existing
80-excerpt labels and old guard-evaluation results were left intact.

Every input is now exposed to triage. Original whole-thread split assignments
were preserved, but this run supplies no untouched test set for future rule
tuning. It establishes a usable review queue and corpus baseline, with explicit
uncertainty; it does not validate a new rejection policy.
