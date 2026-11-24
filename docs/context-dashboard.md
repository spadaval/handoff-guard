# Review dashboard

The dashboard in [`dashboard/`](../dashboard/README.md) is where the corpus is
read and the analysis is judged. It answers four questions: how common fused
shorthand is and where it comes from, where the hook and the model reviewers
disagree, what one message says and how it was judged, and which messages match
a search. Run it with `npm run dev` in `dashboard/`; the README lists the
environment variables.

## What each number means

- **Samples.** Reviews come from frozen samples in `manual-review` runs. Each
  sampled input has a stratum: `random`, `pilot` (inputs with earlier
  reviews), `fused` (long runs of letters without spaces) or `long`. Only
  `random` estimates the corpus. The sample switch applies to every figure on
  the Overview and on Hook vs reviewers, and the page states which sample a
  figure describes.
- **Bad.** Reviewers call an input bad when its verdict is `revise` or
  `rewrite`, or, with the other setting, when its presentation score is 1 or 2.
  The verdict is computed with `verdict()` from `tooling/reviews.ts`.
- **Intervals.** Every share is shown as `k/n` with a 95% Wilson interval.
- **Hook.** Lists and aggregates use the newest stored report per input in
  `mechanical_results`. "Blocks" means the report's `blocked` is true; "warns"
  means it is not blocked but a check has a status other than `pass`. Warnings
  do not stop delivery, so a warned bad input counts as a miss.
- **Months.** An input's month is the month of its earliest recorded
  observation. Months between the first and last with no inputs are shown as
  empty, not left out.
- **Sender model.** *Recorded* is the turn-context model at send time, present
  for about a quarter of inputs. *Thread setting* adds the sending thread's
  saved model selection at export time, which can differ from the model that
  wrote the message. Unknown stays Unknown.
- **Rubric versions.** Each review shows the rubric version of its run. When
  reviews were recorded under an older version than the rubric file, the
  Overview says so, and issue kinds that the current rubric no longer lists are
  still counted and marked as retired.

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

When a review includes a plain-English rewrite, "Beside the rewrite" shows the
original (or the rewritten passage) and the rewrite in two columns with their
character and word counts.

Recorded context lists every observation of the body (source, kind, tool, time,
thread, model at send, thread setting) and the recovered contexts with their
evidence and referenced files. Evidence and file excerpts are capped at 1,000
characters with the omitted count shown; the full text stays in SQLite.

## API

All endpoints are GET only, open SQLite read-only with `query_only`, and return
`Cache-Control: no-store`. Invalid parameters return 400 with a message that
names the parameter.

- `GET /api/meta`: corpus counts, runs and their progress, strata, hook run,
  whether stored reports match the current binary, and filter values.
- `GET /api/overview?sample=&criterion=&basis=`: verdicts, score
  distributions, issue kinds, breakdowns by model, project, size and month, the
  onset months and the screening table.
- `GET /api/messages?…`: filtered, sorted, paginated previews with facet
  counts. Filters include `q`, `sample`, `run`, `split`, `review`, `reviewer`,
  `hook`, `flag` (`rule:status`), `issue`, `intent`, `content`,
  `presentation`, `rewrite`, `model` with `basis`, `project`, `month`, `size`
  and `kind`. `ids=1` adds the ordered IDs of every match.
- `GET /api/messages/<sha256>`: one message with observations, samples,
  reviews, earlier reviews, live and stored hook reports and contexts.
- `GET /api/rubric`: the rubric file as written.

Tests are in `tests/dashboard-api.test.ts` and use invented text only.

## Reviewing changes

There are no automated UI tests. Judge changes by using the rendered app in a
browser in light and dark, at laptop width and narrower, with short, long and
fused messages. Screenshots of the app contain message text and stay out of
Git.
