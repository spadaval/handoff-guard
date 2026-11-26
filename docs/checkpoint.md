# Checkpoint the tools separately from their data

Git contains source code, dashboard source, configuration, rubrics, review
instructions and operating documentation. `config/` and `docs/` remain ordinary
files. Reviewers and agents can inspect these controls without opening SQLite.

The ignored `data/handoffs.sqlite3` contains messages and every derived
record: contexts, labels, sample assignments, diagnostics, scores and reports.
Repeated context text is shared, and obsolete exports, prototypes and redundant
runs are discarded. The working-file archive has been removed.
The dashboard reads this database directly. Automatic WAL/SHM files are managed
by SQLite; they are not separate datasets.

The two additional style diagnostics remain advisory. Existing blocking policy
and Codex settings are unchanged by consolidation. Promotion still requires
rule-specific labels, candidate/false-positive review and frozen evaluation on
reserved thread components. See [the calibration procedure](style-signals-calibration.md).

A fresh clone contains the tools, controls and invented backend fixtures. It
does not contain the dataset or results, apart from the sanitized
[findings report](findings/README.md). Supply the local database separately
when continuing research. Git does not back up the ignored database. Previous
commits may still contain older aggregate reports; their removal from the
current tree does not rewrite Git history.

See [database operations](context-database.md) and [dashboard installation](../dashboard/README.md).
