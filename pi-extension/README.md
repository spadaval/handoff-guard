# Handoff Guard for Pi

In Pi, a handoff can be rewritten before it is sent, not only blocked. This
extension intercepts the same delegation tools as the Codex hook, including T3
Code's `delegate_task`, `t3_thread_send` and `t3_thread_launch`. For each
handoff it:

1. Asks the compiled `handoff-guard` whether the message would be blocked.
2. If the message is flagged, or is 400 characters or longer, asks the sender's
   own model to edit it, in one extra model call that continues the sender's
   conversation. The editor prompt is `v4` from
   [the rewriter experiment](../docs/experiments/forked-rewriter.md).
3. Sends the edited text to the recipient, and shows the sender the edited text
   in place of its draft from then on, so the sender does not copy its own
   shorthand in later messages.
4. Blocks the handoff with the guard's usual explanation if it is flagged and
   could not be rewritten into something that passes.

## Install

Pi 1.7.0 is the version this was tested with.

1. Build and install the guard executable, which the extension runs:

   ```sh
   cargo build --release --locked
   install -Dm755 target/release/handoff-guard ~/.local/bin/handoff-guard
   ```

2. Keep this repository checked out at a stable path, and add the extension
   directory to `extensions` in `~/.pi/agent/settings.json`. Keep any entries
   already there, and put this one last:

   ```json
   {
     "extensions": ["/absolute/path/to/handoff-guard/pi-extension"]
   }
   ```

3. Start a new Pi session. Under T3 Code, start a new thread: T3 Code starts Pi
   with your Pi settings and adds its own extension beside yours, so nothing
   changes in T3 Code's settings. Every agent that runs on Pi loads the
   extension, children included.

To try it for one run without changing settings, start Pi with
`pi -e /absolute/path/to/handoff-guard/pi-extension`.

To check that it is active, set `HANDOFF_GUARD_LOG` (below), send one handoff
and read the log. To remove it, delete the entry from `settings.json`.

## Settings

Settings are environment variables, read when Pi starts. Under T3 Code, set
them in the environment the T3 Code server starts in.

| Variable | Default | Meaning |
| --- | --- | --- |
| `HANDOFF_GUARD_MODE` | `rewrite` | `rewrite` edits flagged handoffs and those at or over the length below. `rewrite-flagged` edits only flagged handoffs. `block` never edits and blocks flagged handoffs, as the Codex hook does. `observe` changes nothing and only logs. |
| `HANDOFF_GUARD_MIN_REWRITE_CHARS` | `400` | In `rewrite` mode, the length from which an unflagged handoff is also edited. |
| `HANDOFF_GUARD_BIN` | `~/.local/bin/handoff-guard`, else `handoff-guard` on `PATH` | The guard executable. |
| `HANDOFF_GUARD_LOG` | none | A JSONL file to append one record per handoff to. **Each record holds the full draft and the full rewritten text**, so keep it out of Git and anywhere else that messages must not go. With no value, nothing is logged. |
| `HANDOFF_GUARD_TOOLS` | the hook's seven tool-name endings | A regular expression matched against the tool name. |
| `HANDOFF_GUARD_REWRITE_TIMEOUT_MS` | `90000` | How long the editing call may take. |

`observe` is the mode for measuring how a setup behaves untouched. In `rewrite`
mode the sender no longer sees its own drafts, so the share of flagged drafts in
the log is not a measure of what the same run would have done without the
extension.

## What it does when something fails

- **The editing call fails, times out or returns no `<rewritten>` text.** A
  flagged draft is blocked, as in `block` mode. An unflagged draft is sent as
  written.
- **The edited text is itself flagged, or the guard fails while checking it.**
  It is thrown away and the draft is treated the same way. A draft the guard
  flagged is only ever replaced by text the guard has passed.
- **The rewrite cannot be saved to the session.** The handoff still goes out
  rewritten, and the sender is shown the rewrite until Pi restarts. After a
  resume it sees that one draft again.
- **The guard executable is missing or fails.** Handoffs are not checked, and
  Pi shows one warning. Editing by length still runs. This matches the Codex
  hook, which also lets handoffs through when its command cannot run.
- **The model does not use the OpenAI Responses API.** The editing call is not
  made, because the extension reuses the sender's request in that API's format
  to keep the provider's prompt cache. Flagged drafts are blocked instead. This
  covers the GPT models; other providers' models get `block` behavior.

## Limits

- **Handoffs made from a codemode script.** The recipient gets the edited text,
  but the sender's record of that handoff is the script it wrote, which is left
  as written. The log marks these with `"nested": true`.
- **Messages with text in more than one place.** If a call has more than one of
  `message`, `task` and `prompt`, or an `items` list, it is checked and can be
  blocked, but it is not edited.
- **Extensions listed after this one.** The editing call replays the sender's
  request as this extension saw it. An extension that loads later and changes
  the request, for example by adding instructions, changes what the sender
  gets but not what the editor gets, and can cost the prompt cache. That is
  why this extension goes last. T3 Code's own extension is outside your
  settings; it only sets a service tier and, for one provider, an output limit.
- **Child completion reports.** A child's final answer is not a tool call, so
  it is neither checked nor edited. The Codex hook has the same gap.
- **The session file.** Pi's saved session keeps the draft as the model wrote
  it. The edited text is stored beside it and is what the model is shown, also
  after a resume, through compaction, and in the summary of a branch left with
  `/tree`.
- The editing call costs one extra model request per edited handoff. In the
  experiment it took 7 to 10 seconds and about half a cent, with the sender's
  whole conversation read from the prompt cache.

## Test

`node scripts/handoff.ts pi-test --scenario NAME` runs the real `pi` executable
with this extension against a local scripted model, with a stand-in for T3
Code's tools that records what is delivered. It makes no remote model requests
and does not read or change your Pi settings. The scenarios are `rewrite`,
`length`, `block`, `rewrite-fails`, `recheck-fails`, `observe`, `resume`, `tree`
and `codemode`. They do not cover a real compaction or Pi's idle cache refresh.

The test does not run the real T3 Code server. T3 Code registers its tools in
Pi as `mcp__t3-code__<tool>`, which is what the stand-in uses. After installing,
confirm one rewritten handoff in the log from a real T3 Code thread.
