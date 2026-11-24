# Clear purposes can still require difficult reading

The frozen 30-message pilot was re-analyzed with `intentionality-v2`. All
30 messages have a discernible purpose. Ten require sustained decoding of
fused prose or compressed status/count chains. Those are separate judgments:
a readable purpose does not establish clear expression, and length alone does
not establish either excessive information or difficult reading.

The independent subjective run is
`intentionality-v2-sol-pilot-20261123-01`. It contains exactly the same 30
message IDs, once each, and reuses all 30 earlier chosen context IDs. Earlier
runs, reports, bodies and split assignments are preserved. No earlier decision,
historical grade or new mechanical prediction was used in this re-analysis.

## Dimension counts

| Dimension | Rating | Messages |
| --- | --- | ---: |
| Purpose | clear | 30 |
| Purpose | unclear / unknown | 0 / 0 |
| Information selection | sufficient | 28 |
| Information selection | unknown | 2 |
| Information selection | missing_essentials / excessive / mixed | 0 / 0 / 0 |
| Clarity | clear | 9 |
| Clarity | minor_friction | 11 |
| Clarity | difficult | 10 |
| Clarity | unintelligible / unknown | 0 / 0 |

The two unknown information judgments concern short progress updates whose
chosen delivery-side evidence does not establish the sender's original
assignment or the recipient's existing ledger and revision vocabulary. They
retain clear purposes and independently assessed readability. The other
messages supply concrete assignments, results, requests or authoritative
retrieval commands. No material irrelevant content or specific inaccessible
essential was established in those 28 contexts. This is a contextual pilot
judgment, not evidence that their recipients successfully acted.

## Exchange classification coverage

Every review records sender, recipient, observation timestamp, position,
message type and task summary/trigger, with basis, reason and context-local
evidence citations.

| Classification | Values and message counts |
| --- | --- |
| Sender functional role | coordinator 21; implementer 9 |
| Recipient functional role | implementer 11; coordinator 7; reviewer 6; researcher 3; validator 2; worker 1 |
| Position within the identified exchange | initial 14; middle 16; final 0; unknown 0 |
| Primary message type | instruction 19; update 8; request 2; result 1 |

Secondary types retain selected mixed functions. A result remains in the middle
when it reports an outcome while awaiting disposition. No message is called
final merely because recovery stopped there. Initial positions rely on recorded
creation/delegation provenance; continuing positions are explicit inferences.

All sender-role classifications are inferred from observed coordination or
implementation communication. Seven recipient roles are explicitly assigned
reviewer/validator roles; the other 23 are inferred functional roles. An assigned
role does not prove its execution. All senders have recorded thread identifiers;
17 recipients have recorded thread identifiers, while 13 recipient identities
remain unknown. A transport `user` role is never treated as proof of a human
sender. Thread identifiers are actor locators, not verified personal identities.

All 30 timestamp values are retained as observation times. None is promoted to
a proven send time or successful delivery time. Task accounts are marked inferred
and cite the body plus relevant recorded antecedents, preserving their original
visibility limits.

## Representative findings

A one-line instruction to run the authoritative tracker review command can be
clear and sufficient. It need not reproduce the review procedure that the command
retrieves. Structured assignment fields and literal commands can also be clear.

A long native-validation assignment can supply relevant input identities,
permissions, preservation rules and acceptance outcomes. Its length does not
by itself establish excess. Repeated ownership and authorization boundaries
can be operationally useful in these exchanges.

A single attached count or local abbreviation can create minor friction without
obscuring the operational meaning. Repeated missing spaces and unlabeled chains
of cases, phases, durations and statuses require more substantial reconstruction.
The latter receive difficult, even when their main purpose remains clear.

No sample was judged unintelligible: operational meaning remained recoverable
with the relevant evidence. The private decisions preserve exact short quotes,
issue explanations and remedies. This public report uses general descriptions
and copies no original private message text.

## Missing context and calibration limits

All 30 chosen contexts remain partial. They comprise 18 turn-item observations,
five delivery-side message observations, three subagent records and four audit
cache observations. Mirrors remain observations rather than unique deliveries.
The selected packets retain 350 sender-context evidence links, 175 links with
unknown visibility and 26 recipient-visible links. These are packet-link counts,
not counts of distinct deliveries or evidence records across the database.

The packets have 61 recovered historical reference entries and 117 unavailable
entries. A historical blob can clarify terminology or task scope, but does not
prove the file's precise state or the recipient's access when the handoff was
observed. Recovery is bounded and sometimes capped; setup prompts, sender history
and cached anchors do not become complete recipient conversations.

This is one model's independent re-analysis of a frozen random sample of distinct
input bodies. Sol (`gpt-6.1-sol`, high reasoning effort) performed the judgments;
temperature and sampling seed were not exposed. The work supplies no inter-rater
agreement estimate and no corpus-wide prevalence estimate. A different rubric
version can change category boundaries; no numerical comparison with earlier
grades was used to decide these ratings.

Mechanical checks were outside this review. No threshold, hook activation or
Codex configuration was changed. This report cannot establish installation
blocking behavior, deterministic false-positive rates or mechanical misses.
Legacy grades and the precedence-only `overall` field are stored solely for API
compatibility; the three v2 dimensions remain the substantive judgments.

## Reproducibility and checks

The private run directory is
`data/private/context-db-work/sample-review-v2/`. It contains separate selection
packets, decisions, full rubric/sample metadata, serialization code and validation
results. The run metadata stores the exact rubric and full frozen sample.

- Rubric SHA-256: `ab1807b62a329225e5a338115bb02744de2b44dc2bf3b1a855f6c91ac1282772`.
- Sample-file SHA-256: `0c25ebdb1939dbc2767b4f52a16f207a59bb28ddbea381dfad374071fa8f6170`.

All 30 reviews were inserted through `context_database.insert_review`. Validation
checks exact sample coverage once each, original context reuse, exact database
bodies, valid message/context ownership, nested context-local evidence citations,
exact quote substrings, rating enums, legacy mappings, compatibility precedence
and database review persistence. The canonical database validator additionally
checks corpus bindings and database integrity.

Run these commands from the repository root to validate the frozen run without
inserting it again:

```sh
python3 data/private/context-db-work/sample-review-v2/validate_and_insert.py
python3 scripts/context_database.py validate
git diff --check -- docs/context-pilot-v2.md
```

The insertion flag intentionally refuses an existing run. No dashboard snapshot
was exported; the parent workstream can integrate the frozen subjective results
with its separately generated mechanical diagnostics.
