# Handoff Guard

Prevent enormous or obviously pathological agent handoffs without imposing a
message template. The intended hook is a small Rust executable for Codex.

This repository is prepared for development. The hook is not implemented or
installed yet. Codex configuration is a separate workstream; setup here does
not change the active Codex configuration.

## Agreed scope

- Reject oversized messages using both character and word limits.
- Use a few conservative checks for glued prose and extreme repetition.
- Allow normal prose, fragments, Markdown, paths, hashes, URLs, and code.
- Check resolved arguments to `spawn_agent`, `send_message`, and
  `followup_task`, including calls inside code mode.
- Explain denials and request a rewrite. Do not truncate or rewrite messages.
- Evaluate against the recovered corpus, including normal and pathological
  messages across projects and model generations. Do not treat search matches
  as ground-truth labels.

The companion Codex configuration work will pin a local catalog for
`gpt-6.1-sol` and `gpt-6-luna` and expose delegation through code mode.

## Historical corpus

See [data/README.md](data/README.md). Raw historical text is local-only and
ignored by Git. It is not sanitized for publication. There is no remote or
upload step in the exporter.

```sh
python3 scripts/export_corpus.py
python3 scripts/validate_corpus.py
python3 -m unittest discover -s tests -v
```

Python is used only for offline corpus preparation. It is not the proposed
runtime dependency for the hook.

## Next steps

1. Label normal, pathological, and ambiguous examples. Keep style labels
   independent of the size limit, since a readable brief can still be too big.
2. Develop the Rust validator and evaluate false positives and misses. Keep
   complete threads together when reserving examples for evaluation.
3. Test the compiled executable through actual code-mode delegation calls,
   including a dynamically constructed message and a fresh child agent.
4. Install at a stable absolute path and activate the Codex hook. Verify that
   explicit denials prevent delivery. Stock Codex hook startup errors and
   timeouts can fail open; this is a quality guard, not a sandbox boundary.

Automatic child completion reports use a separate path. They are exported as
separate kinds and must not be claimed as covered by a `PreToolUse` hook.
