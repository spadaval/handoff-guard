<script lang="ts">
  import type { Line, Mark } from "../lib/marks.ts";

  let {
    lines,
    marks,
    active = null,
    onpick,
  }: { lines: Line[]; marks: Mark[]; active?: string | null; onpick?: (id: string) => void } = $props();

  const byId = $derived(new Map(marks.map((m) => [m.id, m])));
  function classes(ids: string[]) {
    let hook = "",
      rev = false;
    for (const id of ids) {
      const m = byId.get(id);
      if (!m) continue;
      if (m.kind === "hook") hook = hook === "block" || m.status === "block" ? "block" : "warn";
      else rev = true;
    }
    return [hook && "hk-" + hook, rev && "rv", active && ids.includes(active) && "on"].filter(Boolean).join(" ");
  }
  function title(ids: string[]) {
    return ids
      .map((id) => byId.get(id))
      .filter(Boolean)
      .map((m) => `${m!.kind === "hook" ? "Hook" : "Reviewer"}: ${m!.label} (${m!.detail}) at ${m!.cite}`)
      .join("\n");
  }
  function pick(ids: string[]) {
    // Prefer the innermost mark that is not already active, so repeated clicks cycle overlaps.
    const list = ids.map((id) => byId.get(id)!).filter(Boolean).sort((a, b) => a.end - a.start - (b.end - b.start));
    const next = list.find((m) => m.id !== active) ?? list[0];
    if (next) onpick?.(next.id);
  }
  const digits = $derived(String(lines.length).length);
</script>

<!-- Highlights are also reachable from the citation buttons in the side panel and with j/k. -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<div class="text" style:--digits={digits}>
  {#each lines as line (line.number)}
    <div class="row" data-line={line.number}>
      <span class="ln" aria-hidden="true">{line.number}</span>
      <span class="lt">{#each line.segments as s}{#if s.marks.length}<mark
              class={classes(s.marks)}
              data-m={s.marks.join(" ")}
              data-first={s.first.join(" ") || undefined}
              title={title(s.marks)}
              onclick={() => pick(s.marks)}>{s.text}</mark
            >{:else}{s.text}{/if}{/each}{#if !line.segments.length}{"​"}{/if}</span>
    </div>
  {/each}
</div>

<style>
  .text {
    font-family: var(--type);
    font-size: 14.5px;
    line-height: 1.62;
    color: var(--ink);
    border-top: 1px solid var(--rule);
    border-bottom: 1px solid var(--rule);
    padding: 10px 0;
    font-variant-ligatures: none;
    tab-size: 4;
  }
  .row {
    display: grid;
    grid-template-columns: calc(var(--digits) * 1ch + 22px) minmax(0, 1fr);
  }
  .row:target,
  .row:global(.flash-line) {
    background: var(--sunken);
  }
  .ln {
    text-align: right;
    padding-right: 14px;
    color: var(--ink-3);
    user-select: none;
    font-size: 12px;
    border-right: 1px solid var(--rule);
    margin-right: 14px;
  }
  .lt {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    word-break: normal;
    min-width: 0;
  }
  mark {
    color: inherit;
    background: transparent;
    cursor: pointer;
    border-radius: 1px;
    scroll-margin: 160px;
  }
  mark.rv {
    background: var(--reviewer-tint);
  }
  mark.hk-block {
    box-shadow: inset 0 -2px 0 var(--hook);
  }
  mark.hk-warn {
    box-shadow: inset 0 -1px 0 var(--hook);
  }
  mark.hk-block:not(.rv),
  mark.hk-warn:not(.rv) {
    background: var(--hook-tint);
  }
  mark.on {
    background: var(--reviewer-tint-2);
    outline: 1.5px solid var(--ink);
    outline-offset: 0;
  }
  mark.on:not(.rv) {
    background: var(--hook-tint-2);
  }
  mark:global(.flash) {
    animation: flash 900ms cubic-bezier(0.16, 1, 0.3, 1);
  }
  @keyframes flash {
    0% {
      background: var(--flash);
    }
  }
</style>
