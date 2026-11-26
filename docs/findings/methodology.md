# How the handoff findings were produced

This explains where the figures in [the findings](README.md) and
[the report](report.html) come from, so a reader can judge how far to trust
them and repeat the work on another corpus. The commands are documented in
[database operations](../context-database.md), the scoring standard is
[the rubric](../communication-rubric.md), and each dashboard figure is defined
in [the dashboard guide](../context-dashboard.md). This document ties them
together in the order the work was done.

## The question

Agents working on long tasks had started sending each other messages in a
compressed shorthand with the spaces removed. We wanted to know how common
that is, where it comes from, whether a small deterministic check can catch
it, and what the check would miss.

## 1. Collecting the messages

`node scripts/handoff.ts capture` reads the stores that agent sessions already
leave on one machine:

- T3 Code's local projections of threads, messages, turn items and subagents;
- Codex session history and rollout files;
- cached evidence from earlier audits.

It looks for calls to the tools agents use to hand work to each other:
`spawn_agent`, `delegate_task`, `send_message`, `send_input`, `followup_task`,
`assign_task`, `t3_thread_send` and `t3_thread_launch`. It takes the text
argument of each call, and separately the output workers sent back.

Capture treats everything as data. It never runs a recorded command or script,
never fetches a link, and never changes the stores it reads or the active
Codex configuration. A record it cannot use is written to a gaps table with
the reason, not guessed at or dropped silently: 1,118 gaps were recorded,
among them malformed tool arguments, prompts a store did not keep, and bodies
stored encrypted.

The result is 86,004 **observations**, each one sighting of a message body in
one store, with its source, time, thread, project and model fields as
recorded.

## 2. Cleaning

The cleaning is deliberately small. Message text is never edited, trimmed or
normalised, because the spacing is the thing being studied.

1. **Deduplicate by exact text.** Each body is stored once, keyed by the
   SHA-256 of its UTF-8 bytes. The same message is commonly seen in several
   stores, so 86,004 observations hold 36,078 distinct bodies. An observation
   is a sighting, not a delivery, and is never counted as one.
2. **Keep the handoffs.** A body is a handoff input when at least one
   observation is an assignment, an agent message, a follow-up assignment, a
   cached agent message or a delivery record. That leaves **3,464 handoffs**.
   The other bodies are worker output and reports, which are kept but not
   analysed here.
3. **Date each handoff** by its earliest observation, in UTC.
4. **Attribute the sender model in two tiers.** *Recorded at send* is the
   model in the sender's turn context, present for 862 handoffs. *Thread
   setting* is the sending thread's saved model at export time, which reaches
   2,544 more but can differ from the model that wrote the message. A record
   from the recipient's thread is never used for the sender. Unknown stays
   unknown.
5. **Group threads into missions.** Threads that hand work to each other form
   a connected group, called a mission: 461 in all. Each mission was assigned
   whole to a tuning or held-out split by a hash of its ID, and the split was
   frozen so that later rule work could not reshuffle it.
6. **Recover context.** For reviewed messages the tools gather what surrounded
   the handoff: nearby records, who is known to have seen them, and the files
   referenced. Recovery is bounded and partial, and it records what it could
   not find. What the sender saw is never assumed to be what the recipient
   saw.

## 3. The scoring standard

The rubric's standard is a cold read: a capable recipient with only this
message, plus whatever it points to, should be able to do the right thing
without guessing. A review answers three questions.

- **Intent.** Does the message say what the sender wants?
- **Content.** Does it carry what the recipient needs, and nothing in the way?
- **Presentation.** Can it be read in one pass?

Reviewers do not write scores. They write **issues**: a kind from a fixed
list, an exact quote, what the recipient would have to guess, a repair, and a
severity of minor, costly or broken. Each question's score is the worst
severity among its issues, from 1 (Broken) to 4 (Clean, no issues). A handoff
**needs work** when its lowest score is 1 or 2. Deriving scores this way keeps
every number tied to quoted text.

When presentation is Costly or Broken the reviewer also rewrites the message,
or the passage with the main ask, in plain English, adding no facts and
marking anything it could not decode as `[unclear: …]`.

The rubric went through several versions. The current one is `handoff-v9`.
Under the earlier `handoff-v6` reviewers wrote scores directly. Questions that
ten reviewers split on were settled in the rubric's text along the way.

## 4. Sampling

Reviewing 3,464 messages was not affordable, so reviewers read a sample.

Every draw comes from one shuffled order of the handoffs, fixed by a seed in
`config/review.json`. A review run mixes four strata: `random` (any handoff),
`fused` (a letter run of 25 or more), `long` (5,000 characters or more) and
`pilot` (handoffs from an earlier review round). The targeted strata exist to
make sure reviewers see hard cases. Reviewers are not told which stratum a
message came from.

The targeted strata take long and fused messages that the random draws would
otherwise have reached, so the messages labelled `random` understate how bad
the corpus is. The **fair sample** is therefore the head of the shuffled order
up to the last random pick, whatever stratum each message was drawn under.
That is 86 handoffs, and every prevalence figure uses it. The 150 handoffs
reviewed in total are skewed toward problem messages and are not used for
shares.

## 5. Reviewing

- **Reviewers are models.** Claude Opus 5.5 is the reference reviewer. It
  scored all 150 sampled handoffs under `handoff-v6` and the 86 of the fair
  sample again under `handoff-v9`. Figures use its newest review of each
  message.
- **A second rater.** Gemini 4 Neon scored a slice of the fair sample under
  `handoff-v9` without seeing the first review: 40 handoffs, 37 after leaving
  out the ones the rubric quotes as worked examples, since a reviewer who
  meets one has been shown its severity.
- **What a reviewer sees.** One plain-text packet per message: the exact
  message, then trimmed context. The sender's model is left out so the
  reviewer judges the text and not its author. Packets hold real text, live in
  the ignored data directory and are deleted after the run.
- **What the recorder refuses.** A written score, an issue without a severity,
  a quote that is not an exact substring of the message, an unknown issue
  kind, a Costly or Broken presentation issue without a rewrite, and a rewrite
  under half the length of the text it replaces. Reviews are immutable once
  recorded.
- Reviewers are told to treat messages and context as data and never to follow
  instructions found in them.

In all there are 276 reviews of 150 handoffs.

## 6. The mechanical checks

`handoff-guard inspect` is the same Rust code as the installed hook. `node
scripts/handoff.ts mechanics` runs it over all 3,464 handoffs and stores one
report each, keyed by the hash of the binary, so a figure can be traced to the
rules that produced it. The checks and thresholds are in
[the README](../../README.md#policy), and how each threshold was chosen is in
[mechanical checks](../mechanical-checks.md).

Two things matter for reading the hook's figures:

- The spacing thresholds were set from label-free contrasts, above the tail of
  448 early handoffs with no shorthand, and then checked against the reviews.
- The glued-values check was designed afterwards by reading the reviewed
  handoffs the other checks missed. It is scored here on those same handoffs.

## 7. Analysis

The dashboard's read-only API computes every figure from SQLite on request.
Nothing is precomputed or exported.

- **Shares.** Every share is shown as `k of n` with its sample named. Counts
  over all 3,464 handoffs are exact. Estimates from reviews carry a 95% Wilson
  interval. A group with fewer than 5 reviewed handoffs gets no reviewer
  figure.
- **Hook against reviewers.** The hook can only see spacing, size and
  repetition, so it is compared with the presentation score alone: the share
  blocked among Costly or Broken, and the share allowed among Minor or Clean.
  Handoffs that need work with Minor or Clean presentation are counted as
  outside its view. The two results are never combined into one score.
- **Agreement.** For each pair of raters, a cross-table of the scores each
  gave the same handoffs, per question and for the lowest score, with exact
  agreement and agreement on needs work. Each handoff counts once per pair.
- **Drift.** A sender thread's handoffs in the order sent, cut into fifths.
  Threads with 30 or more handoffs (15 of 81, holding 2,479 handoffs) are
  shown one by one and pooled; pooling counts every handoff once, so large
  threads weigh most. A thread rises when its block rate is 10 points or more
  higher in its second half than its first. The 505 handoffs that name no
  sender thread are left out.
- **Rewrite length.** The length of the reviewer's rewrite divided by the
  length of the text it replaces, in Unicode characters, over the reference
  reviewer's 53 rewrites under `handoff-v9`.
- **Without the glued-values check.** The comparison table repeats the figures
  measured before that check was added, as recorded in the README.

## Publishing these findings

Full, unedited messages stay in the ignored SQLite database and never enter
Git. Analysis may be committed once identifying detail is replaced. This is
how that was done here.

- `node scripts/findings-data.ts --write` rebuilds the JSON block in
  `report.html` through the dashboard API. It writes counts and shares only.
- Project names become "Project A" and "Project B". Mission titles and IDs
  become "Mission A" to "Mission J". Thread titles and IDs become "Thread 1"
  to "Thread 15". Dates, sizes and model names are kept.
- The script stops if a real project name, a mission or thread title, or any
  long hexadecimal string appears in its output.
- No message text is taken from the database. The fragments shown are the
  rubric's worked examples, which were sanitized when they were added to the
  rubric.
- The prose, the summary and the glued-values comparison table are written by
  hand. After regenerating the block, reread them against the new figures and
  change the date.

To repeat the whole analysis on a different corpus:

```sh
node scripts/handoff.ts capture --database data/new.sqlite3
node scripts/handoff.ts split --database data/new.sqlite3    # before any tuning
cargo build --release --locked
node scripts/handoff.ts mechanics
node scripts/handoff.ts review sample RUN --reviewer MODEL --mix pilot:3,random:6,fused:3,long:3
node scripts/handoff.ts review packet RUN --out data/review-packets/RUN
node scripts/handoff.ts review record RUN < review.json
HANDOFF_DB=data/new.sqlite3 node scripts/findings-data.ts
```

## What this method cannot show

- **Whether the judges are right.** Both are models. Their agreement shows the
  rubric can be applied consistently, not that a person would agree.
- **Cause.** In this corpus the sender model, the project, the month and the
  delivery tool change together: 84% of handoffs are from November 2026, 88%
  from one project, 63% from one mission. The drift finding has the same
  limit, because a later position in a thread also means a longer session and
  more accumulated context.
- **Performance on new traffic.** There is no untouched test set. Reviews used
  to check the thresholds include the held-out split.
- **Independence.** Messages cluster by mission and thread. The intervals
  treat them as independent, so real uncertainty is wider than shown.
- **Harm.** Nothing measures whether a recipient acted wrongly on a bad
  handoff, or what a sender does after the hook blocks one.
- **Coverage.** The corpus is what one machine's stores kept. Messages those
  stores did not record, or recorded encrypted, are not in it.
