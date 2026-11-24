<script lang="ts">
  /** A few stroked icons drawn for this app, one weight throughout. */
  let { name, size = 14 }: { name: "up" | "down" | "close" | "back"; size?: number } = $props();
  const paths = {
    up: "M3.5 9.5 8 5l4.5 4.5",
    down: "M3.5 6.5 8 11l4.5-4.5",
    close: "M4.5 4.5l7 7m0-7-7 7",
    back: "M9.5 3.5 5 8l4.5 4.5",
  };
</script>

<svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
  <path d={paths[name]} />
</svg>

<style>
  svg {
    display: block;
    flex: none;
  }
</style>
