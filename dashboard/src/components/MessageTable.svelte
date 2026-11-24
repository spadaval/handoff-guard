<script lang="ts">
  import type { MessageSummary } from "../lib/api.ts";
  import { messageHref, go } from "../lib/router.svelte.ts";
  import { n, docket, month, VERDICT_NAMES, VERDICT_SCORE, STRATUM_NAMES, humanise } from "../lib/format.ts";

  let {
    messages,
    from,
    compact = false,
    query = "",
  }: { messages: MessageSummary[]; from: string; compact?: boolean; query?: string } = $props();

  function hookText(h: MessageSummary["hook"]) {
    if (!h) return { cls: "none", word: "No report", rule: "" };
    if (h.blocked) return { cls: "block", word: "Blocks", rule: h.decision_rule ?? h.flags.find((f) => f.status === "block")?.rule ?? "" };
    if (h.flags.length) return { cls: "warn", word: "Warns", rule: h.flags.map((f) => f.rule).join(", ") };
    return { cls: "pass", word: "Allows", rule: "" };
  }
  function highlight(text: string) {
    if (!query) return [{ t: text, hit: false }];
    const out: { t: string; hit: boolean }[] = [];
    const lower = text.toLowerCase(),
      q = query.toLowerCase();
    let i = 0;
    while (i < text.length) {
      const at = lower.indexOf(q, i);
      if (at < 0) break;
      if (at > i) out.push({ t: text.slice(i, at), hit: false });
      out.push({ t: text.slice(at, at + q.length), hit: true });
      i = at + q.length;
    }
    if (i < text.length) out.push({ t: text.slice(i), hit: false });
    return out;
  }
</script>

<table class="data messages" class:compact>
  <thead>
    <tr>
      <th>No.</th>
      <th>Message as written</th>
      <th>Review</th>
      <th>Hook</th>
      {#if !compact}<th>Sender model</th><th>Project, month</th>{/if}
      <th class="r">Characters</th>
    </tr>
  </thead>
  <tbody>
    {#each messages as m (m.message_id)}
      {@const h = hookText(m.hook)}
      {@const link = messageHref(m.message_id, from)}
      <tr class="link" onclick={(e) => { if (!(e.target as HTMLElement).closest("a")) go(link.slice(1)); }}>
        <td class="docket"><a href={link} class="type">{docket(m.message_id)}</a></td>
        <td class="preview">
          <div class="type text">{#if m.preview_clipped}<span class="muted">…</span>{/if}{#each highlight(m.preview) as p}{#if p.hit}<mark>{p.t}</mark>{:else}{p.t}{/if}{/each}</div>
          <div class="meta xs">
            {m.kinds[0] ? humanise(m.kinds[0]) : "unknown kind"}{#if m.sample} · {STRATUM_NAMES[m.sample.stratum] ?? m.sample.stratum} sample, {m.sample.run_id}{/if}
          </div>
        </td>
        <td class="review">
          {#if m.review}
            <span class="score c{VERDICT_SCORE[m.review.verdict]}">{VERDICT_NAMES[m.review.verdict]}</span>
            <span class="dims num" title="Intent, content, presentation">
              {#each ["intent", "content", "presentation"] as d}
                {@const s = m.review.scores[d]}
                <span class="d c{s ?? 'null'}">{s ?? "?"}</span>
              {/each}
            </span>
          {:else if m.sample}
            <span class="muted small">Not reviewed yet</span>
          {:else}
            <span class="muted small">Not sampled</span>
          {/if}
        </td>
        <td class="hook">
          <span class="h {h.cls}">{h.word}</span>
          {#if h.rule}<span class="rule type xs">{h.rule}</span>{/if}
        </td>
        {#if !compact}
          <td class="model small">
            {#if m.model}{m.model}{#if m.model_basis === "thread"}<span class="basis muted xs">thread setting</span>{/if}{:else}<span class="muted">Unknown</span>{/if}
          </td>
          <td class="small">{m.project}<br /><span class="muted">{month(m.first_seen?.slice(0, 7))}</span></td>
        {/if}
        <td class="r num small">{n(m.characters)}</td>
      </tr>
    {/each}
  </tbody>
</table>

<style>
  .messages td {
    padding-top: 10px;
    padding-bottom: 10px;
  }
  .docket a {
    font-size: var(--t-sm);
    font-weight: 700;
    text-decoration: none;
  }
  .preview {
    width: 100%;
    max-width: 0;
    min-width: 280px;
  }
  .text {
    font-size: 13px;
    line-height: 1.45;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    color: var(--ink);
  }
  mark {
    background: var(--flash);
    color: inherit;
    border-radius: 2px;
  }
  .meta {
    color: var(--ink-3);
    margin-top: 3px;
  }
  .review {
    white-space: nowrap;
  }
  .dims {
    display: flex;
    gap: 2px;
    margin-top: 4px;
  }
  .d {
    width: 18px;
    height: 18px;
    display: inline-grid;
    place-items: center;
    font-size: 11px;
    font-weight: 700;
    border-radius: 3px;
    background: var(--c);
    color: #fff;
  }
  .d.c2,
  .d.c3,
  .d.cnull {
    color: #16181d;
  }
  .hook {
    white-space: nowrap;
  }
  .h {
    display: block;
    font-size: var(--t-sm);
    font-weight: 600;
  }
  .h.block {
    color: var(--hook);
  }
  .h.warn {
    color: var(--hook);
    font-weight: 500;
  }
  .h.pass,
  .h.none {
    color: var(--ink-3);
    font-weight: 500;
  }
  .rule {
    display: block;
    color: var(--ink-2);
    max-width: 180px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .model {
    max-width: 170px;
    overflow-wrap: anywhere;
  }
  .basis {
    display: block;
  }
</style>
