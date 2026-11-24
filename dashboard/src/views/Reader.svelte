<script lang="ts">
  import Icon from "../components/Icon.svelte";
  import { tick } from "svelte";
  import { get, type Detail, type MessageList, type HookReport, type Review } from "../lib/api.ts";
  import { router, href, messageHref, go } from "../lib/router.svelte.ts";
  import { buildMarks } from "../lib/marks.ts";
  import { n, docket, date, humanise, STRATUM_NAMES } from "../lib/format.ts";
  import MessageText from "../components/MessageText.svelte";
  import ReviewPanel from "../components/ReviewPanel.svelte";
  import HookPanel from "../components/HookPanel.svelte";
  import RewriteCompare from "../components/RewriteCompare.svelte";
  import ContextPanel from "../components/ContextPanel.svelte";

  const route = $derived(router.route as Extract<typeof router.route, { view: "message" }>);
  const id = $derived(route.id);
  const from = $derived(route.params.get("from"));
  let detail = $state<Detail | null>(null);
  let error = $state<string | null>(null);
  let siblings = $state<{ ids: string[]; total: number } | null>(null);
  let active = $state<string | null>(null);
  let comparing = $state(false);
  let copied = $state(false);

  $effect(() => {
    const ctl = new AbortController();
    detail = null;
    error = null;
    active = null;
    comparing = false;
    get<Detail>("/messages/" + id, ctl.signal)
      .then((d) => (detail = d))
      .catch((e) => e.name !== "AbortError" && (error = e.message));
    return () => ctl.abort();
  });
  $effect(() => {
    if (!from) {
      siblings = null;
      return;
    }
    const ctl = new AbortController();
    get<MessageList>(`/messages?${from}&ids=1&page_size=1`, ctl.signal)
      .then((l) => (siblings = { ids: l.ids ?? [], total: l.total }))
      .catch(() => {});
    return () => ctl.abort();
  });

  const review = $derived((detail?.reviews[0]?.record ?? null) as Review | null);
  const hook = $derived((detail?.hook.live ?? detail?.hook.stored ?? null) as HookReport | null);
  const built = $derived(detail ? buildMarks(detail.text, hook, review) : null);
  const ordered = $derived(built ? built.marks.filter((m) => m.id !== "rewrite-of") : []);
  const position = $derived(active ? ordered.findIndex((m) => m.id === active) : -1);
  const hookCount = $derived(ordered.filter((m) => m.kind === "hook").length);
  const reviewerCount = $derived(ordered.filter((m) => m.kind === "reviewer").length);
  const index = $derived(siblings ? siblings.ids.indexOf(id) : -1);
  const prev = $derived(siblings && index > 0 ? siblings.ids[index - 1] : null);
  const next = $derived(siblings && index >= 0 && index < siblings.ids.length - 1 ? siblings.ids[index + 1] : null);

  async function jump(markId: string, scrollPanel = false) {
    comparing = false;
    active = markId;
    await tick();
    const el = document.querySelector<HTMLElement>(`.reading [data-m~="${markId}"]`);
    if (el) {
      el.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      document.querySelectorAll(`.reading [data-m~="${markId}"]`).forEach((s) => {
        s.classList.remove("flash");
        void (s as HTMLElement).offsetWidth;
        s.classList.add("flash");
      });
    }
    if (scrollPanel) document.querySelector(`.side [data-issue="${markId}"]`)?.scrollIntoView({ block: "nearest" });
  }
  function step(dir: 1 | -1) {
    if (!ordered.length) return;
    const i = position < 0 ? (dir === 1 ? 0 : ordered.length - 1) : (position + dir + ordered.length) % ordered.length;
    jump(ordered[i].id, true);
  }
  function onkey(e: KeyboardEvent) {
    const t = e.target as HTMLElement;
    if (t.closest("input, select, textarea") || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "j") step(1);
    else if (e.key === "k") step(-1);
    else if (e.key === "]" && next) go(messageHref(next, from ?? undefined).slice(1));
    else if (e.key === "[" && prev) go(messageHref(prev, from ?? undefined).slice(1));
    else if (e.key === "Escape") active = null;
    else return;
    e.preventDefault();
  }
  async function copy() {
    await navigator.clipboard?.writeText(id);
    copied = true;
    setTimeout(() => (copied = false), 1400);
  }
  const listHref = $derived(from ? href("/messages", new URLSearchParams(from)) : href("/messages"));
  const sample = $derived(detail?.samples[0]);
</script>

<svelte:window onkeydown={onkey} />

<div class="sub">
  <div class="sub-inner">
    <a class="back small" href={listHref}><Icon name="back" />{from ? "Back to the list" : "All messages"}</a>
    {#if siblings && index >= 0}
      <div class="stepper small num">
        <a class="btn" href={prev ? messageHref(prev, from ?? undefined) : undefined} aria-disabled={!prev} title="Previous message ([)">Previous</a>
        <span>{n(index + 1)} of {n(siblings.total)}</span>
        <a class="btn" href={next ? messageHref(next, from ?? undefined) : undefined} aria-disabled={!next} title="Next message (])">Next</a>
      </div>
    {/if}
    <span class="keys xs muted"><kbd>j</kbd> <kbd>k</kbd> step through highlights · <kbd>[</kbd> <kbd>]</kbd> previous and next message</span>
  </div>
</div>

<div class="page reader">
  {#if error}
    <p class="error">{error}</p>
  {:else if !detail || !built}
    <div class="skeleton" style="height: 48px; width: 40%"></div>
    <div class="skeleton" style="height: 520px; margin-top: 24px"></div>
  {:else}
    <header class="mhead">
      <div class="title">
        <h1><span class="no">No.</span> <span class="type">{docket(detail.message_id)}</span></h1>
        <button class="btn ghost xs" onclick={copy} title={detail.message_id}>{copied ? "Copied" : "Copy full ID"}</button>
      </div>
      <dl class="facts small">
        <div><dt>Kind</dt><dd>{(detail.kinds ?? []).map(humanise).join(", ") || "Unknown"}</dd></div>
        <div><dt>Project</dt><dd>{detail.project ?? "Unknown"}</dd></div>
        <div><dt>First recorded</dt><dd>{date(detail.first_seen)}</dd></div>
        <div>
          <dt>Sender model</dt>
          <dd>
            {#if detail.model.recorded}{detail.model.recorded} <span class="muted">recorded at send</span>
            {:else if detail.model.thread}{detail.model.thread} <span class="muted">thread setting only</span>
            {:else}<span class="muted">Unknown</span>{/if}
          </dd>
        </div>
        <div>
          <dt>Sample</dt>
          <dd>{#if sample}{STRATUM_NAMES[sample.stratum] ?? sample.stratum}, {sample.split ?? "no split"}, <span class="type">{sample.run_id}</span>{:else}<span class="muted">Not sampled</span>{/if}</dd>
        </div>
        <div><dt>Size</dt><dd class="num">{n(detail.scalars)} characters, {n(detail.words)} words, {n(detail.lines)} lines</dd></div>
        {#if detail.thread_title}<div class="wide"><dt>Thread</dt><dd>{detail.thread_title}</dd></div>{/if}
      </dl>
    </header>

    <div class="grid">
      <section class="reading" aria-label="Message">
        <div class="toolbar">
          {#if review?.rewrite}
            <div class="seg" role="group" aria-label="View">
              <button aria-pressed={!comparing} onclick={() => (comparing = false)}>As written</button>
              <button aria-pressed={comparing} onclick={() => (comparing = true)}>Beside the rewrite</button>
            </div>
          {:else}
            <h2 class="small">As written</h2>
          {/if}
          {#if !comparing}
            <div class="legend small">
              <span class="lk hk"><i></i>Hook spans <b class="num">{hookCount}</b></span>
              <span class="lk rv"><i></i>Reviewer quotes <b class="num">{reviewerCount}</b></span>
              {#if ordered.length}
                <span class="stepper">
                  <button class="btn" onclick={() => step(-1)} aria-label="Previous highlight (k)"><Icon name="up" /></button>
                  <span class="num pos">{position >= 0 ? `${position + 1} of ${ordered.length}` : `${ordered.length} highlights`}</span>
                  <button class="btn" onclick={() => step(1)} aria-label="Next highlight (j)"><Icon name="down" /></button>
                </span>
              {/if}
            </div>
          {/if}
        </div>
        {#if comparing && review?.rewrite}
          <RewriteCompare text={detail.text} rewrite={review.rewrite} />
        {:else}
          {#if built.unplaced.length}
            <p class="xs warnline">{built.unplaced.length} reviewer {built.unplaced.length === 1 ? "quote is" : "quotes are"} not an exact substring of this message and cannot be highlighted.</p>
          {/if}
          <MessageText lines={built.lines} marks={built.marks} {active} onpick={(mid) => jump(mid, true)} />
        {/if}
      </section>

      <aside class="side">
        <ReviewPanel {detail} marks={built.marks} {active} onjump={(mid) => jump(mid)} oncompare={() => (comparing = !comparing)} {comparing} />
        <HookPanel {detail} marks={built.marks} {active} onjump={(mid) => jump(mid)} />
      </aside>
    </div>

    <section class="section">
      <header><h2>Recorded context</h2></header>
      <ContextPanel {detail} />
    </section>
  {/if}
</div>

<style>
  .sub {
    position: sticky;
    top: var(--bar-h);
    z-index: 10;
    background: var(--ground);
    border-bottom: 1px solid var(--rule);
  }
  .sub-inner {
    max-width: var(--page);
    margin: 0 auto;
    padding: 0 var(--gutter);
    height: 44px;
    display: flex;
    align-items: center;
    gap: 24px;
  }
  .back {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    text-decoration: none;
    font-weight: 550;
  }
  .back:hover {
    text-decoration: underline;
  }
  .stepper {
    display: inline-flex;
    align-items: center;
    gap: 10px;
  }
  .stepper .btn {
    height: 26px;
  }
  .legend .stepper .btn {
    width: 28px;
    padding: 0;
    justify-content: center;
  }
  a.btn[aria-disabled="true"] {
    opacity: 0.4;
    pointer-events: none;
  }
  .keys {
    margin-left: auto;
  }
  kbd {
    font-family: var(--type);
    font-size: 11px;
    border: 1px solid var(--rule-2);
    border-radius: 3px;
    padding: 0 4px;
    color: var(--ink-2);
  }
  .reader {
    padding-top: 22px;
  }
  .mhead {
    display: grid;
    gap: 14px;
    margin-bottom: 22px;
  }
  .title {
    display: flex;
    align-items: baseline;
    gap: 12px;
  }
  .no {
    color: var(--ink-3);
    font-weight: 500;
  }
  h1 .type {
    font-weight: 700;
    letter-spacing: 0;
  }
  .facts {
    display: flex;
    flex-wrap: wrap;
    gap: 10px 32px;
    margin: 0;
  }
  .facts div {
    display: grid;
    gap: 1px;
  }
  .facts dt {
    font-size: var(--t-xs);
    color: var(--ink-3);
  }
  .facts dd {
    margin: 0;
  }
  .facts .wide {
    flex-basis: 100%;
  }
  .grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 400px;
    gap: 40px;
    align-items: start;
  }
  .toolbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 16px;
    flex-wrap: wrap;
    min-height: 40px;
    margin-bottom: 8px;
    position: sticky;
    top: calc(var(--bar-h) + 44px);
    background: var(--ground);
    z-index: 4;
    padding: 6px 0;
  }
  .legend {
    display: flex;
    align-items: center;
    gap: 18px;
  }
  .lk {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--ink-2);
  }
  .lk b {
    color: var(--ink);
  }
  .lk i {
    width: 22px;
    height: 12px;
    border-radius: 1px;
  }
  .lk.hk i {
    background: var(--hook-tint);
    box-shadow: inset 0 -2px 0 var(--hook);
  }
  .lk.rv i {
    background: var(--reviewer-tint);
    box-shadow: inset 0 0 0 1px var(--reviewer);
  }
  .pos {
    min-width: 70px;
    text-align: center;
    color: var(--ink-2);
  }
  .warnline {
    color: var(--s1);
    font-weight: 600;
    margin-bottom: 6px;
  }
  .side {
    position: sticky;
    top: calc(var(--bar-h) + 44px + 8px);
    max-height: calc(100vh - var(--bar-h) - 60px);
    overflow-y: auto;
    display: grid;
    gap: 32px;
    padding: 6px 4px 24px 0;
    scrollbar-width: thin;
  }
  @media (max-width: 1080px) {
    .grid {
      grid-template-columns: 1fr;
    }
    .side {
      position: static;
      max-height: none;
    }
    .keys {
      display: none;
    }
  }
</style>
