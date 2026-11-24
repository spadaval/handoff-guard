<script lang="ts">
  import type { BreakdownRow, Proportion } from "../lib/api.ts";
  import { n, pct, ci, month } from "../lib/format.ts";

  /**
   * Two panels on one month axis. The top one is an exact share over every
   * handoff; the bottom one is a sample estimate. They are kept apart so the
   * distance between them never reads as a finding.
   */
  let {
    rows,
    sampleLabel,
    sparse,
    link,
  }: { rows: BreakdownRow[]; sampleLabel: string; sparse: number; link: (key: string) => string } = $props();

  let width = $state(900);
  let hover = $state<number | null>(null);
  const months = $derived(rows.filter((r) => r.key !== "unknown"));
  const unknown = $derived(rows.find((r) => r.key === "unknown"));
  const M = { left: 44, right: 24 };
  const PH = 120;
  const plotW = $derived(Math.max(200, width - M.left - M.right));
  const band = $derived(plotW / Math.max(1, months.length));
  const x = (i: number) => M.left + band * (i + 0.5);
  const y = (p: number) => 10 + (1 - p) * (PH - 20);
  const maxInputs = $derived(Math.max(1, ...months.map((r) => r.inputs)));

  type Panel = { key: "hook" | "reviewer"; title: string; sub: string; get: (r: BreakdownRow) => Proportion; usable: (r: BreakdownRow) => boolean };
  const panels: Panel[] = $derived([
    { key: "hook", title: "Hook blocks", sub: "share of all handoffs that month, exact", get: (r) => r.hook_blocked, usable: (r) => r.inputs > 0 },
    { key: "reviewer", title: "Needs work", sub: `${sampleLabel}, with 95% intervals; hollow points have fewer than ${sparse} reviewed and are not joined`, get: (r) => r.needs_work, usable: (r) => !r.sparse },
  ]);
  /** Segments only between neighbouring months that both have a usable point. */
  function segments(p: Panel) {
    const out: string[] = [];
    for (let i = 1; i < months.length; i++) {
      const a = months[i - 1],
        b = months[i];
      const va = p.get(a),
        vb = p.get(b);
      if (va && vb && p.usable(a) && p.usable(b)) out.push(`M${x(i - 1)},${y(va.p)}L${x(i)},${y(vb.p)}`);
    }
    return out;
  }
  const tip = $derived(hover === null ? null : months[hover]);
</script>

<div class="curve" bind:clientWidth={width}>
  {#each panels as p}
    <div class="panel">
      <h3 class="small"><i class="key {p.key}"></i>{p.title} <span class="muted">{p.sub}</span></h3>
      <svg {width} height={PH} role="img" aria-label="{p.title} by month. The breakdown table gives every value.">
        {#each [0, 0.5, 1] as t}
          <line class="grid" x1={M.left} x2={M.left + plotW} y1={y(t)} y2={y(t)} />
          <text class="tick" x={M.left - 8} y={y(t) + 4} text-anchor="end">{t * 100}%</text>
        {/each}
        {#each months as r, i}
          {#if !r.inputs}
            <rect class="nodata" x={x(i) - band / 2 + 2} y={y(1)} width={band - 4} height={y(0) - y(1)} />
            <text class="nodata-label" x={x(i)} y={y(0.5) + 4} text-anchor="middle">no handoffs</text>
          {/if}
        {/each}
        {#each segments(p) as d}<path class="line {p.key}" {d} />{/each}
        {#each months as r, i}
          {@const v = p.get(r)}
          {#if v}
            {#if v.low !== undefined && v.high !== undefined}
              <line class="whisker {p.key}" x1={x(i)} x2={x(i)} y1={y(v.low)} y2={y(v.high)} />
            {/if}
            <circle class="dot {p.key}" class:hollow={!p.usable(r)} cx={x(i)} cy={y(v.p)} r={hover === i ? 5.5 : 4.5} />
            {#if p.usable(r)}<text class="val" x={x(i) + 9} y={y(v.p) + 4}>{pct(v.p)}</text>{/if}
          {/if}
        {/each}
        {#each months as r, i}
          <rect class="hit" x={x(i) - band / 2} y="0" width={band} height={PH} role="presentation" onmouseenter={() => (hover = i)} onmouseleave={() => (hover = null)} />
        {/each}
      </svg>
    </div>
  {/each}
  <div class="panel">
    <h3 class="small"><i class="key ink"></i>Handoffs recorded</h3>
    <svg {width} height="64" aria-hidden="true">
      {#each months as r, i}
        {@const h = r.inputs ? Math.max(2, (r.inputs / maxInputs) * 30) : 0}
        <a href={link(r.key)} aria-label="{month(r.key, true)}: {n(r.inputs)} handoffs">
          <rect class="vol" class:active={hover === i} x={x(i) - Math.min(24, band * 0.4) / 2} y={36 - h} width={Math.min(24, band * 0.4)} height={h} rx="2" />
          <text class="vol-n" x={x(i)} y={36 - h - 4} text-anchor="middle">{r.inputs ? n(r.inputs) : ""}</text>
          <text class="month" x={x(i)} y={56} text-anchor="middle">{month(r.key)}</text>
        </a>
      {/each}
      <line class="base" x1={M.left} x2={M.left + plotW} y1={36.5} y2={36.5} />
    </svg>
  </div>
  {#if tip}
    {@const left = Math.min(width - 270, Math.max(0, x(hover!) + band / 2 + 4))}
    <div class="tip" style:left="{left}px">
      <strong>{month(tip.key, true)}</strong>
      <dl>
        <dt>Handoffs</dt><dd class="num">{n(tip.inputs)}</dd>
        <dt><i class="sw hook"></i>Hook blocks</dt><dd class="num">{tip.hook_blocked ? `${n(tip.hook_blocked.k)}/${n(tip.hook_blocked.n)}, ${pct(tip.hook_blocked.p)}` : "–"}</dd>
        <dt><i class="sw reviewer"></i>Needs work</dt><dd class="num">{tip.needs_work ? `${n(tip.needs_work.k)}/${n(tip.needs_work.n)}, ${pct(tip.needs_work.p)} (${ci(tip.needs_work)})` : "none reviewed"}</dd>
      </dl>
    </div>
  {/if}
  {#if unknown?.inputs}
    <p class="xs muted">{n(unknown.inputs)} handoffs have no recorded time and are left out of this chart.</p>
  {/if}
</div>

<style>
  .curve {
    position: relative;
    display: grid;
    gap: 14px;
  }
  .panel h3 {
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 2px;
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
  .key.ink {
    --c: var(--ink-3);
    height: 8px;
    width: 8px;
    border-radius: 2px;
  }
  svg {
    display: block;
    overflow: visible;
  }
  .grid,
  .base {
    stroke: var(--rule);
  }
  .tick,
  .month,
  .vol-n,
  .val {
    font-size: 11px;
    fill: var(--ink-3);
    font-variant-numeric: tabular-nums;
  }
  .val {
    fill: var(--ink-2);
    font-weight: 600;
  }
  .month {
    fill: var(--ink-2);
    font-weight: 550;
  }
  .nodata {
    fill: var(--sunken);
  }
  .nodata-label {
    font-size: 11px;
    fill: var(--ink-3);
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
  .hit {
    fill: transparent;
  }
  .vol {
    fill: var(--ink-3);
  }
  .vol.active,
  a:hover .vol {
    fill: var(--ink);
  }
  .tip {
    position: absolute;
    top: 24px;
    width: 266px;
    background: var(--raised);
    border: 1px solid var(--rule-2);
    border-radius: 4px;
    padding: 10px 12px;
    font-size: var(--t-xs);
    pointer-events: none;
    z-index: 5;
  }
  .tip dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 3px 10px;
    margin: 6px 0 0;
  }
  .tip dt {
    color: var(--ink-2);
    display: flex;
    align-items: center;
    gap: 5px;
  }
  .tip dd {
    margin: 0;
    text-align: right;
  }
  .sw {
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }
  .sw.hook {
    background: var(--hook);
  }
  .sw.reviewer {
    background: var(--reviewer);
  }
</style>
