<script lang="ts">
  import type { Proportion } from "../lib/api.ts";
  /** A share on a 0–100% track. Sample estimates also draw their interval. */
  let { x, tone = "ink", width = 96, faint = false }: { x: Proportion; tone?: "hook" | "reviewer" | "ink"; width?: number; faint?: boolean } = $props();
</script>

<svg class="ci {tone}" class:faint {width} height="14" viewBox="0 0 {width} 14" aria-hidden="true">
  <line class="track" x1="0" x2={width} y1="7" y2="7" />
  {#if x}
    {#if x.low !== undefined && x.high !== undefined}
      <rect class="band" x={x.low * width} y="3" width={Math.max(1, (x.high - x.low) * width)} height="8" rx="2" />
    {:else}
      <rect class="fill" x="0" y="5" width={Math.max(1, x.p * width)} height="4" rx="2" />
    {/if}
    <rect class="point" x={Math.min(width - 3, Math.max(0, x.p * width - 1.5))} y="1" width="3" height="12" rx="1" />
  {/if}
</svg>

<style>
  .ci {
    display: block;
    flex: none;
  }
  .faint {
    opacity: 0.4;
  }
  .track {
    stroke: var(--rule-2);
    stroke-width: 1;
  }
  .band,
  .fill {
    fill: var(--tint);
  }
  .point {
    fill: var(--mark);
  }
  .hook {
    --mark: var(--hook);
    --tint: var(--hook-tint-2);
  }
  .reviewer {
    --mark: var(--reviewer);
    --tint: var(--reviewer-tint-2);
  }
  .ink {
    --mark: var(--ink);
    --tint: var(--rule-2);
  }
</style>
