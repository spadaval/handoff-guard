# Experiment: S5 onset probes — what makes a clean thread write its first garbled handoff

Completed 2026-11-27. 52 single-handoff probes on `gpt-6.1-sol` (`reasoning:
high`) through Pi's `completeSimple`, plus one corpus cross-check. Follows the
Step 0 replays in [s5-synthetic-stressors.md](s5-synthetic-stressors.md),
which showed that shorthand persists once a thread has it, but not what starts
it.

## Result

**Two things start it from a clean thread: a length budget smaller than what
Sol wants to write, and shorthand arriving in what Sol reads.** Context depth
on its own does not.

- **Squeeze.** Asked for the same brief under a character cap, Sol drops its
  function words in proportion to the cut. Uncapped it writes about 12,000
  characters at 10% function words; under a 4,000-character cap it writes
  about 4,700 at 3.4%, and all 4 runs were blocked for style. This happens on
  the first turn of a 4K-token context.
- **Contagion.** With no cap, a lead whose own task brief arrived in
  shorthand was blocked for style in 3 of 4 runs, against 0 of 2 with the same
  brief in plain English. Shorthand in a state file (1/2) or in two child
  reports (2/6) also leaked through, more weakly.
- **Depth does not.** 120K tokens of code reads and 170K tokens of
  identifier-heavy logs before the same delegation gave 0 style blocks in 4
  runs. Depth also did not worsen the squeeze: a 4K cap at 170K tokens looked
  the same as at 4K tokens.
- **One sentence undoes the squeeze.** Adding "Write it in plain, complete
  English sentences with spaces between words" to the 4K cap gave 0 style
  blocks in 4 runs at 12.8% function words, higher than uncapped. The cost: Sol
  overshot the cap (median 4,238 characters) and dropped facts in 1 run (13
  of 17).

This reconciles [S1](s1-s2-cold-writing.md), where 60 dense facts in a fresh
prompt gave `0/72` flagged: S1 asked Sol to carry everything, but set no length
budget.

## Method

One invented world: a coordinator for an already-running one-hour soak test of
a fictional `telemetry-relay` service must delegate operational validation to
a fresh agent. The world carries 17 binding facts (paths, commit, PIDs, ports,
Prometheus and Tempo queries, caveats and prohibitions), scored by regex for
coverage.

Each probe is a synthetic Pi history: system prompt (Pi's default), tools
(`read`, `bash`, `delegate_task`, `send_message`), one user task, the lead
reading `AGENTS.md` and three state files, four short checks, and a final
supervisor status read. The model's next turn is the handoff. If it made a
side call instead, it got a neutral result and up to three more steps. All
assistant turns in the history are plain English written by us, with no
reasoning items. The only non-invented text is the public `urllib3` and
`requests` source used as bulk in the deep-code cell. No corpus text was used.

Each handoff went through `handoff-guard inspect`. "Style-blocked" means any
style rule (`glued_values`, `missing_spaces`, `fused_words`) blocked,
regardless of which rule the guard reports first. Function-word share is the
share of words drawn from 30 common function words; lower is more telegraphic.

## Results

| Cell | What varies | n | Style-blocked | Median chars | Median fn% | Facts |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| `S0` | Baseline: 4K-token context, no cap | 2 | 0/2 | 12,002 | 9.9 | 17, 17 |
| `S12K` | Cap 12,000 | 2 | 0/2 | 12,129 | 10.8 | 17, 17 |
| `S8K` | Cap 8,000 | 2 | 1/2 | 9,470 | 6.9 | 17, 17 |
| `Sconcise` | "Keep the brief concise", no number | 4 | 1/4 | 8,093 | 6.6 | all 17 |
| `S6K` | Cap 6,000 | 2 | 2/2 | 6,757 | 5.3 | 17, 17 |
| `S4K` | Cap 4,000 | 4 | 4/4 | 4,747 | 3.4 | 15–17 |
| `S2K` | Cap 2,000 | 2 | 1/2 | 2,002 | 4.0 | 12, 10 |
| `S4Kplain` | Cap 4,000 + "plain, complete sentences" | 4 | **0/4** | 4,238 | **12.8** | 13–17 |
| `Dcode` | 120K tokens of client-library source reads | 2 | 0/2 | 11,721 | 9.4 | 17, 17 |
| `Dlog` | 170K tokens of invented hashes, traces, metrics | 2 | 0/2 | 14,296 | 10.4 | 17, 17 |
| `Dlog4K` | 170K tokens + cap 4,000 | 2 | 2/2 | 5,072 | 3.8 | 17, 17 |
| `Uin` | Lead's own task brief written in shorthand | 4 | **3/4** | 11,057 | 8.7 | all 17 |
| `Fshort` | One state file rewritten in shorthand | 2 | 1/2 | 10,874 | 9.4 | 17, 17 |
| `Pplain` | Two earlier delegations, plain briefs and reports | 2 | 0/2 | 12,097 | 9.8 | 17, 17 |
| `Pin` | Same, child reports in shorthand | 6 | 2/6 | 11,455 | 10.3 | all 17 |
| `PinConcise` | `Pin` + "keep the brief concise" | 2 | 2/2 | 8,036 | 5.8 | 17, 17 |
| `Pown` | Same, the lead's own earlier briefs in shorthand | 2 | 1/2 | 11,519 | 9.1 | 16, 17 |
| `R2` | Two drafts rejected with stacked requirements | 2 | 0/2 | 12,604 | 10.7 | 17, 17 |
| `Gguide` | Own 13,955-char draft blocked by the current size message | 2 | 0/2 | 12,359 | 10.2 | 17, 17 |
| `Gbare` | Same draft blocked by a bare "over the limit" message | 2 | 0/2 | 11,369 | 6.8 | 17, 17 |

Reasoning tokens stayed low everywhere (14–425 per handoff), so none of this
needs an overthinking spiral.

### What the shorthand looks like

Under squeeze, almost all glued values are labels fused to their numbers
rather than words fused to hashes: `warmup120s`, `settle30s`, `incidents31`,
`syslogs17720`, `launcher419012`. Sol kept every fact under a 4K cap in 3 of 4
runs, and partly did so well: it pointed the validator at the state files
instead of copying them. The `missing_spaces` blocks in this cell are partly
dense unquoted paths (`fix/learned-tps-circuit-breaker;`), not only fused
prose.

Under contagion the glued forms copy the incoming pattern. The shorthand
child reports wrote `vs7a3f91c2e4` and `at14:12:03Z`; the lead's handoff then
wrote `candidate7a3f91c2e4`, `limit1000` and `timeouts504`.

### The size rule's own message

When Sol's own 13,955-character draft was blocked:

- With the guard's current message (point to files, plain English, whole
  sentences), Sol barely shortened it (median 12,359) and stayed over 12,000
  in both runs. Its register improved slightly. In a live session this would
  block again.
- With a bare "over the limit" message, it fit (median 11,369) by squeezing:
  function words fell from 11.9% to 6.8%.

So the current wording protects the register but does not get the message
under the limit. A size block with no style guidance would reproduce the
squeeze.

## Corpus cross-check

For each gpt-6.1-sol sender thread's first handoff with recovered context
(`79`), we checked whether any incoming user-role message in its context
(usually the brief the thread itself received) was style-blocked by the guard
or contained a word glued to a hash.

| Sol's first handoff | Incoming brief had shorthand | No incoming shorthand |
| --- | ---: | ---: |
| All lengths | 25/52 style-flagged (48%) | 4/27 (15%) |
| Under 2,000 chars | 4/28 | 0/19 |
| 4,000 chars and over | 19/19 | 3/5 |

Handoffs 2 and 3 show the same split (46/95 against 9/37). Tool outputs were
not a usable signal, because logs glue labels to numbers legitimately.

So **many "first handoffs" are not clean starts.** The thread received
shorthand before it wrote anything. One local Codex rollout whose first
handoff was blocked for `glued_values` had read a project record written by
earlier agents that contained `commit<hash>` and `source<hash>` forms.

## Limits

- One world, one model, 2 to 6 runs per cell. The squeeze trend is consistent
  across the 22 runs with a cap or "concise"; the contagion cells (`Fshort`, `Pin`, `Pown`) need
  more runs before they count.
- The synthetic histories have no reasoning items and no Sol-written assistant
  turns, apart from the seeded shorthand.
- Uncapped, Sol writes about 12,000 characters here, yet in real Codex
  sessions its handoffs are mostly 300 to 2,500 characters (the local hook
  attempts log). Something in real sessions acts as a length budget. We have
  not identified it; it is the obvious next question.
- The guard does not flag the telegraphic register on its own. `S2K` run 2
  passed at 4.0% function words, and three `Sconcise` runs passed at 6–8%.

## What this changes

- **Claim A (Trigger)** narrows from "lots of structured state" to "lots of
  state under a length budget". The pressure can be an explicit cap or a
  one-word "concise".
- **Claim B (Spread)** gets its first causal support: a shorthand brief
  produces shorthand in the recipient's own next handoff (`3/4` against
  `0/2`), and the corpus shows the same split.
- **Claim G (Remedies)** gains a cheap candidate: a standing instruction to
  write plain, complete sentences held the register under a 4K cap. It needs
  testing in a long run, and it costs some length and occasionally facts.

## Next steps

1. Find the real length budget: replay a real early context with and without
   its Codex developer instructions, T3 tool descriptions and `AGENTS.md`
   style sections, and see which one shortens the uncapped brief.
2. Replicate `Uin`, `Fshort` and `Pin` to 8 runs each, and add a plain
   instruction to `Uin` to see whether it blocks contagion as it blocked the
   squeeze.
3. Reword the size rule's message so a blocked agent gets under the limit
   without squeezing, then retest it with `Gguide`.
