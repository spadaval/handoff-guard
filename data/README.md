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

Old exports, independent review decisions, audit records and result reports
were preserved in a compressed, checksum-bound historical archive **inside**
SQLite. They are read-only history, not dependencies or another working format.
The normalized message/context/review tables remain the active dataset.
Screenshots, a superseded dashboard export and an obsolete compiled binary were
discarded after verification. The binary's complete policy predictions were saved.

```sh
python3 scripts/context_database.py validate
python3 scripts/research.py runs
python3 scripts/research.py archives
python3 scripts/research.py archive docs/evaluation.md
python3 scripts/calibrate_style_signals.py summarize --run style-signals-v3
```

The archive command prints an original historical record to standard output.
It does not write an export. Use the local dashboard for message browsing.

To capture a different corpus, use `scripts/export_corpus.py --database PATH`
with a **new** database path. Extraction uses temporary files which are imported
and removed automatically. Existing samples, labels and splits are never replaced.
See [database operations](../docs/context-database.md).

No real messages, excerpts, derived labels, charts, reports or aggregate results
belong in Git. Backend test fixtures are invented. Do not copy historical text
into a regression fixture without replacing it with a synthetic example.
