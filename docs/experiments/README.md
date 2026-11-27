# Research plan: why Sol's handoffs decay, and what stops it

This folder holds the plan and completed experiments following
[the corpus findings](../findings/README.md). It sets out what we think is
happening, which parts have evidence, what we can vary, and which experiment
tests which part. When an experiment finishes, write up its result in its own
file here (or move durable headline numbers into the findings) and update the
claim it tested.

Each write-up's raw data (sessions, transcripts, scripts as run and model
outputs) is in the ignored `data/experiments/<name>/`, named after the
write-up. None of it is in Git.

Last updated 2026-11-27.

## Contents

- [proposed.md](proposed.md) — specs for the proposed single-message tests
  (`S1`–`S4`), replays (`R1`–`R5`), long runs (`L1`–`L7`), and the sync-engine
  benchmark task.
- [l4-l5-sync-engine.md](l4-l5-sync-engine.md) — protocol for the sync-engine
  A/B pilot (`Pi raw` vs. `Pi + v4 rewriter`).
- [s5-synthetic-stressors.md](s5-synthetic-stressors.md) — **next up:**
  6-rung synthetic stressor ladder in Pi to isolate what actually triggers
  Sol's shorthand before designing a harder long-run task.
- [evidence.md](evidence.md) — provisional observational figures from the
  2,920-handoff Sol corpus, grouped by claim.
- **Completed experiments:**
  - [forked-rewriter.md](forked-rewriter.md) — offline and live Pi validation
    of a forked Analysis-Mode handoff rewriter (`v1`–`v4` prompt comparison,
    `6.2-sol` cross-check, and prompt-cache verification).
  - [s1-s2-cold-writing.md](s1-s2-cold-writing.md) — `S1` (fresh context:
    load, topic, model-version curve) and `S2` (named recipient).
  - [s3-reading-test.md](s3-reading-test.md) — `S3` reading comprehension test
    on 16 real corpus handoffs (Sol and Opus, original vs. plain rewrite).
  - [s4-planning-test.md](s4-planning-test.md) — `S4` planning overbuilding
    test across 4 models and 4 closing-check wordings (including `Agent
    Factory`).
  - [s5-onset-probes.md](s5-onset-probes.md) — `S5` onset probes: a length
    budget or incoming shorthand starts Sol's shorthand in a clean thread;
    context depth alone does not.
  - [self-review-forks.md](self-review-forks.md) — forking an agent from its
    own history to review the run: a detailed outside-reviewer prompt got Sol
    to name 5 of 8 marked problems in its real pilot runs; a one-line "are
    you stuck?" got 0.

## The question

`gpt-6.1-sol` writes agent-to-agent messages in a compressed shorthand, and in
long multi-agent runs the shorthand gets worse and the work drifts. We want to
know what starts it, what keeps it going, whether it does damage, and what a
harness can do about it on a machine where Sol holds every role.

## The model

We think the decay is a chain. Each link is a separate claim with its own test.

| | Claim | Evidence so far |
|---|---|---|
| **A** | **Trigger.** A message that must carry a lot of structured state tips the writer into a compressed register. | Observational, fairly strong—but [S1 fresh](s1-s2-cold-writing.md) got `0/72` flagged even at 60 facts, so cold-start load alone is not enough. [S5 onset](s5-onset-probes.md): load under a length budget triggers it on turn 1 (`4/4` style-blocked at a 4,000-char cap, `0/2` uncapped); 170K tokens of depth alone does not (`0/4`). |
| **B** | **Spread.** A thread that reads shorthand is more likely to start writing it. | Observational, moderate. First causal support in [S5 onset](s5-onset-probes.md): a lead given a shorthand brief wrote a style-blocked handoff in `3/4` runs, against `0/2` with the plain brief. |
| **C** | **Persistence.** Once a thread has written shorthand it keeps writing it, and clean input does not pull it back. | Observational, strong. |
| **D** | **Mode.** The habit belongs to messaging mid-work. The same agent writes plainly when it answers or is asked a direct question. | Observational, strong for final reports. Pilot support in [forked-rewriter.md](forked-rewriter.md) (`12/12` on both `6.1-sol` and `6.2-sol`). |
| **E** | **Reader.** The sender writes for a copy of itself: it assumes the reader knows its private labels, and still restates state the reader could look up. | Mixed: [S2](s1-s2-cold-writing.md) showed zero audience adaptation in fresh context; [S3](s3-reading-test.md) confirmed `3.1–5.2` undecodable private references per message even after plain rewrites. |
| **F** | **Harm.** The shorthand buries the intent, and over a long run the task drifts. | First direct evidence in [S3](s3-reading-test.md): on hard `[unclear:]` handoffs, plain rewrites cut errors for both Sol (`1.90 → 1.40`, `5–2`) and Opus (`2.10 → 1.70`, `8–2`). Long-run drift (`L4`) untested. |
| **G** | **Remedies.** A rebuke at the moment of writing resets a thread. Rewriting flagged messages before they are sent stops the spread. Mixing in another lab's model protects a run. | Two hook denials, both followed by clean handoffs. One clean mixed-model run. Forked rewriter validated offline (`6.1`+`6.2-sol`) and in live Pi with 100% prefix cache hits ([forked-rewriter.md](forked-rewriter.md)); long-run spread (`L5`) untested. |

**`atelier` is a remedy already in place, which is why harm is hard to see.**
It keeps state in records instead of handoffs and refuses to close an item
until its checks are met. Both limit the damage a bad handoff can do, in the
same way a port does by letting agents check their own work. So a run with
`atelier` can show the shorthand and still finish correctly. That splits
claim F into two questions:

- **What does the shorthand cost with no protection?** Only runs without
  `atelier` can show this.
- **What does the protection cost?** With `atelier`, the price may be paid in
  overbuilding, review rounds and allowance instead of in wrong results.

Two traits look like part of this and are not, on current evidence. They are
tracked because they share a cause or confuse the measurements:

- **Proof vocabulary.** Sol's handoffs are full of words about proof,
  evidence and exactness. It is there from a thread's first handoff, with no
  failure behind it, and it appears in runs that have no shorthand.
- **Overbuilding.** Sol builds verification and recovery machinery nobody
  asked for. Tests do not penalize it, so it needs its own measure.

## What we can vary

| Variable | Settings | Claim |
|---|---|---|
| Structured load in the message | 5, 20 or 60 facts | A |
| Kind of state | plain status, or coordination state (holds, confirmations, windows) | A |
| Depth in the thread | fresh context, or deep in a long transcript | A, C |
| The thread's own earlier messages | as written, or replaced by plain rewrites | C |
| What the thread has received | shorthand, or plain prose | B |
| Who the message is for | Sol, another model, or a person | E |
| How the message is asked for | continuing the work, or answering an outsider | D |
| Who else is in the run | Sol in every role, or another lab's reviewers | B, G |
| Where state can live | `atelier` records, roles and closing checks, or messages only | A, E, F, G |
| Model version | `gpt-6.1-sol` and the versions before it | all |
| The hook | absent, logging only, or blocking | G |
| The rewriter | off or on | G |
| A scarce shared resource | none, or a single-slot test rig | A |
| Whether agents can check their own work | a build with a hidden check, or a port with an oracle | F |

The harness (Codex or Pi) is not a variable we care about. Pi matters only
because it lets us add the rewriter and replay plaintext transcripts.

## What we measure

| Measure | What it captures | Cost |
|---|---|---|
| Guard flag | Would the hook have blocked the message. | Free. |
| Fused-word runs | Lowercase letter runs that split into known words. Uses letters only, so glued numbers cannot make it circular. | Free. |
| Structured load | Numbers, hashes, paths, all-caps tokens and symbols per 100 characters. | Free. |
| Proof vocabulary | Words about proof, evidence and exactness per 1,000 letters. Crude word list. | Free. |
| Rubric review | Intent, content and presentation scores from a model reviewer, each tied to a quote. | A model call per message. |
| Hidden simulation | Whether the built sync engine converges with nothing lost. | Seconds per run. |
| Judge's failure list | Named failures from a fixed list, each with a quote, from another lab's model at fixed checkpoints. | A few model calls per run. |
| Size against a reference | Lines built against a reference implementation, and test lines against code lines. | Free. |
| Unused code | The share of the built code that the hidden simulation and the required-feature tests never execute. | Seconds per run. |
| Non-goals broken | How many stated non-goals the result builds anyway, each one pointed to by the judge. | A model call per run. |
| Planned items outside the scope | In a plan, the items that serve nothing in the stated scope. | A model call per plan. |

The first four are scored on every message. The rest exist only for the long
runs and the planning test. The simulation and the judge's list are the only
measures of claim F. The last four measure overbuilding. No single one of
them is enough: size confuses verbose with excessive, and unused code counts
legitimate error handling. Report them together.

## Four kinds of evidence

Cheapest first. Each kind answers what the one before it cannot.

1. **Corpus analysis.** Free, and already done for most claims. It cannot
   show cause: on the work host, depth, load, the thread's own history and
   what it had read all grow together.
2. **Single-message tests.** Give Sol an invented state and ask for one
   message, or give a recipient one message and ask what it says. Hundreds of
   samples in minutes, with one variable changed at a time. They cannot show
   anything that takes a long context to appear.
3. **Replays.** Take a real long transcript, change one thing in it, and ask
   for the next message. This is the causal test for anything that depends on
   history. It needs plaintext transcripts of infected threads, which this
   machine does not have until a long run produces them.
4. **Long runs.** A whole multi-agent task, start to finish. The only way to
   see spread, drift and harm in the wild. Expensive, so each condition gets
   few runs and should answer one question.

## Experiment matrix

Which experiment tests which claim (see [proposed.md](proposed.md) for full
methods):

| | A Trigger | B Spread | C Persist | D Mode | E Reader | F Harm | G Remedy | Status |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| [Forked rewriter](forked-rewriter.md) | | | | ○ | ○ | | ● | **Done (pilot)** |
| [S1 Load, topic, depth](s1-s2-cold-writing.md) | ● | | ○ | | | | | **Fresh done** / Deep waits for L1 |
| [S2 Named recipient](s1-s2-cold-writing.md) | | | | | ● | | | **Done (pilot)** |
| [S3 Reading test](s3-reading-test.md) | | | | | | ● | | **Done (pilot)** |
| [S4 Planning test](s4-planning-test.md) | | | | | | | | **Done (pilot)** |
| R1 Messaging against answering | | | | ● | | | ○ | Proposed |
| R2 Rewrite the thread's own history | | | ● | | | | ○ | Proposed |
| R3 Swap what the thread received | | ● | | | | | | Proposed |
| R4 Insert a rebuke | | | ● | | | | ● | Proposed |
| R5 Failure in the history | | | | | | | | Proposed |
| L1 Baseline run | ○ | ○ | ○ | | | ○ | | Proposed |
| L2 Another lab's reviewers | | ● | | | | | ● | Proposed |
| L3 Hook blocking | | | ● | | | ○ | ● | Proposed |
| L4 No records, no roles | ● | | | | ● | ● | ○ | Proposed |
| L5 Rewriter | | ● | | | | ○ | ● | Proposed |
| L6 Scarce test rig | ● | | | | | | | Proposed |
| L7 Port as a control | | | | | | ● | | Proposed |

● is the main test of the claim. ○ gives supporting evidence. `R5` tests the
proof-vocabulary trait, which is outside the chain. So does `S4`, the planning
test, for overbuilding; the long runs measure overbuilding too, most usefully
`L1` against `L4`.

## Order of work

1. **S1 and S2.** They need nothing but invented states, they test the
   trigger directly, and the states can be committed as fixtures.
2. **Build the sync task,** then run **L4** and **L1**.
3. **If neither decays,** stop and find what the work host had that this
   machine lacks. `L6` is the first thing to try, since the work host had a
   scheduler. Nothing else in the plan means much until the decay reproduces.
4. **If they decay,** the transcripts unlock the replays. Run **R1 to R4**,
   which settle claims B, C and D far more cheaply than long runs can.
5. **L2 and L3,** to see what protects a run.
6. **L5,** the test of the fix, using the rewriter pattern validated in
   [forked-rewriter.md](forked-rewriter.md).
7. **S3** can run at any point. It is the only cheap test of harm.

## Running now

**A harness comparison on a real mission,** run from another project. Sol
leads and implements, Opus reviews, and the hook blocks. The Codex arm is at
2 flagged first drafts of 53. The matching Pi arm is on hold, because with
the same Sol lead and Opus reviewers it would also be clean. The Codex arm is
still worth finishing: it is a long Sol context with little Sol shorthand
coming in, so if it stays clean to the end, depth alone is not the cause.
