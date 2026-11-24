# One database for message data, files for project controls

`data/handoffs.sqlite3` holds messages and everything derived from them.
It is ignored by Git. Configuration, rubric definitions, review instructions and
executable source stay in ordinary tracked files. Runs reference those files and
record their hashes; a database is not needed to read or edit the rubric.

The existing dashboard reads this database through the read-only Artifact Hub
API. It requests message previews and selected details, without a JSON snapshot.
No export or publishing step is required after a database update.

## Use the existing dataset

```sh
python3 scripts/context_database.py validate
python3 scripts/validate_corpus.py
python3 scripts/context_database.py collect
python3 scripts/analyze_mechanics.py
python3 scripts/evaluate_corpus.py evaluate --labels labels-full.jsonl
python3 scripts/calibrate_style_signals.py summarize --run style-signals-v3
python3 scripts/research.py runs
```

`collect` resumes context recovery in an existing database. It does not require
old JSONL files and does not automatically export the database. Original body
hashes, observation/context bindings, archived-source checksums, manifest counts
and foreign keys are validated. Integrity failures stop the operation.

`evaluate` stores per-body predictions and aggregate results in SQLite and
prints its run ID and summary. It distinguishes handoff inputs from worker-only
and other plaintext bodies. Select the historical label source explicitly when
comparing runs. Ambiguous labels do not enter binary style confusion counts;
unreviewed bodies remain unassessed. Earlier review exposure does not become an
untouched test set merely because its split assignment was retained.

## Capture another dataset

```sh
python3 scripts/export_corpus.py --database data/new-capture.sqlite3
python3 scripts/context_database.py collect --database data/new-capture.sqlite3
python3 scripts/evaluate_corpus.py prepare --database data/new-capture.sqlite3
```

Extraction uses a temporary directory, imports exact records and source hashes
into the new database, and removes the temporary files. An existing destination
is refused. `prepare` freezes connected-thread components and refuses to replace
an existing split. The heldout hash partition is configured in `config/review.json`.
Never tune a rule before freezing its split.

The collector reads local T3 projections, Codex history/rollouts and evidence
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
  policy baselines, newer manual reviews, integration traces and result summaries.
  Records are keyed by run, kind and key. Message records have a foreign key to
  their exact body. Repeating an identical write is safe; changing it is refused.
- `archived_files` maps original historical paths to deduplicated compressed
  `archived_blobs`. Both exact byte count and SHA-256 are verified. `source_files`
  binds original import provenance to those internal bytes, not to external files.
  Original ciphertext exports remain excluded from plaintext classification.

Recovery records missing source anchors, timestamps and recipient access rather
than guessing them. Historical Git reads disable lazy fetch and transports;
current working files are not substituted for historical revisions. Evidence
caps record explicit omission counts. Contexts and bodies remain distinct.

## Review without working-file directories

```sh
python3 scripts/research.py sample my-review --count 30 --reviewer sol
python3 scripts/research.py records my-review sample
python3 scripts/research.py message MESSAGE_ID --context CONTEXT_ID
python3 scripts/research.py record my-review < /dev/stdin
```

`sample` uses `config/review.json` and freezes IDs, split assignments, chosen
contexts, reviewer and rubric hash. Read each full body and its context, then send
one manual JSON review to `record` through standard input. The record needs the
exact `message_id`, frozen `context_id`, `full_message_reviewed: true`, situation
in `classification.task`, intent in `purpose.reason`, and
`information_selection`/`presentation` objects with a `score` (1–5 or null) and
`reason`. Scores below 5 require `issues` with an exact `quote`, `effect` and
`repair`. Cite only evidence belonging to that context. Use the exact
anchors and quote/repair requirements in [the rubric](communication-rubric.md).
Each review is immutable. New manual runs are inspectable through `research.py`;
the dashboard's existing contextual pilot remains unchanged.

Signal-specific calibration uses [its own commands](style-signals-calibration.md).
The old file-oriented review algorithms remain in `scripts/legacy/` for historical
reproduction and synthetic regression checks. Their CLIs are retired.

## Historical records and maintenance

```sh
python3 scripts/research.py archives
python3 scripts/research.py archive docs/context-pilot-v2.md
python3 scripts/research.py records style-signals-v3 label
```

Archive paths are original provenance. They do not imply a required file on disk.
The one-time consolidation command requires an explicit `--legacy-directory`
on its first import. It imports old working files transactionally, validates
all archives and existing table counts, and only then permits `--cleanup`.
Cleanup verifies every candidate's hash before removing any files. Screenshots,
the obsolete dashboard snapshot and the old executable are disposable; independent
decisions and reports are retained. Do not use the historical archive as a second
active results store.

`context_database.py export --snapshot PATH` remains an explicit optional legacy
export for outside tools. It is not part of the dashboard or normal workflow.
Any such export is message data and must remain ignored. Database files use mode
0600 and their data directory uses mode 0700. Use SQLite's backup API for backups
while the dashboard has the database open.
