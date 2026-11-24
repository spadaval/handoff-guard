# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Svelte 5 and Vite, self-contained in `dashboard/` with its own `package.json`
and lockfile. One Node 24 process (`npm run dev`) runs Vite in middleware mode
and mounts the read-only API from `scripts/dashboard-api.ts`, which reads the
ignored SQLite database with Node's built-in `node:sqlite`. Host and port come
from environment variables and default to `127.0.0.1`.

## Users

Sumeet, the project owner, working alone at a laptop, often over Tailscale on
this small host. He reads agent-to-agent messages closely and wants evidence,
not reassurance. Agents working on the project also open the dashboard to check
their own review and hook changes.

## Product Purpose

The repository studies how AI agents write to each other ("handoffs":
assignments, questions, results and updates sent between agents). One model
writes fused, compressed shorthand. The dashboard answers three questions:
how common that is, where it comes from (sender model, project, month, size),
and whether the blocking hook catches it. Sumeet considers the analysis and this
dashboard the main product of the repository; the hook is one layer of defence.

Success: he can state a prevalence figure with its sample and denominator, find
every disagreement between the hook and the model reviewers, and read any one
message exactly as written next to its review, hook result and context.

## Positioning

It puts three independent judgments of the same exact text side by side: the
model review under the `handoff-v6` rubric, the deterministic hook's checks with
character spans, and the recorded context. Disagreement between them is the
finding, not noise.

## Operating Context

- Reviews are recorded with `node scripts/handoff.ts review record RUN` into
  `analysis_records` (`kind='review'`) under `manual-review` runs. Runs fill
  while the dashboard is open; partial runs are normal.
- Samples are stratified (`pilot`, `random`, `fused`, `long`). Only `random` is a
  fair sample of the corpus; the rest are deliberately skewed.
- The hook binary `target/release/handoff-guard inspect` changes while the
  dashboard is in use. Its checks are rendered generically from the report.
- Older `gpt-6.1-sol` reviews (`intentionality-v2`) are not trusted and are a
  secondary comparison at most.

## Capabilities and Constraints

- Read-only. The API accepts GET only and opens SQLite read-only.
- Message text is private. It never enters Git, fixtures or committed
  screenshots.
- Sender model has two tiers: `recorded` (the `model` field from the turn
  context at send time, about a quarter of inputs) and `thread setting` (the
  sending thread's saved model selection at export time, excluding
  `t3_messages`, whose thread is the recipient). Unknown stays unknown.
- The rubric is shown from `docs/communication-rubric.md`; there is no copy.
- The host is small: no heavy or parallel builds.

## Evidence on Hand

All evidence is in `data/handoffs.sqlite3` (ignored): 36,078 bodies, 3,464
handoff inputs, stored hook reports for every input, 150 frozen review samples
across ten `opus-v6-*` runs. There are no testimonials or external claims.

## Product Principles

1. Exact text first. Messages render as written, with no reflow or repair.
2. Every number carries its denominator and its sample.
3. Disagreement is the point: make hook-versus-reviewer gaps one click from
   the messages behind them.
4. Unknown is a value, not a gap to fill.
5. No decoration that does not carry information.

## Accessibility & Inclusion

Light and dark follow the system preference and both must be complete.
Laptop width first; usable when narrower; no phone layout required.
