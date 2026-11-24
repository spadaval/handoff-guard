# Handoff review dashboard

A standalone app for reading the handoff corpus: how common fused shorthand is,
where it comes from, whether the hook catches it, and what each message says.
It reads the ignored SQLite database through the read-only API in
`../scripts/dashboard-api.ts`. Nothing is exported or copied out of SQLite.

## Run it

Node 24.13 or later is required for the built-in `node:sqlite`. The API imports
the root tooling, so run `npm install` once at the repository root as well.

```sh
export PATH="$HOME/.local/opt/node-v24.13.0-linux-x64/bin:$PATH"
cd dashboard
npm install
npm run dev                       # http://127.0.0.1:5180/
```

`npm run dev` starts one Node process that serves the Svelte app through Vite
(with hot reload) and the API under `/api`. For a long-running server without
Vite, build once and serve the result:

```sh
npm run build && npm start
```

| Variable | Default | Meaning |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Address to listen on, for example the Tailscale address. |
| `PORT` | `5180` | Port to listen on. |
| `ALLOWED_HOSTS` | none | Extra comma-separated host names to answer for, such as a MagicDNS name. `localhost`, `127.0.0.1` and `HOST` are always allowed; other `Host` headers get 421. |
| `HANDOFF_DB` | `../data/handoffs.sqlite3` | The SQLite database, opened read-only. |
| `HANDOFF_GUARD` | `../target/release/handoff-guard` | Hook binary run live on the message being read. |
| `HANDOFF_RUBRIC` | `../docs/communication-rubric.md` | Rubric shown on the Rubric page. |

Example on the tailnet:

```sh
HOST=100.64.0.12 ALLOWED_HOSTS=myhost.tailnet.ts.net npm run dev
```

`npm run check` type-checks the app and server with `svelte-check`. API tests
live at the root: `npm test` there runs `tests/dashboard-api.test.ts`.

## Views

- **Overview** answers "how many handoffs need work, and where from". It
  shows needs work with its interval, the split of lowest scores, the three
  score distributions, which question holds the lowest score, issue kinds, the
  largest missions day by day, a breakdown by sender model, month, project and
  size, and a month chart. The sample control (fair sample or all reviewed)
  and the sender-model choice hold across views.
- **Hook vs reviewers** answers "does the hook catch what it can see": the
  hook's result against the presentation score, the share blocked among Costly
  or Broken and allowed among Clean or Minor, what lies outside the hook's
  view, each check, and the misses and false positives.
- **Agreement** cross-tabulates the scores pairs of raters gave the same
  handoffs. Handoffs the rubric quotes as worked examples are left out.
- **Messages** is the corpus browser: full-text search and every filter visible
  in the left column with live counts.
- **Message reader** (`#/m/<id>`) shows the message exactly as written in
  numbered lines with hook spans and reviewer quotes highlighted, every review
  with its rubric version, severities and the issue that set each score, the
  reviewer's clear version side by side when there is one, the reviews side by
  side when there are several, and the recorded context. `j` and `k` step
  through highlights; `[` and `]` move through the list the message was opened
  from.
- **Rubric** renders `docs/communication-rubric.md` as it is on disk, or the
  version a review was scored under when opened from that review.

## Data rules

- Reviews come from `analysis_records` (`kind='review'`) in `manual-review`
  runs. Scores come only from `score()`, `lowest()` and `needsWork()` in
  `tooling/reviews.ts`. Figures use one reference review per message, set by
  `reference_reviewer` in `config/review.json`. Older `intentionality-v2`
  reviews appear only as a collapsed, labelled comparison in the reader.
- Lists and figures use the stored hook reports. The reader runs the current
  binary on the open message and says when its result differs from the stored
  one, or falls back to the stored report when the binary is missing.
- Hook checks are rendered from the report's `checks` array. No rule name is
  hard-coded.
- Sender model has two tiers. *Recorded* is the `model` from the sender's turn
  context at send time. *Thread setting* is the sending thread's
  `saved_model_selection` at export time, and is never taken from a
  `t3_messages` record, whose thread is the recipient's. Breakdowns default to
  recorded only.
- The API reloads its in-memory index whenever another connection commits to
  SQLite, so new reviews appear on the next request. The top bar offers a
  reload instead of changing figures while you read.

Message text is private. Do not commit the database, screenshots of the app
with real messages, or copies of message text. There are no automated UI tests;
judge changes by using the rendered app with short, long and fused messages, in
light and dark.
