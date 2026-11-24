<script lang="ts">
  import Icon from "../components/Icon.svelte";
  import { get, type MessageList } from "../lib/api.ts";
  import { data } from "../lib/data.svelte.ts";
  import { router, setParams } from "../lib/router.svelte.ts";
  import { n, month, humanise, STRATUM_NAMES, VERDICT_NAMES, SCORE_NAMES, DIMENSION_NAMES } from "../lib/format.ts";
  import MessageTable from "../components/MessageTable.svelte";

  const params = $derived(router.route.params);
  let list = $state<MessageList | null>(null);
  let error = $state<string | null>(null);
  let loading = $state(false);
  let search = $state(router.route.params.get("q") ?? "");
  let expanded = $state<Record<string, boolean>>({});

  $effect(() => {
    const q = new URLSearchParams(params);
    q.set("page_size", "50");
    const ctl = new AbortController();
    loading = true;
    get<MessageList>("/messages?" + q, ctl.signal)
      .then((r) => ((list = r), (error = null), (loading = false)))
      .catch((e) => {
        if (e.name !== "AbortError") (error = e.message), (loading = false);
      });
    return () => ctl.abort();
  });

  let timer: ReturnType<typeof setTimeout>;
  function onSearch() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const p = new URLSearchParams(params);
      if (search.trim()) p.set("q", search.trim());
      else p.delete("q");
      p.delete("page");
      setParams(p);
    }, 280);
  }
  function values(name: string) {
    return params.getAll(name).flatMap((v) => v.split(",")).filter(Boolean);
  }
  function toggle(name: string, value: string) {
    const p = new URLSearchParams(params);
    const now = values(name);
    p.delete(name);
    for (const v of now.includes(value) ? now.filter((x) => x !== value) : [...now, value]) p.append(name, v);
    p.delete("page");
    setParams(p);
  }
  function clear(name?: string) {
    const p = new URLSearchParams(params);
    if (name) p.delete(name);
    else for (const k of [...p.keys()]) if (k !== "sort" && k !== "basis" && k !== "criterion") p.delete(k);
    p.delete("page");
    if (!name) search = "";
    setParams(p);
  }
  function set(name: string, value: string | null) {
    const p = new URLSearchParams(params);
    if (value === null) p.delete(name);
    else p.set(name, value);
    setParams(p);
  }

  type Group = { name: string; label: string; order?: string[]; names?: Record<string, string | undefined>; hidden?: string[]; type?: boolean; limit?: number; note?: string };
  const meta = $derived(data.meta!);
  const issueOrder = $derived(Object.values(meta.issue_kinds).flat() as string[]);
  const groups: Group[] = $derived([
    { name: "review", label: "Review", order: ["rewrite", "revise", "send", "unknown", "pending", "none"], names: { ...VERDICT_NAMES, pending: "Not reviewed yet", none: "Not sampled" }, hidden: ["reviewed"] },
    { name: "sample", label: "Sample stratum", order: ["random", "pilot", "fused", "long", "none"], names: { ...STRATUM_NAMES, none: "Not sampled" }, hidden: ["any"] },
    { name: "hook", label: "Hook result", order: ["blocked", "warned", "passed", "unassessed"], names: { blocked: "Blocks", warned: "Allows with a warning", passed: "Allows, no warning", unassessed: "No stored report" }, hidden: ["allowed"] },
    { name: "flag", label: "Hook check", type: true, note: "Stored reports" },
    { name: "issue", label: "Reviewer issue", order: issueOrder, type: true, limit: 8 },
    { name: "presentation", label: "Presentation score", order: ["1", "2", "3", "4", "null"], names: { ...Object.fromEntries(["1", "2", "3", "4"].map((k) => [k, `${k} ${SCORE_NAMES[k]}`])), null: "Unknown" }, hidden: ["none"] },
    { name: "content", label: "Content score", order: ["1", "2", "3", "4", "null"], names: { ...Object.fromEntries(["1", "2", "3", "4"].map((k) => [k, `${k} ${SCORE_NAMES[k]}`])), null: "Unknown" }, hidden: ["none"] },
    { name: "intent", label: "Intent score", order: ["1", "2", "3", "4", "null"], names: { ...Object.fromEntries(["1", "2", "3", "4"].map((k) => [k, `${k} ${SCORE_NAMES[k]}`])), null: "Unknown" }, hidden: ["none"] },
    { name: "rewrite", label: "Plain-English rewrite", order: ["yes", "no"], names: { yes: "Has a rewrite", no: "No rewrite" } },
    { name: "model", label: "Sender model", limit: 6 },
    { name: "month", label: "Month", order: [...meta.facets.months].reverse().concat("unknown"), names: Object.fromEntries([...meta.facets.months, "unknown"].map((m) => [m, month(m, true)])) },
    { name: "project", label: "Project" },
    { name: "size", label: "Size in characters", order: meta.size_buckets },
    { name: "kind", label: "Recorded kind", names: {} },
    { name: "run", label: "Review run", limit: 4 },
    { name: "split", label: "Split", order: ["tuning", "heldout"] },
  ]);
  function entries(g: Group) {
    const counts = list?.facets[g.name] ?? {};
    const active = values(g.name);
    let keys = Object.keys(counts).filter((k) => !g.hidden?.includes(k));
    for (const a of active) if (!keys.includes(a)) keys.push(a);
    if (g.order) keys.sort((a, b) => (g.order!.indexOf(a) + 1 || 999) - (g.order!.indexOf(b) + 1 || 999));
    else keys.sort((a, b) => (counts[b] ?? 0) - (counts[a] ?? 0) || a.localeCompare(b));
    if (g.name === "sample" || g.name === "review") keys = keys.filter((k) => counts[k] || active.includes(k));
    return keys.map((k) => ({ key: k, count: counts[k] ?? 0, label: g.names?.[k] ?? (g.name === "kind" ? humanise(k) : k === "unknown" ? "Unknown" : k), on: active.includes(k) }));
  }
  const activeChips = $derived(
    [...new Set([...params.keys()])]
      .filter((k) => !["sort", "page", "basis", "criterion", "q", "page_size"].includes(k))
      .flatMap((k) => values(k).map((v) => ({ name: k, value: v, label: groups.find((g) => g.name === k)?.names?.[v] ?? v, group: groups.find((g) => g.name === k)?.label ?? chipNames[k] ?? k }))),
  );
  const chipNames: Record<string, string> = { reviewer: "Reviewers", flag: "Hook check" };
  const page = $derived(list?.page ?? 0);
  const pages = $derived(list ? Math.max(1, Math.ceil(list.total / list.page_size)) : 1);
  const fromQuery = $derived.by(() => {
    const p = new URLSearchParams(params);
    p.delete("page");
    return p.toString();
  });
</script>

<div class="layout">
  <aside class="filters" aria-label="Filters">
    <label class="search">
      <span class="visually-hidden">Search message text or ID</span>
      <input type="search" placeholder="Search text or message ID" bind:value={search} oninput={onSearch} />
    </label>
    <p class="xs muted hint">Searches the full text of every handoff input, ignoring case.</p>
    {#each groups as g (g.name)}
      {@const items = entries(g)}
      {#if items.length}
        {@const shown = expanded[g.name] || !g.limit ? items : items.filter((it, i) => i < g.limit! || it.on)}
        <fieldset>
          <legend>
            {g.label}
            {#if values(g.name).length}<button class="clear" onclick={() => clear(g.name)}>Clear</button>{/if}
          </legend>
          {#if g.name === "model"}
            <div class="seg mini" role="group" aria-label="Sender model source">
              <button aria-pressed={(params.get("basis") ?? "thread") === "recorded"} onclick={() => set("basis", "recorded")}>Recorded</button>
              <button aria-pressed={(params.get("basis") ?? "thread") === "thread"} onclick={() => set("basis", null)}>With thread setting</button>
            </div>
          {/if}
          {#each shown as it (it.key)}
            <label class="opt" class:zero={!it.count && !it.on}>
              <input type="checkbox" checked={it.on} onchange={() => toggle(g.name, it.key)} />
              <span class="name" class:type={g.type}>{it.label}</span>
              <span class="count num">{n(it.count)}</span>
            </label>
          {/each}
          {#if g.limit && items.length > g.limit}
            <button class="more" onclick={() => (expanded[g.name] = !expanded[g.name])}>
              {expanded[g.name] ? "Show fewer" : `Show all ${items.length}`}
            </button>
          {/if}
        </fieldset>
      {/if}
    {/each}
  </aside>

  <section class="results">
    <header class="results-head">
      <div>
        <h1 class="num">
          {#if list}{n(list.total)} <span class="of">of {n(list.corpus)} handoff inputs</span>{:else}Messages{/if}
        </h1>
        {#if activeChips.length || params.get("q")}
          <div class="chips">
            {#if params.get("q")}
              <button class="chip" onclick={() => ((search = ""), set("q", null))}>Text contains “<span class="type">{params.get("q")}</span>”<Icon name="close" size={12} /><span class="visually-hidden">Remove</span></button>
            {/if}
            {#each activeChips as c}
              <button class="chip" onclick={() => toggle(c.name, c.value)}>
                <span class="muted">{c.group}:</span> {c.label}<Icon name="close" size={12} /><span class="visually-hidden">Remove</span>
              </button>
            {/each}
            <button class="btn ghost small" onclick={() => clear()}>Clear all</button>
          </div>
        {/if}
      </div>
      <label class="sort small">
        Sort
        <select value={params.get("sort") ?? "severity"} onchange={(e) => set("sort", (e.target as HTMLSelectElement).value)}>
          <option value="severity">Worst first</option>
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="longest">Longest first</option>
          <option value="shortest">Shortest first</option>
        </select>
      </label>
    </header>

    {#if error}
      <p class="error">{error}</p>
    {:else if !list}
      <div class="skeleton" style="height: 480px"></div>
    {:else if !list.total}
      <div class="empty">
        <p>No handoff input matches these filters.</p>
        <button class="btn" onclick={() => clear()}>Clear all filters</button>
      </div>
    {:else}
      <div class:dim={loading}>
        <MessageTable messages={list.messages} from={fromQuery} query={params.get("q") ?? ""} />
      </div>
      <nav class="pager num" aria-label="Pages">
        <button class="btn" disabled={page === 0} onclick={() => set("page", String(page - 1))}>Previous</button>
        <span class="small">Page {n(page + 1)} of {n(pages)}, {n(list.page * list.page_size + 1)}–{n(Math.min(list.total, (list.page + 1) * list.page_size))} of {n(list.total)}</span>
        <button class="btn" disabled={page >= pages - 1} onclick={() => set("page", String(page + 1))}>Next</button>
      </nav>
    {/if}
  </section>
</div>

<style>
  .layout {
    max-width: var(--page);
    margin: 0 auto;
    padding: 0 var(--gutter);
    display: grid;
    grid-template-columns: 248px minmax(0, 1fr);
    gap: 32px;
  }
  .filters {
    position: sticky;
    top: var(--bar-h);
    align-self: start;
    max-height: calc(100vh - var(--bar-h));
    overflow-y: auto;
    padding: 24px 8px 40px 0;
    scrollbar-width: thin;
  }
  .search input {
    width: 100%;
    height: 36px;
    font-size: var(--t-sm);
  }
  .hint {
    margin: 6px 0 8px;
  }
  fieldset {
    border: 0;
    border-top: 1px solid var(--rule);
    margin: 0;
    padding: 12px 0 10px;
  }
  legend {
    font-size: var(--t-xs);
    font-weight: 650;
    color: var(--ink-2);
    padding: 0;
    float: left;
    width: 100%;
    display: flex;
    justify-content: space-between;
    margin-bottom: 6px;
  }
  legend + * {
    clear: both;
  }
  .clear,
  .more {
    border: 0;
    background: none;
    padding: 0;
    font-size: var(--t-xs);
    color: var(--ink-3);
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .more {
    margin-top: 4px;
  }
  .opt {
    display: grid;
    grid-template-columns: 16px minmax(0, 1fr) auto;
    gap: 8px;
    align-items: center;
    padding: 3px 0;
    font-size: var(--t-sm);
    cursor: pointer;
  }
  .opt:hover .name {
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .opt .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .opt .name.type {
    font-size: 12.5px;
  }
  .opt .count {
    font-size: var(--t-xs);
    color: var(--ink-3);
  }
  .opt.zero .name {
    color: var(--ink-3);
  }
  .seg.mini {
    margin-bottom: 8px;
    clear: both;
  }
  .seg.mini button {
    height: 24px;
    font-size: var(--t-xs);
    padding: 0 8px;
  }
  .results {
    padding: 24px 0 80px;
    min-width: 0;
  }
  .results-head {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 16px;
    margin-bottom: 14px;
  }
  .of {
    font-weight: 450;
    color: var(--ink-3);
    font-size: var(--t-lg);
    letter-spacing: 0;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 10px;
  }
  .chip {
    display: inline-flex;
    gap: 6px;
    align-items: center;
    height: 26px;
    padding: 0 8px;
    border: 1px solid var(--rule-2);
    border-radius: 4px;
    background: var(--sunken);
    font-size: var(--t-xs);
    font-weight: 550;
  }
  .chip:hover {
    border-color: var(--ink);
  }
  .sort {
    display: flex;
    gap: 8px;
    align-items: center;
    color: var(--ink-3);
    white-space: nowrap;
  }
  .dim {
    opacity: 0.55;
    transition: opacity 150ms;
  }
  .pager {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-top: 16px;
    color: var(--ink-2);
  }
  @media (max-width: 900px) {
    .layout {
      grid-template-columns: 1fr;
    }
    .filters {
      position: static;
      max-height: 300px;
      border-bottom: 1px solid var(--rule-2);
    }
  }
</style>
