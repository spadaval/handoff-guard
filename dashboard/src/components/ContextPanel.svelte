<script lang="ts">
  import type { Detail } from "../lib/api.ts";
  import { n, date, humanise } from "../lib/format.ts";

  let { detail }: { detail: Detail } = $props();
  let chosen = $state(0);
  const ctx = $derived(detail.contexts[chosen] ?? null);
  const visibility: Record<string, string> = { sender_context: "Sender only", recipient_visible: "Recipient saw it", unknown: "Visibility unknown" };
  function short(id: string) {
    return id.replace(/^ctx-/, "").slice(0, 8);
  }
  function refText(r: any) {
    return r.text?.text ?? null;
  }
</script>

<div class="ctx">
  <div class="obs">
    <h3>Where this message was recorded</h3>
    <p class="xs muted">The same body can be recorded more than once. A recording is not proof of delivery.</p>
    <div class="scroll">
      <table class="data">
        <thead>
          <tr><th>Source</th><th>Kind</th><th>Tool</th><th>Time</th><th>Thread</th><th>Model at send</th><th>Thread setting</th></tr>
        </thead>
        <tbody>
          {#each detail.observations as o}
            <tr>
              <td class="type xs">{o.source}</td>
              <td>{o.kind ? humanise(o.kind) : "–"}{#if o.field}{" "}<span class="muted">({o.field})</span>{/if}</td>
              <td class="type xs">{o.tool ?? "–"}</td>
              <td class="nowrap">{o.timestamp ? date(o.timestamp) : "–"}</td>
              <td class="thread">{o.thread_title ?? "–"}</td>
              <td>{o.model ?? "–"}</td>
              <td class:muted={o.source === "t3_messages"} title={o.source === "t3_messages" ? "Recipient's thread; not used as the sender model" : ""}>{o.saved_model_selection ?? "–"}{#if o.source === "t3_messages" && o.saved_model_selection}{" "}<span class="xs">(recipient)</span>{/if}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </div>

  {#if detail.contexts.length}
    <div class="recovered">
      <h3>Recovered context</h3>
      <div class="tabs" role="tablist" aria-label="Recorded contexts">
        {#each detail.contexts as c, i}
          <button role="tab" aria-selected={chosen === i} onclick={() => (chosen = i)}>
            <span class="type">{short(c.context_id)}</span>
            <span class="xs">{c.status}{c.reviewed ? ", reviewed" : ""}</span>
          </button>
        {/each}
      </div>
      {#if ctx}
        {#if ctx.availability?.gaps?.length}
          <p class="xs muted gaps">Gaps: {ctx.availability.gaps.map((g: any) => g.reason).join("; ")}</p>
        {/if}
        {#if ctx.evidence.length}
          <ol class="ev">
            {#each ctx.evidence as e (e.evidence_id)}
              <li>
                <details>
                  <summary>
                    <span class="ek">{humanise(e.kind)}</span>
                    <span class="vis {e.visibility}">{visibility[e.visibility] ?? e.visibility}</span>
                    <span class="num xs muted">{n(e.characters)} characters{e.extracted ? ", prose extracted from a tool call" : ""}</span>
                  </summary>
                  <div class="type body">{e.text}</div>
                  {#if e.omitted}<p class="xs muted">{n(e.omitted)} more characters are stored in SQLite.</p>{/if}
                </details>
              </li>
            {/each}
          </ol>
        {:else}
          <p class="xs muted">No evidence recorded for this context.</p>
        {/if}
        {#if ctx.references.length}
          <h4 class="small">Referenced files</h4>
          <ul class="refs">
            {#each ctx.references as r (r.reference_id)}
              {@const t = refText(r)}
              <li>
                <details>
                  <summary><code>{(r as any).path ?? r.reference_id}</code> <span class="xs muted">{(r as any).availability ?? ""}</span></summary>
                  {#if (r as any).reason}<p class="xs muted">{(r as any).reason}</p>{/if}
                  {#if t}<div class="type body">{t}</div>{/if}
                </details>
              </li>
            {/each}
          </ul>
        {/if}
      {/if}
    </div>
  {/if}
</div>

<style>
  .ctx {
    display: grid;
    gap: 28px;
  }
  h3 {
    margin-bottom: 4px;
  }
  .scroll {
    overflow-x: auto;
    margin-top: 8px;
  }
  .nowrap {
    white-space: nowrap;
  }
  .thread {
    max-width: 260px;
  }
  .tabs {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
    margin: 10px 0;
  }
  .tabs button {
    display: grid;
    text-align: left;
    border: 1px solid var(--rule-2);
    border-radius: 4px;
    background: var(--raised);
    padding: 4px 10px;
    font-size: var(--t-sm);
  }
  .tabs button[aria-selected="true"] {
    border-color: var(--ink);
    box-shadow: inset 0 -2px 0 var(--ink);
  }
  .gaps {
    margin-bottom: 8px;
  }
  .ev,
  .refs {
    list-style: none;
    padding: 0;
    margin: 0;
    border-top: 1px solid var(--rule);
  }
  .ev li,
  .refs li {
    border-bottom: 1px solid var(--rule);
  }
  summary {
    cursor: pointer;
    padding: 7px 0;
    display: flex;
    gap: 12px;
    align-items: baseline;
    font-size: var(--t-sm);
  }
  .ek {
    font-weight: 600;
    min-width: 260px;
  }
  .vis {
    font-size: var(--t-xs);
    font-weight: 600;
    color: var(--ink-2);
  }
  .vis.recipient_visible {
    color: var(--ink);
    box-shadow: inset 0 -2px 0 var(--ink);
  }
  .body {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    font-size: 13px;
    line-height: 1.55;
    background: var(--sunken);
    padding: 10px 12px;
    border-radius: 3px;
    margin-bottom: 10px;
    max-height: 420px;
    overflow: auto;
  }
  .refs {
    margin-top: 6px;
  }
  h4 {
    margin: 16px 0 6px;
  }
</style>
