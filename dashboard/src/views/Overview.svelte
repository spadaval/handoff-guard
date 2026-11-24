<script lang="ts">
  import { get, type Overview } from "../lib/api.ts";
  import { data } from "../lib/data.svelte.ts";
  import { router, href, setParams } from "../lib/router.svelte.ts";
  import { n, pct, ci, month, STRATUM_NAMES, VERDICT_NAMES, DIMENSION_NAMES, SCORE_NAMES, humanise } from "../lib/format.ts";
  import SampleControls from "../components/SampleControls.svelte";
  import SegBar from "../components/SegBar.svelte";
  import MonthCurve from "../components/MonthCurve.svelte";
  import Breakdown from "../components/Breakdown.svelte";
  import Prop from "../components/Prop.svelte";

  const params = $derived(router.route.params);
  const sample = $derived(params.get("sample") ?? "random");
  const criterion = $derived(params.get("criterion") ?? "verdict");
  const basis = $derived(params.get("basis") ?? "recorded");
  const by = $derived(params.get("by") ?? "model");
  let ov = $state<Overview | null>(null);
  let error = $state<string | null>(null);

  $effect(() => {
    const q = new URLSearchParams({ sample, criterion, basis });
    const ctl = new AbortController();
    get<Overview>("/overview?" + q, ctl.signal)
      .then((r) => ((ov = r), (error = null)))
      .catch((e) => e.name !== "AbortError" && (error = e.message));
    return () => ctl.abort();
  });

  const meta = $derived(data.meta!);
  const listSample = $derived(sample === "all" ? "any" : sample);
  const criterionLabel = $derived(criterion === "verdict" ? "verdict revise or rewrite" : "presentation 1–2");
  const bad = $derived.by(() => {
    if (!ov) return null;
    if (criterion === "verdict") {
      const k = (ov.verdicts.revise?.k ?? 0) + (ov.verdicts.rewrite?.k ?? 0);
      return { k, n: ov.reviewed, ...interval(k, ov.reviewed) };
    }
    const d = ov.dimensions.presentation;
    const k = (d["1"] ?? 0) + (d["2"] ?? 0);
    const N = ov.reviewed - (d["null"] ?? 0);
    return { k, n: N, ...interval(k, N) };
  });
  function interval(k: number, N: number) {
    if (!N) return { p: 0, low: 0, high: 0 };
    const z = 1.96,
      p = k / N,
      d = 1 + (z * z) / N,
      c = (p + (z * z) / (2 * N)) / d,
      h = (z * Math.sqrt((p * (1 - p)) / N + (z * z) / (4 * N * N))) / d;
    return { p, low: Math.max(0, c - h), high: Math.min(1, c + h) };
  }
  const issues = $derived(ov ? ov.issues.filter((i) => i.k > 0).sort((a, b) => b.k - a.k) : []);
  const absent = $derived(ov ? ov.issues.filter((i) => i.k === 0) : []);
  const maxIssue = $derived(Math.max(1, ...issues.map((i) => i.k)));

  const listHref = (extra: Record<string, string>) => href("/messages", { sample: listSample, criterion, ...extra });
  const corpusHref = (extra: Record<string, string>) => href("/messages", extra);
  const field: Record<string, string> = { model: "model", project: "project", size: "size", month: "month" };
  const tabs = [
    { key: "model", label: "Sender model" },
    { key: "month", label: "Month" },
    { key: "project", label: "Project" },
    { key: "size", label: "Message size" },
  ];
  function set(name: string, value: string) {
    const p = new URLSearchParams(params);
    p.set(name, value);
    setParams(p);
  }
  const fmt = (k: string) => (by === "month" ? month(k, true) : by === "size" ? (k === "unknown" ? "Unknown" : k + " characters") : k === "unknown" ? "Unknown" : k);
  const s = $derived(ov?.screening);
  const misses = $derived(s ? s.cells.warned.bad + s.cells.passed.bad : 0);
  const olderRubric = $derived([...new Set(meta.runs.filter((r) => r.reviewed && r.rubric_version && r.rubric_version !== meta.rubric_version).map((r) => r.rubric_version))]);
  const runsFilling = $derived(meta.runs.filter((r) => r.reviewed < r.sampled));
</script>

<div class="page">
  <header class="head">
    <h1>Overview</h1>
    <p class="corpus num">
      {n(meta.corpus.bodies)} message bodies, of which {n(meta.corpus.inputs)} are handoff inputs.
      {n(meta.sampled)} inputs are frozen for review in {meta.runs.length} runs and {n(meta.reviewed)} are reviewed{#if runsFilling.length}; {runsFilling.map((r) => `${r.run_id} has ${r.reviewed} of ${r.sampled}`).join(", ")}{/if}.
    </p>
    {#if olderRubric.length}
      <p class="rubric-note small">Reviews were recorded under {olderRubric.join(" and ")}; the rubric file is now {meta.rubric_version}. Scores and issue kinds follow the version each review used.</p>
    {/if}
    <SampleControls />
  </header>

  {#if error}
    <p class="error">{error}</p>
  {:else if !ov}
    <div class="skeleton" style="height: 320px; margin-top: 32px"></div>
  {:else if !ov.reviewed}
    <section class="section">
      <p class="empty">No reviews in the {STRATUM_NAMES[sample]?.toLowerCase()} sample yet. {n(ov.sampled)} inputs are frozen for it; figures appear as reviews are recorded.</p>
    </section>
  {:else}
    <section class="section lead">
      <div class="verdict">
        <h2>Reviewer verdicts</h2>
        {#if bad}
          <p class="hero num">{pct(bad.p)}</p>
          <p class="hero-line">
            of reviewed {STRATUM_NAMES[sample]?.toLowerCase()}-sample inputs are bad by {criterionLabel}:
            <strong class="num">{n(bad.k)} of {n(bad.n)}</strong>, 95% interval <span class="num">{Math.round(bad.low * 100)}–{Math.round(bad.high * 100)}%</span>.
          </p>
        {/if}
        <div class="split">
          <SegBar
            tall
            label="Verdicts"
            parts={(["send", "revise", "rewrite", "unknown"] as const).map((v) => ({
              key: v,
              label: VERDICT_NAMES[v],
              value: ov!.verdicts[v]?.k ?? 0,
              cls: { send: "c4", revise: "c2", rewrite: "c1", unknown: "cnull" }[v],
              href: listHref({ review: v }),
            }))}
          />
          <ul class="legend num">
            {#each ["send", "revise", "rewrite", "unknown"] as v}
              {@const x = ov.verdicts[v]}
              {#if x && (x.k || v !== "unknown")}
                <li>
                  <a href={listHref({ review: v })}><span class="score c{({ send: 4, revise: 2, rewrite: 1, unknown: 'null' } as any)[v]}">{VERDICT_NAMES[v]}</span></a>
                  <span>{n(x.k)}</span>
                  <span class="muted">{ci(x)}</span>
                </li>
              {/if}
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
                  label: `${k === "null" ? "" : k + " "}${SCORE_NAMES[k]}`,
                  value: s[k] ?? 0,
                  cls: "c" + k,
                  href: listHref({ [d]: k === "null" ? "null" : k }),
                }))}
              />
              <span class="dim-counts num">
                {#each ["4", "3", "2", "1"] as k}<span title={SCORE_NAMES[k]}><i class="c{k}"></i>{s[k] ?? 0}</span>{/each}
                {#if s.null}<span title="Unknown"><i class="cnull"></i>{s.null}</span>{/if}
              </span>
            </div>
          {/each}
          <p class="xs muted scale">Scale: 4 Clean, 3 Minor, 2 Costly, 1 Broken. The verdict is the lowest score.</p>
        </div>
      </div>

      <div class="issues">
        <h2>Issues reviewers found</h2>
        <p class="small muted">Share of the {n(ov.reviewed)} reviewed inputs with at least one issue of each kind.</p>
        <ol>
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
        {#if absent.length}
          <p class="xs muted absent">Not found in this sample: {absent.map((i) => i.kind).join(", ")}.</p>
        {/if}
      </div>
    </section>

    <section class="section">
      <header>
        <h2>Hook against reviewers</h2>
        <a class="btn" href={href("/hook", { sample, criterion })}>Open the comparison</a>
      </header>
      {#if s}
      <div class="screen-strip num">
        <a href={href("/messages", { sample: listSample, criterion, hook: "blocked", reviewer: "bad" })}>
          <span class="big">{n(s.cells.blocked.bad)}</span> bad inputs blocked
        </a>
        <a class="miss" href={href("/messages", { sample: listSample, criterion, hook: "allowed", reviewer: "bad" })}>
          <span class="big">{n(misses)}</span> misses: bad, but the hook allows them
        </a>
        <a class="fp" href={href("/messages", { sample: listSample, criterion, hook: "blocked", reviewer: "fine" })}>
          <span class="big">{n(s.cells.blocked.fine)}</span> false positives: fine, but blocked
        </a>
        <span class="sens">Sensitivity <Prop x={s.sensitivity} /></span>
      </div>
      {/if}
    </section>

    <section class="section">
      <header>
        <h2>By month</h2>
        <p>Month of the earliest recorded observation of each input.</p>
      </header>
      <MonthCurve rows={ov.breakdowns.month} onset={ov.onset} {sample} {criterionLabel} link={(k) => corpusHref({ month: k })} />
    </section>


    <section class="section">
      <header>
        <h2>Breakdown</h2>
        <div class="seg" role="group" aria-label="Group by">
          {#each tabs as t}
            <button aria-pressed={by === t.key} onclick={() => set("by", t.key)}>{t.label}</button>
          {/each}
        </div>
      </header>
      {#if by === "model"}
        <div class="basis">
          <div class="seg" role="group" aria-label="Sender model source">
            <button aria-pressed={basis === "recorded"} onclick={() => set("basis", "recorded")}>Recorded at send<span class="count">{n(meta.corpus.with_recorded_model)}</span></button>
            <button aria-pressed={basis === "thread"} onclick={() => set("basis", "thread")}>Add thread setting<span class="count">+{n(meta.corpus.with_thread_model)}</span></button>
          </div>
          <p class="note">
            {#if basis === "recorded"}
              Recorded: the model in the sender's turn context when it sent the message. Only {n(meta.corpus.with_recorded_model)} of {n(meta.corpus.inputs)} inputs have one; the rest are Unknown.
            {:else}
              Adds the sending thread's saved model selection where no model was recorded. That setting is read at export time, not at send time, and can differ from the model that wrote the message.
            {/if}
          </p>
        </div>
      {/if}
      <Breakdown
        rows={ov.breakdowns[by as "model"]}
        label={tabs.find((t) => t.key === by)!.label}
        format={fmt}
        corpusLink={(k) => corpusHref({ [field[by]]: k, ...(by === "model" ? { basis } : {}) })}
        sampleLink={(k) => listHref({ [field[by]]: k, review: "reviewed", ...(by === "model" ? { basis } : {}) })}
      />
      <p class="xs muted foot">
        Hook figures use every input with a stored report. Reviewer figures use the {STRATUM_NAMES[sample]?.toLowerCase()} sample only, so small groups have wide intervals. Intervals are 95% Wilson intervals.
      </p>
    </section>
  {/if}
</div>

<style>
  .head {
    display: grid;
    gap: 14px;
  }
  .corpus {
    color: var(--ink-2);
    font-size: var(--t-md);
    max-width: 90ch;
  }
  .rubric-note {
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
    max-width: 60ch;
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
  .scale {
    margin-top: 2px;
  }
  .issues ol {
    list-style: none;
    padding: 0;
    margin: 14px 0 0;
    display: grid;
    gap: 2px;
  }
  .issues a {
    display: grid;
    grid-template-columns: minmax(176px, 1.3fr) 116px minmax(0, 1fr) 52px;
    align-items: center;
    gap: 10px;
    padding: 5px 6px;
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
  .absent {
    margin-top: 12px;
  }
  .screen-strip {
    display: flex;
    flex-wrap: wrap;
    gap: 12px 40px;
    align-items: baseline;
    font-size: var(--t-sm);
    color: var(--ink-2);
  }
  .screen-strip a {
    text-decoration: none;
  }
  .screen-strip a:hover {
    color: var(--ink);
  }
  .big {
    font-size: var(--t-2xl);
    font-weight: 650;
    color: var(--ink);
    margin-right: 6px;
    letter-spacing: -0.02em;
  }
  .miss .big {
    box-shadow: inset 0 -3px 0 var(--reviewer);
  }
  .fp .big {
    box-shadow: inset 0 -3px 0 var(--hook);
  }
  .sens {
    margin-left: auto;
    display: inline-flex;
    gap: 8px;
  }
  .basis {
    display: grid;
    justify-items: start;
    gap: 8px;
    margin-bottom: 14px;
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
