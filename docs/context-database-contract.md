# Dashboard data contract

The dashboard reads the ignored SQLite database through `scripts/dashboard-api.ts`.
Its list endpoint returns paginated message previews; its detail endpoint returns
one message with recorded contexts, model reviews and compiled measurements.
Search and filters run in SQLite. No full-corpus JSON is fetched on page load.

Message bodies retain exact text. Contexts remain distinct observation-bound
records, including mirrors and recovery gaps. Model reviews identify their
message, context and rubric. Mechanical diagnostics identify their compiled run.
Do not infer recipient access from sender-only records or unique delivery from
an observation. Missing scores and unimplemented checks are not passes.

Configuration and rubric definitions are tracked files; message data and every
derived result remain in SQLite. See [storage and commands](context-database.md)
and [dashboard installation](../dashboard/README.md). The optional legacy snapshot
export is not an active dashboard format and must remain ignored if requested.
