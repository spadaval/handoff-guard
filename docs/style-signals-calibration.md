# Calibrate two advisory style signals without changing denial policy

The compiled inspector now reports punctuation spacing and needless shorthand
beside the existing size, glued-prose and repetition checks. New matches have
`status: warn` and `enforcement: advisory`. They affect the dashboard score and
can be highlighted, but never become a hook denial. No global configuration was
changed.

The first tuning prototypes incorrectly flagged literal array fields,
`file:line`, command names and Python import lists. The final prototype excludes
those recognized forms. It looks for missing clause-punctuation spacing, bare
empty status markers and alphabetic plus chains. The exact scope and continuous
score formulas are in the [rubric](communication-rubric.md).

## Corpus sweep

The final compiled inspector processed all 36,078 recoverable plaintext bodies,
including 3,464 handoff inputs and 32,614 worker/other outputs. Input bodies had
264 punctuation warnings and 60 shorthand warnings; output bodies had neither.
The warnings can overlap, so these are not distinct-message counts or accuracy
estimates. The detector deliberately does not scan code-like regions as prose. The shorthand
sweep found one empty-status marker and 64 plus-chain matches across those
60 input bodies; the selected manual sample exercises plus chains, while the
empty-status marker behavior also has invented Rust regression examples.

The old and new compiled `evaluate` commands returned identical rule names and
reasons for every corpus body. There were zero changed denial decisions. The
SQLite refresh stores the new measurements for all 3,464 inputs, preserving the
separate non-input output path.

## Manual calibration

One parent Codex reviewer read the full bodies of 17 selected inputs. Nine were
used for tuning and eight were reserved until the detector source was frozen.
Existing connected-thread-component splits were preserved. The tuning messages
span four components; the heldout messages all belong to one other component.
The sample mixes seeded warning hits with non-hit controls, with an 8,000-character
reading limit. Related near-duplicates remain. It is not random delivery sampling,
a blinded independent review, or a corpus precision/recall estimate.

Labels distinguish present defects, absent defects and ambiguous cases on each
dimension. Overall normal/pathological/ambiguous labels are recorded separately:
a message with severe fused words can correctly be negative for these two narrow
new recognizers. The tuning set has two normal, six pathological and one ambiguous
message; the heldout set has six pathological and two ambiguous messages.

| Sample | Signal | Detected defects | False positives | Misses | Correct negatives | Ambiguous |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Tuning, 9 messages | Punctuation | 5 | 0 | 0 | 4 | 0 |
| Tuning, 9 messages | Shorthand | 3 | 0 | 3 | 2 | 1 |
| Heldout, 8 messages | Punctuation | 3 | 0 | 1 | 4 | 0 |
| Heldout, 8 messages | Shorthand | 3 | 0 | 3 | 1 | 1 |

No false positives were found in this small final sample. That does not establish
zero false positives in the remaining corpus. The broad semantic shorthand
labels include two-part and mixed symbolic forms outside the detector's current
scope. Those misses are retained, not relabeled as normal to improve the results.
Heldout examples were not used for another rule revision.

Known misses include missing spaces beside digits, two-part plus expressions,
and mixed plus/slash shorthand. A technical-looking string can still be unreadable
prose; the conservative exclusions intentionally trade recall for fewer intrusive
warnings. The calibration is too narrow to promote these checks to denials.

## Reproduce

```sh
cargo build --release --locked
python3 scripts/calibrate_style_signals.py --directory data/private/new-style-experiment
# Read the tuning bodies, label them, and freeze the source before opening heldout bodies.
# Existing frozen sample, labels, source freeze and aggregate results:
python3 scripts/calibrate_style_signals.py --summarize --directory data/private/style-signals-v3
python3 scripts/analyze_mechanics.py
```

The preparation command uses the pre-change executable retained locally at
`data/private/context-db-work/pre-style-signals-guard` for exact policy comparison.
Use `--baseline` to provide that executable on another machine. It refuses to
replace a frozen experiment. Raw bodies, exact match spans, labels and hashes
remain under ignored `data/private/style-signals-v3/`; aggregate results are in
`evaluation.json`. Historical prototype folders remain local. There are no UI
tests. Rust checks cover advisory/non-denial behavior, technical exclusions,
compiled executable behavior and Unicode span integrity.
