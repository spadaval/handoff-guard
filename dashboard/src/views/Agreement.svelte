<script lang="ts">
  import { get, type Agreement } from "../lib/api.ts";
  import { href } from "../lib/router.svelte.ts";
  import { n, SCORE_NAMES } from "../lib/format.ts";
  import Prop from "../components/Prop.svelte";
  import CIBar from "../components/CIBar.svelte";

  let data = $state<Agreement | null>(null);
  let error = $state<string | null>(null);
  let shown = $state<Record<string, string>>({});

  $effect(() => {
    const ctl = new AbortController();
    get<Agreement>("/agreement", ctl.signal)
      .then((r) => ((data = r), (error = null)))
      .catch((e) => e.name !== "AbortError" && (error = e.message));
    return () => ctl.abort();
  });

  type Comparison = Agreement["comparisons"][number];
  const QUESTIONS = [
    { key: "lowest", label: "Lowest score" },
    { key: "presentation", label: "Presentation" },
    { key: "content", label: "Content" },
    { key: "intent", label: "Intent" },
  ] as const;
  const KEYS = ["1", "2", "3", "4", "null"];
  const scoreLabel = (k: string) => (k === "null" ? "Unknown" : `${k} ${SCORE_NAMES[k]}`);
  const needsLabel: Record<string, string> = { true: "Needs work", false: "Does not", null: "Cannot be judged" };
  const kindLabel: Record<string, string> = {
    "different-raters": "Different raters, same rubric",
    "changed-rubric": "Same rater, changed rubric",
    "different-both": "Different raters and rubrics",
    "same-rater": "Same rater and rubric, different runs",
  };
  function title(c: Comparison) {
    if (c.kind === "changed-rubric") return `${c.a.reviewer} under ${c.a.rubric_version} against ${c.b.rubric_version}`;
    if (c.kind === "different-raters") return `${c.a.reviewer} against ${c.b.reviewer}, both under ${c.a.rubric_version}`;
    return `${c.a.reviewer} under ${c.a.rubric_version} against ${c.b.reviewer} under ${c.b.rubric_version}`;
  }
  const cellHref = (c: Comparison, q: string, a: string, b: string) => href("/messages", { agree: `${c.key}|${q}|${a}|${b}` });
  /** Rows and columns that hold anything, so empty score levels do not pad the table. */
  function axes(table: Record<string, Record<string, number>>) {
    const rows = KEYS.filter((a) => KEYS.some((b) => table[a][b]));
    const cols = KEYS.filter((b) => KEYS.some((a) => table[a][b]));
    return { rows, cols };
  }
</script>

<div class="page">
  <header class="head">
    <h1>Agreement</h1>
    <p class="quiet intro">
      When two reviews score the same handoff, do they agree? Two comparisons matter most: different raters under the same rubric, which tests whether the scale is repeatable, and the same rater under a changed rubric, which shows what the change did. Each table puts one review's score in rows and the other's in columns; the diagonal is agreement.
    </p>
  </header>

  {#if error}
    <p class="error">{error}</p>
  {:else if !data}
    <div class="skeleton" style="height: 360px; margin-top: 32px"></div>
  {:else}
    {#if data.rubric_examples}
      <p class="examples small">
        {n(data.rubric_examples)} handoffs are left out of every figure on this page{#if data.rubric_examples_with_several_reviews}, {n(data.rubric_examples_with_several_reviews)} of them with more than one review{/if}. The rubric quotes them as worked examples of each severity, so a reviewer who meets one has been shown its presentation score; they are not a fair test of agreement. They stay in the prevalence figures.
        <a href={href("/messages", { example: "yes" })}>Show them</a>
      </p>
    {/if}
    {#if !data.comparisons.length}
    <section class="section">
      <p class="empty">
        No handoff has two reviews yet, so there is nothing to compare. Reviews so far: {data.raters.map((r) => `${n(r.n)} by ${r.value.replace("@", " under ")}`).join(", ")}. This view fills in as the re-review runs land; reload when they do.
      </p>
    </section>
    {:else}
    {#each data.comparisons as c (c.key)}
      {@const q = shown[c.key] ?? "lowest"}
      {@const t = c.questions[q].table}
      {@const ax = axes(t)}
      <section class="section comparison">
        <header>
          <div>
            <h2>{title(c)}</h2>
            <p class="small muted">{kindLabel[c.kind]} · {n(c.messages)} handoffs reviewed by both{#if c.rubric_examples_left_out}, not counting {n(c.rubric_examples_left_out)} rubric {c.rubric_examples_left_out === 1 ? "example" : "examples"}{/if}</p>
          </div>
          <a class="btn" href={href("/messages", { pair: c.key })}>Open the handoffs</a>
        </header>
        <div class="grid">
          <table class="data summary">
            <thead>
              <tr><th>Question</th><th colspan="2">Same score</th><th class="r">Unknown in one</th></tr>
            </thead>
            <tbody>
              {#each QUESTIONS as row}
                {@const x = c.questions[row.key]}
                <tr class:on={q === row.key}>
                  <td><button class="qbtn" onclick={() => (shown[c.key] = row.key)} aria-pressed={q === row.key}>{row.label}</button></td>
                  <td class="bar"><CIBar x={x.exact} tone="reviewer" /></td>
                  <td><Prop x={x.exact} /></td>
                  <td class="r">{n(x.unknown_in_one)}</td>
                </tr>
              {/each}
              <tr class="needs">
                <td><strong>Needs work</strong></td>
                <td class="bar"><CIBar x={c.needs_work.agree} tone="reviewer" /></td>
                <td><Prop x={c.needs_work.agree} /></td>
                <td></td>
              </tr>
            </tbody>
          </table>

          <div class="cross">
            <h3 class="small">{QUESTIONS.find((x) => x.key === q)?.label}: {c.a.reviewer} ({c.a.rubric_version}) in rows, {c.b.reviewer} ({c.b.rubric_version}) in columns</h3>
            <table class="xt num">
              <thead>
                <tr>
                  <th></th>
                  {#each ax.cols as b}<th class="col"><span class="score c{b}">{scoreLabel(b)}</span></th>{/each}
                </tr>
              </thead>
              <tbody>
                {#each ax.rows as a}
                  <tr>
                    <th class="row"><span class="score c{a}">{scoreLabel(a)}</span></th>
                    {#each ax.cols as b}
                      {@const v = t[a][b]}
                      <td class="cell" class:diag={a === b} class:zero={!v}>
                        {#if v}<a href={cellHref(c, q, a, b)} aria-label="{scoreLabel(a)} against {scoreLabel(b)}: {v}">{n(v)}</a>{:else}<span>0</span>{/if}
                      </td>
                    {/each}
                  </tr>
                {/each}
              </tbody>
            </table>

            <h3 class="small sub">Needs work</h3>
            <table class="xt num">
              <thead>
                <tr><th></th>{#each ["true", "false", "null"] as b}<th class="col">{needsLabel[b]}</th>{/each}</tr>
              </thead>
              <tbody>
                {#each ["true", "false", "null"] as a}
                  <tr>
                    <th class="row">{needsLabel[a]}</th>
                    {#each ["true", "false", "null"] as b}
                      {@const v = c.needs_work.table[a][b]}
                      <td class="cell" class:diag={a === b} class:zero={!v}>
                        {#if v}<a href={cellHref(c, "needs", a, b)}>{n(v)}</a>{:else}<span>0</span>{/if}
                      </td>
                    {/each}
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        </div>
        <p class="xs muted">
          Same score counts handoffs where both reviews give a score; a question one review leaves unknown is counted apart. Intervals are 95% Wilson intervals over these handoffs, which cluster by mission, so the true uncertainty is wider.
        </p>
      </section>
    {/each}
    {/if}
  {/if}
</div>

<style>
  .head {
    display: grid;
    gap: 14px;
  }
  .intro {
    max-width: 90ch;
  }
  .examples {
    margin-top: 16px;
    max-width: 96ch;
    color: var(--ink);
  }
  .examples a {
    margin-left: 6px;
  }
  .comparison > header {
    align-items: flex-start;
  }
  .grid {
    display: grid;
    grid-template-columns: minmax(0, 5fr) minmax(0, 6fr);
    gap: 40px;
    align-items: start;
  }
  .summary td.bar {
    width: 104px;
    vertical-align: middle;
    padding-right: 0;
  }
  .qbtn {
    border: 0;
    background: none;
    padding: 0;
    font-weight: 600;
    font-size: var(--t-sm);
    text-decoration: underline;
    text-decoration-color: var(--rule-2);
    text-underline-offset: 3px;
  }
  .qbtn[aria-pressed="true"] {
    text-decoration-color: var(--ink);
    text-decoration-thickness: 2px;
  }
  tr.on td {
    background: var(--sunken);
  }
  .needs td {
    border-top: 1px solid var(--rule-2);
  }
  .cross h3 {
    font-weight: 600;
    color: var(--ink-2);
    margin-bottom: 8px;
  }
  .cross .sub {
    margin-top: 20px;
  }
  .xt {
    border-collapse: separate;
    border-spacing: 3px;
    margin-left: -3px;
  }
  .xt th {
    font-size: var(--t-xs);
    font-weight: 600;
    color: var(--ink-2);
    text-align: left;
    padding: 2px 6px;
    white-space: nowrap;
  }
  .xt .col {
    min-width: 76px;
  }
  .cell {
    border: 1px solid var(--rule-2);
    border-radius: 4px;
    background: var(--raised);
    height: 44px;
    padding: 0;
    text-align: center;
    font-size: var(--t-lg);
    font-weight: 650;
  }
  .cell a,
  .cell span {
    display: grid;
    place-items: center;
    height: 100%;
    text-decoration: none;
  }
  .cell a:hover {
    background: var(--sunken);
  }
  .cell.diag {
    border-color: var(--ink);
  }
  .cell.zero {
    color: var(--ink-3);
    font-weight: 400;
    font-size: var(--t-sm);
  }
  @media (max-width: 1000px) {
    .grid {
      grid-template-columns: 1fr;
    }
  }
</style>
