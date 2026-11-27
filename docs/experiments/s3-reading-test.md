# Experiment: S3 — Reading test (original shorthand vs. plain rewrite)

Completed 2026-11-27. Pilot test of Claim F (Harm): does a recipient model
actually lose comprehension when reading Sol's raw shorthand compared to its
plain-English rewrite?

## Method

We sampled **16** handoffs from the 53 reference-reviewed handoffs with plain
rewrites in the local SQLite corpus:
- **10 from the hard `[unclear: ...]` group** (passages where the reference
  reviewer could not decode at least one span).
- **6 from the decodable group** (shorthand the reference reviewer could
  rewrite cleanly).

Two reader models—**`gpt-6.1-sol`** (`--thinking low`) and **`claude-opus`**—
each read the **original** and the **plain rewrite** in separate, isolated
cold-read calls (64 reader calls total) and returned JSON naming:
1. `exact_ask`: the exact requested action.
2. `key_constraints`: up to 6 key constraints, prohibitions, or limits.
3. `undecodable`: any passages or codes they could not reliably decode.

For each `(handoff, reader)` pair (32 pairs total), a blind Opus judge saw the
reference intent statement and reference rewrite alongside anonymized answers
`A` and `B` (randomized order) and scored ask accuracy, count of missed or
misdecoded material details, and overall winner.

## Results

| Reader | Group (`n`) | Ask accurate (Orig → Rewrite) | Avg errors (Orig → Rewrite) | Blind judge wins (Rewrite / Orig / Tie) | Avg undecodable items per msg (Orig → Rewrite) |
| --- | --- | ---: | ---: | ---: | ---: |
| **`gpt-6.1-sol`** | Hard `[unclear:]` (`10`) | `8/10 → 9/10` | **`1.90 → 1.40`** | **5 / 2 / 3** | — |
| **`gpt-6.1-sol`** | Decodable (`6`) | `6/6 → 6/6` | `1.67 → 1.83` | 1 / 2 / 3 | — |
| **`gpt-6.1-sol`** | All (`16`) | `14/16 → 15/16` | `1.81 → 1.56` | 6 / 4 / 6 | `3.50 → 3.13` |
| **`claude-opus`** | Hard `[unclear:]` (`10`) | `10/10 → 10/10` | **`2.10 → 1.70`** | **8 / 2 / 0** | — |
| **`claude-opus`** | Decodable (`6`) | `5/6 → 6/6` | `1.83 → 2.17` | 2 / 3 / 1 | — |
| **`claude-opus`** | All (`16`) | `15/16 → 16/16` | `2.00 → 1.88` | 10 / 5 / 1 | `6.25 → 5.19` |

## Conclusions

1. **Severe shorthand hurts Sol itself—not just other labs or humans.** On the
   10 hardest `[unclear:]` handoffs, plain rewrites cut Sol's material errors
   from `1.90` to `1.40` (blind preference `5–2`, `3` ties) and cut Opus's
   errors from `2.10` to `1.70` (`8–2`, `0` ties). That is the first direct
   evidence for Claim F (Harm).
2. **Milder decodable shorthand is roughly a wash on a single cold read.** On
   the 6 decodable handoffs, both readers recovered the ask reliably on raw
   text, and plain rewrites occasionally lost a minor detail (`1–2` for Sol,
   `2–3` for Opus).
3. **Cold-read rewrites leave `private_reference` unresolved.** Even after
   shorthand was rewritten into plain English, cold readers still flagged an
   average of **3.13 (Sol)** to **5.19 (Opus)** undecodable private codes or
   labels per message (down only slightly from `3.50` / `6.25`). Translating
   private references requires the sender's context—matching the design of the
   forked rewriter in [forked-rewriter.md](forked-rewriter.md).

## Limits

- Small pilot sample (`n = 16`, 32 judged pairs).
- Opus served as both the author of the reference rewrites and the blind
  comprehension judge, which may favor rewrite phrasing on close calls.
- Measures single-message cold comprehension, not multi-hop compounding drift
  (`L4`).
