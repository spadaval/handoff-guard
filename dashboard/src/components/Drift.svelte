<script lang="ts">
  import type { Overview } from "../lib/api.ts";
  import { href } from "../lib/router.svelte.ts";
  import { n, pct, ci } from "../lib/format.ts";

  type Drift = Overview["drift"];
  type Part = Drift["pooled"][number];
  let { drift, sampleName, listSample, sparse }: { drift: Drift; sampleName: string; listSample: string; sparse: number } = $props();

  const partLabel = (p: number) => (p === 0 ? "First fifth" : p === drift.parts - 1 ? "Last fifth" : `Fifth ${p + 1}`);
  let width = $state(700);
  const M = { left: 44, right: 16 };
  const PH = 118;
  const plotW = $derived(Math.max(200, width - M.left - M.right));
  const band = $derived(plotW / drift.parts);
  const x = (i: number) => M.left + band * (i + 0.5);
  const y = (p: number) => 12 + (1 - p) * (PH - 24);
  type Panel = { key: "hook" | "reviewer"; title: string; sub: string; get: (p: Part) => { p: number; low?: number; high?: number } | null; usable: (p: Part) => boolean };
  const panels: Panel[] = $derived([
    { key: "hook", title: "Hook blocks", sub: `share of the ${n(drift.qualifying_handoffs)} handoffs in each fifth, exact`, get: (p) => p.hook_blocked, usable: () => true },
    { key: "reviewer", title: "Presentation Costly or Broken", sub: `${sampleName}, reviewed handoffs only, with 95% intervals; hollow points have fewer than ${sparse} and are not joined`, get: (p) => p.presentation_low, usable: (p) => !p.sparse },
  ]);
  function segs(panel: Panel) {
    const out: string[] = [];
    for (let i = 1; i < drift.parts; i++) {
      const a = drift.pooled[i - 1],
        b = drift.pooled[i];
      const va = panel.get(a),
        vb = panel.get(b);
      if (va && vb && panel.usable(a) && panel.usable(b)) out.push(`M${x(i - 1)},${y(va.p)}L${x(i)},${y(vb.p)}`);
    }
    return out;
  }
  const hours = (a: string | null, b: string | null) => (a && b ? (Date.parse(b) - Date.parse(a)) / 3600e3 : null);
  const span = (h: number | null) => (h === null ? "" : h < 1 ? `${Math.max(1, Math.round(h * 60))} minutes` : h < 48 ? `${h.toFixed(h < 10 ? 1 : 0)} hours` : `${(h / 24).toFixed(1)} days`);
</script>

<div class="drift">
  <div class="pooled" bind:clientWidth={width}>
    {#each panels as panel}
      <div class="panel">
        <h3 class="small"><i class="key {panel.key}"></i>{panel.title} <span class="muted">{panel.sub}</span></h3>
        <svg {width} height={PH} role="img" aria-label="{panel.title} by fifth of the sender's thread. The table below gives every value.">
          {#each [0, 0.5, 1] as t}
            <line class="grid" x1={M.left} x2={M.left + plotW} y1={y(t)} y2={y(t)} />
            <text class="tick" x={M.left - 8} y={y(t) + 4} text-anchor="end">{t * 100}%</text>
          {/each}
          {#each segs(panel) as d}<path class="line {panel.key}" {d} />{/each}
          {#each drift.pooled as part, i}
            {@const v = panel.get(part)}
            {#if v}
              {#if v.low !== undefined && v.high !== undefined}
                <line class="whisker {panel.key}" x1={x(i)} x2={x(i)} y1={y(v.low)} y2={y(v.high)} />
              {/if}
              <circle class="dot {panel.key}" class:hollow={!panel.usable(part)} cx={x(i)} cy={y(v.p)} r="4.5" />
              <text class="val" x={x(i) + 9} y={y(v.p) - 8}>{pct(v.p)}{#if panel.key === "reviewer" && part.presentation_low}<tspan class="kn" dx="5">{part.presentation_low.k}/{part.presentation_low.n}</tspan>{/if}</text>
            {/if}
          {/each}
        </svg>
      </div>
    {/each}
    <div class="axis" style:padding-left="{M.left}px" style:padding-right="{M.right}px">
      {#each drift.pooled as part}
        <a href={href("/messages", { part: String(part.part + 1) })}>{partLabel(part.part)}{" "}<span class="xs muted num">{n(part.handoffs)} handoffs</span></a>
      {/each}
    </div>
  </div>

  <div class="wrap">
    <table class="data threads">
      <thead>
        <tr>
          <th>Sender thread</th>
          <th class="r">Handoffs</th>
          <th>Over</th>
          <th class="r">First half</th>
          <th class="r">Second half</th>
          {#each drift.pooled as part}<th class="c">{partLabel(part.part)}</th>{/each}
        </tr>
      </thead>
      <tbody>
        {#each drift.threads as t (t.key)}
          <tr>
            <td class="name">
              <a href={href("/messages", { sender: t.key })}>{t.title ?? "Untitled thread"}</a>
              <div class="xs muted">{t.models.slice(0, 2).map((m) => `${m.model} ${n(m.n)}`).join(", ")}{#if t.mission_title && t.mission_title !== t.title} · mission {t.mission_title}{/if}</div>
            </td>
            <td class="r num">{n(t.handoffs)}</td>
            <td class="small nowrap">{span(hours(t.first_seen, t.last_seen))}</td>
            <td class="r num small">{pct(t.first_half?.p)}</td>
            <td class="r num small" class:up={(t.change ?? 0) >= 0.1} class:down={(t.change ?? 0) <= -0.1}>{pct(t.second_half?.p)}</td>
            {#each t.parts as part}
              {@const v = part.hook_blocked?.p ?? 0}
              <td class="cell">
                <a href={href("/messages", { sender: t.key, part: String(part.part + 1) })} title="{partLabel(part.part)}: hook blocks {part.hook_blocked?.k} of {part.hook_blocked?.n}{part.reviewed ? `; ${part.presentation_low?.k} of ${part.reviewed} reviewed have Costly or Broken presentation` : ''}">
                  <span class="bar"><span class="fill" style:height="{Math.max(2, v * 100)}%"></span></span>
                  <span class="num pv">{pct(v)}</span>
                  {#if part.reviewed}<span class="xs rv num">{part.presentation_low?.k}/{part.reviewed}</span>{/if}
                </a>
              </td>
            {/each}
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
  <p class="xs muted">
    Each cell is the share the hook blocks in that fifth of the thread, by the order the sender sent its handoffs; it opens those handoffs. Where reviewed handoffs from {sampleName} fall in a fifth, the magenta figure gives how many of them have Costly or Broken presentation. Second half marked when it is at least 10 points above or below the first.
  </p>
</div>

<style>
  .drift {
    display: grid;
    gap: 20px;
  }
  .pooled {
    position: relative;
    display: grid;
    gap: 10px;
    max-width: 860px;
  }
  .panel h3 {
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .panel h3 .muted {
    font-weight: 400;
  }
  .key {
    width: 14px;
    height: 2px;
    background: var(--c);
  }
  .key.hook {
    --c: var(--hook);
  }
  .key.reviewer {
    --c: var(--reviewer);
  }
  svg {
    display: block;
    overflow: visible;
  }
  .grid {
    stroke: var(--rule);
  }
  .tick,
  .val {
    font-size: 11px;
    fill: var(--ink-3);
    font-variant-numeric: tabular-nums;
  }
  .val {
    fill: var(--ink);
    font-weight: 650;
  }
  .val .kn {
    fill: var(--ink-3);
    font-weight: 500;
  }
  .line {
    fill: none;
    stroke-width: 2;
    stroke-linecap: round;
  }
  .line.hook,
  .whisker.hook {
    stroke: var(--hook);
  }
  .line.reviewer,
  .whisker.reviewer {
    stroke: var(--reviewer);
  }
  .whisker {
    stroke-width: 1.5;
    opacity: 0.55;
  }
  .dot {
    stroke: var(--ground);
    stroke-width: 2;
  }
  .dot.hook {
    fill: var(--hook);
  }
  .dot.reviewer {
    fill: var(--reviewer);
  }
  .dot.hollow {
    fill: var(--ground);
    stroke: var(--ink-3);
    stroke-width: 1.5;
  }
  .axis {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    text-align: center;
    font-size: var(--t-xs);
    font-weight: 600;
  }
  .axis a {
    text-decoration: none;
    color: var(--ink-2);
  }
  .axis a:hover {
    color: var(--ink);
    text-decoration: underline;
  }
  .wrap {
    overflow-x: auto;
  }
  .threads td {
    vertical-align: middle;
  }
  .threads th.c {
    text-align: center;
    min-width: 64px;
  }
  .name a {
    font-weight: 600;
    text-decoration: none;
  }
  .name a:hover {
    text-decoration: underline;
  }
  .nowrap {
    white-space: nowrap;
  }
  .up {
    color: var(--ink);
    font-weight: 700;
    box-shadow: inset 0 -2px 0 var(--hook);
  }
  .down {
    color: var(--ink);
    font-weight: 700;
    box-shadow: inset 0 -2px 0 var(--ink-3);
  }
  .cell {
    padding: 4px 6px;
  }
  .cell a {
    display: grid;
    grid-template-columns: 10px auto;
    grid-template-rows: auto auto;
    column-gap: 6px;
    align-items: end;
    text-decoration: none;
    justify-content: center;
  }
  .bar {
    grid-row: 1 / 3;
    width: 10px;
    height: 30px;
    background: var(--sunken);
    border-radius: 2px;
    position: relative;
    overflow: hidden;
  }
  .fill {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    background: var(--hook);
  }
  .pv {
    font-size: var(--t-xs);
    font-weight: 600;
  }
  .rv {
    color: var(--reviewer);
    font-weight: 600;
  }
  .cell a:hover .pv {
    text-decoration: underline;
  }
</style>
