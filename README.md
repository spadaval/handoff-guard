# Handoff Guard

Block agent handoffs that are run together, oversized or repeated, and tell the
sender how to fix them. A small Rust executable runs as a Codex `PreToolUse`
hook. Ordinary prose, short fragments, Markdown, code, URLs, paths and hashes
pass without any template. The guard never truncates or changes a message.

The hook is one layer. Instructions to the sender come first, and the review
dashboard shows what still gets through. The repository contains source,
configuration and the [rubric](docs/communication-rubric.md). Messages,
recovered context and all analysis results live in the ignored SQLite database.
See [the data boundary](data/README.md) and [database commands](docs/context-database.md).

No global Codex settings or model catalog are activated by this project.

## Policy

Four checks can block a handoff. Each applies to the whole resolved message.

- **Size.** More than **8,000 characters** is blocked. No clean handoff in the
  corpus exceeds 6,000, and every reviewed one over 8,000 was a record dump.
- **Fused words.** Two or more stretches of **20 or more letters** with nothing
  between them. No ordinary English word is that long, so each one is several
  words run together. One such stretch is allowed, because it can be an
  identifier.
- **Missing spaces.** Words average **9 or more characters** across at least 20
  words. Ordinary prose averages 5 to 7. This catches words joined by slashes,
  commas and plus signs, where no single letter run is long.
- **Repetition.** One word makes up 80% of 100 or more words, or one line of 20
  or more characters repeats ten times and makes up 80% of the message.

The two spacing checks read prose only. Closed fenced code blocks, closed
inline code spans, URLs, paths, Markdown links and `snake_case` identifiers are
left out. An unclosed fence or backtick hides nothing. Words in scripts that do
not use spaces are not measured.

A denial names the check, quotes up to three offending stretches from the
message, says what to change, and repeats the short rules for a good handoff.
There is no bypass: the sender is expected to rewrite and send again.

Measured against 150 handoffs scored by Claude Opus under the rubric, these
checks block 43 of the 44 with the worst presentation score, 34 of the 60 with
the next-worst, and 1 of the 46 that reviewers found acceptable. They block none of the
448 handoffs sent before the shorthand appeared. Two further detectors,
punctuation spacing and bracket or plus-sign shorthand, are advisory and never
block. The checks miss shorthand that keeps its spaces, and they cannot judge
whether a message says what it should.

## Build and check

Rust and Cargo are build dependencies. The installed executable does not need
Python, Node, or another separately installed interpreter.

```sh
cargo build --release --locked
cargo test --locked
npm ci
npm run check
npm test
node scripts/handoff.ts validate
node scripts/handoff.ts evaluate
node scripts/handoff.ts hook-test --scenario denied
node scripts/handoff.ts hook-test --scenario normal
node scripts/handoff.ts hook-test --scenario startup-error
node scripts/handoff.ts hook-test --scenario timeout
node scripts/handoff.ts hook-test --scenario exit-one
```

Node 24.13 runs the TypeScript research tools and integration harness. Rust
remains the standalone installed hook. Integration tests use the actual installed `codex` executable, a
loopback scripted Responses server, a fresh child session and a temporary
`CODEX_HOME`. They make no remote model requests. They neither read nor modify
the active Codex configuration. Integration fixtures use temporary files and print their results without retaining traces.

## Install and activate separately

Build, then copy the executable to a stable absolute path:

```sh
install -Dm755 target/release/handoff-guard ~/.local/bin/handoff-guard
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

The guard matches tool names by suffix: `spawn_agent`, `send_message`,
`send_input` and `followup_task` for Codex's own delegation, and
`delegate_task`, `t3_thread_send` and `t3_thread_launch` for T3 Code's. That
covers concatenated names such as `collaborationspawn_agent` and MCP names such
as `mcp__t3-code__delegate_task`. It reads the `message`, `task` and `prompt`
strings and any text `items`, and checks them together, so text cannot hide in
a second field. It does not execute or scan JavaScript to infer arguments;
nested tool dispatch supplies the resolved values. A matching tool with no text
is denied, except `t3_thread_launch`, which can start an idle thread.

In the corpus, 87% of handoffs went through the T3 Code tools. The isolated
integration suite below proves interception for Codex's own delegation tools
only. Whether Codex fires `PreToolUse` for MCP tools such as
`mcp__t3-code__delegate_task` has not been tested end to end.

Before relying on a different Codex version, rerun the isolated integration
suite against it and verify a denial in the client where you activated the
hook. This does not certify the surrounding T3 application or another Codex
build. Automatic child completion reports bypass this `PreToolUse` input path.

Stock Codex hook errors can fail open. Missing commands, exit code 1 and
one-second hook timeouts permitted delivery in the integration tests. A valid
JSON `permissionDecision: "deny"` blocked delivery. This is a quality guard,
not a sandbox or security boundary.

## TypeScript research tooling

Run `npm ci` at the repository root, then `npm run handoff -- --help` for the CLI.
Node is pinned to 24.13.0, matching the dashboard service. It runs TypeScript
directly; there is no Python runtime or application build step for these tools.

`tooling/db/schema.ts` defines the shared Drizzle model. The CLI and dashboard
API use `tooling/db/connection.ts` for SQLite access and decoding. Schema and
migration files are tracked; messages and results remain ignored. The current
`node:sqlite` integration uses matching, pinned Drizzle ORM/Kit release candidates.

This migration preserves the current TEXT/JSON and compressed-provenance formats.
It does not convert stored data to JSONB or change hook policy. Query-builder types
check database operations; explicit runtime checks still validate imported records
and model assessments.

## Corpus work

Controls stay as files: [config/](config/), [the rubric](docs/communication-rubric.md),
[review instructions](docs/review-instructions/) and executable source. Messages,
provenance, recovered context, labels, samples, diagnostics and every derived
result stay in `data/handoffs.sqlite3`. This includes aggregate reports.

```sh
node scripts/handoff.ts validate
node scripts/handoff.ts evaluate --labels labels-full.jsonl
node scripts/handoff.ts mechanics
node scripts/handoff.ts review runs
node scripts/handoff.ts calibrate summarize --run style-signals-v3
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
node scripts/handoff.ts validate
node scripts/handoff.ts mechanics
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
