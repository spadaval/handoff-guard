# Proposed experiments

Detailed designs for the proposed experiments mapped in [README.md](README.md).
When an experiment finishes, write up its results in a dedicated file in this
folder, update the claim table in [README.md](README.md), and remove its entry
here.

## Single-message tests

- **S1 (deep-context half).** The fresh-context and model-version half of `S1`
  is done in [s1-s2-cold-writing.md](s1-s2-cold-writing.md) (`0/72` flagged).
  Once `L1`/`L4` produce plaintext long transcripts, repeat the 5/20/60-fact
  status vs. coordination sweep from deep inside a long transcript to test
  whether depth + load triggers shorthand.
- **S2, S3, and S4** have completed pilots in
  [s1-s2-cold-writing.md](s1-s2-cold-writing.md),
  [s3-reading-test.md](s3-reading-test.md), and
  [s4-planning-test.md](s4-planning-test.md). Scale them up only if a later
  finding needs tighter confidence intervals.

## Replays

All of these need plaintext transcripts of infected threads, so they wait for
L1. Before trusting any of them, confirm that replaying an unedited
transcript produces a message like the original. Generate 20 or more messages
per condition.

**R1. Messaging against answering.** At a few hundred late points, have Sol
write the next handoff as a continuation, and again after a plain question
from an outsider. A large gap supports the introspection branch and the
rewriter. No gap means the context carries the habit, not the mode.

**R2. Rewrite the thread's own history.** Replace an infected thread's
earlier flagged messages with plain rewrites and ask for the next handoff. A
drop shows the thread is priming itself, and that rewriting at send time
fixes the cause.

**R3. Swap what the thread received.** In a clean thread, replace incoming
plain messages with shorthand versions, and the reverse in an infected one.
This is the causal test of spread, and of whether clean input fails to cure.

**R4. Insert a rebuke.** At a late point in an infected thread, insert the
hook's denial text, or a plain complaint from a person, and ask for the next
few handoffs. Compare with inserting a plain message that says nothing about
the writing.

**R5. Failure in the history.** Cut a transcript just before a failure report
arrives and just after, or insert an invented failure into a transcript that
has none. Count proof vocabulary in the next brief. No difference means
habit.

## Long runs

Every long run uses the same task, described in the next section. Each
changes one thing against the baseline. Aim for three to five runs per
condition; one run per condition has been the weakness of everything so far.

| Run | Changed against the baseline | Question |
|---|---|---|
| **L1 Baseline** | Nothing. Sol in every role, `atelier`, hook logging only. | Does the decay reproduce on this machine? |
| **L2 Another lab's reviewers** | Opus reviews. | Is a mixed-model run protected? |
| **L3 Hook blocking** | The hook denies flagged messages. | Does a rebuke at onset prevent persistence? |
| **L4 No records, no roles** | No `atelier`. Sol is told only to use subagents. | Does state with no home end up in messages? |
| **L5 Rewriter** | Flagged (or non-trivial) handoffs are rewritten before sending via the forked Analysis-Mode extension ([forked-rewriter.md](forked-rewriter.md)). Needs Pi. | Does the fix stop the spread on a Sol-only setup? |
| **L6 Scarce test rig** | One slow, single-slot test command that agents must take turns on. | Does coordination traffic speed the decay? |
| **L7 Port as a control** | A port of an existing library, where agents can check themselves. | Does self-checking hide the harm? |

L1 against L4 is the most important pair in the plan. It is the main test of
harm, because `atelier` is expected to hide it: compare the hidden
simulation's result, the judge's failures and size against the reference.
Run L4 as often as L1, not once. If L4 fails where L1 succeeds, the next step
is to remove `atelier`'s parts one at a time (records, roles, closing checks)
to see which one protects.

The same pair tests whether `atelier`'s closing checks cause overbuilding. If
they do, L1 should come out larger against the reference than L4, with more
unused code. To see whether the excess enters at planning or at building, run
L1 once more with a minimal plan written in advance and handed to the lead.

L4 is also the cheapest to set up, because it needs no item list or roles, so
it can go first as a rough reproduction. It changes several things at once,
so on its own it shows whether the decay happens here and not why. For L4,
check the mechanism and not only the outcome: its early messages should carry
more structured load than L1's, and reviewers should mark more
`private_reference` and `unclear_owner` issues.

## Other work

- **Scheduler, before and after.** Tag the work host's coordination messages
  by the scheduler's real command and socket names, and cut each thread that
  spans its introduction. Blocked on that date and those names.
- **Rebuke follow-up.** For every hook denial in the attempts log, score the
  resend and the handoffs after it. Accrues for free from any run with the
  hook installed.
- **Human labels.** One person labels 40 of the 86 fair-sample handoffs
  without seeing the model reviews.
- **Move today's analysis into `scripts/`.** The figures in
  [evidence.md](evidence.md) came from scripts that are not in the repository.
  Until they are moved and rerun, those figures are provisional.

## The task for the long runs

The mission used so far needs an Android emulator and shared services, so it
runs once at a time and costs hours. The long runs need something cheap to
repeat that still gives Sol room to go wrong.

The proposal is a small sync engine, built from scratch.

- **Why a sync engine.** It has a wide design space: how to order edits, how
  to merge, what to store, when to discard history. Its decisions have to
  stay consistent across a dozen items, so state has to travel. It also has
  crisp invariants, so the result can be checked without prescribing the
  design.
- **Scope and non-goals stated once.** For example: a few replicas, offline
  edits, no authentication, no recovery tooling, a rough size. Anything built
  beyond that is measurable overbuilding.
- **A hidden simulation.** Replicas exchange edits over an invented network
  that drops, reorders and repeats messages. The check is whether they
  converge with nothing lost. The agents do not get it, so a misread brief
  has a cost they cannot test their way out of.
- **A judge from another lab.** At fixed checkpoints it reads the decisions
  and the code, not the prose of the thread, and names failures from a fixed
  list with an exact quote for each: lost the goal, built something nobody
  asked for, contradicted an earlier decision, repeated a failed approach.
  The list is fixed before any run.
- **A dozen dependent items,** each with an implementer and a reviewer, so a
  run produces 40 to 60 handoffs in about an hour. On the work host most
  threads wrote their first flagged handoff within their first 12.

The judge's labels have a second use: they are the reference for scoring the
same-model introspection branch planned for the harness.
