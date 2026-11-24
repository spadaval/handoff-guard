<script lang="ts">
  import { router, setParams } from "../lib/router.svelte.ts";
  import { data } from "../lib/data.svelte.ts";
  import { n, STRATUM_NAMES } from "../lib/format.ts";

  const params = $derived(router.route.params);
  const sample = $derived(params.get("sample") ?? "random");
  const criterion = $derived(params.get("criterion") ?? "verdict");
  const counts = $derived(Object.fromEntries((data.meta?.strata_counts ?? []).map((s) => [s.stratum, s])));
  const options = $derived([
    ...(data.meta?.strata ?? []).map((s) => ({ key: s, reviewed: counts[s]?.reviewed ?? 0, sampled: counts[s]?.sampled ?? 0 })),
    { key: "all", reviewed: data.meta?.reviewed ?? 0, sampled: data.meta?.sampled ?? 0 },
  ]);
  function set(name: string, value: string) {
    const p = new URLSearchParams(params);
    p.set(name, value);
    setParams(p);
  }
</script>

<div class="controls">
  <div class="group">
    <span class="label" id="sample-label">Sample</span>
    <div class="seg" role="group" aria-labelledby="sample-label">
      {#each options as o}
        <button aria-pressed={sample === o.key} onclick={() => set("sample", o.key)} title="{n(o.reviewed)} of {n(o.sampled)} reviewed">
          {STRATUM_NAMES[o.key] ?? o.key}<span class="count">{n(o.reviewed)}</span>
        </button>
      {/each}
    </div>
  </div>
  <div class="group">
    <span class="label" id="criterion-label">Reviewers call a message bad when</span>
    <div class="seg" role="group" aria-labelledby="criterion-label">
      <button aria-pressed={criterion === "verdict"} onclick={() => set("criterion", "verdict")}>Verdict is revise or rewrite</button>
      <button aria-pressed={criterion === "presentation"} onclick={() => set("criterion", "presentation")}>Presentation scores 1–2</button>
    </div>
  </div>
</div>
<p class="sample-note" class:skewed={sample !== "random"}>
  {#if sample === "random"}
    The random stratum is a fair sample of the {n(data.meta?.corpus.inputs)} handoff inputs, so its shares estimate the corpus.
  {:else if sample === "all"}
    All strata pooled. Three strata were chosen on purpose (earlier reviews, fused text, long messages), so these shares describe the sample, not the corpus.
  {:else}
    The {STRATUM_NAMES[sample]?.toLowerCase()} stratum was chosen on purpose, so these shares describe that stratum only, not the corpus.
  {/if}
</p>

<style>
  .controls {
    display: flex;
    flex-wrap: wrap;
    gap: 12px 28px;
    align-items: flex-end;
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
    margin-top: 10px;
    font-size: var(--t-sm);
    color: var(--ink-2);
  }
  .skewed {
    color: var(--ink);
  }
  .skewed::before {
    content: "Skewed sample. ";
    font-weight: 650;
  }
</style>
