# Controls are files

- `calibration.json` defines signal names, sample seeds, reading budget and
  hit/control counts for new calibration runs.
- `review.json` defines the sampling seed, input scope, heldout hash partition
  and current rubric for new manual reviews.
- `policy-freezes.json` records source-code identities frozen during earlier
  rule work. These are code controls, not message IDs or measured outcomes.

Rubrics live in `docs/communication-rubric.md` and `docs/rubrics/`. Reviewer
instructions live in `docs/review-instructions/`. Edit these files in Git.
Runs record their paths and hashes in SQLite. Messages, sample membership,
labels, scores and results never belong in these configuration files.
