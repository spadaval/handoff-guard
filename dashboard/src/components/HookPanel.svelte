<script lang="ts">
  import type { Detail, HookCheck, HookReport } from "../lib/api.ts";
  import type { Mark } from "../lib/marks.ts";
  import { n, date, humanise } from "../lib/format.ts";

  let showAll = $state<Record<number, boolean>>({});
  let { detail, marks, active, onjump }: { detail: Detail; marks: Mark[]; active: string | null; onjump: (id: string) => void } = $props();

  const live = $derived(detail.hook.live as HookReport | null);
  const stored = $derived(detail.hook.stored as HookReport | null);
  const report = $derived(live ?? stored);
  const source = $derived(live ? "live" : stored ? "stored" : "none");
  const checks = $derived((report?.checks ?? []).map((c, i) => ({ c, i })));
  const flagged = $derived(checks.filter(({ c }) => c.status !== "pass"));
  const passing = $derived(checks.filter(({ c }) => c.status === "pass"));
  const byCheck = $derived.by(() => {
    const m = new Map<number, Mark[]>();
    for (const mk of marks)
      if (mk.kind === "hook") {
        const i = Number(mk.id.split("-")[1]);
        m.set(i, [...(m.get(i) ?? []), mk]);
      }
    return m;
  });
  const differences = $derived.by(() => {
    if (!live || !stored) return [];
    const out: string[] = [];
    if (!!live.blocked !== !!stored.blocked) out.push(`The stored report ${stored.blocked ? "blocked" : "allowed"} this message; the current rules ${live.blocked ? "block" : "allow"} it.`);
    const before = new Map(stored.checks.map((c) => [c.rule, c.status]));
    for (const c of live.checks) {
      const was = before.get(c.rule);
      if (was === undefined) out.push(`New check ${c.rule}: ${c.status}.`);
      else if (was !== c.status) out.push(`${c.rule} was ${was}, now ${c.status}.`);
      before.delete(c.rule);
    }
    for (const [rule, was] of before) out.push(`Check ${rule} (${was}) no longer runs.`);
    return out;
  });
  const statusWord: Record<string, string> = { block: "Blocks", warn: "Warns", pass: "Passes" };
  function fmt(v: unknown): string {
    if (typeof v === "number") return Number.isInteger(v) ? n(v) : String(Math.round(v * 100) / 100);
    if (typeof v === "boolean") return v ? "yes" : "no";
    if (v === null || v === undefined) return "–";
    if (typeof v === "string") return v;
    return JSON.stringify(v);
  }
  function extras(c: HookCheck) {
    const known = new Set(["rule", "category", "status", "reason", "measurements", "thresholds", "spans", "omitted_spans"]);
    return Object.entries(c).filter(([k]) => !known.has(k));
  }
</script>

<section class="panel" aria-labelledby="hook-title">
  <header class="ph">
    <h2 id="hook-title"><span class="key hk"></span>Hook</h2>
    <span class="xs muted">
      {#if source === "live"}Current rules, run on this message now{:else if source === "stored"}Stored report{#if detail.hook.stored_run}, {date(detail.hook.stored_run.created_at)}{/if}{:else}No report{/if}
    </span>
  </header>
  {#if detail.hook.live_error}
    <p class="xs note-warn">Could not run the hook: {detail.hook.live_error}.{#if stored} Showing the stored report instead.{/if}</p>
  {/if}
  {#if !report}
    <p class="small quiet">No hook report exists for this message.</p>
  {:else}
    <div class="decision">
      <span class="dword" class:block={report.blocked}>{report.blocked ? "Blocks" : "Allows"}</span>
      {#if report.decision_rule}<span class="small quiet">decided by <code>{report.decision_rule}</code></span>
      {:else if flagged.length}<span class="small quiet">with {flagged.length} {flagged.length === 1 ? "warning" : "warnings"}</span>
      {/if}
    </div>
    {#if differences.length}
      <div class="diff xs">
        <strong>Differs from the stored report</strong> used in lists and figures:
        <ul>{#each differences as d}<li>{d}</li>{/each}</ul>
      </div>
    {/if}
    {#each flagged as { c, i } (i)}
      {@const spans = byCheck.get(i) ?? []}
      <article class="check">
        <header>
          <code class="rule">{c.rule}</code>
          <span class="st {c.status}">{statusWord[c.status] ?? c.status}</span>
        </header>
        {#if c.category}<span class="xs muted">{humanise(c.category)}{#if c.enforcement} · {c.enforcement}{/if}</span>{/if}
        {#if c.reason}<p class="small">{c.reason}</p>{/if}
        <div class="mt xs">
          {#if c.measurements}
            <div><span class="muted">Measured</span> {#each Object.entries(c.measurements) as [k, v], j}{j ? ", " : ""}{humanise(k)} <b class="num">{fmt(v)}</b>{/each}</div>
          {/if}
          {#if c.thresholds}
            <div><span class="muted">Thresholds</span> {#each Object.entries(c.thresholds) as [k, v], j}{j ? ", " : ""}{humanise(k)} <b class="num">{fmt(v)}</b>{/each}</div>
          {/if}
          {#each extras(c) as [k, v]}
            <div><span class="muted">{humanise(k)}</span> {fmt(v)}</div>
          {/each}
        </div>
        {#if spans.length}
          <div class="spans">
            {#each showAll[i] ? spans : spans.slice(0, 12) as s}
              <button class="cite type" class:on={active === s.id} onclick={() => onjump(s.id)}>{s.cite}</button>
            {/each}
            {#if spans.length > 12}
              <button class="more xs" onclick={() => (showAll[i] = !showAll[i])}>{showAll[i] ? "Show fewer" : `Show all ${spans.length}`}</button>
            {/if}
            {#if Number(c.omitted_spans ?? 0) > 0}<span class="xs muted">+{n(Number(c.omitted_spans))} spans not reported</span>{/if}
          </div>
        {/if}
      </article>
    {/each}
    {#if passing.length}
      <details class="passing">
        <summary class="small">{passing.length} {passing.length === 1 ? "check passes" : "checks pass"}: <span class="type">{passing.map(({ c }) => c.rule).join(", ")}</span></summary>
        {#each passing as { c } (c.rule)}
          <div class="pass-row xs">
            <code>{c.rule}</code>
            {#if c.measurements}<span class="quiet">{#each Object.entries(c.measurements) as [k, v], j}{j ? ", " : ""}{humanise(k)} <b class="num">{fmt(v)}</b>{/each}</span>{/if}
          </div>
        {/each}
      </details>
    {/if}
    {#if typeof report.limitation === "string"}
      <p class="xs muted">{report.limitation}</p>
    {/if}
  {/if}
</section>

<style>
  .panel {
    display: grid;
    gap: 12px;
  }
  .ph {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 10px;
    border-bottom: 1px solid var(--rule-2);
    padding-bottom: 8px;
  }
  .ph h2 {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .key.hk {
    width: 12px;
    height: 12px;
    border-radius: 2px;
    background: var(--hook-tint);
    box-shadow: inset 0 -3px 0 var(--hook);
  }
  .decision {
    display: grid;
    gap: 2px;
  }
  .dword {
    font-size: var(--t-xl);
    font-weight: 700;
    color: var(--ink-2);
  }
  .dword.block {
    color: var(--hook);
  }
  .diff {
    border: 1px solid var(--hook);
    border-radius: 4px;
    padding: 8px 10px;
    background: var(--hook-tint);
  }
  .diff ul {
    margin: 4px 0 0;
    padding-left: 16px;
  }
  .note-warn {
    color: var(--ink);
    background: var(--s2-tint);
    padding: 6px 8px;
    border-radius: 3px;
  }
  .check {
    border-top: 1px solid var(--rule);
    padding-top: 10px;
    display: grid;
    gap: 5px;
  }
  .check header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .rule {
    font-weight: 700;
    font-size: 13.5px;
  }
  .st {
    font-size: var(--t-xs);
    font-weight: 650;
    padding: 1px 7px;
    border-radius: 3px;
  }
  .st.block {
    background: var(--hook);
    color: #fff;
  }
  .st.warn {
    box-shadow: inset 0 0 0 1px var(--hook);
    color: var(--hook);
  }
  .mt {
    display: grid;
    gap: 2px;
    color: var(--ink-2);
  }
  .mt b {
    color: var(--ink);
    font-weight: 600;
  }
  .spans {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    align-items: center;
  }
  .cite {
    border: 1px solid var(--hook);
    background: var(--hook-tint);
    border-radius: 3px;
    font-size: 12px;
    font-weight: 700;
    padding: 0 6px;
    height: 22px;
  }
  .cite:hover,
  .cite.on {
    background: var(--hook-tint-2);
  }
  .cite.on {
    outline: 1.5px solid var(--ink);
  }
  .more {
    border: 0;
    background: none;
    color: var(--ink-2);
    text-decoration: underline;
    text-underline-offset: 2px;
    padding: 0 4px;
  }
  .passing summary {
    cursor: pointer;
    color: var(--ink-2);
  }
  .pass-row {
    display: grid;
    gap: 1px;
    padding: 6px 0;
    border-bottom: 1px solid var(--rule);
  }
</style>
