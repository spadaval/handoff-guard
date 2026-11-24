<script lang="ts">
  import { tick } from "svelte";
  import { marked } from "marked";
  import { get } from "../lib/api.ts";
  import { router, href } from "../lib/router.svelte.ts";
  import { data } from "../lib/data.svelte.ts";

  type Rubric = { path: string; markdown: string; current: boolean; commit: string | null; requested: string | null; found: boolean };
  let rubric = $state<Rubric | null>(null);
  let error = $state<string | null>(null);
  let body: HTMLElement | undefined = $state();
  const sha = $derived(router.route.params.get("sha256"));
  const version = $derived(router.route.params.get("version"));

  $effect(() => {
    const ctl = new AbortController();
    get<Rubric>("/rubric" + (sha ? "?sha256=" + sha : ""), ctl.signal)
      .then((r) => ((rubric = r), (error = null)))
      .catch((e) => e.name !== "AbortError" && (error = e.message));
    return () => ctl.abort();
  });

  const slug = (s: string) => s.toLowerCase().replace(/<[^>]+>/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const parsed = $derived.by(() => {
    if (!rubric) return null;
    const toc: { depth: number; text: string; id: string }[] = [];
    const tokens = marked.lexer(rubric.markdown);
    for (const t of tokens) if (t.type === "heading" && t.depth <= 3) toc.push({ depth: t.depth, text: t.text, id: slug(t.text) });
    const renderer = new marked.Renderer();
    renderer.heading = function ({ tokens, depth, text }) {
      return `<h${depth} id="${slug(text)}">${this.parser.parseInline(tokens)}</h${depth}>`;
    };
    // The rubric is a tracked file in this repository, rendered as written.
    return { toc, html: marked.parse(rubric.markdown, { renderer, async: false }) as string };
  });
  const at = $derived(router.route.params.get("at"));
  $effect(() => {
    if (!parsed || !at) return;
    tick().then(() => {
      const target = parsed.toc.find((h) => h.text.toLowerCase().includes(at.toLowerCase()));
      if (target) document.getElementById(target.id)?.scrollIntoView({ block: "start" });
    });
  });
</script>

<div class="page rubric">
  {#if error}
    <p class="error">{error}</p>
  {:else if !parsed || !rubric}
    <div class="skeleton" style="height: 600px"></div>
  {:else}
    <nav class="toc small" aria-label="Rubric sections">
      <p class="xs muted">Read from <code>{rubric.path}</code>{#if rubric.commit} at commit <code>{rubric.commit.slice(0, 8)}</code>{/if}</p>
      <ol>
        {#each parsed.toc.filter((h) => h.depth > 1) as h}
          <li class="d{h.depth}"><a href="#{h.id}" onclick={(e) => { e.preventDefault(); document.getElementById(h.id)?.scrollIntoView(); }}>{h.text}</a></li>
        {/each}
      </ol>
    </nav>
    <article class="prose" bind:this={body}>
      {#if sha && !rubric.current && rubric.found}
        <p class="banner small">
          This is the rubric as it was when the review was scored{#if version} ({version}){/if}. The current file is {data.meta?.rubric_version}.
          <a href={href("/rubric")}>Show the current rubric</a>
        </p>
      {:else if sha && !rubric.found}
        <p class="banner small">
          The rubric this review was scored under{#if version} ({version}){/if} is not in this repository's history, so the current file ({data.meta?.rubric_version}) is shown instead.
        </p>
      {/if}
      {@html parsed.html}
    </article>
  {/if}
</div>

<style>
  .rubric {
    display: grid;
    grid-template-columns: 220px minmax(0, 72ch);
    gap: 56px;
  }
  .toc {
    position: sticky;
    top: calc(var(--bar-h) + 24px);
    align-self: start;
  }
  .toc ol {
    list-style: none;
    padding: 0;
    margin: 10px 0 0;
    display: grid;
    gap: 4px;
  }
  .toc a {
    text-decoration: none;
    color: var(--ink-2);
  }
  .toc a:hover {
    color: var(--ink);
    text-decoration: underline;
  }
  .toc .d3 {
    padding-left: 12px;
  }
  .banner {
    border: 1px solid var(--ink);
    border-radius: 4px;
    padding: 10px 12px;
    margin-bottom: 20px;
    font-weight: 550;
  }
  .banner a {
    margin-left: 6px;
  }
  .prose {
    font-size: var(--t-md);
    line-height: 1.65;
  }
  .prose :global(h1) {
    margin-bottom: 18px;
  }
  .prose :global(h2) {
    font-size: var(--t-xl);
    margin: 40px 0 10px;
    padding-top: 16px;
    border-top: 1px solid var(--rule-2);
    scroll-margin-top: calc(var(--bar-h) + 16px);
  }
  .prose :global(h3) {
    font-size: var(--t-lg);
    margin: 28px 0 8px;
    scroll-margin-top: calc(var(--bar-h) + 16px);
  }
  .prose :global(p),
  .prose :global(ul),
  .prose :global(ol),
  .prose :global(table),
  .prose :global(pre) {
    margin: 0 0 14px;
  }
  .prose :global(code) {
    font-size: 0.92em;
  }
  .prose :global(pre) {
    background: var(--sunken);
    padding: 12px 14px;
    border-radius: 4px;
    overflow-x: auto;
    font-size: 13px;
    line-height: 1.5;
  }
  .prose :global(table) {
    border-collapse: collapse;
    width: 100%;
    font-size: var(--t-sm);
  }
  .prose :global(th),
  .prose :global(td) {
    text-align: left;
    padding: 6px 10px;
    border-bottom: 1px solid var(--rule);
    vertical-align: top;
  }
  .prose :global(th) {
    border-bottom-color: var(--rule-2);
  }
  @media (max-width: 900px) {
    .rubric {
      grid-template-columns: 1fr;
    }
    .toc {
      position: static;
    }
  }
</style>
