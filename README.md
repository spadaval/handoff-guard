# Handoff Guard

Reject oversized or obviously pathological Codex handoffs with a small Rust
executable. Ordinary prose, short fragments, Markdown, code, URLs, paths and
hashes need no template. Denials name the check and ask for a rewrite. The guard
never truncates or changes delivery arguments.

The repository contains source, configuration and rubrics. Messages, recovered
context and all analysis results live in the ignored SQLite database. See
[the data boundary](data/README.md) and [database commands](docs/context-database.md).
The local dashboard reads the database directly.

No global Codex settings or model catalog are activated by this project.

## Policy

The limits apply separately to each resolved handoff:

- More than **12,000 Unicode scalar values** or **1,500 whitespace-separated
  words** is denied, regardless of style. Equality passes the size check.
- Glued prose is denied when ASCII alphabetic runs of at least 40 letters
  contribute at least 240 letters and 15% of all characters. Fenced code,
  backtick-bearing tokens, URLs, absolute paths, assignments, email tokens and
  underscore identifiers have conservative exemptions. These exemptions are
  heuristics, not a complete programming-language or Markdown parser.
- Extreme repetition is denied when one token occupies at least 80% of 100 or
  more words, or a line of at least 20 characters repeats at least ten times and
  occupies at least 80% of the message.

The style rules intentionally miss less extreme compression and repetition.
Non-ASCII prose is only subject to size and repetition checks. Code still has
to fit the size limits and can trigger extreme repetition checks.

## Build and check

Rust and Cargo are build dependencies. The installed executable does not need
Python, Node, or another separately installed interpreter.

```sh
cargo build --release --locked
cargo test --locked
python3 -m unittest discover -s tests -v
python3 scripts/validate_corpus.py
python3 scripts/evaluate_corpus.py evaluate
python3 scripts/test_codex_hook.py --scenario denied
python3 scripts/test_codex_hook.py --scenario normal
python3 scripts/test_codex_hook.py --scenario startup-error
python3 scripts/test_codex_hook.py --scenario timeout
python3 scripts/test_codex_hook.py --scenario exit-one
```

Python is only used for offline corpus preparation and the integration test
harness. Integration tests use the actual installed `codex` executable, a
loopback scripted Responses server, a fresh child session and a temporary
`CODEX_HOME`. They make no remote model requests. They neither read nor modify
the active Codex configuration. Integration fixtures use temporary files and print their results without retaining traces.

## Install and activate separately

Build, then copy the executable to a stable absolute path:

```sh
install -Dm755 target/release/handoff-guard /root/.local/bin/handoff-guard
```

Adapt [examples/hooks.json](examples/hooks.json) to your installation path.
Merge its `PreToolUse` entry into your own `$CODEX_HOME/hooks.json` (normally
`~/.codex/hooks.json`), retaining existing hooks. Do not replace an existing file
with the example. Enable `features.hooks` if your client disables it and review
and trust the hook through your client's hook trust flow. Start a new session.
The test-only `--dangerously-bypass-hook-trust` flag is not an installation step.

For native delegation inside code mode, Codex 0.169.0 needs
`features.multi_agent_v2.non_code_mode_only = false` alongside enabled code mode
and multi-agent v2. The integration harness sets this only in its temporary
configuration. Catalog selection and global activation remain separate work.

The matcher catches native concatenated names such as
`collaborationspawn_agent`, as well as plain and namespaced variants. The guard
checks resolved `message` strings, JSON-string tool inputs, and legacy text
`items` joined with newlines. It matches tool names ending in `spawn_agent`,
`send_message`, or `followup_task`. It does not execute or scan JavaScript to
infer tool arguments; nested tool dispatch supplies the resolved values.
Unsupported payload shapes on matching tools receive an explicit denial.

Before relying on a different Codex version, rerun the isolated integration
suite against it and verify a denial in the client where you activated the
hook. This does not certify the surrounding T3 application or another Codex
build. Automatic child completion reports bypass this `PreToolUse` input path.

Stock Codex hook errors can fail open. Missing commands, exit code 1 and
one-second hook timeouts permitted delivery in the integration tests. A valid
JSON `permissionDecision: "deny"` blocked delivery. This is a quality guard,
not a sandbox or security boundary.

## Corpus work

Controls stay as files: [config/](config/), [the rubric](docs/communication-rubric.md),
[review instructions](docs/review-instructions/) and executable source. Messages,
provenance, recovered context, labels, samples, diagnostics and every derived
result stay in `data/handoffs.sqlite3`. This includes aggregate reports.

```sh
python3 scripts/context_database.py validate
python3 scripts/evaluate_corpus.py evaluate --labels labels-full.jsonl
python3 scripts/analyze_mechanics.py
python3 scripts/research.py runs
python3 scripts/calibrate_style_signals.py summarize --run style-signals-v3
```

These commands use SQLite directly. They create no corpus export or experiment
folder. Repeated context text is shared. Obsolete working exports and redundant runs
are discarded. See [database operations](docs/context-database.md)
for capture, review and maintenance commands. For a different corpus, capture into
a new database and freeze its connected-thread split before tuning.

For direct use, `handoff-guard hook` reads one Codex hook JSON event and returns
`{}` or an explicit denial, exiting zero. Invalid JSON, invalid UTF-8, or a hook
envelope above 8 MiB gets an explicit denial. `handoff-guard evaluate` reads
JSONL records with `message_id` and `text`, returning one decision per record
without echoing message text.

## Inspect context and communication grades

The versioned Svelte application is in [dashboard/](dashboard/README.md), including
installation instructions for the existing Artifact Hub server.

The [context dashboard](http://ai-assistant-ia:5173/artifacts/handoff-context-review/)
reads a page of messages directly from SQLite in a full-window view. It opens
on the contextual pilot, with rewrite cases first. The message,
strategic context and tactical assessments form one reading flow. Cited evidence
expands beneath the explanation it supports; raw source data is available at the
bottom. Each assessment stays attached to its recorded context. See the
[database guide](docs/context-database.md),
[dashboard guide](docs/context-dashboard.md) and [communication rubric](docs/communication-rubric.md).

SQLite is the single local analysis store at `data/handoffs.sqlite3`. The agreed communication guidance is in
[AGENTS.md](AGENTS.md). To validate the existing database and update mechanical
diagnostics:

```sh
python3 scripts/context_database.py validate
python3 scripts/analyze_mechanics.py
```

The dashboard reads SQLite through a read-only API in the existing Artifact Hub
server. It loads one page of previews and the selected message, with search and
filters evaluated in SQLite. Click Refresh data after database updates; no JSON
export or publication step is needed.
Raw data stays out of Git. The context pilot does not change hook policy.

Contextual assessments include participant roles, message
stage/type and task summaries. [Mechanical diagnostics](docs/mechanical-checks.md)
come from `handoff-guard inspect`, sharing the hook implementation.
The dashboard groups measured size and style checks within readability and
excludes v1 scores. The current rubric defines two independent tactical scores;
older observations are not converted into new scores. Existing denial thresholds and
global activation are unchanged.
