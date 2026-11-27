# Observational evidence so far

These figures come from the 2,920 Sol-sent handoffs in the corpus, all from
one project on a machine where Sol held every role and used `atelier`. No
hook was installed there. "Flagged" means the guard would have blocked the
message when scored afterwards.

The scripts that produced these figures are not in the repository yet, so
treat them as provisional until they are moved into `scripts/` and rerun.

## A. Trigger

- Handoffs with two or more fused-word runs rise from 18% in the lowest
  quartile of structured load to 55% in the highest, at every length.
- For a thread whose last handoff was clean, the next is flagged 14% of the
  time at the lowest load and 71% at the highest.
- Inside a message, the fused words sit in the prose and not in the
  data-dense parts. Load tips the whole message into the register.
- Load explains little of the drift: it rises from 3.0 to 3.9 across a
  thread while the fused share goes from 18% to 57%.
- Handoffs with none of 13 guessed scheduler words are flagged 52% of the
  time, and those with any 81%. There is no dose effect, and in 14 of 22
  threads the shorthand started before the heavy scheduler traffic.

## B. Spread

- A thread still writing cleanly is flagged next 49% of the time after it
  reads a flagged message, and 33% after a clean one.
- A new child's first message is flagged in 21 of 26 cases after a flagged
  brief and 3 of 29 after a clean one. Brief length is tangled in.
- 18 of the 59 threads that go bad had read no flagged message first, so it
  also starts unprompted.
- Sol to Sol is flagged 73% of the time and Sol to `gpt-6-luna` 12%, but
  every Luna handoff comes from one thread.

## C. Persistence

- After a thread's own flagged handoff the next is flagged 87% of the time
  (1,781 of 2,036). After a clean one, 34% (274 of 805).
- An infected thread that received only clean messages or reports since its
  last handoff is flagged next 87% of the time (593 of 679), against 89% when
  it received nothing.
- 8 of 27 infected threads later wrote five clean handoffs in a row. All 8
  were flagged again.
- In a model with depth, length, the thread's own previous handoff and the
  last message received, the odds ratios are 3.6, 1.6 and 2.2 for own
  history, received message and log depth. All intervals exclude 1.

## D. Mode

- 26 of the 2,250 final reports children returned are flagged, including 11
  of 422 from children whose brief was flagged.
- One example of a thread deep in a long run answering a plain question in
  plain prose.

## E. Reader

- Reviewers marked a label whose meaning lives outside the message in 45 of
  86 sampled handoffs.
- 418 of the 427 handoffs over 5,000 characters are opening briefs to a new
  child. Paths make up 36% of their characters. They cite the item's record
  and restate its state and constraints anyway.

## F. Harm

- Nothing measured. Reviewers marked a buried ask in 18 of 86 handoffs.

## G. Remedies

- Two hook denials in the running comparison, both followed by clean
  handoffs.
- Records did not prevent the decay on the work host.

## Proof vocabulary (outside the chain)

- Sol's handoffs use these words 9.5 times per 1,000 letters, against 2.4 in
  the Agent Factory skill text they work from.
- A thread's first handoff is at 6.5 and handoffs past the hundredth at 10.4.
- The running comparison's lead is at 10.1 in its first ten handoffs and 10.1
  in its last fifteen, with no shorthand and no failure behind it.
- Negations are not elevated.
