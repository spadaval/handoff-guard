<script lang="ts">
  import { router, href } from "./lib/router.svelte.ts";
  import { data, reload } from "./lib/data.svelte.ts";
  import { n, time } from "./lib/format.ts";
  import Overview from "./views/Overview.svelte";
  import Screening from "./views/Screening.svelte";
  import Messages from "./views/Messages.svelte";
  import Reader from "./views/Reader.svelte";
  import Rubric from "./views/Rubric.svelte";
  import Agreement from "./views/Agreement.svelte";

  reload();
  const tabs = [
    { view: "overview", path: "/", label: "Overview" },
    { view: "hook", path: "/hook", label: "Hook vs reviewers" },
    { view: "agreement", path: "/agreement", label: "Agreement" },
    { view: "messages", path: "/messages", label: "Messages" },
    { view: "rubric", path: "/rubric", label: "Rubric" },
  ];
  const current = $derived(router.route.view === "message" ? "messages" : router.route.view);
  const meta = $derived(data.meta);
  const incomplete = $derived(meta ? meta.runs.filter((r) => r.reviewed < r.sampled) : []);
</script>

<header class="bar">
  <div class="inner">
    <a class="title" href="#/">Handoff review</a>
    <nav aria-label="Views">
      {#each tabs as t}
        <a href={href(t.path)} aria-current={current === t.view ? "page" : undefined}>{t.label}</a>
      {/each}
    </nav>
    <div class="status">
      {#if meta}
        <span class="num">
          {n(meta.reviewed)} handoffs reviewed{#if meta.several_reviews}, {n(meta.several_reviews)} more than once{/if}{#if incomplete.length}, {incomplete.length} {incomplete.length === 1 ? "run" : "runs"} still filling{/if}
        </span>
        {#if meta.hook.stored_matches_binary === false}
          <span class="warn" title="Lists and figures use stored reports; the reader runs the current binary.">Stored hook reports predate the current binary</span>
        {/if}
      {/if}
      {#if data.pending}
        <button class="reload new" onclick={reload}>
          {data.pending.reviewed > 0 ? `${data.pending.reviewed} new ${data.pending.reviewed === 1 ? "review" : "reviews"}` : "Data changed"}. Reload
        </button>
      {:else}
        <button class="reload" onclick={reload} title="Re-read SQLite">Reload{#if meta}<span class="muted"> · read {time(meta.loaded_at)}</span>{/if}</button>
      {/if}
    </div>
  </div>
</header>

{#if data.error && !meta}
  <div class="page"><p class="error">{data.error}</p></div>
{:else if meta}
  {#key data.version}
    {#if router.route.view === "overview"}
      <Overview />
    {:else if router.route.view === "hook"}
      <Screening />
    {:else if router.route.view === "messages"}
      <Messages />
    {:else if router.route.view === "message"}
      <Reader />
    {:else if router.route.view === "agreement"}
      <Agreement />
    {:else}
      <Rubric />
    {/if}
  {/key}
{/if}

<style>
  .bar {
    position: sticky;
    top: 0;
    z-index: 20;
    background: var(--bar);
    color: var(--bar-ink);
    border-bottom: 1px solid var(--rule);
  }
  .inner {
    max-width: var(--page);
    margin: 0 auto;
    padding: 0 var(--gutter);
    height: var(--bar-h);
    display: flex;
    align-items: stretch;
    gap: 28px;
  }
  .title {
    display: flex;
    align-items: center;
    font-weight: 700;
    font-size: var(--t-md);
    letter-spacing: -0.01em;
    text-decoration: none;
    white-space: nowrap;
  }
  nav {
    display: flex;
    gap: 4px;
  }
  nav a {
    display: flex;
    align-items: center;
    padding: 0 10px;
    font-size: var(--t-sm);
    font-weight: 550;
    color: var(--bar-ink-2);
    text-decoration: none;
    border-bottom: 2px solid transparent;
    border-top: 2px solid transparent;
    white-space: nowrap;
  }
  nav a:hover {
    color: var(--bar-ink);
  }
  nav a[aria-current="page"] {
    color: var(--bar-ink);
    border-bottom-color: var(--bar-ink);
  }
  .status {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 14px;
    font-size: var(--t-xs);
    color: var(--bar-ink-2);
    min-width: 0;
  }
  .status > span:first-child {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .warn {
    color: var(--bar-ink);
    border-bottom: 2px solid var(--hook);
    white-space: nowrap;
  }
  .reload {
    background: transparent;
    border: 1px solid #ffffff2e;
    color: var(--bar-ink);
    border-radius: 4px;
    height: 26px;
    padding: 0 9px;
    font-size: var(--t-xs);
    font-weight: 550;
    white-space: nowrap;
  }
  .reload .muted {
    color: var(--bar-ink-2);
    font-weight: 400;
  }
  .reload:hover {
    border-color: var(--bar-ink-2);
  }
  .reload.new {
    background: var(--bar-ink);
    color: var(--bar);
    border-color: var(--bar-ink);
  }
  @media (max-width: 1100px) {
    .status > span:first-child {
      display: none;
    }
  }
  @media (max-width: 760px) {
    .inner {
      gap: 12px;
      overflow-x: auto;
    }
    .title {
      display: none;
    }
  }
</style>
