# Local research data

There are two kinds of project material:

- **Tracked files:** Rust and TypeScript code, dashboard source, configuration in
  `config/`, rubrics, review instructions and documentation about using the tools.
- **Ignored SQLite database:** exact messages, provenance, recovered context,
  frozen sample/split assignments, human/model labels, scores, diagnostics,
  experiment results and working reports.

- **Ignored experiment files:** `experiments/<name>/` holds the sessions,
  transcripts and model outputs behind each write-up in
  [`docs/experiments/`](../docs/experiments/README.md), under the same name.
  They are files, not database rows, because the experiment tools read them
  as files (for example `pi --fork` takes a session file).

`handoffs.sqlite3` is the single durable store for the corpus. Its automatic `-wal`
and `-shm` companions are SQLite internals, not separate datasets. Never delete
those while connections are open. Back up a running database with SQLite's backup
API, rather than copying or deleting its journal files.

Context text is stored once in `context_texts`. Evidence and historical-file
references point to that text while keeping their individual provenance and
visibility. Repetitive provenance is compressed; the tools reconstruct it when
reading. Message bodies are unchanged.

The obsolete working-file archive, abandoned prototypes, fixture traces,
superseded diagnostics and duplicate evaluations have been removed. Canonical
labels, contextual reviews, frozen splits and the policy baseline remain.

```sh
node scripts/handoff.ts validate
node scripts/handoff.ts review runs
node scripts/handoff.ts calibrate summarize --run style-signals-v3
```

Use `node scripts/handoff.ts compact` to prune obsolete runs and reclaim freed pages.
Stop the dashboard service before running maintenance on its live database.

To capture a different corpus, use `node scripts/handoff.ts capture --database PATH`
with a **new** database path. Capture writes directly to SQLite without intermediate CSV or JSONL files. Existing samples, labels and splits are never replaced.
See [database operations](../docs/context-database.md).

Full, unedited messages never belong in Git, and neither do per-message
records such as labels and review packets. Backend test fixtures are invented.
Do not copy historical text into a regression fixture without replacing it
with a synthetic example.

Analysis does belong in Git: findings, counts, shares, charts and written
reports. [`docs/findings/`](../docs/findings/README.md) is the current one, and
`scripts/findings-data.ts` builds its data. Before committing analysis,
replace project, mission and thread names, identifiers, hashes and anything
else sensitive. Short fragments of real handoffs may be quoted as examples
after the same replacement, as the rubric does. See
[how the findings are published](../docs/findings/methodology.md#publishing-these-findings).
