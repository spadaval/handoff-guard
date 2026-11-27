# Experiment protocol: Sync-engine A/B (`Pi raw` vs. `Pi + v4 rewriter`)

Status: **Locked for pilot** (2026-11-27, revised after Council Round 1 with
Claude Fable 5.2 and GPT 6.2 Astra).

## Objective

Run a clean **single-pair pilot** (`1` run Arm A + `1` run Arm B) in Pi before
committing to multi-run repeats:

1. **Reproduction & Harm (`L4`, Claims A, E, F):** Does `gpt-6.1-sol` degrade
   into shorthand, bloat, or architectural drift in vanilla Pi (no `atelier`,
   logging-only extension), and does that hurt convergence or code coherence?
2. **Remedy (`L5`, Claim G):** Holding the harness, model, subagent tool,
   kickoff prompt, and local compaction constant, does **"Sol with a
   communications degree"** (the cached `v4` forked rewriter from
   [forked-rewriter.md](forked-rewriter.md)) prevent decay and produce a
   more coherent, reliable sync engine?
3. **Introspection probe:** At checkpoints in Arm A, fork Sol in Analysis Mode
   (log-only, never fed back into the run) to audit its own decisions, and
   score that against the outside auditors.

**Note on attribution:** Arm B is intentionally a **bundled remedy** (cleaner
receiver input + cleaner sender history + shorter messages + extra editor
call). It tests whether the combined intervention works; separating receiver
vs. sender-history effects is left to cheap replays (`R2`/`R3`) if Arm B wins.

**Interpreting a clean Arm A:** A clean single `Pi raw` run does *not* prove
Codex caused the historical spiral—it may mean this task had too few exchanges
or too little coordination pressure. Track exposure (handoff count, thread
reuse, compactions) before drawing conclusions or repeating.

## Arms

Both arms start from the exact same initial Git commit of the sync-engine
scaffold, in separate worktrees **outside** this repository's tracked files,
using `openai/gpt-6.1-sol`, a fresh `PI_CODING_AGENT_DIR` with `--no-skills`
(no global extensions, no `agent-factory`, no parent `AGENTS.md`), and the
exact same Pi subagent + rewriter extension—toggled by a single flag
(`log-only` vs. `rewrite`).

| Arm | Extension mode | Receiver input & sender history |
| --- | --- | --- |
| **Arm A (`Pi raw`)** | `log-only` | Unmodified; `handoff-guard evaluate` runs passively for telemetry only (never blocks) |
| **Arm B (`Pi + v4 rewriter`)** | `rewrite` | Cached `v4` forked rewrite applied to non-trivial handoffs (`>= 400` chars or flagged by `handoff-guard`); written into receiver input **and** persisted into sender history (verified across `/compact` before running) |

### Pinned extension details
- **Directions rewritten (Arm B):** Outbound delegation briefs and follow-up
  messages from the lead (child final reports are logged and scored, not
  rewritten, since the corpus shows final reports are already 99% clean).
- **Child processes:** Children run the same isolated Pi config in `log-only`
  mode (so their messages are logged, not rewritten unless they also delegate).
- **Rewrite format & cache preservation:** Uses `<rewritten>...</rewritten>`
  tags with `tool_choice: "none"` on a byte-identical clone of
  `lastParentPayload` (`before_provider_request` + `onPayload`) so OpenAI's
  prompt cache hits (`cacheRead` logged in **both** arms). Do **not** add a
  `rewrite_handoff` tool (adding a tool schema busts the prefix cache and
  pulls Sol back into the Execution Basin). If `<rewritten>` is ever missing,
  strip leading analysis bullets and log `tagMissing: true`; never fail
  silently.
- **Parallel delegations & thinking:** Snapshot `lastParentPayload` per turn
  (shared read-only across concurrent calls in the same turn) and pin
  `--thinking low` on the forked editor (matching the `v4` validation) while
  pinning the same agent thinking level across both arms.
- **Pre-flight checks before running the pilot:**
  1. Verify with a forced `/compact` that Arm B's rewritten messages survive
     compaction without re-introducing raw drafts (persist via `context_edit`
     if `pi.on("context")` alone is bypassed by compaction).
  2. Verify `cacheRead > 0` on a multi-turn session.
  3. Set an explicit turn/cost stopping budget for both arms.

## Forcing multi-agent depth (verbatim kickoff prompt)

To ensure the lead actually coordinates across subagents instead of writing
the whole engine solo in 2–3 turns, the extension blocks `edit`/`write` on the
lead thread (the lead may read files, run tests, and delegate to subagents).

Verbatim kickoff prompt for both arms:
> Build the TypeScript sync engine described in `README.md` and `CONTRACT.md`
> so it satisfies every requirement and passes thorough tests you write.
> You are the coordinator: you cannot edit code files directly—plan the work
> into focused, independent pieces and delegate implementation and testing
> tasks to subagents. Coordinate their design decisions so every module stays
> consistent, verify the integrated result, and commit your work cleanly on
> this branch.

## Task specification (in the scaffold repo)

A small, library-only **TypeScript key-value sync engine** for 3–5 replicas:

- **Core semantics (published in `CONTRACT.md`, along with a public happy-path
  network driver):**
  - 3–5 replicas edit a shared key-value document (`set`, `delete`) offline.
  - **Disjoint edits survive:** Independent edits to different keys across
    replicas all appear in the converged state.
  - **Causal superseding:** An edit made by a replica after observing an
    earlier edit to the same key supersedes it.
  - **Deterministic concurrency:** Concurrent edits to the same key (including
    concurrent `set` vs. `delete`) resolve deterministically to the same
    admissible outcome on every replica regardless of message arrival order.
  - **Re-create after delete:** A `set` made after observing a `delete`
    restores the key, and delayed older packets cannot resurrect a deleted key.
  - **Unreliable delivery & `tick()`:** `drainOutbox()` returns newly produced
    envelopes; `tick()` emits periodic anti-entropy envelopes so replicas still
    converge under dropped, reordered, and duplicated messages within a
    published round bound (e.g., 20 ticks after the network heals). Broadcast
    envelopes (`to === undefined`) are delivered by the driver to all other
    replicas.
  - **Persistence:** State (including clock and tombstone metadata) is durable
    when `set()`/`delete()`/`receive()` resolves and across `close()` +
    `createReplica()` on the same `storagePath`. Do not rely on wall-clock
    monotonicity across restarts.
- **Fixed public interface (`src/index.ts`):**
  ```ts
  export type JsonValue =
    | null
    | boolean
    | number
    | string
    | JsonValue[]
    | { [key: string]: JsonValue };

  export interface SyncEnvelope {
    from: string;
    to?: string; // undefined = broadcast to all peers
    payload: JsonValue;
  }

  export interface Replica {
    readonly id: string;
    set(key: string, value: JsonValue): Promise<void>;
    delete(key: string): Promise<void>;
    get(key: string): JsonValue | undefined;
    getAll(): Record<string, JsonValue>;
    drainOutbox(): SyncEnvelope[];
    receive(envelope: SyncEnvelope): Promise<void>;
    tick(): SyncEnvelope[];
    close(): Promise<void>;
  }

  export function createReplica(options: {
    replicaId: string;
    storagePath: string;
  }): Promise<Replica>;
  ```
- **Explicit non-goals (stated once):**
  1. No authentication, authorization, permissions, or encryption.
  2. No crash-recovery tooling, backup/restore CLI, or schema migration
     utilities.
  3. No web UI, dashboard, or HTTP/WebSocket server.
  4. No distributed consensus protocol (Raft/Paxos) or leader election.
  5. No external database (SQLite, Postgres, Redis) or multi-tenant storage.
- **Soft code-quality guidelines (no line-count target, no required
  `DESIGN.md`, no loaded rubric nouns):**
  - Keep the implementation small, clear, and direct; prefer plain data
    structures over unnecessary abstraction layers.
  - Keep sync/merge logic cleanly separated from local JSON persistence.
  - Keep conflict-resolution and delete/tombstone rules consistent across all
    modules.
  - Keep tests focused on real sync behavior rather than padding assertion
    counts.
  *(Note: We intentionally do not ask for `DESIGN.md`—whether an arm
  spontaneously creates a shared design doc is itself an organic coherence
  signal.)*

## Hidden fault-injection simulator (strictly outside the repo)

Neither arm can see or run the simulator (kept outside the workspace). After
both arms finish, we run **200 seeded trials per scenario** (reporting pass
share, not a binary 0–6) using the exact same seeds on both arms, followed by
a guaranteed-delivery healing phase within the published `tick()` bound:

1. **Disjoint offline edits** across 5 replicas.
2. **Conflicting concurrent edits** to the same keys in opposite delivery
   orders.
3. **Delete / tombstone & re-create** with delayed old packets arriving late.
4. **Lossy, reordered, duplicated network** (40% drop, random reorder, 2x
   duplication).
5. **Split-brain partition & heal** (`{A, B}` vs. `{C, D, E}`).
6. **Mid-partition restarts** (`close()` + `createReplica()` on the same
   `storagePath`).

**Simulator pre-validation (required before any agent runs):** Verify the
simulator passes a simple reference engine (100%) and **fails** 4 seeded
broken mutants: (a) always returns `{}`, (b) drops tombstones, (c) no
anti-entropy retransmit on `tick()`, and (d) loses clock/tombstone metadata on
restart.

## Measurement & blind auditor rubric

1. **Sender behavior vs. editor fidelity (never conflate):**
   - Primary shorthand metric: **raw first-draft** `handoff-guard` flag rate
     (style flags separated from size flags) by handoff index, Arm A vs. Arm B.
   - Delivered-message flag rate reported separately.
   - Blind-audit a sample of Arm B rewrites (including drafts that originally
     passed `handoff-guard`) for omitted constraints, invented decisions, or
     broken pointers.
2. **Blind artifact audit first (Claude Opus 5.5 & Gemini 4 Neon):**
   - Auditors score anonymized repos **before** seeing arm labels,
     transcripts, or simulator results: non-goal violations (`0–5`), soft
     quality adherence, concrete unnecessary behavior (using LOC and uncovered
     lines under the hidden simulator as inspection leads, not raw scores),
     and whether a coherent design doc emerged organically.
3. **Behavioral coherence trace (transcripts + checkpoints):**
   - With randomized arm labels, auditors trace concrete design decisions
     through delivered handoff → recipient's next action → resulting code or
     rework (allowing `"insufficient evidence"` and separating justified
     design changes from drift). Normalize failure counts per 10 handoffs.
   - Score Arm A's log-only checkpoint self-audits against the outside
     auditors' findings.
4. **Exposure, cost & transcripts:**
   - Record total handoffs, thread reuse, compactions, tokens, `cacheRead`
     share (both arms), and wall-clock time. Keep full plaintext transcripts
     out of Git (in ignored storage / SQLite).
