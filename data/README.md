# Local research data

There are two kinds of project material:

- **Tracked files:** Rust and Python code, dashboard source, configuration in
  `config/`, rubrics, review instructions and documentation about using the tools.
- **Ignored SQLite database:** exact messages, provenance, recovered context,
  frozen sample/split assignments, human/model labels, scores, diagnostics,
  experiment results and reports. Aggregates are derived data too; keep them here.

`handoffs.sqlite3` is the single durable data store. Its automatic `-wal`
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
python3 scripts/context_database.py validate
python3 scripts/research.py runs
python3 scripts/calibrate_style_signals.py summarize --run style-signals-v3
```

Use `scripts/compact_database.py` to prune obsolete runs and reclaim freed pages.
Stop the dashboard service before running maintenance on its live database.

To capture a different corpus, use `scripts/export_corpus.py --database PATH`
with a **new** database path. Extraction uses temporary files which are imported
and removed automatically. Existing samples, labels and splits are never replaced.
See [database operations](../docs/context-database.md).

No real messages, excerpts, derived labels, charts, reports or aggregate results
belong in Git. Backend test fixtures are invented. Do not copy historical text
into a regression fixture without replacing it with a synthetic example.
