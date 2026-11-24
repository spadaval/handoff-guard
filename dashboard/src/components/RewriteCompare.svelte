<script lang="ts">
  import { n } from "../lib/format.ts";
  import { measure, locate } from "../lib/marks.ts";

  let { text, rewrite }: { text: string; rewrite: { of?: string; text: string } } = $props();
  const original = $derived(rewrite.of ?? text);
  const a = $derived(measure(original));
  const b = $derived(measure(rewrite.text));
  const ratio = $derived(b.characters / Math.max(1, a.characters));
  const at = $derived.by(() => {
    if (!rewrite.of) return null;
    const i = text.indexOf(rewrite.of);
    if (i < 0) return null;
    const where = locate(text);
    const s = where(i),
      e = where(i + rewrite.of.length);
    return s.line === e.line ? `line ${s.line}` : `lines ${s.line}–${e.line}`;
  });
</script>

<div class="compare">
  <p class="summary">
    {#if rewrite.of}The reviewer rewrote one passage{#if at} ({at}){/if}; the rest of the message is unchanged.{:else}The reviewer rewrote the whole message.{/if}
    The plain-English version is
    <strong class="num">{ratio >= 1 ? `${ratio.toFixed(1)} times as long` : `${Math.round((1 - ratio) * 100)}% shorter`}</strong>.
  </p>
  <div class="cols">
    <section>
      <header>
        <h3>{rewrite.of ? "Passage as written" : "As written"}</h3>
        <span class="num size"><b>{n(a.characters)}</b> characters, {n(a.words)} words</span>
      </header>
      <div class="sizebar"><span style:width="{Math.min(100, (a.characters / Math.max(a.characters, b.characters)) * 100)}%"></span></div>
      <div class="body type">{original}</div>
    </section>
    <section>
      <header>
        <h3>Plain-English rewrite</h3>
        <span class="num size"><b>{n(b.characters)}</b> characters, {n(b.words)} words</span>
      </header>
      <div class="sizebar rw"><span style:width="{Math.min(100, (b.characters / Math.max(a.characters, b.characters)) * 100)}%"></span></div>
      <div class="body type">{#each rewrite.text.split(/(\[unclear:[^\]]*\])/) as part}{#if part.startsWith("[unclear:")}<span class="unclear">{part}</span>{:else}{part}{/if}{/each}</div>
    </section>
  </div>
</div>

<style>
  .compare {
    display: grid;
    gap: 14px;
  }
  .summary {
    font-size: var(--t-sm);
    color: var(--ink-2);
    max-width: 80ch;
  }
  .summary strong {
    color: var(--ink);
  }
  .cols {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 24px;
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 10px;
    flex-wrap: wrap;
  }
  .size {
    font-size: var(--t-xs);
    color: var(--ink-2);
  }
  .size b {
    color: var(--ink);
    font-size: var(--t-md);
  }
  .sizebar {
    height: 6px;
    margin: 8px 0 10px;
    background: var(--sunken);
    border-radius: 3px;
    overflow: hidden;
  }
  .sizebar span {
    display: block;
    height: 100%;
    background: var(--ink-3);
    border-radius: 3px;
  }
  .sizebar.rw span {
    background: var(--reviewer);
  }
  .body {
    font-size: 14px;
    line-height: 1.6;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    border-top: 1px solid var(--rule);
    padding-top: 10px;
    font-variant-ligatures: none;
  }
  .unclear {
    background: var(--s2-tint);
    border-radius: 2px;
  }
  @media (max-width: 800px) {
    .cols {
      grid-template-columns: 1fr;
    }
  }
</style>
