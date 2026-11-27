# Experiment: S1 (fresh context) and S2 — Cold-start load, topic, model version, and recipient

Completed 2026-11-27. Pilot test of Claims A (Trigger), E (Reader), and the
proof-vocabulary trait using invented synthetic states from a fresh,
single-turn context.

## Questions

1. **Load and topic (`S1`):** Does packing 5, 20, or 60 structured facts into
   a cold-start handoff prompt trigger shorthand, and is coordination state
   (holds, confirmations, windows) worse than plain project status?
2. **Model version (`S1`):** Does the habit or proof vocabulary sharpen across
   `gpt-5.6-sol`, `gpt-6-sol`, `gpt-6.1-sol`, and `gpt-6.2-sol`?
3. **Named recipient (`S2`):** Does Sol write differently when told the
   recipient is another Sol agent, a Claude Opus agent, or a human engineer?

## Method

We invented two 60-fact synthetic state pools (zero corpus text):
- **Plain project status:** endpoints, commit hashes, file paths, test counts,
  config flags, and open failures for a fictional ledger service.
- **Coordination state:** shared benchmark host, coordinator socket, active vs.
  idle workers, pending ACKs, time windows, and resource ceilings.

Each prompt asked the model to write a single handoff message conveying all
facts in the state and what the next agent should do (`--no-tools`,
`--thinking low`, fresh session).

- **`S1`:** 4 available OpenAI Sol models (`gpt-5.6-sol`, `gpt-6-sol`,
  `gpt-6.1-sol`, `gpt-6.2-sol`; `gpt-5.5` was not enabled on this auth) × 3
  fact counts (5, 20, 60) × 2 topics × 3 repeats = **72 calls**.
- **`S2`:** `gpt-6.1-sol` and `gpt-6.2-sol` × 3 named recipients (`another
  gpt-6.1-sol coding agent`, `a Claude Opus coding agent`, `a human software
  engineer`) × 2 fact counts (20, 60) × 2 topics × 2 repeats = **48 calls**.

Every message was scored with `handoff-guard evaluate`, character length,
glued-token proxy count, and proof-vocabulary rate (words about proof,
evidence, and exactness per 1,000 letters).

## Results

### `S1` — By model version (`n = 18` per model)

| Model | Flagged by `handoff-guard` | Avg chars | Proof vocab / 1k letters | Glued tokens (proxy) |
| --- | ---: | ---: | ---: | ---: |
| `gpt-5.6-sol` | `0/18` | 2,400 | 2.73 | 1.28 |
| `gpt-6-sol` | `0/18` | 2,191 | 2.19 | 1.00 |
| `gpt-6.1-sol` | `0/18` | 2,629 | **3.71** | 1.00 |
| `gpt-6.2-sol` | `0/18` | 2,340 | **3.76** | 1.00 |

### `S1` — By load and topic (`gpt-6.1-sol` + `gpt-6.2-sol`)

| Slice | `n` | Flagged | Avg chars | Proof vocab / 1k letters |
| --- | ---: | ---: | ---: | ---: |
| 5 facts | 12 | `0/12` | 563 | 2.78 |
| 20 facts | 12 | `0/12` | 1,927 | 5.25 |
| 60 facts | 12 | `0/12` | 4,966 | 3.18 |
| Plain project status | 18 | `0/18` | 2,365 | 1.57 |
| **Coordination state** | 18 | `0/18` | 2,605 | **5.90** |

### `S2` — By named recipient (`gpt-6.1-sol` + `gpt-6.2-sol`, `n = 16` each)

| Named recipient | Flagged | Avg chars | Proof vocab / 1k letters | Glued tokens (proxy) |
| --- | ---: | ---: | ---: | ---: |
| Another `gpt-6.1-sol` agent | `0/16` | 3,529 | 4.05 | 1.25 |
| A Claude Opus agent | `0/16` | 3,621 | 4.11 | 1.31 |
| A human software engineer | `0/16` | 3,491 | 3.99 | 1.25 |

## Conclusions

1. **Cold-start structured load alone does not trigger shorthand (`0/120`
   flagged).** Even with 60 dense coordination facts (~5,000 characters),
   neither `6.1-sol` nor `6.2-sol` slipped into shorthand from a fresh text
   prompt. The trigger requires an in-loop execution context (tool-calling,
   thread depth, or prior shorthand)—the deep-context half of `S1` and the
   long runs (`L1`/`L4`) remain the decisive tests of Claim A.
2. **Proof vocabulary is a cold-start habit that sharpened in `6.1`/`6.2-sol`.**
   With zero failure history, proof vocabulary rose from `2.19/1k` (`6-sol`) to
   `3.71–3.76/1k` (`6.1`/`6.2-sol`), and was **3.8x higher on coordination
   state (`5.90/1k`)** than on plain project status (`1.57/1k`).
3. **No audience adaptation in fresh context (`S2`).** Naming Sol, Opus, or a
   human engineer produced indistinguishable length, vocabulary, and style.

## Limits

- Fresh single-turn text prompts only (no tool schemas, no deep transcript).
- `gpt-5.5` was unavailable on the active auth plan.
- Small pilot repeat count (`3` per cell in `S1`, `2` in `S2`); sufficient for
  a `0/120` null result on flagging, not for fine-grained variance estimates.
