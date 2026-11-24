# Review a message in its strategic and tactical context

Open the [handoff review dashboard](http://ai-assistant-ia:5173/artifacts/handoff-context-review/).
It reads `data/handoffs.sqlite3` through the existing Artifact Hub server.
There is no corpus download, JSON publication step, second service or extra port.

The left message list selects the message. There is no right sidebar. The main
area is one centered reading flow, in this order:

1. The project name and a pictorial sender → message type → recipient exchange.
   There is no status strip or in-page navigation.
2. The exact original message, with its word and character counts beside Message.
3. **Situation & intent:** unscored model context describing the work, immediate
   trigger and the information or action the sender wants to convey.
4. **Information selection:** length-policy checklist, model assessment, agreement.
5. **Presentation:** surface-check checklist, model assessment, agreement.

Each tactical block keeps Hook and Model labels visible beside their respective
scores. Checklists show measured passes, failures and missing checks as distinct
states. Punctuation-spacing and shorthand signals use an advisory state; they are
implemented in Rust and do not deny delivery. Clicking a quoted finding highlights that exact passage in
the original without rewriting it.

An **Evidence** disclosure appears directly beneath a situation, intent or model
judgment when it cites surrounding records. It opens in place and contains only
sources explicitly cited for that claim. The original message is not duplicated
as surrounding evidence; presentation quotes already link to that message.
Each excerpt identifies its recorded kind, available time and visibility. Sender
history is explicitly distinguished from recipient-visible information. Partial
recovery and omitted text remain visible. Displaying a citation does not claim
that the citation proves recipient access.

**Inspect recorded source data** sits at the bottom for investigation. Its record
selector changes only the raw record being inspected, never the assessment above.
Evidence and raw JSON are rendered when opened, keeping the default reading flow
focused. The API and database are unchanged.

The [five-point rubric](communication-rubric.md) anchors the two tactical scales.
Hook scores decline continuously with measured burden and are shown to one
decimal: length utilization for information selection and the worst normalized
surface signal for presentation. They do not
establish semantic completeness or overall readability. The agreement line
compares pass/revise signals within that coverage. Earlier model explanations
remain visible and explicitly labeled; their numeric scores are absent until a
fresh review under the five-point rubric. There is no combined score and no v1
assessment display.

Roles in the exchange graph have distinct colors and SVG icons, with visible
role names retained. The interface uses a dark palette, full-window shell and
bounded reading measure.
The main sections use the generated design study as visual inspiration, with the
actual message, measurements and recorded reviews supplying the content.

## Requests and search

- `GET /api/handoff-review/messages` returns at most 50 previews, the matching
  count, corpus counts and filter choices. `view` is `reviewed`, `inputs`,
  `outputs` or `all`; `page` starts at zero.
- `GET /api/handoff-review/messages/<body-sha256>` returns that message, its
  contexts, evidence, references, current reviews and mechanical results.
- `query` searches full stored message text, message ID, project and review
  classification. It is not restricted to previews. SQLite's built-in ASCII
  case folding does not cover every Unicode character.

Search is debounced; obsolete requests are cancelled. **Refresh data** rereads
SQLite. No export is needed after importing reviews or diagnostic results.
Supporting excerpts are capped at 1,000 Unicode characters with explicit omission
counts; longer text remains in SQLite. Markdown evidence is sanitized and active
content is disabled. Raw source fields remain separately available.

The API accepts GET only, opens SQLite read-only, enables query_only and returns
Cache-Control: no-store. Its database path is server configuration, not browser
input. Raw data and the database remain outside Git.

## Install in the existing server

The versioned application source is in [dashboard/](../dashboard/README.md).
Install its files into Artifact Hub before registering the API below.

Node 24's built-in SQLite module is sufficient. In `/artifact-hub/vite.config.ts`,
import and register the plugin before artifact routing:

```ts
import { handoffReviewApi } from '/root/handoff-guard/scripts/dashboard-api.ts';

// Inside plugins:
handoffReviewApi('/root/handoff-guard/data/handoffs.sqlite3'),
```

Adjust repository paths on another installation. Vite reloads its configuration;
use `/artifact-hub/bin/artifact-hub restart` if needed. The API shares the Hub's
trusted-network access model. Missing database access produces a retryable error.

## Review changes visually

There are no automated UI tests or browser assertion suites. Judge UI changes by
reading and using the rendered page with short, long and poorly written messages.
The single-flow layout was inspected visually at desktop and mobile sizes,
including opening claim-specific evidence, inspecting raw records and reading
a short message. Keep type/compiler diagnostics separate from
readability and usability judgments.
