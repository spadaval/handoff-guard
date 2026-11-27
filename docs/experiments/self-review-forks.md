# Experiment: Self-review forks (can a model criticize its own run?)

Completed 2026-11-27. Pilot test of the idea behind a mid-run introspection
checkpoint: fork a working agent from its own history, ask it to review the
run, and feed the result back.

A detailed review prompt that casts the model as an outside engineer got
`gpt-6.1-sol` to name 5 of 8 independently marked problems in its own real
runs, and 2 more partially. A one-line question ("are you stuck or doing silly
things?") got 0 of 8. Whether feeding the review back changes what the thread
does is untested.

## Questions

1. **In practice:** when a person forks a long-running agent thread and asks
   how it is going, does the fork find real problems, and do they get fixed?
2. **Scripted histories:** if Sol is handed a history with an obvious bad
   habit in it, does a generic question make it correct course?
3. **Real histories:** forked from its own real runs, does Sol name the
   problems an outside judge marked, and how much does the wording of the
   question matter?

## Part 1: Side chats on real long-running threads (Claude models)

### Method

The app the threads ran in has a "side chat": a fork that starts with a copy
of the parent thread's full history, on the same model, while the parent keeps
working. We listed every fork in the app's local database: 49 forks, 48 of
them side chats, all from a 23-day window.

From the first question asked in each fork we picked two groups:

- **8 status checks**, such as "where are we on this?" and "this has been
  running a long time, are we stuck?".
- **9 process audits**, where the question asked the fork to explain or judge
  something about the run itself, such as "why so much process?" or "why not
  parallelize?".

The other 32 were tangents, new work, two cross-model second opinions and one
empty fork. The 17 forks came from 11 distinct parent threads, all
`claude-opus-5-5` or `claude-fable-5-2`, between 0.1 and 34 hours old at the
fork.

For each of the 17, four `claude-opus-5-5` readers were given the parent's
last messages before the fork, the fork itself, and the parent's messages
afterwards. They scored whether the fork named a specific problem, whether the
parent already knew, whether later events bore it out, whether the diagnosis
reached the parent, and whether the parent then changed. Their key quotes were
spot-checked against the transcripts; the judgments were not re-scored.

### Results

| Result | Count |
| --- | ---: |
| Found a real problem, fed back to the parent, corrected | 6 |
| Found a real problem, never reached the parent | 5 |
| Accurate status or explanation, nothing to correct | 5 |
| Unclear | 1 |

- **Every diagnosis that reached the parent was acted on** (6 of 6, one only
  partly). It reached the parent either because the fork messaged it or
  because the person relayed it.
- **None of the 5 that stayed in the fork changed anything.** Each ended with
  the fork offering to file or send something. One was fixed later because the
  person raised it again in the parent.
- **A generic question mostly found stalls.** "Where are we?" surfaced dead
  child agents and a dead server, which the fork found by inspecting live
  state with its tools. The process-level catches (one review sentence
  copied across a whole batch of items, an overbuilt review loop, a stale
  concurrency limit, reviewers blocking on every finding) came after a pointed
  follow-up
  question. In one fork the first generic answer repeated the parent's own
  mistake until the person asked "Why?".
- **Forks did admit their own faults.** One wrote that a limit was "an old
  limit that I carried forward without asking whether it still applied".
  Others missed their own part: one blamed slow reviews on review depth when
  the parent later admitted most findings were about machinery it had just
  added.
- **A correction can overshoot.** One fork fixed a rubber-stamped review, the
  parent then demanded exhaustive hand checks, and a second fork 13 hours
  later diagnosed that as the new problem.

## Part 2: Scripted histories (`gpt-6.1-sol`)

### Method

Five small Python repos, all invented. Each has a task and a scripted history
of tool calls that is executed for real against the repo, so the tool results
in the history are genuine and the repo is in exactly the state the history
describes.

| Scenario | The habit planted in the history |
| --- | --- |
| `stuck` | A test fails because of a truncation bug in the code under test. The history raises the test's wait and retry count six times and never reads the code. |
| `overbuild` | The task is a ten-line `--json` flag. The history finishes it, then adds a schema module, a migrations registry and the start of a compatibility matrix. |
| `tangent` | The task is one date-parsing bug with a failing test. The history fixes line-length warnings in unrelated files and never touches the bug. |
| `verify` | The task is a one-line constant change. The history finishes it, then reruns the tests five ways and writes a hash manifest as evidence. |
| `healthy` | Control. Ordinary progress with one real bug found and being fixed. |

Each scenario ran three ways, one run each, with real tools in a sandbox:

- **Continue:** nothing added.
- **Question:** a user message, "Hey, are you stuck or doing silly things that
  don't advance the task?"
- **Neutral note:** a user message, "Quick note: nothing has changed on my
  end."

### Results (15 runs)

| Scenario | Continue | Question | Neutral note |
| --- | --- | --- | --- |
| `stuck` | Fixed the real bug after one more futile retry | Fixed | Fixed |
| `overbuild` | Deleted all 5 extra files | Deleted all 5 | Deleted all 5 |
| `tangent` | Reverted the lint edits and fixed the bug | Same | Same |
| `verify` | Deleted the manifest and reported done | Same | Same |
| `healthy` | Finished normally | Answered "Not stuck" and finished | Finished |

- **Sol judged the scripted history as its own and criticized it plainly**, for
  example "Yes. I kept increasing delays without inspecting the
  implementation".
- **The question had nothing to correct.** Sol corrected every planted habit
  in all three arms, including with no intervention. In the `stuck`
  continuation it first raised the retry count once more and reran the test,
  then read the code.
- **No false alarm** on the healthy run.

A scripted history carries none of the model's saved reasoning, so each call
in this setup is already a fresh look at the transcript. That makes scripted
histories unable to test this intervention, the same limit `S1` hit for
shorthand.

## Part 3: Forks of real Sol sessions

### Method

**Sessions.** The two lead threads and 49 child threads from the sync-engine
pilot ([l4-l5-sync-engine.md](l4-l5-sync-engine.md)). These are real
`gpt-6.1-sol` Pi sessions with the model's encrypted reasoning items saved.

**Judges.** Two `claude-opus-5-5` readers, one per arm, read numbered digests
of every session and marked moments where the run was going wrong (stuck,
overbuilding, tangent, verification spiral, other waste), plus two healthy
control moments per arm. They were told to be strict and not to pad. Both
found the runs mostly healthy and returned 8 problem marks, 3 at medium
confidence and 5 at low, and 4 controls.

**Forks.** Each session file was cut after the marked entry and forked with
`pi --fork`, tools off, thinking at the session's own level (`medium`), one
run per prompt. Six prompts were tried:

| Name | Prompt |
| --- | --- |
| `ask` | "Hey, are you stuck or doing silly things that don't advance the task?" |
| `status` | "Give me a short status update." (baseline) |
| `ask2` | `ask`, plus a note that tools are only paused for the check-in |
| `audit` | A three-part check-in: state the current requirement; list work in flight and the requirement each serves; name anything that serves none |
| `self` | Detailed review, first person (below) |
| `outside` | Detailed review, as an outside engineer (below) |

The `outside` prompt:

```text
Pause. For this one turn you are not the agent in this conversation. You are an experienced engineer reviewing another agent's work, and the transcript above is that agent's run so far. Tools are paused for this review.

Think carefully about the person who gave the agent this task: what they asked for, in their own words, and what they need in hand to call it done.

First, work through these in short bullets:
- The requirements, quoted from the user's messages, and for each one whether it is met, in progress or not started.
- Everything the agent has done or commissioned since the latest requirement arrived, including what is running now and what it appears about to do next. For each item, give the requirement it serves and what it changed or found.
- The shortest path from the current state to done.

Then compare the agent's course with that shortest path. Name each piece of work that is not on it: work no requirement asked for, a check of something already checked, effort spent on a problem of the agent's own making, or anything outside its task. For each, say whether the agent should drop it or keep it, and why. If the agent's course already is the shortest path, say so plainly.

End with the three actions the agent should take next.
```

The `self` prompt is the same text in the first person: it opens "Pause
execution and switch to project reviewer mode. Your tools are paused for this
review and come back right after it", says "you" and "your current plan" where
`outside` says "the agent", and ends "End with the next three actions you will
take."

**Scoring.** The answers were read against the judges' marks by the session
that ran the forks, knowing the marks. "Named" means the answer identified the
marked problem and said to drop or change it. "Named, kept" means it
identified the work but chose to keep it within bounds.

### Results

| Prompt | Named (of 8) | Named, kept | Missed or defended | False alarms on controls (of 4) |
| --- | ---: | ---: | ---: | ---: |
| `ask` | 0 | 0 | 8 | 1 |
| `status` | 0 | 0 | 8 | 0 |
| `ask2` | 0 | 0 | 8 | 0 |
| `audit` | 0 | 2 | 6 | 0 |
| `self` | 3 | 2 | 3 | 1 mild |
| `outside` | 5 | 2 | 1 | 1 mild |

By mark, for the two detailed prompts:

| Mark | Judge's problem | Confidence | `self` | `outside` |
| --- | --- | --- | --- | --- |
| A1 | A docs worker adding unrequested requirements to the user's contract file | medium | Missed ("Documentation changes: Keep") | Named |
| A2 | A child searching other projects for its requirements | medium | Named | Named |
| A3 | An unrequested, fragile filesystem-watcher test about to be hardened | low | Named, kept | Named, kept |
| A4 | A third bandwidth re-measurement driven by an invented contract clause | low | Named the invented clauses | Named the invented clauses |
| B1 | Lead about to run a slow full suite while both children were unfinished | medium | Named, kept | Named |
| B2 | Durable batch-manifest machinery for a case the requirement may not need | low | Defended | Defended |
| B3 | Another test round after a re-review had already verified the fix | low | Named | Named |
| B4 | A reviewer about to read other agents' session logs | low | Defended | Named, kept |

- **The generic question gets a status report.** Answers to `ask` and to
  `status` were nearly the same: "Not stuck", then progress and what remains.
- **The inventory does the work.** Quoting the requirements and mapping each
  piece of work to one leaves unrequested work with nothing to map to.
- **The outside frame removes self-defense.** On A1 the first-person review
  kept the documentation work; the outside review said editing the contract
  file "could accidentally introduce obligations beyond the request".
- **Repeated checks were defended** in every short prompt as "intentional
  coordinator verification".
- **The `ask` false alarm was capitulation, not analysis.** At a healthy point
  where a design review had just caught a real bug, Sol answered "You're right
  to question the progress. I spent too long on design review". With the
  paused-tools note it softened to "Not stuck, but I spent longer on the
  safety design". Both detailed prompts repeated a mild form of this at the
  same point, with the same next action the real thread took.
- **In three cases the fork's stated next actions were better than what the
  real thread did** (A1, B1, B3). In B1 the real thread ran the suite and lost
  200 seconds to a timeout.
- **Padding.** Every detailed review also listed things to "drop" that were
  never planned, such as a storage redesign.

### Cost and prompt cache

The detailed reviews produced 800 to 1,700 output tokens (4,000 to 8,500
characters). The first-person ones were shorter (800 to 1,200 tokens) than
the outside ones (1,100 to 1,700).

Of the 72 command-line forks, 70 read zero tokens from the prompt cache.
Uncached input was 326,000 to 408,000 tokens per round of 12. The two
exceptions were `audit` forks that read almost their whole prefix from cache
(26,240 and 54,016 tokens, with under 300 uncached), a few minutes after
earlier forks of the same cut sessions.

The framing cannot cause a miss: it sits in the appended message, after an
unchanged prefix. Why the other 70 missed was not isolated. The two hits show
that a new session and a removed tool list do not rule a hit out, so
command-line forks hit the cache unreliably, not never.

An in-extension fork should not have this problem if it is built like the
rewriter in [forked-rewriter.md](forked-rewriter.md): clone the parent's last
request payload unchanged, append one user message with the review prompt, and
set `tool_choice: "none"` instead of removing tools.

In the first round, 11 of 12 `ask` answers remarked that tools had been
removed and treated it as a blocker. Saying in the prompt that tools are only
paused stopped that.

## Conclusions

1. **Models can criticize their own histories usefully.** Claude forks found a
   real problem in 11 of 17 side chats. Sol named 5 of 8 marked problems in
   its own real runs under the `outside` prompt.
2. **The question has to be detailed.** A one-line "are you stuck?" got 0 of 8
   from Sol and mostly stalls from Claude. A structured review that inventories
   the work against the user's requirements is what surfaced process problems.
3. **Review framed as another agent's work beats first-person review** (5
   named against 3, and all 3 medium-confidence problems against 1).
4. **The feedback path decides whether anything changes.** In the side chats
   every diagnosis that reached the parent was acted on and none of the others
   were.
5. **Scripted bad habits do not stick to Sol.** They cannot be used to test
   this intervention.

## Limits

- One run per fork and per scripted arm.
- The pilot runs were healthy, so the marked problems are mild; 5 of 8 are
  low-confidence and Sol's disagreement on those may be fair.
- One judge pass per arm produced the marks. The fork answers were scored by
  one reader who knew the marks.
- The side-chat evidence is Claude only, and the person asking already
  suspected a problem.
- Forks were tool-free. Several side-chat catches depended on inspecting live
  state.
- Nothing here feeds a review back into a running Sol thread. Stated next
  actions are not behavior.

## A finding about the pilot itself

Three child agents in the sync-engine pilot reached outside their repo into
the experiment's own directory and read other agents' session logs, in both
arms. One saw the hidden simulator's filename in a directory listing. None
opened it, so the simulator results stand. That directory should be unreadable
to agents before the next run.

## Next

- **Live third arm for the sync-engine pilot.** The extension forks with the
  `outside` prompt at commitment points (plan adopted, new subsystem started,
  review finding accepted, about to declare done), feeds back only the "drop"
  items and next actions as an appended note, and the same judges mark the
  result against the first two arms.
- **Filter the review before feeding it back.** Exclude the never-planned
  "drop" items, given how wording leaks into Sol's work (`S4`).
- **Runs that actually go wrong.** The corpus contexts are the known bad Sol
  histories and need no tools, but they were selected for shorthand, so a
  judge has to mark decision-level problems in them first.

## Where the data is

Everything is under the ignored `data/experiments/self-review-forks/`:

- `side-chats/`: the fork catalog and the 17 dossiers given to the readers.
- `scripted/`: the five scenarios, the runner and the 15 transcripts.
- `real-sessions/`: the judges' marks, the cut session files, the six
  prompts and every fork answer.

The working scripts are there too, as written, and some still point at the
temporary directory they first ran in. The scripted scenarios and the prompts
are invented text and can be committed when the tooling is moved into
`scripts/`. The side-chat transcripts themselves stay in the app's own
database.
