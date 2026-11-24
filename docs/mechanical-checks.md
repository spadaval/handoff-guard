# Inspect measured checks beside model judgments

`handoff-guard inspect` reports five existing blocking-policy checks and two
advisory style signals. The existing guard decisions remain `conservative-v1`;
expanded diagnostics identify themselves as `style-signals-v1`. Inspection
measures every check; delivery still uses the existing early size rejection.

```sh
cargo build --release --locked
python3 scripts/analyze_mechanics.py
```

The analyzer stores compiled diagnostics for all 3,464 distinct input bodies in
SQLite, with binary/source/script hashes. The dashboard reads those results
directly; no export or publication step is needed. Worker bodies without a
handoff-input path are not inserted as input-hook coverage.

Existing blocking checks are character count above 12,000, word count above
1,500, long glued prose, extreme word repetition and extreme line repetition.
Punctuation spacing and needless shorthand are advisory, with `warn` status,
`enforcement: advisory` and exact spans. They never participate in denial
selection. See [scope and calibration](style-signals-calibration.md).

Reports contain at most 128 ranges per check and explicit omission counts.
Offsets use Unicode scalar indices, end exclusive. The dashboard preserves the
original message when highlighting ranges. Scores are continuous display
functions of the measurements; thresholds remain explicit and independent.
See the [rubric](communication-rubric.md) for formulas and model anchors.

Ten Rust checks cover existing decisions, compiled CLI/hook envelopes, thresholds,
Unicode spans, technical exemptions and advisory behavior. The final inspector
was also evaluated against the pre-change executable on every recoverable body:
all 36,078 rule/reason outcomes were identical. No new interception behavior or
global installation was introduced. The existing stock-hook limitations in the
[README](../README.md) still apply.
