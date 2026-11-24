# Local context database and dashboard contract

Keep exact corpus exports unchanged. Store SQLite databases, extracted context,
historical documents, review details and original dashboard snapshots in
`data/private/`. Keep raw corpus text out of tracked files. The user explicitly
permits serving agent messages in the local Artifact Hub dashboard.

The database is `data/private/handoffs.sqlite3`. The context collector owns its
schema, importer and documentation. Preserve distinct message bodies,
observations, context evidence, historical reviews and new review runs. An
observation is not necessarily a unique delivery: preserve mirrors and record
uncertainty instead of inflating delivery counts. New context-dependent grades
must identify a specific context, message and rubric version.

Export the canonical snapshot to `data/private/dashboard.json`. The collector
owns that repeatable exporter. Publish a copy at the local artifact's
`data/dashboard.json` with `scripts/publish_dashboard.py`; the dashboard loads it
automatically and provides a reload button. Its index includes complete bodies
and filter/review metadata; `details_path` optionally points to the complete
message/context record in an immutable snapshot generation. The app fetches
that record on selection. Browser file import remains an
optional way to inspect another export. The dashboard must also handle a missing
or empty snapshot before collection finishes. Do not commit the published copy.

Snapshot version 1 contains:

```json
{
  "schema_version": 1,
  "generated_at": "ISO timestamp",
  "database_path": "local path",
  "summary": {},
  "messages": [
    {
      "message_id": "exact body hash",
      "text": "unmodified message",
      "characters": 0,
      "words": 0,
      "kinds": [],
      "projects": [],
      "historical_reviews": [],
      "contexts": [
        {
          "context_id": "stable evidence-context identifier",
          "kind": "assignment or other recorded kind",
          "tool": null,
          "timestamp": null,
          "project": null,
          "source": "recorded source",
          "locator": "source locator",
          "sender_thread_id": null,
          "target_thread_id": null,
          "task_summary": null,
          "context_status": "recovered, partial, or unavailable",
          "evidence": [],
          "references": [],
          "analyses": []
        }
      ]
    }
  ]
}
```

Evidence objects use `evidence_id`, `kind`, `text`, `provenance` and `visibility`.
Visibility distinguishes sender context, recipient-visible evidence and unknown
visibility. Reference objects identify the path or issue, historical revision,
availability, provenance and recovered text where available. Preserve source
truth: document unavailability, caps and omitted material explicitly. Do not
execute historical commands or guess missing conversation or recipient access.

New analysis objects use `review_id`, `run_id`, `rubric_version`, `reviewer`,
`purpose`, `information_selection`, `clarity`, `overall`, `rationale` and
`evidence_ids`. Each dimension is an object with `grade` and `reason`. Grades are
`pass`, `fail`, `ambiguous` or `unknown`. Historical style labels remain separate.
Additional fields are allowed; the dashboard must handle missing optional data.

The rubric is: have a discernible purpose; choose information this recipient
needs to understand or act, accounting for accessible context; state it clearly
in ordinary English. Evaluate observable communication rather than internal
intent. Allow fragments, Markdown, code, URLs, paths and hashes. Missing context
can make purpose or information selection unknown without making clarity unknown.

## Contextual rubric v2 and mechanical reports

Snapshot schema version 1 is retained. V2 analyses add `classification` objects
for sender/recipient role, observation/send time, position, message type and task
summary/trigger. Each object records a basis, reason and context-local evidence
citations. Assessment objects add the anchored `rating` from
`docs/communication-rubric.md`; legacy grade fields and the overall value are
compatibility fields rather than a composite score. Reviews export `reviewed_at`
and are ordered newest first. Consumers should default to the newest reviewed
context and retain access to earlier rubric versions.

A message can also contain `mechanical`, a body-bound compiled Rust report from
`handoff-guard inspect`. It records exact measurements, thresholds, pass/block
statuses, scalar-index spans, policy version and engine provenance. An absent
report means unmeasured. It is not a pass. Mechanical reports remain separate
from context-dependent model judgments; no browser detector is authoritative.
