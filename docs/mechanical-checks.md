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

The spacing thresholds sit above the clean set's tail: 21 letters for a fused
run, which is one more than "internationalization", and 9 characters for the
average word. The size limit is 12,000 characters. It was briefly 8,000 on the
claim that no clean handoff exceeded 6,000; reviewed handoffs judged fine run
to about 7,800, so that claim was wrong and the limit went back. They
were not fitted to individual messages. On the fair sample of 86 reviewed handoffs
the checks block 14 of the 15 with a presentation score of 1, 25 of the 38
scored 2, and none of the 33 scored 3 or 4. Use the fair sample for such figures: the
other reviewed handoffs were picked for being long or fused, which is what the
checks detect. Those reviews include the heldout split, so there is no
untouched test set for this version. Freeze a new sample
before tightening the rules further.

## The glued-values check

The spacing checks left one handoff in three with Costly or Broken
presentation unblocked. Those handoffs keep their spaces, so their average
word is 8 to 9 characters and no letter run is long. What they share is
numbers and hashes stuck to words: `supported246`, `exits0`,
`committed61000c4…`. The check blocks one glued hash, or three different
words of five or more letters with a number stuck to the end.

It was written by reading those misses, so the reviewed handoffs are not an
independent test of it. The only evidence from outside that reading is the
448 early handoffs, none of which it blocks.

The checks still miss dropped small words, slash and status chains, and
unexplained codes. Those need the instructions and the reviews, not a longer
rule list.
