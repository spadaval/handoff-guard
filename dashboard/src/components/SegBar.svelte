<script lang="ts">
  import { n, pct } from "../lib/format.ts";
  type Part = { key: string; label: string; value: number; cls: string; href?: string };
  let { parts, tall = false, label }: { parts: Part[]; tall?: boolean; label: string } = $props();
  const total = $derived(parts.reduce((s, p) => s + p.value, 0));
</script>

<div class="seg-bar" class:tall role="img" aria-label="{label}: {parts.map((p) => `${p.label} ${p.value}`).join(', ')}">
  {#each parts.filter((p) => p.value > 0) as p (p.key)}
    {@const share = p.value / total}
    <svelte:element
      this={p.href ? "a" : "span"}
      href={p.href}
      class="part {p.cls}"
      style:flex-grow={p.value}
      title="{p.label}: {n(p.value)} of {n(total)} ({pct(share)})"
    >
      {#if tall && share >= 0.09}<span class="in num">{pct(share)}</span>{/if}
    </svelte:element>
  {/each}
  {#if !total}<span class="part empty"></span>{/if}
</div>

<style>
  .seg-bar {
    display: flex;
    gap: 2px;
    height: 8px;
    width: 100%;
  }
  .tall {
    height: 28px;
  }
  .part {
    flex: 1 1 0;
    min-width: 3px;
    background: var(--c, var(--unknown));
    border-radius: 2px;
    display: flex;
    align-items: center;
    text-decoration: none;
  }
  .tall .part {
    border-radius: 4px;
  }
  a.part:hover {
    filter: brightness(1.08) saturate(1.1);
    outline: 2px solid var(--ink);
    outline-offset: 1px;
  }
  .empty {
    background: var(--sunken);
  }
  .part.c2 .in,
  .part.c3 .in,
  .part.cnull .in {
    color: #16181d;
  }
  .in {
    padding-left: 8px;
    font-size: var(--t-xs);
    font-weight: 650;
    color: #fff;
  }
</style>
