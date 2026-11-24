<script lang="ts">
  import type { Proportion } from "../lib/api.ts";
  import { n, pct, ci } from "../lib/format.ts";
  let { x, strong = true }: { x: Proportion; strong?: boolean } = $props();
  const estimate = $derived(!!x && x.low !== undefined);
</script>

{#if x}
  <span class="prop num" title={estimate ? `${n(x.k)} of ${n(x.n)}; 95% Wilson interval ${ci(x)}` : `${n(x.k)} of ${n(x.n)}, an exact count`}>
    <span class:strong>{pct(x.p)}</span>
    <span class="kn">{n(x.k)}/{n(x.n)}</span>
    {#if estimate}<span class="ci">{ci(x)}</span>{/if}
  </span>
{:else}
  <span class="none">none</span>
{/if}

<style>
  .prop {
    display: inline-flex;
    gap: 6px;
    align-items: baseline;
    white-space: nowrap;
  }
  .strong {
    font-weight: 650;
    color: var(--ink);
  }
  .kn {
    color: var(--ink-2);
  }
  .ci {
    color: var(--ink-3);
    font-size: 0.92em;
  }
  .none {
    color: var(--ink-3);
    font-size: var(--t-xs);
  }
</style>
