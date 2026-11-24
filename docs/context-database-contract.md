# Dashboard data contract

The dashboard reads the ignored SQLite database through
`scripts/dashboard-api.ts`. It opens the database read-only with the shared
connection in `tooling/db/connection.ts`, because the `evidence` and
`context_references` views need its custom SQL function. It never writes.

What it relies on:

- `messages` with `is_input=1` are the handoff inputs. Message text is returned
  exactly as stored.
- `observations.record_json` supplies time (`timestamp` or `timestamp_ms`),
  project, thread title, `model` and `saved_model_selection`. A
  `t3_messages` record belongs to the recipient's thread, so its saved model
  selection is never used as the sender model.
- `analysis_runs` with `kind='manual-review'` and their `analysis_records`:
  `kind='sample'` gives `stratum` (how the message was picked) and
  `context_id`; `kind='review'` holds the review record defined in
  `docs/communication-rubric.md`. Run metadata supplies `reviewer`,
  `rubric_version` and `rubric_sha256`. A message may have reviews in several
  runs; figures use the one from the earliest run.
- `probabilitySample()` in `tooling/reviews.ts`, with the seed in
  `config/review.json`, defines the fair sample used for prevalence.
- `splits.record_json` supplies `component`, the mission a handoff belongs to.
- `mechanical_results` joined to `mechanical_runs`: the reports of the newest
  run only. Reports are rendered from their `checks` array without assuming rule
  names. Span offsets are Unicode scalar offsets.
- `reviews` with `intentionality-v2` only, as an older comparison.
- `contexts`, `evidence`, `context_evidence` and `context_references` for the
  recorded context of one message.

Contexts remain distinct observation-bound records, including mirrors and
recovery gaps. A recorded observation does not prove delivery, and sender-only
evidence does not prove what the recipient saw. Missing scores and missing
reports are shown as missing, never as passes.

Configuration and rubric definitions are tracked files; message data and every
derived result remain in SQLite. See [storage and commands](context-database.md)
and the [dashboard README](../dashboard/README.md).
