# Handoff Guard

Build a small Rust executable that rejects massive or obviously pathological
agent handoffs. Preserve ordinary free-form messages; do not require a template,
particular headings, or an Atelier-specific task line.

- Prefer a few understandable deterministic rules over a growing exception list.
- Measure false positives and misses against historical messages. Keep style
  labels separate from size policy, and keep ambiguous examples ambiguous.
- Raw corpus files in `data/private/` are local-only. Never commit them or copy
  their contents into public fixtures without sanitizing the examples.
- Corpus preparation scripts may use Python's standard library. The installed
  hook should not require Python or another separately installed interpreter.
- Test the compiled executable and its actual Codex hook integration before
  claiming that installation blocks handoffs.
- Keep Codex catalog configuration and hook development as separate workstreams.
  Do not change the active Codex configuration as part of corpus preparation.
