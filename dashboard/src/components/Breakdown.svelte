<script lang="ts">
  import type { BreakdownRow } from "../lib/api.ts";
  import { n, SCORE_NAMES } from "../lib/format.ts";
  import Prop from "./Prop.svelte";
  import CIBar from "./CIBar.svelte";
  import SegBar from "./SegBar.svelte";

  let {
    rows,
    label,
    format = (k: string) => k,
    corpusLink,
    sampleLink,
    sparse,
  }: {
    rows: BreakdownRow[];
    label: string;
    format?: (k: string) => string;
    corpusLink: (key: string) => string;
    sampleLink: (key: string) => string;
    sparse: number;
  } = $props();
</script>

<div class="wrap">
  <table class="data">
    <thead>
      <tr>
        <th>{label}</th>
        <th class="r">Handoffs</th>
        <th colspan="2">Hook blocks <span class="muted">(all handoffs, exact)</span></th>
        <th class="r">Reviewed</th>
        <th colspan="2">Needs work <span class="muted">(sample estimate)</span></th>
        <th>Lowest score</th>
      </tr>
    </thead>
    <tbody>
      {#each rows as r (r.key)}
        <tr class:unknown={r.key === "unknown"} class:empty={!r.inputs}>
          <td class="key"><a href={corpusLink(r.key)}>{format(r.key)}</a></td>
          <td class="r"><a href={corpusLink(r.key)}>{n(r.inputs)}</a></td>
          <td class="bar"><CIBar x={r.hook_blocked} tone="hook" /></td>
          <td><Prop x={r.hook_blocked} /></td>
          <td class="r">{#if r.reviewed}<a href={sampleLink(r.key)}>{n(r.reviewed)}</a>{:else}<span class="muted">0</span>{/if}</td>
          {#if r.reviewed && r.sparse}
            <td class="bar"><CIBar x={r.needs_work} tone="reviewer" faint /></td>
            <td class="small muted">{n(r.needs_work?.k)}/{n(r.needs_work?.n)}, fewer than {sparse} reviewed</td>
          {:else}
            <td class="bar"><CIBar x={r.needs_work} tone="reviewer" /></td>
            <td><Prop x={r.needs_work} /></td>
          {/if}
          <td class="verdicts">
            {#if r.reviewed}
              <SegBar
                label="Lowest scores for {format(r.key)}"
                parts={["4", "3", "2", "1"].map((k) => ({ key: k, label: `${k} ${SCORE_NAMES[k]}`, value: r.lowest[k] ?? 0, cls: "c" + k }))}
              />
            {/if}
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  .wrap {
    overflow-x: auto;
  }
  td a {
    text-decoration: none;
  }
  td a:hover {
    text-decoration: underline;
  }
  .key {
    font-weight: 600;
    min-width: 150px;
  }
  .unknown .key a {
    font-weight: 500;
    color: var(--ink-2);
    font-style: italic;
  }
  .empty td {
    color: var(--ink-3);
  }
  td.bar {
    width: 104px;
    padding-right: 0;
    vertical-align: middle;
  }
  .verdicts {
    width: 140px;
    vertical-align: middle;
  }
</style>
