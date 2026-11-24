# Grade a handoff for its recipient and purpose

The agreed communication standard has three parts:

1. Have something to convey.
2. Choose the information this recipient needs to understand or act on it.
3. State it in clear, ordinary English.

Version: `intentionality-v1`. Assess observable communication, not a model's
internal intention. Evaluate a specific message in a specific recorded context.
A status update, question, acknowledgement or short fragment can have a clear
purpose; every message need not be a new command or a complete task brief.

## Purpose

Can the recipient tell what is being requested, reported or asked, using the
message and context they could access? Identify that purpose in the reason.
Do not require an explicit task heading, template or success criterion when the
existing exchange already establishes them. An incoherent mixture of competing
instructions or unrelated claims may fail even when individual sentences parse.

## Information selection

Does the message supply what the recipient needs and resolve which instructions
apply now? Consider missing essentials, irrelevant history, repeated directives,
contradictory overrides, and lengthy restatements of readily accessible records.
Distinguish assignment-specific authority, ownership, current changes and useful
warnings from redundant context. Do not assume every repeated safety constraint
is unnecessary. A path or issue reference alone does not establish historical
availability or recipient access. Sender-private evidence is not automatically
recipient-visible. Grade unknown when the necessary context cannot be recovered.

## Clarity

Can the recipient understand the message without decoding avoidable shorthand,
invented words, fused prose, rambling or unnecessary pseudo-formal notation?
Use the user's standard of clear ordinary English rather than mere technical
decipherability. Ordinary technical terms, code, machine schemas, URLs, paths,
hashes, Markdown, punctuation variation and short fragments are allowed. Avoid
grammar policing and mandatory prose where literal technical syntax is needed.
Length is a separate size-policy measurement; length alone does not fail this
dimension. A short cryptic message may fail and a necessary long explanation pass.

## Grades and evidence

For each dimension record a grade and a concrete reason:

- `pass`: the available evidence supports the dimension.
- `fail`: identify a specific communication defect and its effect on the recipient.
- `ambiguous`: relevant evidence is available but the boundary remains debatable.
- `unknown`: evidence needed to judge the dimension is missing or inaccessible.

Reasons cite recovered evidence IDs where the judgment depends on context. State
visibility and historical-source limits. A clarity grade can be definite even
when information selection is unknown. Describe a brief possible rewrite or
remedy for each failure without inventing missing task facts.

Overall is `fail` if any dimension definitely fails; otherwise `unknown` if any
dimension is unknown, `ambiguous` if any dimension is ambiguous, and `pass` when
all pass. Preserve all individual grades so this summary does not hide uncertainty.
Keep previous style labels separate; they are not ground truth for this rubric.

## Initial random sample

Select 30 distinct handoff input bodies uniformly without replacement from the
frozen 3,464-body input inventory, sorted by message ID, with Python's
`random.Random("intentionality-pilot-v1-20261123")`. Freeze the selected IDs before
reading their new context or grades. The private selection manifest records
original split membership and inventory checksum. No substitution for missing
context: record unknown where appropriate. Context-dependent judgments identify
the actual chosen evidence context; do not pool observations as delivery counts.

This is an exploratory pilot. No hook tuning or corpus-wide quality claims follow
automatically from it. Preserve original labels, exports and reserved splits.
