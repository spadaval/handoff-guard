<script lang="ts">
  import type { BreakdownRow, Proportion } from "../lib/api.ts";
  import { n, pct, ci, month, STRATUM_NAMES } from "../lib/format.ts";

  let {
    rows,
    onset,
    sample,
    criterionLabel,
    link,
  }: {
    rows: BreakdownRow[];
    onset: { first_fused_words: string | null; first_hook_block: string | null };
    sample: string;
    criterionLabel: string;
    link: (key: string) => string;
  } = $props();

  let width = $state(900);
  let hover = $state<number | null>(null);
  const months = $derived(rows.filter((r) => r.key !== "unknown"));
  const unknown = $derived(rows.find((r) => r.key === "unknown"));
  const M = { left: 44, right: 168, top: 34, bottom: 8 };
  const H = 210;
  const VH = 74;
  const plotW = $derived(Math.max(200, width - M.left - M.right));
  const band = $derived(plotW / Math.max(1, months.length));
  const x = (i: number) => M.left + band * (i + 0.5);
  const y = (p: number) => M.top + (1 - p) * (H - M.top - M.bottom);
  const maxInputs = $derived(Math.max(1, ...months.map((r) => r.inputs)));

  type S = { key: "reviewer" | "hook"; label: string; sub: string; get: (r: BreakdownRow) => Proportion; dx: number };
  const series: S[] = $derived([
    { key: "hook", label: "Hook blocks", sub: "all inputs with a stored report", get: (r) => r.hook_blocked, dx: -5 },
    { key: "reviewer", label: "Reviewers: bad", sub: `${STRATUM_NAMES[sample]?.toLowerCase()} sample, ${criterionLabel}`, get: (r) => r.bad, dx: 5 },
  ]);
  function path(s: S) {
    let d = "";
    let open = false;
    months.forEach((r, i) => {
      const v = s.get(r);
      if (!v) {
        open = false;
        return;
      }
      d += `${open ? "L" : "M"}${x(i) + s.dx},${y(v.p)}`;
      open = true;
    });
    return d;
  }
  function last(s: S) {
    for (let i = months.length - 1; i >= 0; i--) {
      const v = s.get(months[i]);
      if (v) return { i, v };
    }
    return null;
  }
  const ends = $derived.by(() => {
    const e = series.map((s) => ({ s, at: last(s) })).filter((e) => e.at);
    const ys = e.map((e) => y(e.at!.v.p));
    if (ys.length === 2 && Math.abs(ys[0] - ys[1]) < 30) {
      const mid = (ys[0] + ys[1]) / 2;
      const up = ys[0] <= ys[1] ? 0 : 1;
      ys[up] = mid - 15;
      ys[1 - up] = mid + 15;
    }
    return e.map((e, i) => ({ ...e, ly: ys[i] }));
  });
  const markers = $derived.by(() => {
    const out: { i: number; label: string }[] = [];
    const a = months.findIndex((r) => r.key === onset.first_fused_words);
    const b = months.findIndex((r) => r.key === onset.first_hook_block);
    if (a >= 0 && a === b) out.push({ i: a, label: "First fused_words issue and first hook block" });
    else {
      if (a >= 0) out.push({ i: a, label: "First fused_words issue" });
      if (b >= 0) out.push({ i: b, label: "First hook block" });
    }
    return out;
  });
  const tip = $derived(hover === null ? null : months[hover]);
</script>

<div class="curve" bind:clientWidth={width}>
  <div class="legend" aria-hidden="true">
    {#each series as s}
      <span class="key {s.key}"><i></i>{s.label} <span class="muted">({s.sub})</span></span>
    {/each}
    <span class="key whisker"><i></i>95% interval</span>
  </div>
  <svg {width} height={H} role="img" aria-label="Share of messages by month. Table below gives every value.">
    {#each [0, 0.25, 0.5, 0.75, 1] as t}
      <line class="grid" x1={M.left} x2={M.left + plotW} y1={y(t)} y2={y(t)} />
      <text class="tick" x={M.left - 8} y={y(t) + 4} text-anchor="end">{t * 100}%</text>
    {/each}
    {#each months as r, i}
      {#if !r.inputs}
        <rect class="nodata" x={x(i) - band / 2 + 2} y={M.top} width={band - 4} height={H - M.top - M.bottom} />
        <text class="nodata-label" x={x(i)} y={y(0.5)} text-anchor="middle">no inputs</text>
      {/if}
    {/each}
    {#each markers as m, j}
      {@const mx = x(m.i) - band / 2}
      <line class="onset" x1={mx} x2={mx} y1={M.top - 22 + j * 14} y2={H - M.bottom} />
      <text class="onset-label" x={mx + 6} y={M.top - 12 + j * 14}>{m.label}, {month(months[m.i].key, true)}</text>
    {/each}
    {#each series as s}
      {#each months as r, i}
        {@const v = s.get(r)}
        {#if v}
          <line class="whisker {s.key}" x1={x(i) + s.dx} x2={x(i) + s.dx} y1={y(v.low)} y2={y(v.high)} />
        {/if}
      {/each}
      <path class="line {s.key}" d={path(s)} />
      {#each months as r, i}
        {@const v = s.get(r)}
        {#if v}
          <circle class="dot {s.key}" cx={x(i) + s.dx} cy={y(v.p)} r={hover === i ? 5.5 : 4.5} />
        {/if}
      {/each}
    {/each}
    {#each ends as e}
      <line class="leader" x1={x(e.at!.i) + e.s.dx + 8} x2={M.left + plotW + 10} y1={y(e.at!.v.p)} y2={e.ly} />
      <text class="end" x={M.left + plotW + 14} y={e.ly + 4}>
        <tspan class="end-v">{pct(e.at!.v.p)}</tspan>
        <tspan dx="6" class="end-l">{e.s.key === "hook" ? "hook blocks" : "reviewers: bad"}</tspan>
      </text>
    {/each}
    {#each months as r, i}
      <rect
        class="hit"
        x={x(i) - band / 2}
        y={M.top}
        width={band}
        height={H - M.top}
        role="presentation"
        onmouseenter={() => (hover = i)}
        onmouseleave={() => (hover = null)}
      />
    {/each}
  </svg>
  <svg {width} height={VH} class="volume" aria-hidden="true">
    <text class="tick" x={M.left - 8} y={14} text-anchor="end">Inputs</text>
    {#each months as r, i}
      {@const h = r.inputs ? Math.max(2, (r.inputs / maxInputs) * 36) : 0}
      <a href={link(r.key)} aria-label="{month(r.key, true)}: {n(r.inputs)} inputs">
        <rect class="vol" class:active={hover === i} x={x(i) - Math.min(24, band * 0.4) / 2} y={42 - h} width={Math.min(24, band * 0.4)} height={h} rx="2" />
        <text class="vol-n" x={x(i)} y={42 - h - 4} text-anchor="middle">{r.inputs ? n(r.inputs) : ""}</text>
        <text class="month" x={x(i)} y={62} text-anchor="middle">{month(r.key)}</text>
      </a>
    {/each}
    <line class="base" x1={M.left} x2={M.left + plotW} y1={42.5} y2={42.5} />
  </svg>
  {#if tip}
    {@const left = Math.min(width - 260, Math.max(0, x(hover!) + band / 2 + 4))}
    <div class="tip" style:left="{left}px">
      <strong>{month(tip.key, true)}</strong>
      <dl>
        <dt>Inputs recorded</dt><dd class="num">{n(tip.inputs)}</dd>
        <dt><i class="sw hook"></i>Hook blocks</dt><dd class="num">{tip.hook_blocked ? `${n(tip.hook_blocked.k)}/${n(tip.hook_blocked.n)}, ${pct(tip.hook_blocked.p)} (${ci(tip.hook_blocked)})` : "–"}</dd>
        <dt><i class="sw reviewer"></i>Reviewers: bad</dt><dd class="num">{tip.bad ? `${n(tip.bad.k)}/${n(tip.bad.n)}, ${pct(tip.bad.p)} (${ci(tip.bad)})` : "none reviewed"}</dd>
        <dt>Reviewed in sample</dt><dd class="num">{n(tip.reviewed)} of {n(tip.sampled)}</dd>
      </dl>
    </div>
  {/if}
  {#if unknown?.inputs}
    <p class="unknown xs muted">{n(unknown.inputs)} inputs have no recorded time and are left out of this chart.</p>
  {/if}
</div>

<style>
  .curve {
    position: relative;
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 20px;
    font-size: var(--t-xs);
    color: var(--ink-2);
    margin-bottom: 4px;
  }
  .key {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .key i {
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
  .key.whisker i {
    width: 2px;
    height: 12px;
    background: var(--ink-3);
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
  .vol-n {
    font-size: 11px;
    fill: var(--ink-3);
    font-variant-numeric: tabular-nums;
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
  .onset {
    stroke: var(--ink);
    stroke-width: 1;
  }
  .onset-label {
    font-size: 11px;
    font-weight: 600;
    fill: var(--ink);
  }
  .line {
    fill: none;
    stroke-width: 2;
    stroke-linejoin: round;
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
  .leader {
    stroke: var(--rule-2);
  }
  .end {
    font-size: 12px;
    fill: var(--ink-2);
  }
  .end-v {
    font-weight: 650;
    fill: var(--ink);
    font-variant-numeric: tabular-nums;
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
    top: 40px;
    width: 256px;
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
  .unknown {
    margin-top: 4px;
  }
  .volume {
    margin-top: 14px;
  }
</style>
