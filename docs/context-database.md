# One database for message data, files for project controls

`data/handoffs.sqlite3` holds messages and everything derived from them.
It is ignored by Git. Configuration, rubric definitions, review instructions and
executable source stay in ordinary tracked files. Runs reference those files and
record their hashes; a database is not needed to read or edit the rubric.

The [review dashboard](../dashboard/README.md) reads this database through its
own read-only API. It requests message previews and selected details, without a
JSON snapshot. No export or publishing step is required after a database update.

## Use the existing dataset

```sh
node scripts/handoff.ts migrate
node scripts/handoff.ts validate
node scripts/handoff.ts collect
node scripts/handoff.ts mechanics
node scripts/handoff.ts evaluate --labels labels-full.jsonl
node scripts/handoff.ts calibrate summarize --run style-signals-v3
node scripts/handoff.ts review runs
```

`collect` resumes context recovery in an existing database. It does not require
old JSONL files and does not automatically export the database. Original body
hashes, observation/context bindings, shared-text checksums, manifest counts
and foreign keys are validated. Integrity failures stop the operation.

`evaluate` stores per-body predictions and aggregate results in SQLite and
prints its run ID and summary. It distinguishes handoff inputs from worker-only
and other plaintext bodies. Select the historical label source explicitly when
comparing runs. Ambiguous labels do not enter binary style confusion counts;
unreviewed bodies remain unassessed. Earlier review exposure does not become an
untouched test set merely because its split assignment was retained.

## Capture another dataset

```sh
node scripts/handoff.ts capture --database data/new-capture.sqlite3
node scripts/handoff.ts split --database data/new-capture.sqlite3
```

Capture writes exact bodies and recorded observations directly into a new
database, without a directory of intermediate exports. An existing destination
is refused. `split` freezes connected-thread components and refuses to replace
an existing split. The heldout hash partition is configured in `config/review.json`.
Never tune a rule before freezing its split.

The TypeScript collector reads local T3 projections, Codex history/rollouts and evidence
caches. Recorded tool arguments are evidence. It never executes recorded commands
or JavaScript, fetches remote references, changes historical stores or modifies
active Codex configuration. Input kinds include assignments, messages, followup
assignments, cached messages and delivery records. Other output remains a separate
path, with explicit recovery gaps.

## Data model

- `messages` contains exact text keyed by its UTF-8 SHA-256. `observations` retains
  original provenance, including mirrors. They are not unique delivery counts.
- `contexts`, `evidence`, `context_evidence` and `context_references` preserve
  surrounding records, visibility and unavailable references. Sender history
  does not establish recipient access. Recovery is bounded and may be partial.
- `historical_reviews` keeps earlier style ledgers distinct; `splits` keeps the
  original connected-thread assignments. `review_runs` and `reviews` retain the
  earlier context-bound model assessments without converting their scales.
- `mechanical_runs` and `mechanical_results` hold compiled Rust diagnostics.
- `analysis_runs` and `analysis_records` hold calibration samples, rule labels,
  policy baselines, newer manual reviews and result summaries.
  Records are keyed by run, kind and key. Message records have a foreign key to
  their exact body. Repeating an identical write is safe; changing it is refused.
- `context_texts` stores each distinct context text once, keyed by a binary hash
  and a compact integer ID. `evidence_records` and `reference_records` retain
  individual provenance/visibility and reference shared text. Their repetitive
  metadata is compressed. The `evidence` and `context_references` views expose
  the original logical records to the CLI and dashboard. Open connections through
  `tooling/db/connection.ts`; it registers the decompressor and creates the shared
  Drizzle query interface. Read-only API connections use the same module.
- `source_files` keeps original import names, byte counts and checksums as
  provenance. Imported message/context records are validated directly; external
  exports and their archived copies are not needed.

Recovery records missing source anchors, timestamps and recipient access rather
than guessing them. Historical Git reads disable lazy fetch and transports;
current working files are not substituted for historical revisions. Evidence
caps record explicit omission counts. Contexts and bodies remain distinct.

## Review without working-file directories

```sh
node scripts/handoff.ts review sample my-review --reviewer claude-opus-5-5 --mix pilot:3,random:6,fused:3,long:3
node scripts/handoff.ts review packet my-review --out data/review-packets/my-review
node scripts/handoff.ts review record my-review < review.json
node scripts/handoff.ts review records my-review review
```

`sample` freezes message IDs, split assignments, chosen contexts, reviewer and
rubric hash. `--mix` draws from the strata named in `config/review.json`;
`random` is every handoff input. A message already frozen in another sample is
never drawn again, so runs are disjoint. Reviewers are not told which stratum a
message came from.

Only part of what gets sampled is a fair sample of the corpus. Every stratum
draws from one shuffled order of the inputs, so the targeted strata take long
and fused messages that the `random` draws would otherwise have reached. The
fair sample is the head of that order up to the last `random` pick, whatever
stratum each message was drawn under. `probabilitySample()` in
`tooling/reviews.ts` returns it, and prevalence figures must use it. The
messages labelled `random` alone understate how many handoffs are bad.

`packet` writes one plain-text file per sampled message: the exact message,
then trimmed context. Packets hold real message text, so they go under ignored
`data/` and are deleted after the run.

`record` reads one JSON review from standard input and validates it against
[the rubric](communication-rubric.md), which defines the record format. A
review lists issues with a severity each and carries no scores: the recorder
computes them and prints them back. It rejects a written `score`, an issue
without a severity, a quote that is not an exact substring of the message, an
unknown issue kind, and a costly or broken presentation issue without a full
rewrite. Each review is immutable.

To have a second reviewer score messages that are already reviewed, draw a
slice of the fair sample again:

```sh
node scripts/handoff.ts review sample second-rating-01 --reviewer gemini-4-neon --rerate 0:14
```

`--rerate START:COUNT` takes that slice of the fair sample in its fixed order.
The draw is recorded with stratum `rerate` and does not change how the message
was first picked. `config/review.json` names the `reference_reviewer`; figures
use that reviewer's review under the newest rubric version, and other reviews
of the same message are second ratings.

Signal-specific calibration uses [its own commands](style-signals-calibration.md).
The abandoned file-oriented review CLIs and working-file archive have been removed.

## Maintenance

```sh
node scripts/handoff.ts compact
```

Stop the dashboard server before maintaining the live database, then start it
again afterwards.

The schema is declared in `tooling/db/schema.ts`. Reviewed SQL migrations and
Drizzle snapshots live in `migrations/`, with `drizzle.config.ts` as configuration.
`node scripts/handoff.ts migrate` applies those migrations. The existing normalized
v2 database is adopted only if its complete schema matches the checked-in baseline;
its research rows are not rewritten. Older database schemas are refused explicitly.

Use `npm run db:generate -- --name=DESCRIPTION` to propose a schema change. Review
the generated SQL, including the custom views, triggers and WITHOUT ROWID tables,
before applying it. Do not use schema push against the research dataset. The
baseline includes the existing storage objects that the query-builder schema
cannot express. Custom SQL remains appropriate for those objects and maintenance.

The obsolete working-file archive has been removed. Compaction prunes abandoned
unlabeled calibration prototypes, fixture traces, superseded mechanical results
and older complete evaluations of the same label source. It keeps the
newest available diagnostic per message, canonical reviews/labels, frozen splits
and the old-policy baseline. All essential table fingerprints and the retained
diagnostics are checked before committing. SQLite VACUUM then reclaims pages.

New calibration runs retain frozen sample measurements rather than another full
copy of every inspection result. Integration fixtures do not append traces to
the research database. Raw data and aggregate results remain out of Git, apart
from the sanitized report in [findings/](findings/README.md).

`handoff.ts export --snapshot PATH` remains an explicit optional legacy
export for outside tools. It is not part of the dashboard or normal workflow.
Any such export is message data and must remain ignored. Database files use mode
0600 and new data directories are created with mode 0700. Use SQLite's backup API for backups
while the dashboard has the database open.
