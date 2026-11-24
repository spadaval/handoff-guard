# Review dashboard

The dashboard in [`dashboard/`](../dashboard/README.md) is where the corpus is
read and the analysis is judged. It answers four questions: how common fused
shorthand is and where it comes from, where the hook and the model reviewers
disagree, what one message says and how it was judged, and which messages match
a search. Run it with `npm run dev` in `dashboard/`; the README lists the
environment variables.

## What each number means

The dashboard asks two questions and gives each one definition.

- **Needs work.** A handoff needs work when its lowest score is 1 (Broken) or
  2 (Costly). Scores come only from `score()`, `lowest()` and `needsWork()` in
  `tooling/reviews.ts`. Under `handoff-v9` a question's score is the worst
  severity among its issues, or 4 with none; older reviews carry a score the
  reviewer wrote, which `score()` uses as it is. A review with an unknown
  question and nothing below 3 cannot be judged and is left out of shares.
  There is no verdict label; the dashboard shows the lowest score and the
  question it came from.
- **Reference review.** A message can have several reviews: different raters,
  or the same rater under a newer rubric. Every figure uses one reference
  review per message, the `reference_reviewer` named in `config/review.json`
  under the newest rubric version it used. The Overview says which rubric
  versions the figures rest on and warns when a sample mixes them.
- **Agreement.** For messages with two or more reviews, the Agreement view
  cross-tabulates the scores each pair of raters gave, per question and for the
  lowest score, with exact agreement and agreement on needs work as `k/n`.
  Different raters under one rubric are listed first, then one rater under a
  changed rubric. Every cell opens its messages, and the reader shows a
  message's reviews side by side.
  Each handoff counts once per comparison, with each rater's earliest review
  of it; a rater's repeat reviews of the same handoff under the same rubric are
  not used, and the view says how many there are.
  Messages listed in `rubric_example_messages` in `config/review.json` are
  left out of every agreement figure and cell: the rubric quotes them as
  worked examples, so a reviewer who meets one has been shown its severity.
  The view says how many were left out, the reader marks them, and they stay
  in the prevalence figures.
- **Does the hook catch what it can see.** The hook measures spacing, size and
  repetition, so it is judged against the presentation score alone: the share
  blocked among Costly or Broken presentation, and the share allowed among
  Clean or Minor, each computed on the handoffs with a known presentation
  score and a stored hook report; the caption gives the table's full
  population. A handoff is outside what the hook can see when it needs work
  and its presentation is Minor or Clean; the count and its link (`outside=yes`)
  use the same rule. Handoffs that need work with an unknown presentation score
  are counted separately (`outside=unknown`). A check's warnings on handoffs
  another check blocked are counted within the Costly-or-Broken band only.
- **Samples.** Prevalence comes from the fair sample, the head of the shuffled
  sampling order returned by `probabilitySample()`. "All reviewed" adds the
  messages picked for long letter runs, for length and for the earlier pilot,
  and is marked as skewed toward problem messages. The choice holds across
  views. How a message was picked is a filter in the message list, not a
  figure sample; it is the stratum of the message's first draw, because a
  `rerate` draw only re-reviews a message already picked.
- **Intervals.** Sample estimates show `k/n` and a 95% Wilson interval. The
  intervals treat messages as independent; messages cluster by mission, so the
  real uncertainty is wider. Counts over all handoffs are exact and show no
  interval. A group with fewer than 5 reviewed handoffs is shown greyed and is
  not joined into a line.
- **Unreadable reviews.** A stored review that cannot be read (bad JSON, or
  `issues` that is not a list of issues with a kind) is set aside for its
  message only. The Overview says how many there are and the reader names
  each one; every other review still counts.
- **Hook.** Lists and aggregates use the reports of the newest run in
  `mechanical_results`; a handoff that run did not cover shows as having no
  stored report. The hook blocks or allows. A check can also warn; a warning
  does not stop delivery, and a handoff that another check blocks still carries
  its warnings. Checks that never fire on any handoff are named once and left
  out of the tables.
- **Missions.** A mission is a connected group of threads, `component` in
  `splits.record_json`. The Overview lists the largest missions with each day's
  handoffs, hook block rate and sample estimate. Model, project, month,
  mission and delivery tool change together in this corpus, so a difference
  between groups is not evidence of a cause.
- **Months and days.** A handoff's month and day are those of its earliest
  recorded observation, in UTC. Months between the first and last with no
  handoffs are shown as empty.
- **Sender model.** *Recorded at send* is the turn-context model, present for
  about a quarter of handoffs, and is the default everywhere. *Add thread
  setting* also uses the sending thread's saved model selection at export time,
  which can differ from the model that wrote the message. Unknown stays Unknown.
  Handoffs with a recorded model are not typical, and the Overview shows the
  hook's block rate for each kind of attribution side by side.
- **Rubric versions.** Each review states the rubric version of its run, and
  links to that version: the API finds it by hashing the rubric file at each
  commit that changed it. Issue kinds the current rubric no longer lists are
  still counted and marked as not in the current rubric.

## The message reader

The message is shown exactly as written, in numbered source lines, with
whitespace preserved and long unbroken runs wrapped anywhere. Hook spans are
blue with an underline (solid for a blocking check, thin for a warning);
reviewer quotes are a magenta highlight. Every highlight is cited as
`L<line>:<column>`, counted in Unicode characters; clicking a citation scrolls
to the passage, and `j`/`k` step through all highlights in order.

The hook result is a live run of `target/release/handoff-guard inspect` on that
message, so it always reflects the current rules. If it differs from the stored
report used in lists and figures, the reader lists the differences. If the
binary is missing, the stored report is shown with a note.

When a review includes the reviewer's plain-English version, called the clear
version here, "Beside the clear version" shows the original (or the passage it replaces) and the clear
version in two columns with their character and word counts.

The review panel opens with the rubric version the review was scored under
(linking to that version of the rubric), then the lowest score and the question
it came from, for example "Lowest score: 1 Broken, in presentation". Each
issue shows its severity, and the issue that set a question's score is marked.
For a review from before `handoff-v9` the panel says the reviewer wrote the
scores. When a message has several reviews, tabs switch between them and a
table below the message puts them side by side with the rows that differ
marked.

Recorded context lists every observation of the body (source, kind, tool, time,
thread, model at send, thread setting) and the recovered contexts with their
evidence and referenced files. Evidence and file excerpts are capped at 1,000
characters with the omitted count shown; the full text stays in SQLite.

## API

All endpoints are GET only, open SQLite read-only with `query_only`, and return
`Cache-Control: no-store`. Invalid parameters return 400 with a message that
names the parameter.

- `GET /api/meta`: corpus counts, runs and their progress, the size of the
  fair sample and of all reviewed handoffs, how many handoffs have more than one
  review, the rubric versions reviews used, the hook run and whether its stored
  reports match the current binary, and filter values.
- `GET /api/overview?sample=fair|all&basis=recorded|thread`: needs work, the
  lowest-score split, score distributions, which question holds the lowest
  score, issue kinds, breakdowns by model, project, size and month, the
  largest missions by day, block rates by model attribution, and the hook
  against presentation scores. `sample` defaults to `fair`, `basis` to
  `recorded`.
- `GET /api/messages?…`: filtered, sorted, paginated previews with facet
  counts. Filters: `q`, `sample` (`fair`, `reviewed`, `waiting`, `none`),
  `picked` (`random`, `fused`, `long`, `pilot`), `lowest` (`1` to `4`,
  `unsettled`, `none`), `cause` (`presentation`, `intent-content`), `hook`
  (`blocked`, `allowed`, `unassessed`), `flag` (`rule:status`), `issue`,
  `intent`, `content`, `presentation`, `clear`, `several` (`yes`, `no`),
  `outside` (`yes`, `unknown`), `rater` (`reviewer@rubric`), `pair`
  (`raterA|raterB`), `agree`
  (`raterA|raterB|question|scoreA|scoreB`, with `needs` as the question for
  needs work), `mission`, `day`, `model` with `basis`, `project`, `month`,
  `size` and `kind`. Values in one filter are
  alternatives; filters combine. `ids=1` adds the ordered IDs of every match.
- `GET /api/messages/<sha256>`: one message with observations, how it was
  picked, every review with its run, reviewer, rubric version, scores, lowest
  score, how each score was reached and whether it is the reference, earlier
  reviews, live and stored hook reports and contexts.
- `GET /api/agreement`: every pair of raters that reviewed the same
  messages, with cross-tables per question and agreement figures.
- `GET /api/rubric[?sha256=]`: the rubric file as written, or the version
  whose hash a review run recorded, found in Git history.

Tests are in `tests/dashboard-api.test.ts` and use invented text only.

## Reviewing changes

There are no automated UI tests. Judge changes by using the rendered app in a
browser in light and dark, at laptop width and narrower, with short, long and
fused messages. Screenshots of the app contain message text and stay out of
Git.
