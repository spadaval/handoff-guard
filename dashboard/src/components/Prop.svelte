<script lang="ts">
  import type { Proportion } from "../lib/api.ts";
  import { n, pct, ci } from "../lib/format.ts";
  let { x, interval = true, strong = true }: { x: Proportion; interval?: boolean; strong?: boolean } = $props();
</script>

{#if x}
  <span class="prop num" title="{n(x.k)} of {n(x.n)}; 95% Wilson interval {ci(x)}">
    <span class:strong>{pct(x.p)}</span>
    <span class="kn">{n(x.k)}/{n(x.n)}</span>
    {#if interval}<span class="ci">{ci(x)}</span>{/if}
  </span>
{:else}
  <span class="none">no data</span>
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
