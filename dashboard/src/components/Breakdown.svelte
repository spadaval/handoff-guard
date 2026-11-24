<script lang="ts">
  import type { BreakdownRow } from "../lib/api.ts";
  import { n, VERDICT_NAMES } from "../lib/format.ts";
  import Prop from "./Prop.svelte";
  import CIBar from "./CIBar.svelte";
  import SegBar from "./SegBar.svelte";

  let {
    rows,
    label,
    format = (k: string) => k,
    corpusLink,
    sampleLink,
  }: {
    rows: BreakdownRow[];
    label: string;
    format?: (k: string) => string;
    corpusLink: (key: string) => string;
    sampleLink: (key: string) => string;
  } = $props();
</script>

<div class="wrap">
  <table class="data">
    <thead>
      <tr>
        <th>{label}</th>
        <th class="r">Inputs</th>
        <th colspan="2">Hook blocks <span class="muted">(all inputs)</span></th>
        <th class="r">Reviewed</th>
        <th colspan="2">Reviewers: bad <span class="muted">(sample)</span></th>
        <th>Verdicts</th>
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
          <td class="bar"><CIBar x={r.bad} tone="reviewer" /></td>
          <td><Prop x={r.bad} /></td>
          <td class="verdicts">
            {#if r.reviewed}
              <SegBar
                label="Verdicts for {format(r.key)}"
                parts={[
                  { key: "send", label: VERDICT_NAMES.send, value: r.verdicts.send, cls: "c4" },
                  { key: "revise", label: VERDICT_NAMES.revise, value: r.verdicts.revise, cls: "c2" },
                  { key: "rewrite", label: VERDICT_NAMES.rewrite, value: r.verdicts.rewrite, cls: "c1" },
                  { key: "unknown", label: VERDICT_NAMES.unknown, value: r.verdicts.unknown, cls: "cnull" },
                ]}
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
