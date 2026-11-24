# Context gaps prevent definite selection grades for 24 of 30 handoffs

Run `intentionality-pilot-v1-sol-20261123-346b864b62ff` reviewed all 30 frozen
sample IDs once each under `intentionality-v1`. No IDs were replaced. The
reviewer read every complete original body and manually authored each decision.
The executed model was `gpt-6.1-sol` through Codex in T3 Code, with high reasoning
effort and no child agents. Other decoding settings were not exposed.

The grades were:

- Purpose: 30 pass.
- Information selection: 6 pass and 24 unknown.
- Clarity: 11 pass, 10 fail and 9 ambiguous.
- Overall: 4 pass, 10 fail, 2 ambiguous and 14 unknown.

These are exploratory counts for sampled bodies, not estimates of unique
handoff deliveries. The sample was selected uniformly without replacement from
3,464 sorted input-body IDs using
`random.Random("intentionality-pilot-v1-20261123")` before reading the recovered
context or making these grades. Original style labels were not used. Historical
reviews and the split ledger retained identical table checksums after insertion.

For each body, context selection first preferred an input-side observation,
then the availability and amount of preceding non-reasoning/user evidence,
then recovered-reference availability, with ascending context ID as tie-break.
The exact rank tuples and all candidates are preserved privately. This ranking
is not random context or delivery sampling and can favor longer, less relevant
history. The reviewer selected relevant records within the chosen context and
recorded the evidence IDs actually read. Output mirrors remain separate
observations. Four chosen contexts came from cache-origin input observations.

Every message had a discernible request, question or report. Definite clarity
failures concerned fused ordinary words and compact chains that mixed outcomes,
counts and identifiers. Literal code, hashes, paths, short continuations and
fragments were allowed. Some detailed assignments remained clear despite their
length. Nine clarity cases remain ambiguous because established technical
vocabulary and avoidable compression can be difficult to distinguish. Each
failure has a private reason and possible remedy.

The 24 unknown information-selection grades reflect missing recipient access
and task evidence, not established communication defects. Sender history can
explain a task without proving that the recipient saw it. Historical Git files
can predate session edits and do not establish the filesystem or access at the
handoff. Repeated material is not called redundant solely because it appears in
sender history or an observation mirror. A precise question can supply enough
information even when its purpose is to request a missing fact.

Reviews used stored SQLite evidence, not the dashboard's capped snippets.
Recovery itself has bounded preceding records and a 24,000-character evidence
cap. None of the evidence records actually read reports omitted characters;
this does not establish complete conversation recovery. Available pertinent
historical references were read and identified separately from evidence IDs.
Several final plans, issue states, assignment manifests and external helper
files were unavailable. There was one reviewer and no independent regrade or
agreement measurement. No corpus-wide quality claim or hook tuning follows.

Private records, including full-ID selection packets, individual decisions,
run metadata and coverage verification, are under
`data/private/context-db-work/sample-review/`. They include full rubric and
sample manifest text and their checksums. The manifest SHA-256 is
`0c25ebdb1939dbc2767b4f52a16f207a59bb28ddbea381dfad374071fa8f6170`;
the rubric SHA-256 is
`6ebb81bd7d3f385ca4f971f3cf83138246b0a94e373ca641e3c118524d9d3df5`.
No raw messages or private review examples are included here.

The private import helper asserts exact coverage, full body hashes, valid
input contexts, evidence membership and the rubric's overall-grade precedence.
It inserts through `scripts/context_database.py`'s `insert_review` API in one
transaction and refuses a duplicate run rather than replacing reviews.
Full database validation and canonical export passed. The exported snapshot
contains all 30 analyses from this run. The report whitespace check passed.
Executed commands, from the repository root:

```sh
python3 data/private/context-db-work/sample-review/author_decisions.py
python3 data/private/context-db-work/sample-review/import_reviews.py
python3 scripts/context_database.py validate
python3 scripts/context_database.py export
```

The authoring/import commands are the initial-run record, not instructions to
recreate decisions over an existing run. Preserve those files and the existing
database. Validation and export are repeatable. Canonical output is
`data/private/dashboard.json`; local publication is a separate parent task.
No collector/schema, dashboard/publisher, hook or global configuration changes
were made for this review.
