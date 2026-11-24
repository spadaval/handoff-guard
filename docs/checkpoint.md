# Checkpoint: guard, corpus analysis and SQLite dashboard

Saved on 2026-11-24. This is a development checkpoint, not a claim that rule
calibration or corpus grading is finished.

The repository now contains the Rust executable, corpus preparation and review
scripts, SQLite collector and read-only API, aggregate evaluation reports,
communication rubric and complete dashboard application source.

The installed guard's five existing size/glued-prose/repetition policy checks
remain unchanged. Two new Rust diagnostics, punctuation spacing and needless
shorthand, are advisory. Their display scores vary continuously with measured
burden. The final compiled executable retained the previous denial rule/reason
on all 36,078 recoverable plaintext bodies. Expanded diagnostics are stored for
all 3,464 distinct handoff inputs; worker output remains a separate path.

The current model pilot has contextual v2 assessments for 30 input bodies. New
five-point model scores have not been populated. V1 grades are excluded from the
dashboard. The new diagnostics received a preliminary 17-message manual pass,
with only one heldout thread component; that is inadequate evidence for reliable
blocking. See [the calibration report](style-signals-calibration.md).

The outstanding work is to use the collected corpus and existing assessments
for rule-specific labels, review candidate matches and missed bad examples,
tune defensible blocking criteria, and evaluate frozen rules on reserved thread
components. The two new checks have not been promoted to denials or activated
through global Codex configuration.

The live dashboard is served by the existing Artifact Hub process. Its source
is tracked in [dashboard/](../dashboard/README.md). The API integration is one
plugin registration in that server; the installation instructions reproduce it.
No app-local service or generated per-message JSON tree is needed. The main flow
is exchange graph, message, strategic context, then information selection and
presentation; cited evidence expands in place. UI tests were removed at the
user's request. Role colors/icons and the current dark appearance are included.

The SQLite database, SQLite sidecars, raw corpus exports, per-message review
labels, exact calibration samples, retained executables and real-message
screenshots remain local under ignored paths. The checked-in JSON and charts
contain aggregate reports, not recoverable message bodies. A fresh clone needs
the local frozen inputs to reconstruct the database; Git intentionally cannot
supply them. Backend tests use invented data and can run without the corpus.
