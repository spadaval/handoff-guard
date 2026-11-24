# Recover local context without changing the corpus

`python3 scripts/context_database.py collect` imports the frozen corpus and
recovers locally recorded evidence into `data/private/handoffs.sqlite3`. It
then writes `data/private/dashboard.json` using snapshot contract version 1.
The database and optional JSON export remain Git-ignored. The dashboard queries
the database directly through a read-only API; exporting or publishing JSON is
not required. The user authorized serving agent messages through this local
dashboard. See [dashboard setup](context-dashboard.md).

The collector uses Python's standard library and local read-only SQLite/Git
queries. Historical Git reads disable lazy fetch and block Git transports.
It never executes recorded commands, opens network connections, changes
Codex configuration, edits historical stores, or regenerates exact exports.
New database and snapshot files use mode 0600; their directory uses mode 0700.

```sh
python3 -m unittest discover -s tests -p test_context_database.py -v
python3 scripts/context_database.py collect
python3 scripts/context_database.py validate
python3 scripts/context_database.py export
```

Snapshot evidence and reference text defaults to 1,000 characters per item,
with `snapshot_original_characters` and `snapshot_omitted_characters` when capped.
Message bodies remain unmodified. The database keeps its longer recovered text.
Use `--snapshot-text-limit 0` to export all stored evidence/reference text.

The default paths can be changed with `--directory`, `--database`, and
`--snapshot`. A changed bound input fails collection or validation rather than
silently replacing previously imported history. Use a new database for a changed
corpus. Keep the original database when its reviews must remain reproducible.

## Bodies, observations and evidence contexts

`messages` stores exact UTF-8 body hashes and unmodified text. `observations`
retains every provenance record, including mirrors, keyed by export line and a
hash of its canonical record. `contexts` gives each observation its own stable
`ctx-` identifier. These are evidence contexts, **not unique deliveries**. A
shared body can have several contexts and several later grades. No heuristic
merges two contexts merely because their text matches.

All messages have context availability through their observations. Input-body
selection matches `scripts/triage_handoffs.py`: assignment, agent_message,
followup_assignment, cached_agent_message, and agent_delivery. Observations of
these bodies receive recovery attempts even when an observation is an output
mirror. Other output paths retain body/provenance and an explicit
`non_input_output_path_not_enriched` gap.

`evidence` stores source text, source hashes, provenance and visibility.
`context_evidence` links it to contexts. `context_references` preserves recovered
historical files and explicit unavailable references. `historical_reviews`
imports the original labels, full Luna labels, Sol labels and provisional
reconciliations as distinct records, including their original metadata. They
remain body-level style reviews. `splits` preserves the frozen split ledger;
`corpus_gaps` preserves original extraction gaps. `metadata` stores the original
manifest, and `source_files` binds imported exports and ledgers to SHA-256.

## What recovery establishes

Codex rollouts supply recorded session instructions, up to eight preceding
developer/system instruction records, their first recorded user message, latest
preceding user message, latest turn context and up to twelve preceding text
response items.
Tool arguments and results are recorded evidence, not instructions to execute.
The first user message may contain setup instructions; it is not assumed to be
the user's original task. Recorded session metadata supplies repository and Git
revision provenance when available.

Codex history uses the anchor's rollout ordinal to select preceding records.
T3 uses the recorded observation timestamp to select up to twelve preceding
messages, the first preceding user message and up to four tools with earlier
recorded `startedAt` timestamps. Missing timestamps do not fall back to current
projection order. Missing source anchors and unavailable databases are gaps.
Audit caches retain recorded context metadata. When a cache references a local
rollout, a bounded scan seeks exact body hashes in recorded text or decoded
tool task/message arguments. Up to three matching anchors supply preceding
records, with match and omission counts. Multiple matches do not establish a
unique delivery; recovered evidence keeps unknown visibility. Two scan hashes
are compared before linking evidence. Cache metadata alone does not establish
original conversation ordering. No cache timestamp is promoted to a delivery ID.

Live Codex state and T3 provider mappings are locator aids only. A unique
available recorded rollout session can provide historical metadata. A session
recorded after the observation cannot supply its revision; T3 mapping-only
links also require recorded session and observation timestamps. Current
thread settings and current Git HEAD are never historical proof. Multiple
session candidates leave a gap rather than choosing one historical revision.

Referenced file paths and issue keys are extracted deterministically from the
body. When a recorded session revision and repository remain available, Git
can recover local historical blobs, including candidate `AGENTS.md`, `SPEC.md`
and `README.md`. Issue bodies require an unavailable offline tracker source.
Current working files are not substituted. The recorded session revision may
predate edits made during the session; recovered files explicitly do not prove
the precise filesystem state or recipient access at delivery time.

Recorded handoff inputs are recipient-visible body evidence; this does not
prove successful delivery. Output mirrors and cache-only bodies have unknown
visibility. Prior sender conversation is
`sender_context`; T3 delivery-side records and cache metadata have `unknown`
visibility. Recovery never makes sender-private history recipient-visible.
No model grades or invented task summaries are produced; `task_summary` is null.
Contexts remain partial or unavailable because complete recipient access cannot
be established from these sources.

## Bounds and reproducibility limits

A rollout scan stops at its initial length or 128 MiB. Evidence text is capped at
24,000 characters with original/omitted counts. Selection keeps bounded recent
records and does not claim all selected turns are relevant. Parse errors carry
counts and up to 100 line numbers. Session metadata lookup examines at most the
first 32 lines within 1 MiB. Cache files above 128 MiB are unavailable.

Each context attempts up to 24 deduplicated references, with a separate omission
record above the cap. Historical Git blobs above 65,536 bytes are omitted before
dumping their contents. Git reads have five-second timeouts. Binary, missing,
external and unresolved paths retain availability reasons. T3 tool timestamp
indexes retain at most the most recent 20,000 records per thread, with an
explicit gap if older tool records were omitted. An eight-thread cache retains
only timestamps and IDs; selected payloads are fetched by primary key.

Rollout provenance binds the scanned prefix hash and exact evidence-record
hashes. SQLite provenance binds each recovered row hash and anchor hash.
Historical live stores can have changed since the frozen corpus export; recovery
is a later best-effort capture, not an atomic historical snapshot. Validation
checks imported input-file hashes, stored body and observation hashes, context
bindings, manifest counts, complete
observation/context coverage, SQLite integrity and foreign keys. It does not
require a live historical store to remain byte-identical after recovery.

Collection commits each rollout source group and each batch of up to 100
observations from database/cache sources. Repeating it verifies inputs and resumes
pending contexts without duplicating data. A completed unavailable context is a
recorded recovery result; collection does not silently replace it when external
sources later reappear. Use a new database for a new recovery capture. Context
IDs remain stable for unchanged export paths and records; evidence IDs reflect
provenance and retained text. Snapshot writing uses an atomic file replacement.

## Stable surface for later reviews

Use `input_contexts` to select contexts without relying on private source schemas:

```sql
SELECT message_id, context_id, status, source, metadata_json
FROM input_contexts
ORDER BY message_id, context_id;
```

`review_runs` requires run ID, rubric version, reviewer, creation timestamp and
JSON metadata. Store the full rubric, model settings and selection procedure in
that metadata. New `reviews` require both `message_id` and `context_id`; a
composite foreign key rejects a context belonging to a different body.

The Python helper validates the four grade dimensions and checks that evidence
IDs belong to the selected context:

```python
import sys
sys.path.insert(0, 'scripts')
import context_database as c

db = c.connect('data/private/handoffs.sqlite3')
with db:
    db.execute('INSERT INTO review_runs VALUES(?,?,?,?,?)',
               ('my-run', 'communication-v1', 'reviewer-name', c.now(),
                c.js({'rubric': 'Store the exact rubric here.'})))
    # Supply an existing message/context pair and evidence IDs from that context.
    # record has purpose, information_selection, clarity and overall objects,
    # each with grade and reason, plus rationale and evidence_ids.
    # c.insert_review(db, 'my-run', context_id, message_id, record)
```

Allowed grades are `pass`, `fail`, `ambiguous`, and `unknown`. The helper adds
review ID, run metadata, rubric version and reviewer to the snapshot analysis
record. Review insertion is explicit; collection creates no review runs.
Re-export after inserting reviews. Synthetic tests cover repeat collection,
exact whitespace, distinct mirrored contexts, snapshot shape, private file modes,
input checksum mismatch, context/evidence review binding and historical Git
recovery when the working file has changed.

## Completed local capture on 23 November 2026

The completed database has 36,078 exact bodies, 86,004 observations and
86,004 evidence contexts. All 3,464 input bodies have auxiliary evidence;
3,454 have preceding conversation evidence, and 3,168 have historical file
recovery. Ten input bodies have no recovered preceding conversation. Metadata
and historical-file availability do not by themselves establish recipient access.

There are 164,265 evidence records, 68,618 reference records, 7,767 historical
review records, 36,078 split assignments and 1,118 original corpus gaps.
References comprise 23,948 recovered records, 44,632 unavailable records and
38 cap/omission records. Cache-origin scans matched 1,685 observation contexts;
40 had no exact recorded body match within the scan. These are observations,
not unique deliveries or distinct body counts.

Context status is partial for 12,617 observations and unavailable for 73,387.
The latter includes 72,801 non-input output observations explicitly left
unenriched and 586 input-body observations lacking auxiliary recovery. Other
observations of those bodies can still supply context. No context is declared
complete solely from sender history. There are no pending contexts, rubric
review runs or rubric reviews.

A full repeat collection preserved all reported table and coverage counts. Integrity, foreign
keys, input-file checksums, body hashes and observation bindings passed. The
local aggregate validation record is `data/private/context-database-report.json`.

## Mechanical diagnostics and v2 reviews

The additive `mechanical_runs` and `mechanical_results` tables store compiled
Rust measurements per body, keyed by a provenance-bound run ID. They do not
replace observations or contextual model reviews. The exporter includes the
newest report as each message's `mechanical` field and orders contextual reviews
by their review-run creation time. V2 review JSON retains classifications and
anchored ratings alongside compatibility grade fields. Existing v1 records and
source bindings are preserved. See [the diagnostics guide](mechanical-checks.md).
