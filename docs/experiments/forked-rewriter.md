# Experiment: Forked Analysis-Mode handoff rewriter

Completed 2026-11-27. Tests whether `gpt-6.1-sol` can rewrite its own degraded
or bloated handoffs into concise, plain English inside a forked branch of the
sender's own session—without dropping real constraints and while hitting the
provider's prompt cache.

## Questions

1. **Mode switch & clarity:** Does branching the sender's session into a
   tool-free technical-editor turn eliminate shorthand and surface buried asks?
2. **Bloat vs. retention:** Can prompt framing get Sol to *cut* unnecessary
   text on 5k+ opening briefs and wordy follow-ups instead of expanding them?
3. **Cache economics:** Can a Pi extension run this forked rewrite on the
   sender's prefix cache rather than paying full uncached input on every edit?

## Method

### Offline corpus batch (`v1`–`v4`)

We drew 12 real Sol handoffs with recovered preceding sender context from the
local SQLite corpus, stratified into three buckets of 4:

- **Shorthand (4):** `914` to `2,682` chars; all 4 flagged by `handoff-guard`
  (`glued_values` or `fused_words`).
- **Bloated briefs (4):** `5,881` to `9,721` chars; 3 of 4 flagged by
  `handoff-guard` (`fused_words`, `glued_values`, `missing_spaces`).
- **Clean but wordy (4):** `981` to `1,802` chars; all 4 passed
  `handoff-guard`, though several still used telegraphic phrasing or restated
  policy.

Each case's recovered sender context was loaded into an isolated Pi session
(`.jsonl`), and `gpt-6.1-sol` (`--thinking low`, `--no-tools`) rewrote the
draft under four prompt variants (starting from an uncontaminated copy of the
same session for every variant):

- **`v1` (preserve everything):** Warned that the recipient lacked the
  transcript and instructed Sol *not* to drop any real constraint, acceptance
  criterion, file path, or boundary.
- **`v2` (negative cut rules):** Prioritized keep order (ask → pointers →
  non-obvious constraints) plus an explicit list of `"Do NOT..."` cut rules
  (no pulling background from earlier turns, no restating files/records, no
  standing workflow boilerplate).
- **`v3` (cut rules + hard budget):** Same as `v2`, plus a concrete character
  ceiling (`2,500` chars for `>= 5k` briefs; `min(1800, max(800, 0.85 * draft))`
  for shorter messages).
- **`v4` (positive minimal-information):** Zero `"Do NOT"` rules and zero
  character caps. Asked Sol to consider what the recipient already knows (from
  their role, existing thread, or linked records) and provide the minimal
  information needed for their next step in plain English.

Every rewrite was scored with the compiled `handoff-guard evaluate` binary,
and representative cases across all three buckets were inspected by hand for
dropped constraints versus removed bloat.

### Live Pi extension & prompt-cache test

A throwaway Pi 1.6.1 extension intercepted a `send_handoff` tool call in
`tool_call`, ran the forked `v4` rewrite, mutated `event.input.message` in
place for the receiver, and rewrote the tool-call argument in
`pi.on("context")` so the sender's own active context sees the clean version
(preventing self-priming).

## Results

### 1. Length and `handoff-guard` pass rates (`n = 12` per variant)

| Bucket (4 cases each) | Raw draft | `v1` (Preserve) | `v2` (Cut rules) | `v3` (+ Budget) | `v4` (Positive) |
| --- | ---: | ---: | ---: | ---: | ---: |
| **Shorthand** | 7,775 (`0/4` pass) | 13,862 (`1.78x`, `4/4`) | 5,811 (`0.75x`, `4/4`) | 5,091 (`0.65x`, `4/4`) | **5,005 (`0.64x`, `4/4`)** |
| **Bloated briefs** | 32,287 (`1/4` pass) | 44,847 (`1.39x`, `2/4`) | 22,254 (`0.69x`, `4/4`) | 10,960 (`0.34x`, `4/4`) | **14,154 (`0.44x`, `4/4`)** |
| **Clean but wordy** | 5,636 (`4/4` pass) | 10,120 (`1.80x`, `4/4`) | 3,370 (`0.60x`, `4/4`) | 3,858 (`0.68x`, `4/4`) | **3,435 (`0.61x`, `4/4`)** |
| **All 12 cases** | 45,698 (`5/12` pass) | 68,829 (`1.51x`, `10/12`) | 31,435 (`0.69x`, `12/12`) | 19,909 (`0.44x`, `12/12`) | **22,594 (`0.49x`, `12/12`)** |

- **Tag and guard compliance:** `v2`, `v3`, and `v4` each achieved `12/12`
  valid `<rewritten>` extractions and `12/12` `handoff-guard` passes (clearing
  all 7 raw presentation failures). In `v1`, two bloated briefs expanded past
  the `12,000`-character limit (`9.7k → 12.4k` and `9.7k → 15.0k`).
- **Latency and uncached batch cost:** `v4` averaged **11.4s** per rewrite at
  **$0.0136/msg** uncached (`$0.1630` across 12 cases), compared to 14.5s
  (`$0.0146/msg`) for `v2` and 11.2s (`$0.0107/msg`) for `v3`.

### 2. Qualitative findings across prompts

- **Why `v1` inflated every message (`1.11x–2.72x`):** Telling Sol that the
  recipient lacked the transcript while forbidding it from dropping any
  constraint caused it to treat every restated rule as mandatory and to import
  earlier conversation history into already-clean follow-ups (one `981`-char
  follow-up grew to `2,667` chars).
- **Why `v4` beat both `v2` and `v3` overall:**
  - Framing the task positively around **theory of mind** (*what the recipient
    already knows vs. what they need for their next step*) shrank all 12
    cases without a single `"Do NOT"` rule or character cap.
  - On the `981`-char follow-up where `v1` dumped 1,700 chars of history and
    `v2` was forbidden from adding anything, `v4` recognized that the
    recipient's thread already held the investigation, pulled in only the two
    missing task/provenance pointers, and still finished shorter (`956` chars).
  - On the `5.8k–9.7k` bloated briefs, `v4` naturally landed at `2.8k–3.9k`
    chars (`0.44x`)—cutting standing boilerplate and restated records while
    retaining specific task constraints. `v3` compressed further (`2.65k–2.81k`,
    overshooting its `2,500`-char cap by 6–12%) by collapsing inline parameter
    lists into generic pointers, which is only safe when the linked record
    already contains every parameter.
  - Giving `v3` an `85%` length cap on shorter messages anchored Sol *upward*
    on `clean_wordy` (`0.68x` vs. `0.60x` in `v2` and `0.61x` in `v4`).

### 3. Live Pi extension & prompt-cache hit

Running the `v4` extension on a live Pi session (preloaded with a `~4.3k`-token
prefix) cut Sol's live draft from `3,332` chars to `986` chars (`0.30x`) in
`7.0s`:

| Call | `cacheRead` | Uncached `input` | `output` | Cost |
| --- | ---: | ---: | ---: | ---: |
| Parent Turn 1 (drafts handoff) | 4,224 | 127 | 703 | $0.0077 |
| **Forked `v4` rewrite** | **4,224** | 1,022 | 287 | **$0.0053** |
| Parent Turn 2 (after `pi.on("context")` rewrite) | 4,224 | 357 | 34 | $0.0015 |

**100% of the `4,224`-token parent prefix hit the OpenAI prompt cache** on
both the forked rewrite and the parent's follow-up turn.

## Recommended production pattern for Pi (`L5`)

### Prompt (`v4`)

```text
Pause execution and switch to technical editor mode.
You just drafted the following handoff message to another agent:

<draft>
${draft}
</draft>

Think carefully about the recipient: what they already know from their role, their existing thread, or files and records you can point them to, and what they actually need from you right now to take their next step well.

Provide the minimal amount of information possible in clear, ordinary English:
- Lead with the exact ask or decision.
- Include concrete pointers (task/item IDs, commits, file paths) so the recipient can read full details directly instead of having them repeated.
- Include only the essential, task-specific facts or constraints the recipient needs for their next step.
- Write every technical term, identifier, and instruction plainly so a reader can understand it in one pass.

First, in 2-3 short bullets, note what the recipient actually needs for their next step and what they can already get from their thread or linked records.
Then output ONLY the edited handoff inside <rewritten>...</rewritten> tags.
```

### Pi 1.6.1 extension mechanics

1. **Keep the forked call tool-free and single-turn.** Do not give the editor
   read/bash tools; the fork already inherits everything the parent read, and
   tools risk pulling Sol back into execution-mode loops.
2. **Preserve the prompt cache via `before_provider_request` + `onPayload`.**
   Calling `@earendil-works/pi-ai/compat`'s `completeSimple()` with
   `ctx.getSystemPrompt()` + `buildSessionContext()` + `tools` busts the cache
   in Pi 1.6.1 because Pi's `TranscriptContext` already stores system and tool
   declarations inside `messages`. Instead:
   - In `pi.on("before_provider_request")`, clone `event.payload` into
     `lastParentPayload`.
   - In `tool_call`, call `completeSimple()` with an `onPayload` override that
     clones `lastParentPayload`, appends one user message with the `v4` prompt,
     and sets `tool_choice: "none"`.
3. **Rewrite both sides of the wire.** Mutate `event.input.message` in
   `tool_call` so the recipient gets the clean message, and rewrite the same
   tool-call argument in `pi.on("context")` so the sender's own active context
   does not self-prime on its raw draft.
4. **Post-check with `handoff-guard`.** Keep the deterministic Rust guard as a
   fast sanity check on the rewritten output.

- **Cross-check on `gpt-6.2-sol` (`v4`, `n = 12`):** Passed `12/12` on
  `handoff-guard` (`12/12` valid `<rewritten>` tags), averaging **10.5s** and
  **$0.0130/msg** uncached (`$0.1563` total). Totals: **shorthand** `5,076`
  (`0.65x`), **bloated briefs** `11,430` (`0.35x`, cutting the `9.7k` brief
  to `2,120` chars while preserving all P1 checks, commit pointers, and
  offline boundaries), **clean wordy** `3,527` (`0.63x`). Even if `6.2-sol`
  collapses harder in execution mode, its Analysis-Mode editing basin is
  intact and slightly tighter than `6.1-sol`'s.

## Limits

- Small, hand-stratified sample (`n = 12`); this validates the rewriter design
  and prompt framing, not long-run spread prevention (`L5`).
- Constraint retention was audited by hand on representative cases rather than
  by blind recipient execution (`S3`) or human rubric scoring.
- Tested at `--thinking low` on `gpt-6.1-sol` and `gpt-6.2-sol`; higher
  thinking levels were not tested here.
