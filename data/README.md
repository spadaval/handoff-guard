# Delegation message corpus

`private/` contains exact historical message text. It is ignored by Git and
created with owner-only permissions. Keep these files local; use sanitized
fixtures for public regression tests.

## Files

- `messages.jsonl`: one record per distinct plaintext body, deduplicated by
  SHA-256 of its exact UTF-8 bytes. Includes character/word counts, observed
  kinds and projects, and an observation count. Text is not trimmed or repaired.
  For multipart provider messages, recorded text blocks are joined with a
  newline; non-text blocks are not expanded.
- `messages.csv`: the same bodies and metadata for inspection, with blank
  `style_label` and `notes` columns. CSV fields can contain quoted newlines.
- `observations.jsonl`: provenance for every recovered observation. References
  `message_id`; records the database item or rollout line, project/thread,
  tool, timestamp, and model attribution when known. Observations are **not**
  distinct delivery counts: forks, event mirrors, and projections can repeat
  the same message.
- `opaque.jsonl`: ciphertext or explicitly encrypted payloads. These are
  excluded from the plaintext evaluation set; they are not decoded or labeled.
- `gaps.jsonl`: unavailable fields, unreadable sources, and parse failures.
  An omitted projection field may still be recovered from another source;
  gap records are not counts of definitively lost messages.
- `manifest.json`: source coverage, counts, extraction window, and file checksums.

Assignment and inter-agent message kinds are the primary handoff inputs.
Worker commentary, final reports, completion notifications, and peer-thread
requests are separate kinds. Select the relevant kinds when evaluating a
specific hook path. Do not equate all worker output with a delivered handoff.

## Coverage

The exporter reads the local T3 SQLite projections, Codex thread history and
raw session/archived-session rollouts, and existing evidence caches from the
preceding handoff investigation. It does not apply a project, date, or model
filter. T3/other-provider records are retained when locally available; this
does not claim an independent audit of every provider's private log format.

Only recorded tool arguments and recorded messages are extracted. JavaScript
source that happens to contain a delegation call is not executed or guessed
at. Recorded nested calls or their T3 delivery records provide evidence instead.
Attachments and referenced documents are not expanded into the message body.

Model attribution is explicit: original preceding rollout context is strongest;
saved thread selections and evidence-cache metadata are identified separately.
The latest thread model is never silently presented as the historical model.

The export is a read-only, best-effort capture of live sources during the
manifest's extraction window, not an atomic snapshot across all stores.
Regeneration replaces the export. Save manual labels separately, keyed by
`message_id`, before regenerating; the generated CSV is not a label database.

[coverage.json](coverage.json) records aggregate counts for the prepared export
without its raw message text. It is an inventory, not a classifier scorecard.
