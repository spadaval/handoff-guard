<script lang="ts">
  import { data, prefs, setPref } from "../lib/data.svelte.ts";
  import { n } from "../lib/format.ts";

  const s = $derived(data.meta!.samples);
</script>

<div class="controls">
  <div class="group">
    <span class="label" id="sample-label">Figures use</span>
    <div class="seg" role="group" aria-labelledby="sample-label">
      <button aria-pressed={prefs.sample === "fair"} onclick={() => setPref("sample", "fair")} disabled={!s.fair.available}>
        Fair sample<span class="count">{n(s.fair.reviewed)}</span>
      </button>
      <button aria-pressed={prefs.sample === "all"} onclick={() => setPref("sample", "all")}>
        All reviewed<span class="count">{n(s.all.reviewed)}</span>
      </button>
    </div>
  </div>
  <p class="sample-note" class:skewed={prefs.sample === "all"}>
    {#if prefs.sample === "fair"}
      The fair sample is the first {n(s.fair.size)} handoffs in the shuffled sampling order, all reviewed. Its shares estimate the {n(data.meta!.corpus.inputs)} handoffs.
    {:else}
      <strong>Skewed toward problem messages.</strong> All {n(s.all.reviewed)} reviewed handoffs, including those picked for long letter runs, for length and for the earlier pilot. These shares describe the reviewed set, not the corpus.
    {/if}
    Intervals are 95% Wilson intervals for sample estimates. They treat messages as independent, but messages cluster by mission, so the true uncertainty is wider. Counts over all handoffs are exact and have none.
  </p>
</div>

<style>
  .controls {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 8px 28px;
    align-items: end;
  }
  .group {
    display: grid;
    gap: 4px;
  }
  .label {
    font-size: var(--t-xs);
    color: var(--ink-3);
    font-weight: 550;
  }
  .sample-note {
    font-size: var(--t-sm);
    color: var(--ink-2);
    max-width: 92ch;
  }
  .sample-note strong {
    color: var(--ink);
  }
  @media (max-width: 900px) {
    .controls {
      grid-template-columns: 1fr;
    }
  }
</style>
