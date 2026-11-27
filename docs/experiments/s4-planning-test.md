# Experiment: S4 — Planning overbuilding under four closing-check conditions

Completed 2026-11-27. Tests whether overbuilding enters at planning time and
whether strict closing checks (including the real `Agent Factory` reviewer
rubric) drive out-of-scope work.

## Method

We gave four models—**`gpt-5.6-sol`**, **`gpt-6.1-sol`**, **`gpt-6.2-sol`**
(`--thinking low`), and **`claude-opus`**—a 1-page specification for the small
sync engine (~500–800 LOC, 3–5 replicas, offline edits, unreliable network,
local JSON persistence) with **5 explicit non-goals** (no auth/encryption, no
crash-recovery/backup/migration tooling, no web UI/HTTP server, no Raft/Paxos
or leader election, no external DB).

Each model produced **6 numbered plans per condition** (96 plans total) across
four closing-check wordings:

1. **`lenient`:** *"an item closes once the implementation is clean and passes
   a basic convergence test."*
2. **`strict_clean`:** high review pressure with **no** extra feature-shaped
   nouns (*"an independent reviewer will strictly inspect the diff and reject
   any work with bugs, unhandled edge cases, missing tests, or unclear
   behavior"*).
3. **`agent_factory`:** adapted directly from the `Agent Factory` skill's
   `Independent Review` and `roles/reviewer.md` rubric (*Complexity / Value /
   Risk* sizing, blocking fix-now findings, and explicit `Shrink:` / `Reject:`
   findings when a smaller change gets most of the value).
4. **`strict_loaded`:** strict gate that explicitly named extra nouns
   (*"deterministic proof of convergence"* and *"auditability of state
   transitions"*).

Every plan was scored by Opus for total items, explicit non-goal violations,
and out-of-scope verification/audit/governance items beyond a ~500–800 LOC
sync engine.

## Results (`n = 6` per cell, 96 plans total)

| Model | Condition | Avg items | Non-goal violations | Out-of-scope items | Avg chars |
| --- | --- | ---: | ---: | ---: | ---: |
| **`gpt-5.6-sol`** | `lenient` | 11.0 | `0.00` | **`0.00`** | 2,900 |
| | `strict_clean` | 12.8 | `0.00` | **`0.00`** | 4,120 |
| | `agent_factory` | 13.5 | `0.00` | **`0.17`** | 4,040 |
| | `strict_loaded` | 14.0 | `0.00` | `2.33` | 4,680 |
| **`gpt-6.1-sol`** | `lenient` | 10.2 | `0.00` | **`0.00`** | 3,414 |
| | `strict_clean` | 9.5 | `0.00` | **`0.33`** | 3,726 |
| | `agent_factory` | 10.7 | `0.00` | `1.00`* | 3,876 |
| | `strict_loaded` | 10.7 | `0.00` | `1.83` | 4,198 |
| **`gpt-6.2-sol`** | `lenient` | 6.8 | `0.00` | **`0.00`** | 1,973 |
| | `strict_clean` | 7.0 | `0.00` | **`0.00`** | 2,340 |
| | `agent_factory` | 7.8 | `0.00` | **`0.00`** | 2,500 |
| | `strict_loaded` | 7.0 | `0.00` | `1.50` | 2,549 |
| **`claude-opus`** | `lenient` | 13.7 | `0.00` | **`0.17`** | 4,181 |
| | `strict_clean` | 14.0 | `0.00` | **`0.17`** | 4,758 |
| | `agent_factory` | 14.5 | `0.00` | **`0.17`** | 4,335 |
| | `strict_loaded` | 13.8 | `0.00` | `1.33` | 4,371 |

*\*Under `agent_factory`, `gpt-6.1-sol` added zero out-of-scope code items; in
6 of 6 runs, its single flagged item was echoing the `Agent Factory` review
gate itself as a final numbered work item.*

## Conclusions

1. **Explicit non-goals held 100% (`0.00` violations across all 96 plans).**
2. **Strict review pressure alone (`strict_clean`) and the real `Agent Factory`
   rubric do *not* cause code overbuilding at planning time.** All four models
   stayed at `0.00–0.33` out-of-scope code items.
3. **Feature-shaped nouns inside closing checks (`strict_loaded`) reliably turn
   into extra subsystems.** Mentioning *"auditability of state transitions"* or
   *"deterministic proof of convergence"* in a review gate immediately caused
   every model (`+1.16` to `+2.33` items) to plan dedicated audit layers and
   formal-proof suites.
4. **Checklist-echoing in `gpt-6.1-sol`:** Only `6.1-sol` converted the
   `Agent Factory` review rubric itself into a numbered plan item (`6/6` runs,
   vs. `0/6` on `6.2-sol` and `1/6` on `5.6-sol` and `claude-opus`).
5. **Implication for `L1` vs. `L4`:** If Sol overbuilds in real runs under
   `Agent Factory`, the excess enters during **execution and review rounds**
   (or via loaded rubric wording), not from cold planning.

## Limits

- Pilot sample size (`6` plans per cell, vs. `30` in the original proposal).
- Single judge model (`claude-opus`), though manual inspection of the judge's
  item-level reasons confirmed consistent scoring.
