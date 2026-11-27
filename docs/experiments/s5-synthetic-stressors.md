# Experiment: S5 — Synthetic stressor ladder (what actually triggers shorthand?)

Status: **Gate running** (2026-11-27, revised after Council Round 1 with
Claude Fable 5.2 and GPT 6.2 Astra).

## Motivation

Two findings narrowed where `gpt-6.1-sol`'s shorthand comes from:
- **[S1 (fresh context)](s1-s2-cold-writing.md):** `0/72` flagged even at 60
  dense coordination facts (~5,000 chars) in a fresh single-turn text prompt.
- **Sync-engine 4-phase pilot (`Pi raw`):** `2/38` raw drafts flagged (`5.3%`)
  across 38 handoffs and 1 threshold compaction (`63.3K` tokens), with `100%`
  pass on all 9 hidden simulator scenarios—zero shorthand spiral (though proof
  vocabulary jumped 3.6x in the second half, `1.8 → 6.5` per 1k letters).

Meanwhile, a provisional read-only cut of `3,737` `gpt-6.1-sol` handoffs in
`data/handoffs.sqlite3` (`78` threads) showed where shorthand actually starts:

| Guard-flagged, by length (chars) | `< 400` | `400–1k` | `1k–2k` | `2k–4k` | **`> 4k`** |
| --- | ---: | ---: | ---: | ---: | ---: |
| **Thread's first handoff** | `0/13` | `2/23` | `2/11` | `3/8` | **`22/23`** |
| **Previous handoff clean** | `8/135` | `128/619` | `92/238` | `40/82` | `8/25` |
| **Previous handoff flagged** | `79/131` | `789/931` | `616/663` | `320/335` | `499/500` |

- **Half of all threads that go bad (`29/58`) are flagged on their very first
  handoff** (`37/58` by their third), with median length `5,691` chars (`28/29`
  trip `glued_values`).
- Our `sync-engine` Pi pilot averaged `740` chars, where the corpus
  first-handoff flag rate is also low (`2/23`).

Finally, **decoherence is broader than shorthand**: fused words and glued
values are the most visible symptom, while the underlying failure is failing to
carry intent forward cleanly—scattering into tangential checks, unnecessary
holds, or dropped constraints.

## Experimental Settings

- **Reasoning effort:** `--thinking high` everywhere (Sol spends thinking
  tokens working itself into paranoia and defensiveness), with `low` only as a
  later contrast if needed.
- **Sample sizing:** Start lean with **1 run per case/cell** to screen for
  signal, scaling up only on rungs that fire.
- **Model:** `openai/gpt-6.1-sol` first; add `gpt-6.2-sol` only to confirm
  rungs that fire.
- **Natural Execution Basin:** End histories on a realistic tool output (or
  natural task state) with `delegate_task` / `send_message` available, rather
  than a user question asking *"write a handoff"* (which triggers the clean
  answering frame). Track tangential tool calls as **scatter** alongside prose.

## Step 0: Positive-Control Gate (run first)

Before running synthetic stressors, verify that Pi at `--thinking high` can
reproduce the phenomenon on real infected contexts from `data/handoffs.sqlite3`:

- **Method:** Load **6** real flagged `gpt-6.1-sol` sender contexts (`3` long
  `>= 4k` briefs + `3` mid-length `800–3.5k` handoffs) into isolated Pi
  sessions in scratch (outside Git), ending on the final chronological rollout
  event (with `delegate_task`, `send_message`, and a read-only snapshot
  `exec_command` stub).
- **Reading:**
  - If Sol emits shorthand and/or scatters into tangential checks here, the
    elicitation setup works and we run the synthetic stressor ladder next.
  - If even real infected contexts stay clean in Pi, stop and diagnose what
    Codex / the work host had that this Pi setup lacks.

## Pass 1: Matched Synthetic Stressor Rungs (after gate passes)

Built using Arm A's real Sol lead style / tool turns and real Pi compaction,
testing **matched pairs** where length, facts, and recipient stay comparable
while varying the suspected trigger:

| Rung | Matched stressor contrast | What it isolates |
| --- | --- | --- |
| **Standing context** | Bare Pi prompt vs. `Agent Factory` skill + `atelier`-style item record vs. Codex-like delegation prompt | Whether standing instructions/schemas spark `>4k` Handoff #1 failures |
| **Provenance & prohibition debt** | 6 review rounds (all **accepted** vs. **rejected** with stacked `"preserve X / no Y"` rules), ending in a fresh reviewer delegation | Whether accumulated provenance & prohibition debt triggers shorthand and intent loss apart from length |
| **Concurrent contention** | 5 concurrent workers sharing one host socket (late ACK **confirms** authority vs. **conflicts** with it) | Whether live async contention triggers short paranoid holds & scatter |
| **Seeded contagion (`Rung 5a`)** | Clean vs. real Sol shorthand **opening brief** | Causal test of Claim B (Spread) at Handoff #1 |
| **Seeded self-priming (`Rung 5b`)** | Two prior lead handoffs as **real Sol shorthand** vs. **plain rewrites** of the same facts, then a clean intermediate turn, then next handoff | Causal test of Claim C (Persistence) |
| **Real Pi compaction (`Rung 6`)** | Run Pi's real compactor on the provenance-debt history before the next delegation | Whether sitting immediately after compaction triggers shorthand or drops constraints |

## Measures

Every handoff is scored on **both** prose hygiene and intent coherence:
1. **Length-normalized shorthand:** fused-word runs and glued values **per
   1,000 characters** (separating prose fusion from inline identifiers), plus
   `handoff-guard evaluate` (style vs. size rules).
2. **Early register signals:** proof vocabulary per 1,000 letters and
   function-word share (lower = more telegraphic).
3. **Behavioral scatter:** count of `exec_command` / tangential verification
   calls before delegating, missing delegation calls, and reasoning tokens.
4. **Intent & decision fidelity (on synthetic fixtures):** each synthetic world
   carries a 4-item answer key (*authorized next action*, *binding
   constraint*, *superseded fact*, *irrelevant detail*), scored by a blinded
   reader using only what the recipient could know.
