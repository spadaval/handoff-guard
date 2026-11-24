# Mechanical checks

`handoff-guard inspect` measures every check on a message and reports them all.
The hook uses the same code and stops at the first check that blocks. The
policy is described in the [README](../README.md#policy) and identifies itself
as `plain-english-v2`.

```sh
cargo build --release --locked
node scripts/handoff.ts mechanics
```

`mechanics` stores one report for every distinct handoff input in SQLite, keyed
by the hashes of the binary and its sources. Run it again after changing a
rule. The dashboard uses the stored reports for lists and totals, and runs the
binary live when it shows one message.

A report lists `checks`. Each has a `rule`, a `status` of `pass`, `block` or
`warn`, its `measurements`, its `thresholds` and up to 128 `spans`. Spans are
zero-based Unicode scalar offsets, end exclusive. `warn` marks the two advisory
detectors, which never block. Reports hold no message text.

## How the thresholds were chosen

The spacing thresholds were set on two label-free contrasts and then checked
against model reviews.

- 448 handoffs sent before September 2026, or by `gpt-5.5`, contain no fused
  shorthand. Their average word length has a median of 6.7 characters and a
  99th percentile of 8.5. None has two 20-letter runs.
- 415 handoffs known to be sent by `gpt-6.1-sol` have a median average word
  length of 12.3 characters.

The thresholds sit above the clean set's tail: 21 letters for a fused run,
which is one more than "internationalization", 9 characters for the average
word, and 8,000 characters for size. They
were not fitted to individual messages. Against Claude Opus reviews the checks
block nearly every handoff with a presentation score of 1, about half of those
scored 2, and almost none scored 3 or 4. Those reviews include the heldout
split, so there is no untouched test set for this version. Freeze a new sample
before tightening the rules further.

The checks miss compressed text that keeps its spaces: dropped small words,
status chains and unexplained codes. Those need the instructions and the
reviews, not a longer rule list.
