# Handoff Guard

Build a small Rust executable that rejects massive or obviously pathological
agent handoffs. Preserve ordinary free-form messages; do not require a template,
particular headings, or an Atelier-specific task line.

- Prefer a few understandable deterministic rules over a growing exception list.
- Measure false positives and misses against historical messages. Keep style
  labels separate from size policy, and keep ambiguous examples ambiguous.
- Keep code, configuration, rubrics and review instructions as ordinary tracked
  files. Keep messages and everything derived from them in the ignored SQLite
  database: context, labels, scores, samples, diagnostics and reports, including
  aggregates. Do not add loose durable data exports or experiment directories.
- Never commit real corpus text or copy it into fixtures. Use invented examples.
- Use TypeScript and the shared Drizzle database layer for research tooling. The installed
  hook should not require Python or another separately installed interpreter.
- Test the compiled executable and its actual Codex hook integration before
  claiming that installation blocks handoffs.
- Keep Codex catalog configuration and hook development as separate workstreams.
  Do not change the active Codex configuration as part of corpus preparation.

## Subagent communication

Before sending a message to another agent:

1. Know what you want to convey: an instruction, question, result or update.
2. Choose the information this recipient needs to understand or act on it.
   Account for what they already know or can readily retrieve. Reference
   authoritative records instead of reproducing them. Resolve conflicting
   or outdated instructions before sending.
3. State it in clear, ordinary English. Avoid needless shorthand, fused
   words, invented notation and repetition. Use code and other technical
   syntax where they help communicate the meaning.

Every detail should serve the message's purpose. Use the length needed
to communicate clearly; do not compress prose merely to make it shorter.

## Review dashboard

The dashboard is a standalone app in `dashboard/` with its own `package.json`.
`npm run dev` there serves the app and the read-only API from
`scripts/dashboard-api.ts`. See `dashboard/README.md` for the environment
variables and `docs/context-dashboard.md` for what each figure means.

- Show messages exactly as written. Keep hook spans and reviewer quotes
  distinct, and keep the hook's result separate from the reviewers' judgment.
- Give every share its numerator, denominator and sample. Only the `random`
  stratum estimates the corpus.
- Render hook checks from the report; do not hard-code rule names.
- Follow the system light or dark preference, and keep both complete.
- Do not add automated UI tests or browser assertion suites. Judge readability
  and usability by viewing and using the rendered page. Compiler diagnostics
  are separate from visual review. Backend and Rust checks remain appropriate.
- Keep SQLite databases and their automatic WAL/SHM files out of Git. Do not
  commit message-derived reports, charts, labels or screenshots, even aggregates.
  Temporary exports must be explicit and disposable; SQLite is authoritative.
