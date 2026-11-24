<script lang="ts">
  import { get, type Overview, type MessageList, type Proportion } from "../lib/api.ts";
  import { data } from "../lib/data.svelte.ts";
  import { router, href } from "../lib/router.svelte.ts";
  import { n, pct, ci, date, STRATUM_NAMES } from "../lib/format.ts";
  import SampleControls from "../components/SampleControls.svelte";
  import Prop from "../components/Prop.svelte";
  import CIBar from "../components/CIBar.svelte";
  import MessageTable from "../components/MessageTable.svelte";

  const params = $derived(router.route.params);
  const sample = $derived(params.get("sample") ?? "random");
  const criterion = $derived(params.get("criterion") ?? "verdict");
  const listSample = $derived(sample === "all" ? "any" : sample);
  let ov = $state<Overview | null>(null);
  let misses = $state<MessageList | null>(null);
  let falsePos = $state<MessageList | null>(null);
  let error = $state<string | null>(null);

  const missQuery = $derived(new URLSearchParams({ sample: listSample, criterion, hook: "allowed", reviewer: "bad" }));
  const fpQuery = $derived(new URLSearchParams({ sample: listSample, criterion, hook: "blocked", reviewer: "fine" }));

  $effect(() => {
    const ctl = new AbortController();
    const q = new URLSearchParams({ sample, criterion });
    Promise.all([
      get<Overview>("/overview?" + q, ctl.signal),
      get<MessageList>("/messages?page_size=100&" + missQuery, ctl.signal),
      get<MessageList>("/messages?page_size=100&" + fpQuery, ctl.signal),
    ])
      .then(([o, m, f]) => {
        ov = o;
        misses = m;
        falsePos = f;
        error = null;
      })
      .catch((e) => e.name !== "AbortError" && (error = e.message));
    return () => ctl.abort();
  });

  const meta = $derived(data.meta!);
  const s = $derived(ov?.screening);
  const rows = ["blocked", "warned", "passed", "unassessed"] as const;
  const allCols = ["bad", "fine", "unknown"] as const;
  const cols = $derived(s && !rows.some((r) => s.cells[r].unknown) ? (["bad", "fine"] as const) : allCols);
  const rowNames: Record<string, string> = { blocked: "Blocks", warned: "Allows with a warning", passed: "Allows, no warning", unassessed: "No stored report" };
  const colNames: Record<string, string> = { bad: "Bad", fine: "Fine", unknown: "No verdict" };
  const criterionText = $derived(criterion === "verdict" ? "verdict is revise or rewrite" : "presentation score is 1 or 2");
  function cellHref(row: string, col: string) {
    return href("/messages", { sample: listSample, criterion, hook: row, reviewer: col });
  }
  function cellRole(row: string, col: string) {
    if (col === "bad" && row === "blocked") return "hit";
    if (col === "bad" && (row === "warned" || row === "passed")) return "miss";
    if (col === "fine" && row === "blocked") return "fp";
    if (col === "fine") return "agree";
    return "";
  }
  const unreviewed = $derived(s ? rows.reduce((t, r) => t + s.cells[r].unreviewed, 0) : 0);
  const ruleMeta = $derived(Object.fromEntries(meta.hook.rules.map((r) => [r.rule, r.statuses])));
  const bad = $derived(s ? s.cells.blocked.bad + s.cells.warned.bad + s.cells.passed.bad : 0);
  const fine = $derived(s ? s.cells.blocked.fine + s.cells.warned.fine + s.cells.passed.fine : 0);
  function share(k: number, N: number): Proportion {
    if (!N) return null;
    const z = 1.96,
      p = k / N,
      d = 1 + (z * z) / N,
      c = (p + (z * z) / (2 * N)) / d,
      h = (z * Math.sqrt((p * (1 - p)) / N + (z * z) / (4 * N * N))) / d;
    return { k, n: N, p, low: Math.max(0, c - h), high: Math.min(1, c + h) };
  }
  const statusOrder = (st: Record<string, unknown>) => ["block", "warn", ...Object.keys(st).filter((k) => k !== "block" && k !== "warn" && k !== "pass")];
</script>

<div class="page">
  <header class="head">
    <h1>Hook against reviewers</h1>
    <p class="quiet intro">
      The hook is read as a screening test and the model reviewers as the reference. A miss is an input reviewers call bad that the hook lets through. A false positive is one the hook blocks that reviewers call fine.
    </p>
    <SampleControls />
  </header>

  {#if error}
    <p class="error">{error}</p>
  {:else if !s || !ov}
    <div class="skeleton" style="height: 360px; margin-top: 32px"></div>
  {:else}
    <section class="section grid">
      <div>
        <h2>Outcomes in the {STRATUM_NAMES[sample]?.toLowerCase()} sample</h2>
        <p class="small muted sub">
          {n(ov.reviewed)} reviewed inputs. Reviewers count an input as bad when its {criterionText}. Hook results are the stored reports.
        </p>
        <table class="matrix num">
          <thead>
            <tr>
              <th></th>
              <th class="axis" colspan={cols.length}><span class="rev">Reviewers</span></th>
            </tr>
            <tr>
              <th class="axis"><span class="hk">Hook</span></th>
              {#each cols as c}<th class="col">{colNames[c]}</th>{/each}
            </tr>
          </thead>
          <tbody>
            {#each rows as r}
              {#if r !== "unassessed" || cols.some((c) => s.cells.unassessed[c])}
                <tr>
                  <th class="row">{rowNames[r]}</th>
                  {#each cols as c}
                    {@const v = s.cells[r][c]}
                    {@const role = cellRole(r, c)}
                    <td class="cell {role}" class:zero={!v}>
                      <a href={cellHref(r, c)} aria-label="{rowNames[r]}, reviewers {colNames[c]}: {v}">
                        <span class="v">{n(v)}</span>
                        {#if role === "miss"}<span class="tag">miss</span>{:else if role === "fp"}<span class="tag">false positive</span>{:else if role === "hit"}<span class="tag">caught</span>{/if}
                      </a>
                    </td>
                  {/each}
                </tr>
              {/if}
            {/each}
          </tbody>
        </table>
        {#if unreviewed}
          <p class="xs muted">{n(unreviewed)} sampled inputs are not reviewed yet and are left out.</p>
        {/if}
        {#if cols.length === 2}
          <p class="xs muted">Every reviewed input has a verdict, so the "no verdict" column is hidden.</p>
        {/if}
      </div>

      <div class="metrics">
        <h2>Test measures</h2>
        <dl>
          <div>
            <dt>Sensitivity</dt>
            <dd><CIBar x={s.sensitivity} tone="hook" width={120} /><Prop x={s.sensitivity} /></dd>
            <p>Of {n(bad)} bad inputs, the share the hook blocks.</p>
          </div>
          <div>
            <dt>Specificity</dt>
            <dd><CIBar x={s.specificity} tone="hook" width={120} /><Prop x={s.specificity} /></dd>
            <p>Of {n(fine)} fine inputs, the share the hook allows.</p>
          </div>
          <div>
            <dt>Precision</dt>
            <dd><CIBar x={s.ppv} tone="hook" width={120} /><Prop x={s.ppv} /></dd>
            <p>Of inputs the hook blocks, the share reviewers call bad.</p>
          </div>
          <div>
            <dt>Blocks or warns</dt>
            <dd><CIBar x={s.flagged_sensitivity} tone="hook" width={120} /><Prop x={s.flagged_sensitivity} /></dd>
            <p>Of bad inputs, the share the hook blocks or warns about. Warnings do not stop delivery.</p>
          </div>
        </dl>
        {#if sample !== "random"}
          <p class="xs skew">These measures depend on how the {STRATUM_NAMES[sample]?.toLowerCase()} stratum was chosen and do not describe the corpus.</p>
        {/if}
        <p class="xs muted provenance">
          Stored reports: run <code>{meta.hook.stored_run?.run_id ?? "none"}</code>{#if meta.hook.stored_run}, {date(meta.hook.stored_run.created_at)}{/if}.
          {#if meta.hook.stored_matches_binary === true}They match the current binary.{:else if meta.hook.stored_matches_binary === false}<strong>The current binary is different</strong>; the message reader shows its live result.{/if}
        </p>
      </div>
    </section>

    <section class="section">
      <header>
        <h2>By check</h2>
        <p>Every check in the stored reports, as the hook names it.</p>
      </header>
      <div class="scroll">
        <table class="data">
          <thead>
            <tr>
              <th>Check</th>
              <th>Status</th>
              <th class="r">All inputs</th>
              <th class="r">Bad in sample</th>
              <th class="r">Fine in sample</th>
              <th colspan="2">Share of bad inputs it marks</th>
            </tr>
          </thead>
          <tbody>
            {#each s.rules as rule}
              {@const corpus = ruleMeta[rule.rule] ?? {}}
              {@const marked = statusOrder(rule.statuses).filter((st) => rule.statuses[st] || corpus[st])}
              {#if marked.length}
                {#each marked as st, i}
                  {@const x = share(rule.statuses[st]?.bad ?? 0, bad)}
                  <tr>
                    {#if i === 0}<td rowspan={marked.length} class="type rulename">{rule.rule}</td>{/if}
                    <td><span class="st {st}">{st}</span></td>
                    <td class="r"><a href={href("/messages", { flag: `${rule.rule}:${st}` })}>{n(corpus[st] ?? 0)}</a></td>
                    <td class="r"><a href={href("/messages", { sample: listSample, criterion, flag: `${rule.rule}:${st}`, reviewer: "bad" })}>{n(rule.statuses[st]?.bad ?? 0)}</a></td>
                    <td class="r"><a href={href("/messages", { sample: listSample, criterion, flag: `${rule.rule}:${st}`, reviewer: "fine" })}>{n(rule.statuses[st]?.fine ?? 0)}</a></td>
                    <td class="cib"><CIBar {x} tone="hook" /></td>
                    <td><Prop {x} /></td>
                  </tr>
                {/each}
              {:else}
                <tr class="passes">
                  <td class="type rulename">{rule.rule}</td>
                  <td colspan="6" class="muted small">Passes every input ({n(corpus.pass ?? 0)}).</td>
                </tr>
              {/if}
            {/each}
          </tbody>
        </table>
      </div>
    </section>

    <section class="section lists">
      <div>
        <header class="list-head">
          <h2><span class="swatch miss"></span>Misses <span class="num muted">{n(misses?.total ?? 0)}</span></h2>
          {#if misses?.total}<a class="btn" href={href("/messages", missQuery)}>Open as list</a>{/if}
        </header>
        <p class="small muted">Reviewers call these bad; the hook allows them.</p>
        {#if misses?.messages.length}
          <MessageTable messages={misses.messages} from={missQuery.toString()} compact />
        {:else}
          <p class="empty">No misses in this sample.</p>
        {/if}
      </div>
      <div>
        <header class="list-head">
          <h2><span class="swatch fp"></span>False positives <span class="num muted">{n(falsePos?.total ?? 0)}</span></h2>
          {#if falsePos?.total}<a class="btn" href={href("/messages", fpQuery)}>Open as list</a>{/if}
        </header>
        <p class="small muted">The hook blocks these; reviewers call them fine.</p>
        {#if falsePos?.messages.length}
          <MessageTable messages={falsePos.messages} from={fpQuery.toString()} compact />
        {:else}
          <p class="empty">No false positives in this sample: every input the hook blocks, reviewers also call bad.</p>
        {/if}
      </div>
    </section>
  {/if}
</div>

<style>
  .head {
    display: grid;
    gap: 14px;
  }
  .intro {
    max-width: 82ch;
  }
  .grid {
    display: grid;
    grid-template-columns: minmax(0, 7fr) minmax(0, 5fr);
    gap: 48px;
  }
  .sub {
    margin: 4px 0 18px;
  }
  .matrix {
    border-collapse: separate;
    border-spacing: 4px;
    margin-left: -4px;
  }
  .matrix th {
    font-size: var(--t-xs);
    font-weight: 600;
    color: var(--ink-2);
    text-align: left;
    padding: 2px 6px;
  }
  .matrix .axis {
    font-size: var(--t-xs);
    text-transform: none;
  }
  .rev {
    box-shadow: inset 0 -2px 0 var(--reviewer);
  }
  .hk {
    box-shadow: inset 0 -2px 0 var(--hook);
  }
  .matrix .col {
    width: 150px;
    font-size: var(--t-sm);
    color: var(--ink);
  }
  .matrix .row {
    font-size: var(--t-sm);
    color: var(--ink);
    padding-right: 16px;
    white-space: nowrap;
  }
  .cell {
    padding: 0;
    height: 84px;
    border: 1px solid var(--rule-2);
    border-radius: 4px;
    background: var(--raised);
  }
  .cell a {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    height: 100%;
    padding: 10px 12px;
    text-decoration: none;
  }
  .cell:hover {
    border-color: var(--ink);
  }
  .v {
    font-size: var(--t-2xl);
    font-weight: 650;
    letter-spacing: -0.02em;
  }
  .zero .v {
    color: var(--ink-3);
    font-weight: 500;
  }
  .tag {
    font-size: var(--t-xs);
    font-weight: 600;
    color: var(--ink-2);
  }
  .cell.miss {
    border-color: var(--reviewer);
    border-width: 2px;
  }
  .cell.fp {
    border-color: var(--hook);
    border-width: 2px;
  }
  .cell.zero {
    border-width: 1px;
    border-color: var(--rule-2);
  }
  .metrics dl {
    margin: 16px 0 0;
    display: grid;
    gap: 16px;
  }
  .metrics dt {
    font-weight: 600;
    font-size: var(--t-sm);
  }
  .metrics dd {
    margin: 4px 0 2px;
    display: flex;
    gap: 12px;
    align-items: center;
    font-size: var(--t-md);
  }
  .metrics p {
    font-size: var(--t-xs);
    color: var(--ink-3);
  }
  .skew {
    margin-top: 16px;
    font-weight: 600;
  }
  .provenance {
    margin-top: 16px;
  }
  .scroll {
    overflow-x: auto;
  }
  .rulename {
    font-weight: 700;
    font-size: var(--t-sm);
  }
  td a {
    text-decoration: none;
  }
  td a:hover {
    text-decoration: underline;
  }
  .st {
    font-size: var(--t-xs);
    font-weight: 650;
    padding: 1px 6px;
    border-radius: 3px;
  }
  .st.block {
    background: var(--hook);
    color: #fff;
  }
  .st.warn {
    box-shadow: inset 0 0 0 1px var(--hook);
    color: var(--hook);
  }
  .cib {
    width: 104px;
    vertical-align: middle;
  }
  .passes td {
    color: var(--ink-3);
  }
  .lists {
    display: grid;
    grid-template-columns: 1fr;
    gap: 36px;
  }
  .list-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 4px;
  }
  .list-head h2 {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .swatch {
    width: 12px;
    height: 12px;
    border-radius: 2px;
    border: 2px solid var(--c);
  }
  .swatch.miss {
    --c: var(--reviewer);
  }
  .swatch.fp {
    --c: var(--hook);
  }
  @media (max-width: 1000px) {
    .grid {
      grid-template-columns: 1fr;
    }
  }
</style>
