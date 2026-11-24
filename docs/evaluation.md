# Corpus and integration evidence

The guard blocks oversized handoffs and the most extreme fused prose while
leaving ordinary free-form messages alone in the reviewed sample. Historical
style recall is low: **9 of 37** reviewed pathological excerpts were caught.
**28 were missed**. There were **0 false positives among 33 reviewed normal
excerpts**. These figures are a small exploratory sample, not a corpus-wide
accuracy estimate or evidence that every ordinary message will pass.

## Corpus coverage and labels

The manifest's 36,078 distinct recoverable plaintext bodies and 86,004
observations passed integrity validation. All plaintext bodies were run through
the compiled release executable. The 18,739 opaque payloads were excluded.
Observations include mirrors and forks and are not delivery counts. Existing
exporter gaps, attachments and unrecorded arguments remain outside coverage.
The corpus spans seven project labels; there was no project/model/date filter.

3,464 distinct bodies have assignment, agent-message, follow-up assignment,
cached-message or delivered-agent input provenance. Input classification takes
precedence when a body also appears as worker output. Automatic completion
notifications, worker commentary and reports are separately classified;
peer-thread requests are not counted as covered handoff inputs. Running a
classifier over worker output does not mean a PreToolUse hook intercepts it.

Before tuning, union-find connected threads sharing exact message bodies and
sender/recipient thread relationships. This yielded 41 thread components
covering 1,723 thread identifiers. SHA-256 of each component's sorted thread
identifiers selected a reserved fifth by hash bucket. Bodies without thread
provenance use their message hash. No thread or identical body crosses splits.
Uneven component sizes produced 25,140 tuning and 10,938 reserved bodies,
including 1,178 tuning and 2,286 reserved handoff inputs.

80 opening excerpts were manually style-labeled by the implementation agent:
37 pathological, 33 normal and ten ambiguous. Selection combined long
alphabetic-run enrichment with seeded random input samples (20 of each per
split). This is biased toward fused prose. Labels assess visible style,
independently of the size policy; they do not certify the unseen remainder of
a message. All 35,998 other bodies remain **unassessed**, not normal or
ambiguous. No repetition-specific historical recall is established by this
sample. Public regression tests use authored synthetic messages.

The reserved sample was previewed before correcting an overly broad path
exemption. Final reserved scores are therefore **exploratory, not blind**.
The earlier frozen source fingerprint and earlier scorecard are retained
privately. Do not use final scores to claim an untouched held-out benchmark.
Further tuning needs a new whole-thread corpus or genuinely unseen components.

## Results

The aggregate machine-readable report is [data/evaluation.json](../data/evaluation.json).
Detailed per-body decisions, manual labels and frozen component assignments
are local files under `data/private/`.

Across all plaintext, the guard denied 47 bodies: 38 exceeded the character
limit and nine triggered glued-prose checks. No body first triggered the word
or repetition check. This does not make those checks redundant: synthetic
boundary and repetition cases test them independently.

Among handoff inputs, 17 of 3,464 were denied: eight for size and nine for
style. The remaining 3,447 passed. Eight size denials are policy decisions,
not false positives inferred from a readable style label.

The tuning style sample had six detections, 14 misses and 18 normal passes.
The reserved style sample had three detections, 14 misses and 15 normal passes.
The two tuning and eight reserved ambiguous examples are excluded from error
rates. Many misses use numerous shorter glued words, punctuation and technical
identifiers without enough qualifying long runs. The guard deliberately does
not infer missing spaces from dictionary lookup or require a message template.
Do not infer zero false positives for the thousands of unreviewed bodies.

## Actual Codex integration

Tests ran on installed **codex-cli 0.169.0**, using a temporary Codex home and
a local scripted Responses provider. The real code-mode JavaScript runtime,
native tool dispatch, hook command runner, Rust executable and fresh child
session executed. Model sampling was scripted, so this verifies runtime
interception rather than model willingness to rewrite a rejected brief.
The harness sets `features.multi_agent_v2.non_code_mode_only = false` to expose
native delegation inside code mode.

The denial scenario constructs a 52,004-character message dynamically in
JavaScript, attempts a denied spawn, creates an ordinary fresh child, then
attempts denied send-message and follow-up calls against that existing child.
All three oversized calls received the guard's denial before delivery. The
child's model requests contained none of the oversized payload. The passing
scenario delivered ordinary messages via all three paths, including a new
child task and a message followed by a new child turn. Root completion
notifications appeared separately and were not treated as hook inputs.

Codex exposes hook tool names as `collaborationspawn_agent`,
`collaborationsend_message` and `collaborationfollowup_task`. Suffix matching
also covers configured namespaces and standard plain/MCP spellings. Unit
tests cover these variants, legacy text items and JSON-string tool arguments.
The outer JavaScript source is never used as the policy input.

Failure scenarios deliberately tested a nonexistent hook command, exit code 1
and a timeout of one second. Codex still delivered normal handoffs in each
case. Explicit JSON denials blocked them. Python only wraps the hook to record
test events; production invokes the Rust binary directly.

These tests do not certify activation in the surrounding T3 app, automatic
completion-report filtering, encrypted payload decoding, or every possible
Codex version/tool envelope. No global configuration or catalog was changed.
Use the installation steps and rerun in the actual target client before
claiming global interception.

## Validation

`cargo test --locked` passes five Rust integration tests, including subprocess
execution of the compiled binary. The five existing Python corpus-export tests
pass. `scripts/validate_corpus.py` verifies the manifest and all recovered
observations. All five Codex integration scenarios pass their assertions.
Clippy could not run because the installed Rust toolchain lacks the component.
