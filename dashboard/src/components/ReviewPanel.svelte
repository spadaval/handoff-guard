<script lang="ts">
  import type { Detail } from "../lib/api.ts";
  import type { Mark } from "../lib/marks.ts";
  import { href } from "../lib/router.svelte.ts";
  import { n, SCORE_NAMES, VERDICT_NAMES, VERDICT_SCORE, DIMENSION_NAMES, STRATUM_NAMES, humanise } from "../lib/format.ts";

  let {
    detail,
    marks,
    active,
    onjump,
    oncompare,
    comparing,
  }: {
    detail: Detail;
    marks: Mark[];
    active: string | null;
    onjump: (id: string) => void;
    oncompare: () => void;
    comparing: boolean;
  } = $props();

  const review = $derived(detail.reviews[0] ?? null);
  const r = $derived(review?.record);
  const byId = $derived(new Map(marks.map((m) => [m.id, m])));
  const dims = ["intent", "content", "presentation"] as const;
  const lowest = $derived.by(() => {
    if (!r) return null;
    const scored = dims.filter((d) => typeof r[d]?.score === "number");
    if (!scored.length) return null;
    const min = Math.min(...scored.map((d) => r[d].score as number));
    return { score: min, dims: scored.filter((d) => r[d].score === min) };
  });
  const rewriteSize = $derived.by(() => {
    if (!r?.rewrite) return null;
    const original = r.rewrite.of ?? detail.text;
    const a = Array.from(original).length,
      b = Array.from(r.rewrite.text).length;
    return { a, b, ratio: b / Math.max(1, a), partial: !!r.rewrite.of };
  });
</script>

<section class="panel" aria-labelledby="review-title">
  <header class="ph">
    <h2 id="review-title"><span class="key rv"></span>Review</h2>
    {#if review}
      <span class="who xs">{review.reviewer ?? "unknown reviewer"} · <span class="type">{review.run_id}</span>{#if review.rubric_version} · {review.rubric_version}{/if}</span>
    {/if}
  </header>

  {#if !review || !r}
    {#if detail.samples.length}
      <p class="small quiet">
        Frozen for review in <span class="type">{detail.samples[0].run_id}</span> ({STRATUM_NAMES[detail.samples[0].stratum] ?? detail.samples[0].stratum} stratum). The review has not been recorded yet.
      </p>
    {:else}
      <p class="small quiet">Not in any review sample, so no model has reviewed it under the current rubric.</p>
    {/if}
  {:else}
    <div class="verdict">
      <span class="vword c{VERDICT_SCORE[review.verdict]}">{VERDICT_NAMES[review.verdict]}</span>
      {#if lowest}
        <span class="small quiet">Lowest score {lowest.score} {SCORE_NAMES[lowest.score]}, in {lowest.dims.map((d) => DIMENSION_NAMES[d].toLowerCase()).join(" and ")}</span>
      {/if}
    </div>
    <dl class="facts small">
      <dt>Exchange</dt>
      <dd>{r.exchange.sender} → {r.exchange.recipient}, {r.exchange.type}</dd>
      <dt>Situation</dt>
      <dd>{r.situation}</dd>
      <dt>Intent</dt>
      <dd class="intent">{r.intent.statement}</dd>
    </dl>

    {#if rewriteSize}
      <button class="rewrite" onclick={oncompare} aria-pressed={comparing}>
        <span class="rw-label">Plain-English rewrite{rewriteSize.partial ? " of one passage" : ""}</span>
        <span class="num rw-size">{n(rewriteSize.a)} → {n(rewriteSize.b)} characters, {rewriteSize.ratio >= 1 ? `${rewriteSize.ratio.toFixed(1)}×` : `${Math.round((1 - rewriteSize.ratio) * 100)}% shorter`}</span>
        <span class="rw-action">{comparing ? "Show the message" : "Compare side by side"}</span>
      </button>
    {/if}

    {#each dims as d}
      {@const s = r[d]}
      <article class="dim">
        <header>
          <h3><a href={href("/rubric", { at: d })}>{DIMENSION_NAMES[d]}</a></h3>
          <span class="score c{s.score ?? 'null'}">{s.score ?? "–"} {SCORE_NAMES[String(s.score)]}</span>
        </header>
        <p class="reason">{s.reason}</p>
        {#each s.issues ?? [] as issue, i}
          {@const id = `r-${d}-${i}`}
          {@const m = byId.get(id)}
          <div class="issue" class:on={active === id} data-issue={id}>
            <div class="ih">
              <a class="kind type" href={href("/rubric", { at: d })} title="See the rubric">{issue.kind}</a>
              {#if m}
                <button class="cite type" onclick={() => onjump(id)} title="Show in the message">{m.cite}</button>
              {:else if issue.quote}
                <span class="xs warn">quote not found in text</span>
              {:else}
                <span class="xs muted">absent from the message</span>
              {/if}
            </div>
            {#if issue.quote}<p class="quote type">{issue.quote}</p>{/if}
            <dl class="er small">
              <dt>Effect</dt>
              <dd>{issue.effect}</dd>
              <dt>Repair</dt>
              <dd>{issue.repair}</dd>
            </dl>
          </div>
        {/each}
      </article>
    {/each}
    {#if detail.reviews.length > 1}
      <p class="xs muted">{detail.reviews.length - 1} more {detail.reviews.length === 2 ? "review" : "reviews"} in other runs: {detail.reviews.slice(1).map((x) => `${x.run_id} (${x.verdict})`).join(", ")}.</p>
    {/if}
  {/if}

  {#if detail.legacy_reviews.length}
    <details class="legacy">
      <summary>Earlier review, {detail.legacy_reviews[0].rubric_version}, not trusted</summary>
      {#each detail.legacy_reviews as l}
        {@const rec = l.record as any}
        <p class="xs muted">{l.reviewer}, {l.created_at.slice(0, 10)}. Different rubric; scores are not comparable.</p>
        {#each ["purpose", "information_selection", "clarity"] as part}
          {#if rec?.[part]}
            <div class="lp small">
              <strong>{humanise(part)}</strong>
              <span class="quiet">{rec[part].rating ?? rec[part].grade ?? ""}</span>
              {#if rec[part].reason}<p>{rec[part].reason}</p>{/if}
              {#each rec[part].issues ?? [] as li}
                <p class="xs"><code>{li.kind}</code>{#if li.quote} <span class="type quiet">“{li.quote}”</span>{/if}</p>
              {/each}
            </div>
          {/if}
        {/each}
      {/each}
    </details>
  {/if}
</section>

<style>
  .panel {
    display: grid;
    gap: 14px;
  }
  .ph {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 10px;
    border-bottom: 1px solid var(--rule-2);
    padding-bottom: 8px;
  }
  .ph h2 {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .key {
    width: 12px;
    height: 12px;
    border-radius: 2px;
  }
  .key.rv {
    background: var(--reviewer-tint);
    box-shadow: inset 0 0 0 1.5px var(--reviewer);
  }
  .who {
    color: var(--ink-3);
    text-align: right;
  }
  .verdict {
    display: grid;
    gap: 2px;
  }
  .vword {
    font-size: var(--t-xl);
    font-weight: 700;
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  .vword::before {
    content: "";
    width: 14px;
    height: 14px;
    border-radius: 3px;
    background: var(--c);
  }
  .facts {
    display: grid;
    grid-template-columns: 74px minmax(0, 1fr);
    gap: 6px 12px;
    margin: 0;
  }
  .facts dt {
    color: var(--ink-3);
  }
  .facts dd {
    margin: 0;
  }
  .intent {
    font-weight: 550;
  }
  .rewrite {
    display: grid;
    gap: 2px;
    text-align: left;
    border: 1px solid var(--rule-2);
    border-radius: 4px;
    background: var(--raised);
    padding: 10px 12px;
  }
  .rewrite:hover,
  .rewrite[aria-pressed="true"] {
    border-color: var(--ink);
  }
  .rw-label {
    font-weight: 650;
    font-size: var(--t-sm);
  }
  .rw-size {
    font-size: var(--t-sm);
    color: var(--ink-2);
  }
  .rw-action {
    font-size: var(--t-xs);
    text-decoration: underline;
    text-underline-offset: 2px;
    color: var(--ink-2);
  }
  .dim {
    border-top: 1px solid var(--rule);
    padding-top: 12px;
    display: grid;
    gap: 8px;
  }
  .dim header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
  }
  .dim h3 a {
    text-decoration: none;
  }
  .dim h3 a:hover {
    text-decoration: underline;
  }
  .reason {
    font-size: var(--t-sm);
    color: var(--ink-2);
  }
  .issue {
    border-left: 1px solid var(--rule-2);
    padding: 2px 0 2px 12px;
    display: grid;
    gap: 5px;
  }
  .issue.on {
    border-left-color: var(--ink);
  }
  .ih {
    display: flex;
    gap: 10px;
    align-items: baseline;
    justify-content: space-between;
  }
  .kind {
    font-size: 13px;
    font-weight: 700;
    text-decoration: none;
  }
  .kind:hover {
    text-decoration: underline;
  }
  .cite {
    border: 1px solid var(--reviewer);
    background: var(--reviewer-tint);
    border-radius: 3px;
    font-size: 12px;
    font-weight: 700;
    padding: 0 6px;
    height: 22px;
  }
  .cite:hover {
    background: var(--reviewer-tint-2);
  }
  .warn {
    color: var(--s1);
    font-weight: 600;
  }
  .quote {
    font-size: 13px;
    background: var(--reviewer-tint);
    padding: 4px 6px;
    border-radius: 2px;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    max-height: 7.5em;
    overflow: auto;
  }
  .er {
    display: grid;
    grid-template-columns: 52px minmax(0, 1fr);
    gap: 3px 10px;
    margin: 0;
  }
  .er dt {
    color: var(--ink-3);
  }
  .er dd {
    margin: 0;
  }
  .legacy {
    border-top: 1px solid var(--rule);
    padding-top: 10px;
    font-size: var(--t-sm);
  }
  .legacy summary {
    cursor: pointer;
    color: var(--ink-2);
    font-weight: 550;
  }
  .lp {
    margin-top: 8px;
    display: grid;
    gap: 3px;
  }
</style>
