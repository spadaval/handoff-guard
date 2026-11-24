<script lang="ts">
  import type { Detail } from "../lib/api.ts";
  import { SCORE_NAMES, DIMENSION_NAMES } from "../lib/format.ts";

  /** Every review of one message in columns, so a disagreement can be read. */
  let { detail, selected, onselect }: { detail: Detail; selected: number; onselect: (i: number) => void } = $props();
  const dims = ["intent", "content", "presentation"] as const;
  const label = (v: number | null) => (v === null ? "Unknown" : `${v} ${SCORE_NAMES[String(v)]}`);
  const differs = (d: (typeof dims)[number] | "lowest") => {
    const values = detail.reviews.map((r) => (d === "lowest" ? r.lowest.score : r.scores[d]));
    return new Set(values).size > 1;
  };
</script>

<div class="wrap">
  <table class="data compare">
    <thead>
      <tr>
        <th></th>
        {#each detail.reviews as r, i}
          <th class:sel={i === selected}>
            <button class="pick" onclick={() => onselect(i)} aria-pressed={i === selected}>
              <span class="who">{r.reviewer ?? "unknown reviewer"}</span>
              <span class="xs muted">{r.rubric_version} · <span class="type">{r.run_id}</span>{r.reference ? " · used in figures" : ""}</span>
            </button>
          </th>
        {/each}
      </tr>
    </thead>
    <tbody>
      <tr class:diff={differs("lowest")}>
        <th>Lowest score</th>
        {#each detail.reviews as r}
          <td><span class="score c{r.lowest.score ?? 'null'}">{label(r.lowest.score)}</span>{#if r.lowest.score !== null}<span class="xs muted"> in {r.lowest.questions.map((q) => DIMENSION_NAMES[q].toLowerCase()).join(" and ")}</span>{/if}</td>
        {/each}
      </tr>
      {#each dims as d}
        <tr class:diff={differs(d)}>
          <th>{DIMENSION_NAMES[d]}</th>
          {#each detail.reviews as r}
            {@const f = r.record[d]}
            {@const how = r.scoring[d]}
            <td>
              <span class="score c{r.scores[d] ?? 'null'}">{label(r.scores[d])}</span>
              {#if how.written}<span class="xs muted"> written by the reviewer</span>{/if}
              {#if f?.issues?.length}
                <ul class="issues">
                  {#each f.issues as issue, i}
                    <li class:decides={how.decided_by === i}>
                      <code>{issue.kind}</code>{#if issue.severity}<span class="xs"> {issue.severity}</span>{/if}
                    </li>
                  {/each}
                </ul>
              {/if}
            </td>
          {/each}
        </tr>
      {/each}
      <tr>
        <th>Clear version</th>
        {#each detail.reviews as r}
          <td class="small">{r.record.rewrite ? (r.record.rewrite.of ? "Of one passage" : "Of the whole message") : "None"}</td>
        {/each}
      </tr>
    </tbody>
  </table>
  <p class="xs muted">Rows where the reviews disagree are marked. Choose a column to read that review beside the message.</p>
</div>

<style>
  .wrap {
    overflow-x: auto;
  }
  .compare th,
  .compare td {
    vertical-align: top;
  }
  .compare tbody th {
    font-size: var(--t-sm);
    color: var(--ink);
    white-space: nowrap;
    padding: 8px 10px;
    border-bottom: 1px solid var(--rule);
    text-align: left;
    font-weight: 600;
  }
  .pick {
    display: grid;
    text-align: left;
    border: 0;
    background: none;
    padding: 0;
    gap: 1px;
  }
  .who {
    font-size: var(--t-sm);
    color: var(--ink);
    font-weight: 650;
  }
  th.sel {
    box-shadow: inset 0 -2px 0 var(--ink);
  }
  tr.diff th::after {
    content: " differs";
    font-size: var(--t-xs);
    font-weight: 600;
    color: var(--reviewer);
  }
  .issues {
    list-style: none;
    padding: 0;
    margin: 6px 0 0;
    display: grid;
    gap: 2px;
    font-size: var(--t-xs);
  }
  .issues li.decides code {
    box-shadow: inset 0 -1px 0 var(--ink);
  }
</style>
