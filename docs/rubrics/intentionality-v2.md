# Explain the exchange and assess communication separately

Version: `intentionality-v2`. Preserve the [v1 rubric](rubrics/intentionality-v1.md)
and earlier review runs. The standard remains: have a purpose, select what the
recipient needs, and state it clearly. Assess one body in one recorded context.

## Classify the exchange

Store the following under `classification`. Each object has `basis` (`recorded`,
`inferred`, `unknown`), a short `reason`, and supporting `evidence_ids`. Supported
inferences are useful; label them rather than silently treating them as facts.

- `sender` and `recipient`: `identity` when known and functional `role`:
  `coordinator`, `implementer`, `reviewer`, `validator`, `researcher`, `worker`,
  `user`, or `unknown`. Chat transport role `user` does not prove a human sender.
  Distinguish an explicitly assigned role from evidence it was actually executed.
- `sent_at`: recorded `value`, with `meaning` distinguishing an observation time
  from a proven send time. Never manufacture delivery timing.
- `position`: `value` is `initial`, `middle`, `final`, or `unknown`, within the
  identified exchange. Creation-tool evidence can establish an initial handoff.
  Final requires terminal-report/completion evidence; the last recovered row
  alone is insufficient. A result can occur in the middle of an exchange.
- `message_type`: primary `value` is `instruction`, `request`, `question`,
  `update`, `result`, `acknowledgement`, or `unknown`; optional `secondary` types
  preserve mixed functions. Type and position are independent.
- `task`: short `summary` of the work and `trigger` explaining why this message
  was sent. Identify the original assignment and relevant preceding exchange in
  `task.evidence_ids` when available. State when the account relies only on the
  body or sender-private history. Do not invent missing task context.

Classifications describe observed inputs and intended handoffs, not necessarily
successful deliveries. Keep mirrors distinct and preserve evidence visibility.

## Purpose

`purpose.rating` is `clear`, `unclear`, or `unknown`. Clear means the recipient
can discern the instruction, request, question, result or update. Unclear means
competing or incoherent statements obscure it. Unknown means necessary context
is unavailable. Give a concrete `reason` identifying the purpose. Short fragments
and acknowledgements can be clear; no template or task heading is required.

## Information selection

`information_selection.rating` is:

- `sufficient`: supplied information and established accessible context serve
  the purpose without a material selection defect.
- `missing_essentials`: identify a specific essential the recipient cannot get
  from the message or established accessible context.
- `excessive`: identify material irrelevant or unnecessarily reproduced content.
- `mixed`: both missing essentials and excessive material are established.
- `unknown`: evidence cannot establish what this recipient needed or could access.

Give a concrete `reason`. Repeated warnings, ownership, authorization and task
boundaries can be useful. Sender history or historical files alone do not prove
recipient access. Conversely, do not use blanket unknowns when a narrow defect
can be established from the body itself without that access assumption.

## Mechanical checks

The compiled Rust executable supplies deterministic diagnostics from the same
implementation as the hook: measured values, thresholds, pass/block status and
exact offending ranges. Do not duplicate the algorithm in Python or JavaScript.
Start with existing character/word limits, long glued alphabetic runs and extreme
word/line repetition. Show size policy separately from style findings.

No rule triggering means only that these narrow checks did not trigger. It is
not a readability pass. Candidate shorthand checks need evaluation before being
allowed to block. This pass changes neither denial thresholds nor global hook
activation and invents no composite score. Parent-generated mechanical findings
are not inputs to the independent model regrade; compare after judgments freeze.

## Readability levels

`clarity.rating` is a model judgment distinct from mechanical findings:

- `clear`: ordinary reading suffices; necessary technical syntax, Markdown,
  fragments, paths, URLs, hashes and punctuation variation are allowed.
- `minor_friction`: a local abbreviation or dense phrase needs brief
  interpretation, but operational meaning remains clear without sustained decoding.
- `difficult`: important meaning needs reconstruction of missing spaces,
  repeated needless shorthand, mixed status/count chains, rambling or conflicts.
- `unintelligible`: substantial operational meaning cannot reliably be recovered
  even using the relevant available context. Identify what cannot be understood.
- `unknown`: a justified exceptional case where readability cannot be judged.

Give a concrete `reason`. Add `issues`, each with `kind` (`fused_prose`,
`needless_shorthand`, `unclear_reference`, `rambling`, `contradiction`, or another
plain description), an exact short `quote`, and an explanation. Give a brief
`remedy` for defects. Do not penalize established terminology or literal code.

Invented calibration examples: "No blockers. The review is complete." is clear;
"Review done; CI pending." is an ordinary clear fragment. One contextual local
abbreviation may create minor friction. Repeated fused sentences and unlabeled
count chains are difficult. Reserve unintelligible for unrecoverable meaning.
Length alone never decides the level.

## Database compatibility

Each assessment keeps `reason`, optional context-local `evidence_ids`, and legacy
`grade` for the existing review API. The v2 display uses the new `rating`:

- Purpose: clear maps to pass, unclear to fail, unknown to unknown.
- Information: sufficient maps to pass; missing_essentials/excessive/mixed to fail;
  unknown to unknown.
- Readability: clear maps to pass, minor_friction to ambiguous,
  difficult/unintelligible to fail, unknown to unknown.

Retain `overall` as `{grade, reason, compatibility_only: true}` for old consumers,
with precedence fail, unknown, ambiguous, pass. It is not a new composite score.
Retain `rationale`, `evidence_ids`, message/context/run/rubric identity and model
settings. All evidence citations must belong to the chosen context; historical
reference IDs can be cited separately. Preserve provenance and recovery limits.

## Re-analysis scope

Regrade the same 30 IDs in `data/private/context-db-work/random-sample.json`.
Reuse the earlier chosen contexts in `sample-review/*.selection.json` where
possible so a rubric comparison does not silently change its evidence. Read full
bodies and relevant stored context, without consulting earlier grades or new
mechanical predictions. Do not substitute easier messages. Store a separate v2
run with exact rubric text/hash, sample identity, model/settings and limitations.
This is a calibration pilot, not corpus-wide grading or authorization to tune
hook thresholds. Preserve original labels, exports and split assignments.
