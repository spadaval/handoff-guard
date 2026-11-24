# Historical review algorithms

These modules preserve the earlier triage, mapping audit and blind sampling
algorithms. Their synthetic backend regression tests still run. Their file-based
CLIs are retired. Use `scripts/research.py` for new SQLite reviews and
`scripts/calibrate_style_signals.py` for signal calibration.

Earlier frozen inputs, independent decisions, page receipts and reports were
imported into the database's read-only historical archive. They are not active
working directories and are not required alongside the database.
