# Run the review dashboard from this checkpoint

This directory is the versioned source of the Svelte application served by
Artifact Hub. The live server reads the single local SQLite database through
`../scripts/dashboard-api.ts`. It never needs a published corpus snapshot.
The database and raw corpus are intentionally absent from this repository.

Artifact Hub supplies Svelte, Vite, TypeScript, marked and DOMPurify. Its existing
Node 24 process also supplies the built-in SQLite API. This app does not own a
package manifest, lockfile, node_modules directory, second service or extra port.

## Install or refresh the application

From the repository root, install into an existing Artifact Hub. Copy the source
files explicitly so generated runtime data never travels with an application
refresh:

```sh
mkdir -p /artifact-hub/artifacts/handoff-context-review/src
cp dashboard/index.html dashboard/manifest.json dashboard/tsconfig.json \
  dashboard/communication-rubric.md /artifact-hub/artifacts/handoff-context-review/
cp dashboard/src/* /artifact-hub/artifacts/handoff-context-review/src/
```

The manifest ID must match the destination directory. The tsconfig extends the
Hub's shared config from that installed location; it is not a standalone project
config in this source tree. After removing a component in the repo, remove its
obsolete served copy as well. Refresh the page to load the application changes.

In `/artifact-hub/vite.config.ts`, import and register the read-only API plugin
before artifact routing. Adjust the repository path on another installation:

```ts
import { handoffReviewApi } from '/root/handoff-guard/scripts/dashboard-api.ts';

// Inside plugins:
handoffReviewApi('/root/handoff-guard/data/handoffs.sqlite3'),
```

Vite normally reloads its configuration. If necessary, use the Hub's existing
`/artifact-hub/bin/artifact-hub restart` command. Do not launch an app-local server.
The only Hub configuration change made for this application is this plugin import
and registration; no package or service changes are required.

Open <http://ai-assistant-ia:5173/artifacts/handoff-context-review/>. A missing
database produces an explicit retryable error. Supply the local SQLite database separately from Git.
`python3 scripts/context_database.py collect` resumes recovery and
`python3 scripts/analyze_mechanics.py` stores compiled measurements. See
[the database guide](../docs/context-database.md) for capture and maintenance.

## Edit and inspect

Edit `dashboard/src/`, then copy the changed source files to the served directory.
The rubric is authoritative in `docs/communication-rubric.md`; synchronize it to
both dashboard copies when changing the help text.

```sh
/artifact-hub/node_modules/.bin/svelte-check \
  --tsconfig /artifact-hub/artifacts/handoff-context-review/tsconfig.json
```

There are no automated UI tests. Read and use the rendered application to judge
layout, context, source excerpts, scores and role icons. Check short and long
messages, evidence expansion and narrow windows. Use a temporary ignored location for any real-message screenshots and discard
them after visual review. Do not create another durable data directory.

The repository's Rust, Python and API tests cover backend behavior separately.
