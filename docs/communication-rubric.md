# Have an intent, choose the information, present it clearly

Version: `intentionality-v5`.

Assess one message in its recovered context. The dashboard shows the exchange
(sender, message type, recipient), the unchanged original, strategic context,
then two tactical assessments. Do not require this structure in the message.

## Strategic context: situation and intent, without scores

**Situation:** what work is underway, what just happened and what the recipient
can reasonably know or retrieve. **Intent:** what the sender wants this recipient
to understand, decide, answer or do. State the intended payload concretely. For
an update, name the status or changed facts to convey; for a request, name the
requested action and constraints. Do not score a message without identifying
that target first. Unknown context stays unknown.

These are model interpretations for the human reader and subsequent assessors.
Inference is the default. Mark only explicit source facts as recorded. An assigned
role is not proof that the role was performed. Observation time is not proven send
time. Reference recovered evidence, without assuming sender-private history was
available to the recipient. Do not invent an outcome.

## Tactical scores: two independent five-point scales

Higher is better. Do not combine the dimensions into one grade. Each model score
needs a concrete reason grounded in the situation and intended payload. Scores
1–4 require an exact example and a useful repair. Use null when missing evidence
prevents judgment, rather than manufacturing a middle score.

### Information selection

Judge whether this recipient receives what is needed for the stated intent,
without unnecessary duplication or irrelevant material. Consider essentials,
recipient access, relevance and duplication. Length alone cannot establish any
of those semantic defects.

| Score | Anchor | Evidence needed |
| --- | --- | --- |
| **5 · Ready to send** | The intended information is complete, relevant and economical. Authoritative references are usable by this recipient. | Identify the intended payload and how it is supplied or accessible. |
| **4 · Minor polish** | The recipient can act correctly; one nonessential detail is missing or one local passage is unnecessary. | Name the small addition or deletion; explain why action remains possible. |
| **3 · Revision needed** | One material omission or substantial avoidable passage creates a follow-up or distracting detour, but the core intent is recoverable. | Identify the specific missing fact or unnecessary passage and its consequence. |
| **2 · Major revision** | Several essentials are missing, recipient knowledge is seriously misjudged, or a large record dump obscures what the recipient needs. | Show why the recipient must reconstruct the assignment or obtain substantial context. |
| **1 · Unusable** | There is no reliable actionable payload for this recipient, or conflicting/outdated instructions make acting unsafe or indeterminate. | Identify the unrecoverable payload or incompatible instructions. |

A long necessary assignment can score 5. A short message can score 1. Repeating
authorization, scope boundaries or warnings can be necessary. Prefer references
to records the recipient can readily retrieve, while supplying necessary local
context. Do not assume that every reference is accessible.

### Presentation

Judge the reading effort needed to recover the information as written. Consider
word spacing, ordinary English, punctuation, needless shorthand, organization,
references and repetition. Penalize needless decoding rather than unfamiliar
subject matter. Technical syntax belongs in code, literal data, paths, hashes,
URLs and established terminology. Ordinary Markdown and concise fragments are
allowed. `blockers[]` in prose is needless encoding when "No blockers" says the
same thing; those characters in a real API payload can be appropriate.

| Score | Anchor | Evidence needed |
| --- | --- | --- |
| **5 · Ready to send** | Ordinary reading is enough; clauses, referents and sequence are clear. | Explain briefly why no avoidable decoding is needed. |
| **4 · Minor polish** | One local spacing, shorthand or organization issue needs a brief reread, without changing the operational interpretation. | Quote the isolated friction and provide a local repair. |
| **3 · Revision needed** | Repeated shorthand, fused prose, weak structure or unlabeled chains require reconstruction, but the important meaning is recoverable. | Quote representative defects and state the meaning the recipient must reconstruct. |
| **2 · Major revision** | Sustained decoding or rambling obscures much of the message; at least one material clause remains ambiguous despite context. | Identify the ambiguity and the needed reorganization or rewrite. |
| **1 · Unusable** | Substantial operational meaning cannot reliably be recovered, even with relevant available context. | Identify the unrecoverable instruction or fact; do not merely say "confusing." |

## Hook checklists and limited scores

Each tactical section groups **Hook**, then **Model**, then **Agreement**.
Checklists show a checkmark for a measured pass, a cross for a measured failure,
and a dash for unimplemented or missing checks. Include the measured value and
actual threshold. An unimplemented check is never a pass.

Information selection's checklist contains character and word limits only.
Its continuous score describes **length burden**, not relevance or completeness.
With u = max(characters/12000, words/1500), the score is clamp(5 − 2u, 1, 5).
It declines linearly to 3 at the current budget and 1 at twice that budget.
Denial still begins strictly above the existing budget; the display score is
not the denial decision. Necessary long assignments can still receive a high
model information-selection score.

Presentation uses continuous normalized surface loads:

- Glued prose: long-run-letter percentage / 50.
- Repeated words: min((most-frequent count − 1)/79, most-frequent percentage/80).
- Repeated lines: min((dominant-line count − 1)/9, repeated-character percentage/80).
- Each new advisory: 5 × matches / max(20, eligible prose words).

Clamp negative loads to zero. The presentation score is
5 − 4 × clamp(max(surface loads), 0, 1). The worst signal determines the score;
defects are not added together. A single occurrence is not repetition. A minimum
20-word denominator keeps one match in a tiny fragment from saturating a score.
These are clamped, piecewise-linear measurement scores with no step changes at
pass/fail thresholds. The display rounds to one decimal; partial dot fills use
the unrounded value. They are not calibrated probabilities or model grades.

The dashboard computes these scores from compiled-Rust measurements without
duplicating detection algorithms. Model scores retain the anchored integer scale
above. Missing measurements produce no score.

The two new Rust diagnostics are advisory:

- Punctuation spacing finds missing spaces after commas, semicolons, question
  marks and exclamation marks between alphabetic runs (at least three letters
  before and two after). Periods and colons are deliberately excluded because
  member access, file references and command names frequently use them.
- Needless shorthand finds bare `blockers[]` or `risks[]` status markers and
  three-or-more alphabetic words joined with plus signs. Literal array fields,
  two-part chains and mixed path/notation forms are not broadly recognized.

Fenced/indented code, quoted examples, recognized import lines, JSON-like lines,
Markdown tables and recognizable technical tokens are excluded conservatively.
Exclusions create misses and are not an English parser. Every match has exact
Unicode scalar spans. The checklist uses an advisory finding state instead of
pretending that these signals block handoffs. Existing denial thresholds and
global settings are unchanged. See [calibration](style-signals-calibration.md).

## Agreement

Agreement compares the signals within their stated coverage, not identical
semantic knowledge. A hook pass means no blocking or advisory rule flags that dimension. An advisory
finding can disagree with the model without denying delivery. A model score
of 4–5 is acceptable with at most local polish; 1–3 calls for revision. Report
"Both find no issue," "Both flag an issue," "Different findings," or "Not
comparable yet." Information agreement is qualified by the hook's length-only
scope. Never imply that a length check establishes complete information.

Existing explicit model pass/fail judgments can support a directional agreement
line, but cannot be converted into a new numeric score. Ambiguous or unknown
judgments do not support an agreement claim. Preserve a disagreement, such as
"Hook passes; model calls for revision," rather than averaging it away.

## Recording and grading

New model reviews store `information_selection.score` and `presentation.score`
as integers from 1 to 5, or null. Each includes `reason` and `issues` with exact
quotes, their effect and a repair. Store situation and intent under
`classification.task` and `purpose.reason`, without numeric purpose scores.
Bind the review to the message, context, exact rubric and reviewer.

Current v2 explanations remain identifiable model observations. Their new
numeric scores are absent until freshly graded under these anchors. Do not map
"sufficient" to 5 or "difficult" to 2. V1 assessments remain excluded. A fresh grading run is required before populating the new numeric model scores.
