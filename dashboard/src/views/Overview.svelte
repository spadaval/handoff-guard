<script lang="ts">
  import { get, type Overview } from "../lib/api.ts";
  import { data, prefs, setPref } from "../lib/data.svelte.ts";
  import { router, href, setParams } from "../lib/router.svelte.ts";
  import { n, pct, ci, month, DIMENSION_NAMES, SCORE_NAMES, SAMPLE_NAMES } from "../lib/format.ts";
  import SampleControls from "../components/SampleControls.svelte";
  import SegBar from "../components/SegBar.svelte";
  import MonthCurve from "../components/MonthCurve.svelte";
  import Breakdown from "../components/Breakdown.svelte";
  import Missions from "../components/Missions.svelte";

  const params = $derived(router.route.params);
  const by = $derived(params.get("by") ?? "model");
  let ov = $state<Overview | null>(null);
  let error = $state<string | null>(null);

  $effect(() => {
    const q = new URLSearchParams({ sample: prefs.sample, basis: prefs.basis });
    const ctl = new AbortController();
    get<Overview>("/overview?" + q, ctl.signal)
      .then((r) => ((ov = r), (error = null)))
      .catch((e) => e.name !== "AbortError" && (error = e.message));
    return () => ctl.abort();
  });

  const meta = $derived(data.meta!);
  /** The message-list filter that matches the active sample. */
  const listSample = $derived(prefs.sample === "fair" ? "fair" : "reviewed");
  const sampleName = $derived(prefs.sample === "fair" ? "the fair sample" : "all reviewed handoffs");
  const listHref = (extra: Record<string, string>) => href("/messages", { sample: listSample, ...extra });
  const corpusHref = (extra: Record<string, string>) => href("/messages", extra);
  const tabs = [
    { key: "model", label: "Sender model", field: "model" },
    { key: "month", label: "Month", field: "month" },
    { key: "project", label: "Project", field: "project" },
    { key: "size", label: "Message size", field: "size" },
  ];
  const tab = $derived(tabs.find((t) => t.key === by) ?? tabs[0]);
  function setBy(value: string) {
    const p = new URLSearchParams(params);
    p.set("by", value);
    setParams(p);
  }
  const fmt = (k: string) =>
    by === "month" ? month(k, true) : by === "size" ? (k === "unknown" ? "Unknown" : k + " characters") : k === "unknown" ? "Unknown" : k;
  const issues = $derived(ov ? ov.issues.filter((i) => i.k > 0).sort((a, b) => b.k - a.k) : []);
  const absent = $derived(ov ? ov.issues.filter((i) => i.k === 0) : []);
  const maxIssue = $derived(Math.max(1, ...issues.map((i) => i.k)));
  const runsFilling = $derived(meta.runs.filter((r) => r.reviewed < r.sampled));
  const joinDims = (dims: string[]) => {
    const names = dims.map((d) => DIMENSION_NAMES[d]?.toLowerCase() ?? d);
    if (names.length === 1) return names[0][0].toUpperCase() + names[0].slice(1) + " alone";
    const text = names.slice(0, -1).join(", ") + " and " + names.at(-1);
    return text[0].toUpperCase() + text.slice(1) + ", tied";
  };
  const dayName = (d: string) => new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
</script>

<div class="page">
  <header class="head">
    <h1>Overview</h1>
    <p class="corpus num">
      {n(meta.corpus.bodies)} message bodies, of which {n(meta.corpus.inputs)} are handoffs. {n(meta.reviewed)} handoffs are reviewed, in {meta.runs.length} runs{#if runsFilling.length}; {runsFilling.map((r) => `${r.run_id} has ${r.reviewed} of ${r.sampled}`).join(", ")}{/if}.
    </p>

    {#if meta.several_reviews}
      <p class="note-strong small">{n(meta.several_reviews)} handoffs have more than one review ({n(meta.reviews_total)} reviews in all). Figures use one reference review of each; the reader lists every review and the <a href="#/agreement">Agreement</a> view compares them.</p>
    {/if}
    <SampleControls />
  </header>

  {#if error}
    <p class="error">{error}</p>
  {:else if !ov}
    <div class="skeleton" style="height: 320px; margin-top: 32px"></div>
  {:else if !ov.reviewed}
    <section class="section"><p class="empty">No handoff in {sampleName} is reviewed yet.</p></section>
  {:else}
    <p class="basisline small" class:mixed={ov.rubric_mix.length > 1 || ov.rubric_mix[0]?.value !== meta.rubric_version}>
      Figures rest on one reference review per handoff: {ov.reference_reviewer ?? "any reviewer"}'s review under the newest rubric version it used.
      {#if ov.rubric_mix.length > 1}
        This sample mixes rubric versions: {ov.rubric_mix.map((v) => `${n(v.n)} under ${v.value}`).join(", ")}.
      {:else if ov.rubric_mix[0]}
        All {n(ov.rubric_mix[0].n)} are scored under {ov.rubric_mix[0].value}{#if ov.rubric_mix[0].value !== meta.rubric_version}; the rubric file is now {meta.rubric_version}{/if}.
      {/if}
    </p>
    <section class="section lead">
      <div>
        <h2>Handoffs that need work</h2>
        {#if ov.needs_work}
          <p class="hero num">{pct(ov.needs_work.p)}</p>
          <p class="hero-line">
            of handoffs in {sampleName} need work: <strong class="num">{n(ov.needs_work.k)} of {n(ov.needs_work.n)}</strong> have a lowest score of 1 Broken or 2 Costly, 95% interval <span class="num">{ci(ov.needs_work)}</span>.
            {#if ov.unscored}<span class="muted">{n(ov.unscored)} reviews have a missing score and nothing below 3, so they could go either way and are left out.</span>{/if}
          </p>
        {/if}
        <div class="split">
          <h3 class="small">Lowest of the three scores</h3>
          <SegBar
            tall
            label="Lowest score"
            parts={["4", "3", "2", "1"].map((k) => ({
              key: k,
              label: `${k} ${SCORE_NAMES[k]}`,
              value: ov!.lowest_scores[k]?.k ?? 0,
              cls: "c" + k,
              href: listHref({ lowest: k }),
            }))}
          />
          <ul class="legend num">
            {#each ["4", "3", "2", "1"] as k}
              {@const x = ov.lowest_scores[k]}
              <li>
                <a href={listHref({ lowest: k })}><span class="score c{k}">{k} {SCORE_NAMES[k]}</span></a>
                <span>{n(x?.k ?? 0)}</span>
                <span class="muted">{ci(x)}</span>
              </li>
            {/each}
          </ul>
        </div>
        <div class="dims">
          {#each meta.dimensions as d}
            {@const s = ov.dimensions[d]}
            <div class="dim">
              <span class="dim-name">{DIMENSION_NAMES[d]}</span>
              <SegBar
                label="{DIMENSION_NAMES[d]} scores"
                parts={["4", "3", "2", "1", "null"].map((k) => ({
                  key: k,
                  label: k === "null" ? "No score" : `${k} ${SCORE_NAMES[k]}`,
                  value: s[k] ?? 0,
                  cls: "c" + k,
                  href: listHref({ [d]: k }),
                }))}
              />
              <span class="dim-counts num">
                {#each ["4", "3", "2", "1"] as k}<span title="{k} {SCORE_NAMES[k]}"><i class="c{k}"></i>{s[k] ?? 0}</span>{/each}
                {#if s.null}<span title="No score"><i class="cnull"></i>{s.null}</span>{/if}
              </span>
            </div>
          {/each}
          <p class="xs muted">Scores: 4 Clean, 3 Minor, 2 Costly, 1 Broken. A handoff needs work when its lowest score is 2 or 1.</p>
        </div>
      </div>

      <div>
        <h2>Which question holds the lowest score</h2>
        {#if ov.cause.needs_work}
          <p class="finding">
            {#if ov.cause.by_dimension.presentation === ov.cause.needs_work && !ov.cause.outside_hook}
              Presentation holds the lowest score in all {n(ov.cause.needs_work)} handoffs that need work. Intent or content alone never does.
            {:else}
              Presentation holds the lowest score in {n(ov.cause.by_dimension.presentation)} of the {n(ov.cause.needs_work)} handoffs that need work; intent or content alone in {n(ov.cause.outside_hook)}.
            {/if}
          </p>
          <ul class="causes num">
            {#each ov.cause.combinations as c}
              <li>
                <span>{joinDims(c.dimensions)}</span>
                <span class="track"><span class="fill" style:width="{(c.k / ov.cause.needs_work) * 100}%"></span></span>
                <span class="count">{n(c.k)}<span class="muted">/{n(ov.cause.needs_work)}</span></span>
              </li>
            {/each}
          </ul>
        {/if}
        <h2 class="issues-title">Issues reviewers found</h2>
        <p class="small muted">Handoffs in {sampleName} with at least one issue of each kind, out of {n(ov.reviewed)}.</p>
        <ol class="issues">
          {#each issues as i}
            <li>
              <a href={listHref({ issue: i.kind })}>
                <code>{i.kind}</code>
                <span class="dimtag">{DIMENSION_NAMES[i.dimension]}{#if i.retired}, not in current rubric{/if}</span>
                <span class="track"><span class="fill" style:width="{(i.k / maxIssue) * 100}%"></span></span>
                <span class="num count">{n(i.k)}<span class="muted">/{n(i.n)}</span></span>
              </a>
            </li>
          {/each}
        </ol>
        {#if absent.length}<p class="xs muted">Not found: {absent.map((i) => i.kind).join(", ")}.</p>{/if}
      </div>
    </section>

    <p class="section hookline small">
      <strong>The hook</strong> blocks <span class="num">{n(ov.screening.blocked_low?.k ?? 0)} of {n(ov.screening.blocked_low?.n ?? 0)}</span> handoffs in {sampleName} whose presentation is Costly or Broken, and allows <span class="num">{n(ov.screening.allowed_high?.k ?? 0)} of {n(ov.screening.allowed_high?.n ?? 0)}</span> whose presentation is Clean or Minor.
      <a href={href("/hook")}>See the hook against the reviewers</a>
    </p>

    <section class="section">
      <header>
        <h2>By mission</h2>
      </header>
      <p class="note lede">
        A mission is a connected group of threads. The {n(meta.corpus.inputs)} handoffs fall into {n(ov.missions.count)} missions, but the largest holds
        <strong class="num">{n(ov.missions.largest?.inputs ?? 0)}</strong> of them ({pct((ov.missions.largest?.inputs ?? 0) / meta.corpus.inputs)}), and
        <strong class="num">{n(ov.missions.busiest_days.reduce((s, d) => s + d.n, 0))}</strong> were sent on three days: {ov.missions.busiest_days.map((d) => dayName(d.day)).join(", ")}.
        Within one mission the sender model hardly changes, yet the hook's block rate moves from day to day. Read the days of a mission together before reading anything into a model or a month. Each row links to its handoffs.
      </p>
      <Missions
        missions={ov.missions.top}
        sparse={meta.sparse}
        link={(m, day) => corpusHref({ mission: m, ...(day ? { day } : {}) })}
        sampleLink={(m, day) => listHref({ mission: m, ...(day ? { day } : {}) })}
      />
      <p class="xs muted foot">The {ov.missions.top.length} largest missions. Days are UTC days of each handoff's earliest record.</p>
    </section>

    <section class="section">
      <header>
        <h2>Breakdown</h2>
        <div class="seg" role="group" aria-label="Group by">
          {#each tabs as t}
            <button aria-pressed={by === t.key} onclick={() => setBy(t.key)}>{t.label}</button>
          {/each}
        </div>
      </header>
      <p class="note limits">
        Model, project, month, mission and delivery tool change together in this corpus: most handoffs from November come from one mission, run by one model through one tool. A difference between rows is not evidence that the row's attribute caused it.
      </p>
      {#if by === "model"}
        <div class="basis">
          <div class="seg" role="group" aria-label="Sender model source">
            <button aria-pressed={prefs.basis === "recorded"} onclick={() => setPref("basis", "recorded")}>Recorded at send<span class="count">{n(meta.corpus.with_recorded_model)}</span></button>
            <button aria-pressed={prefs.basis === "thread"} onclick={() => setPref("basis", "thread")}>Add thread setting<span class="count">+{n(meta.corpus.with_thread_model)}</span></button>
          </div>
          <p class="note">
            {#if prefs.basis === "recorded"}
              Recorded at send: the model in the sender's turn context. Only {n(meta.corpus.with_recorded_model)} of {n(meta.corpus.inputs)} handoffs have one; the rest are Unknown.
            {:else}
              Adds the sending thread's saved model setting where no model was recorded. That setting is read at export time and can differ from the model that wrote the message.
            {/if}
            This choice also applies to the message list.
          </p>
          {#each ov.model_records as r}
            <p class="note bias">
              Handoffs with a recorded model are not typical. The hook blocks <strong class="num">{pct(r.recorded?.p)}</strong> ({n(r.recorded?.k)}/{n(r.recorded?.n)}) of {r.model} handoffs with a recorded model, but
              <strong class="num">{pct(r.thread_only?.p)}</strong> ({n(r.thread_only?.k)}/{n(r.thread_only?.n)}) of those known only from the thread setting.
            </p>
          {/each}
        </div>
      {/if}
      <Breakdown
        rows={ov.breakdowns[tab.key as "model"]}
        label={tab.label}
        format={fmt}
        sparse={meta.sparse}
        corpusLink={(k) => corpusHref({ [tab.field]: k })}
        sampleLink={(k) => listHref({ [tab.field]: k })}
      />
    </section>

    <section class="section">
      <header>
        <h2>By month</h2>
        <p>Month of each handoff's earliest record.</p>
      </header>
      <MonthCurve rows={ov.breakdowns.month} sampleLabel={SAMPLE_NAMES[prefs.sample].toLowerCase()} sparse={meta.sparse} link={(k) => corpusHref({ month: k })} />
    </section>
  {/if}
</div>

<style>
  .head {
    display: grid;
    gap: 12px;
  }
  .corpus {
    color: var(--ink-2);
    font-size: var(--t-md);
    max-width: 90ch;
  }
  .note-strong {
    color: var(--ink);
    font-weight: 550;
  }
  .basisline {
    margin-top: 16px;
    color: var(--ink-2);
  }
  .basisline.mixed {
    color: var(--ink);
    font-weight: 550;
  }
  .lead {
    display: grid;
    grid-template-columns: minmax(0, 7fr) minmax(0, 5fr);
    gap: 48px;
  }
  .hero {
    font-size: var(--t-hero);
    font-weight: 650;
    letter-spacing: -0.03em;
    line-height: 1;
    margin-top: 14px;
  }
  .hero-line {
    margin-top: 6px;
    color: var(--ink-2);
    max-width: 62ch;
  }
  .hero-line strong {
    color: var(--ink);
  }
  .split {
    margin-top: 20px;
    display: grid;
    gap: 10px;
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 22px;
    list-style: none;
    padding: 0;
    margin: 0;
    font-size: var(--t-sm);
  }
  .split h3 {
    font-weight: 600;
    color: var(--ink-2);
  }
  .legend li {
    display: inline-flex;
    gap: 8px;
    align-items: baseline;
  }
  .legend a {
    text-decoration: none;
  }
  .dims {
    margin-top: 26px;
    display: grid;
    gap: 10px;
  }
  .dim {
    display: grid;
    grid-template-columns: 104px minmax(0, 1fr) 180px;
    gap: 14px;
    align-items: center;
    font-size: var(--t-sm);
  }
  .dim-name {
    font-weight: 600;
  }
  .dim-counts {
    display: flex;
    gap: 10px;
    color: var(--ink-2);
    font-size: var(--t-xs);
  }
  .dim-counts span {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .dim-counts i {
    width: 8px;
    height: 8px;
    border-radius: 2px;
    background: var(--c);
  }
  .finding {
    margin: 12px 0 10px;
    font-size: var(--t-md);
    font-weight: 550;
    max-width: 52ch;
  }
  .causes {
    list-style: none;
    padding: 0;
    margin: 0 0 28px;
    display: grid;
    gap: 6px;
    font-size: var(--t-sm);
  }
  .causes li {
    display: grid;
    grid-template-columns: minmax(170px, 1.3fr) minmax(0, 1fr) 52px;
    gap: 10px;
    align-items: center;
  }
  .issues-title {
    margin-top: 4px;
  }
  .issues {
    list-style: none;
    padding: 0;
    margin: 12px 0 8px;
    display: grid;
    gap: 2px;
  }
  .issues a {
    display: grid;
    grid-template-columns: minmax(176px, 1.3fr) 116px minmax(0, 1fr) 52px;
    align-items: center;
    gap: 10px;
    padding: 4px 6px;
    margin: 0 -6px;
    border-radius: 3px;
    text-decoration: none;
    font-size: var(--t-sm);
  }
  .issues a:hover {
    background: var(--sunken);
  }
  .issues code {
    font-size: 0.95em;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .dimtag {
    font-size: var(--t-xs);
    color: var(--ink-3);
  }
  .track {
    height: 8px;
    position: relative;
  }
  .fill {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    background: var(--reviewer);
    border-radius: 0 3px 3px 0;
    min-width: 2px;
  }
  .count {
    text-align: right;
  }
  .hookline {
    color: var(--ink-2);
  }
  .hookline strong {
    color: var(--ink);
  }
  .hookline a {
    margin-left: 6px;
    font-weight: 550;
    color: var(--ink);
  }
  .lede {
    margin-bottom: 16px;
    max-width: 96ch;
  }
  .lede strong {
    color: var(--ink);
  }
  .limits {
    margin-bottom: 14px;
  }
  .basis {
    display: grid;
    justify-items: start;
    gap: 8px;
    margin-bottom: 14px;
  }
  .bias strong {
    color: var(--ink);
  }
  .foot {
    margin-top: 10px;
  }
  @media (max-width: 1000px) {
    .lead {
      grid-template-columns: 1fr;
    }
    .dim {
      grid-template-columns: 90px minmax(0, 1fr);
    }
    .dim-counts {
      display: none;
    }
  }
</style>
