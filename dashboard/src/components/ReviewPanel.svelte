<script lang="ts">
  import type { Detail } from "../lib/api.ts";
  import type { Mark } from "../lib/marks.ts";
  import { href } from "../lib/router.svelte.ts";
  import { n, SCORE_NAMES, DIMENSION_NAMES, PICKED_NAMES, CLEAR_VERSION, humanise } from "../lib/format.ts";

  let {
    detail,
    marks,
    active,
    onjump,
    oncompare,
    comparing,
    selected,
    onselect,
  }: {
    detail: Detail;
    selected: number;
    onselect: (i: number) => void;
    marks: Mark[];
    active: string | null;
    onjump: (id: string) => void;
    oncompare: () => void;
    comparing: boolean;
  } = $props();

  const review = $derived(detail.reviews[selected] ?? detail.reviews[0] ?? null);
  const older = $derived(!!review?.rubric_version && review.rubric_version !== detail.current_rubric);
  const rubricHref = (at?: string) =>
    href("/rubric", { ...(review?.rubric_sha256 ? { sha256: review.rubric_sha256 } : {}), ...(review?.rubric_version ? { version: review.rubric_version } : {}), ...(at ? { at } : {}) });
  const r = $derived(review?.record);
  const byId = $derived(new Map(marks.map((m) => [m.id, m])));
  const dims = ["intent", "content", "presentation"] as const;
  const written = $derived(!!review && dims.some((d) => review.scoring[d].written));
  const SEVERITY_SCORE: Record<string, number> = { broken: 1, costly: 2, minor: 3 };
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
      <span class="who xs">{review.reviewer ?? "unknown reviewer"} · <span class="type">{review.run_id}</span></span>
    {/if}
  </header>

  {#if !review || !r}
    {#if detail.picks.length}
      <p class="small quiet">
        Picked for review in <span class="type">{detail.picks[0].run_id}</span>. The review has not been recorded yet.
      </p>
    {:else}
      <p class="small quiet">Not in any review sample, so no model has reviewed it under the current rubric.</p>
    {/if}
  {:else}
    {#if detail.reviews.length > 1}
      <div class="reviews" role="tablist" aria-label="Reviews of this handoff">
        {#each detail.reviews as rv, i}
          <button role="tab" aria-selected={i === selected} onclick={() => onselect(i)}>
            <span>{rv.reviewer ?? "unknown reviewer"}</span>
            <span class="xs muted"><span class="type">{rv.run_id}</span>, {rv.rubric_version}{rv.reference ? ", used in figures" : ""}</span>
          </button>
        {/each}
      </div>
    {/if}
    <p class="version xs" class:older>
      Scored under <a href={rubricHref()}>{review.rubric_version ?? "an unrecorded rubric version"}</a>{#if older}; the current rubric is {detail.current_rubric}. Score names and issue kinds below follow {review.rubric_version}{/if}.
      {#if written}Under that rubric the reviewer wrote each score directly; issues carry no severity.{:else}Each score is the worst severity among the question's issues, or 4 Clean with none.{/if}
    </p>
    <div class="lowest">
      {#if review.lowest.score !== null}
        <span class="lword"><span class="score c{review.lowest.score}">Lowest score: {review.lowest.score} {SCORE_NAMES[review.lowest.score]}</span>, in {review.lowest.questions.map((d) => DIMENSION_NAMES[d].toLowerCase()).join(" and ")}</span>
        <span class="small quiet">{review.needs_work ? "Needs work." : "Does not need work."}</span>
      {:else}
        <span class="lword">Cannot be judged</span>
        <span class="small quiet">A question is unknown and nothing else is below 3, so this review cannot say whether the handoff needs work.</span>
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
        <span class="rw-label">{CLEAR_VERSION}{rewriteSize.partial ? " of one passage" : ""}, written by the reviewer</span>
        <span class="num rw-size">{n(rewriteSize.a)} → {n(rewriteSize.b)} characters, {rewriteSize.ratio >= 1 ? `${rewriteSize.ratio.toFixed(1)}×` : `${Math.round((1 - rewriteSize.ratio) * 100)}% shorter`}</span>
        <span class="rw-action">{comparing ? "Show the message" : "Compare side by side"}</span>
      </button>
    {/if}

    {#each dims as d}
      {@const s = r[d]}
      {@const sc = review.scores[d]}
      {@const how = review.scoring[d]}
      <article class="dim">
        <header>
          <h3><a href={rubricHref(d)} title="This question in {review.rubric_version ?? 'the rubric'}">{DIMENSION_NAMES[d]}</a></h3>
          <span class="score c{sc ?? 'null'}">{sc === null ? "Unknown" : `${sc} ${SCORE_NAMES[String(sc)]}`}</span>
        </header>
        <p class="how xs">
          {#if how.unknown}The context cannot settle this question.{:else if how.written}Score written by the reviewer.{:else if how.decided_by === null}No issue, so 4 Clean.{:else}Set by the {s.issues?.[how.decided_by]?.severity} issue marked below.{/if}
        </p>
        <p class="reason">{s.reason}</p>
        {#each s.issues ?? [] as issue, i}
          {@const id = `r-${d}-${i}`}
          {@const m = byId.get(id)}
          <div class="issue" class:on={active === id} class:decides={how.decided_by === i} data-issue={id}>
            <div class="ih">
              <span class="kindline">
                <a class="kind type" href={rubricHref(d)} title="{issue.kind} as defined in {review.rubric_version ?? 'the rubric'}">{issue.kind}</a>
                {#if issue.severity}<span class="sev c{SEVERITY_SCORE[issue.severity] ?? 'null'}">{issue.severity}</span>{/if}
                {#if how.decided_by === i}<span class="sets">sets the score</span>{/if}
              </span>
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
  .reviews {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .reviews button {
    display: grid;
    text-align: left;
    border: 1px solid var(--rule-2);
    border-radius: 4px;
    background: var(--raised);
    padding: 4px 10px;
    font-size: var(--t-sm);
  }
  .reviews button[aria-selected="true"] {
    border-color: var(--ink);
    box-shadow: inset 0 -2px 0 var(--ink);
  }
  .version {
    color: var(--ink-3);
  }
  .version.older {
    color: var(--ink);
    font-weight: 550;
  }
  .lowest {
    display: grid;
    gap: 3px;
  }
  .lword {
    font-size: var(--t-md);
    font-weight: 600;
  }
  .lword .score {
    font-size: var(--t-md);
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
  .how {
    color: var(--ink-3);
  }
  .kindline {
    display: inline-flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: baseline;
  }
  .sev {
    font-size: var(--t-xs);
    font-weight: 650;
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .sev::before {
    content: "";
    width: 8px;
    height: 8px;
    border-radius: 2px;
    background: var(--c);
  }
  .sets {
    font-size: var(--t-xs);
    color: var(--ink);
    font-weight: 600;
    box-shadow: inset 0 -1px 0 var(--ink);
  }
  .issue.decides {
    border-left-color: var(--ink-2);
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
