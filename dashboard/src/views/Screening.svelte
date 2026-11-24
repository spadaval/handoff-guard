<script lang="ts">
  import { get, type Overview, type MessageList } from "../lib/api.ts";
  import { data, prefs } from "../lib/data.svelte.ts";
  import { href } from "../lib/router.svelte.ts";
  import { n, date, SCORE_NAMES } from "../lib/format.ts";
  import SampleControls from "../components/SampleControls.svelte";
  import Prop from "../components/Prop.svelte";
  import CIBar from "../components/CIBar.svelte";
  import MessageTable from "../components/MessageTable.svelte";

  let ov = $state<Overview | null>(null);
  let misses = $state<MessageList | null>(null);
  let falsePos = $state<MessageList | null>(null);
  let error = $state<string | null>(null);

  const listSample = $derived(prefs.sample === "fair" ? "fair" : "reviewed");
  const sampleName = $derived(prefs.sample === "fair" ? "the fair sample" : "all reviewed handoffs");
  const missQuery = $derived(new URLSearchParams([["sample", listSample], ["hook", "allowed"], ["presentation", "1"], ["presentation", "2"]]));
  const fpQuery = $derived(new URLSearchParams([["sample", listSample], ["hook", "blocked"], ["presentation", "3"], ["presentation", "4"]]));

  $effect(() => {
    const ctl = new AbortController();
    const basis = prefs.basis;
    Promise.all([
      get<Overview>("/overview?" + new URLSearchParams({ sample: prefs.sample, basis }), ctl.signal),
      get<MessageList>(`/messages?page_size=100&basis=${basis}&` + missQuery, ctl.signal),
      get<MessageList>(`/messages?page_size=100&basis=${basis}&` + fpQuery, ctl.signal),
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
  const rows = $derived(s && Object.values(s.cells.unassessed).some(Boolean) ? (["blocked", "allowed", "unassessed"] as const) : (["blocked", "allowed"] as const));
  const cols = $derived(s && Object.values(s.cells).some((c) => c.null) ? ["1", "2", "3", "4", "null"] : ["1", "2", "3", "4"]);
  const rowNames: Record<string, string> = { blocked: "Blocks", allowed: "Allows", unassessed: "No stored report" };
  function role(row: string, col: string) {
    const low = col === "1" || col === "2";
    const high = col === "3" || col === "4";
    if (row === "blocked" && low) return "hit";
    if (row === "allowed" && low) return "miss";
    if (row === "blocked" && high) return "fp";
    if (row === "allowed" && high) return "agree";
    return "";
  }
  const cellHref = (row: string, col: string) => href("/messages", { sample: listSample, hook: row, presentation: col });
  const statusName: Record<string, string> = { block: "blocks", warn: "warning" };
</script>

<div class="page">
  <header class="head">
    <h1>Hook against reviewers</h1>
    <p class="quiet intro">
      Does the hook catch what it can see? It measures only spacing, size and repetition, so it is judged against the reviewers' presentation score alone. A miss is a handoff with Costly or Broken presentation that the hook allows. A false positive is one with Clean or Minor presentation that it blocks.
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
        <h2>Hook result against presentation score</h2>
        <p class="small muted sub">{n(s.low + s.high)} reviewed handoffs in {sampleName}. Hook results are the stored reports.</p>
        <table class="matrix num">
          <thead>
            <tr>
              <th></th>
              <th class="axis" colspan="2"><span class="rev">Costly or Broken presentation</span></th>
              <th class="axis" colspan={cols.length - 2}><span class="rev">Clean or Minor</span></th>
            </tr>
            <tr>
              <th class="axis"><span class="hk">Hook</span></th>
              {#each cols as c}<th class="col"><span class="score c{c}">{c === "null" ? "No score" : `${c} ${SCORE_NAMES[c]}`}</span></th>{/each}
            </tr>
          </thead>
          <tbody>
            {#each rows as r}
              <tr>
                <th class="row">{rowNames[r]}</th>
                {#each cols as c}
                  {@const v = s.cells[r][c]}
                  {@const kind = role(r, c)}
                  <td class="cell {kind}" class:zero={!v}>
                    <a href={cellHref(r, c)} aria-label="Hook {rowNames[r].toLowerCase()}, presentation {c}: {v}">
                      <span class="v">{n(v)}</span>
                      {#if kind === "miss"}<span class="tag">miss</span>{:else if kind === "fp"}<span class="tag">false positive</span>{/if}
                    </a>
                  </td>
                {/each}
              </tr>
            {/each}
          </tbody>
        </table>
        {#if s.unreviewed}<p class="xs muted">{n(s.unreviewed)} handoffs in this sample are not reviewed yet and are left out.</p>{/if}
      </div>

      <div class="metrics">
        <h2>How well it separates them</h2>
        <dl>
          <div>
            <dt>Blocked, among Costly or Broken presentation</dt>
            <dd><CIBar x={s.blocked_low} tone="hook" width={120} /><Prop x={s.blocked_low} /></dd>
          </div>
          <div>
            <dt>Allowed, among Clean or Minor presentation</dt>
            <dd><CIBar x={s.allowed_high} tone="hook" width={120} /><Prop x={s.allowed_high} /></dd>
          </div>
        </dl>
        <div class="outside">
          <h3 class="small">Outside what the hook can see</h3>
          <p class="small">
            <strong class="num">{n(s.outside.k)}</strong> of the {n(s.outside.needs_work)} handoffs that need work do so for intent or content alone, with presentation scored Clean or Minor. No check in the hook could catch them.
            {#if s.outside.k}<a href={href("/messages", { sample: listSample, cause: "intent-content" })}>Show them</a>{/if}
          </p>
        </div>
        <p class="xs muted provenance">
          Stored reports: run <code>{meta.hook.stored_run?.run_id ?? "none"}</code>{#if meta.hook.stored_run}, {date(meta.hook.stored_run.created_at)}{/if}.
          {#if meta.hook.stored_matches_binary === true}They match the current binary.{:else if meta.hook.stored_matches_binary === false}<strong>The current binary is different</strong>; the message reader shows its live result.{/if}
        </p>
      </div>
    </section>

    <section class="section">
      <header>
        <h2>By check</h2>
        <p>Every check that fires on at least one handoff, as the hook names it.</p>
      </header>
      <div class="scroll">
        <table class="data">
          <thead>
            <tr>
              <th>Check</th>
              <th>Status</th>
              <th class="r">All handoffs <span class="muted">(exact)</span></th>
              <th colspan="2">Costly or Broken presentation</th>
              <th class="r">Clean or Minor</th>
            </tr>
          </thead>
          <tbody>
            {#each s.checks as c}
              {@const statuses = Object.keys(c.sample)}
              {#each statuses as st, i}
                {@const low = c.sample[st].low}
                <tr>
                  {#if i === 0}<td rowspan={statuses.length} class="type rulename">{c.rule}</td>{/if}
                  <td><span class="st {st}">{statusName[st] ?? st}</span></td>
                  <td class="r"><a href={href("/messages", { flag: `${c.rule}:${st}` })}>{n(c.corpus[st] ?? 0)}</a></td>
                  <td class="cib"><CIBar x={s.low ? { k: low, n: s.low, p: low / s.low } : null} tone="hook" /></td>
                  <td class="small">
                    <a href={href("/messages", { sample: listSample, flag: `${c.rule}:${st}`, presentation: "1,2" })}>{n(low)}</a> of {n(s.low)}{#if st === "warn" && c.warned_but_blocked.sample}<span class="muted">; {n(c.warned_but_blocked.sample)} of these were already blocked by another check</span>{/if}
                  </td>
                  <td class="r small"><a href={href("/messages", { sample: listSample, flag: `${c.rule}:${st}`, presentation: "3,4" })}>{n(c.sample[st].high)}</a> of {n(s.high)}</td>
                </tr>
              {/each}
            {/each}
          </tbody>
        </table>
      </div>
      <p class="xs muted foot">
        A warning does not stop delivery. A handoff another check blocks still carries its warnings, which is why a check can warn on handoffs in this table while the hook's result for them is Blocks.
        {#if s.silent.length}
          {s.silent.join(" and ")} {s.silent.length === 1 ? "never fires" : "never fire"} on any of the {n(meta.corpus.inputs)} handoffs and {s.silent.length === 1 ? "is" : "are"} left out.
        {/if}
      </p>
    </section>

    <section class="section lists">
      <div>
        <header class="list-head">
          <h2><span class="swatch miss"></span>Misses <span class="num muted">{n(misses?.total ?? 0)}</span></h2>
          {#if misses?.total}<a class="btn" href={href("/messages", missQuery)}>Open as list</a>{/if}
        </header>
        <p class="small muted">Costly or Broken presentation, and the hook allows them.</p>
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
        <p class="small muted">Clean or Minor presentation, and the hook blocks them.</p>
        {#if falsePos?.messages.length}
          <MessageTable messages={falsePos.messages} from={fpQuery.toString()} compact />
        {:else}
          <p class="empty">No false positives in this sample: every handoff the hook blocks has Costly or Broken presentation.</p>
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
    max-width: 86ch;
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
  .rev {
    box-shadow: inset 0 -2px 0 var(--reviewer);
  }
  .hk {
    box-shadow: inset 0 -2px 0 var(--hook);
  }
  .matrix .col {
    width: 120px;
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
  .outside {
    margin-top: 24px;
    border-top: 1px solid var(--rule);
    padding-top: 12px;
  }
  .outside p {
    margin-top: 4px;
    color: var(--ink-2);
  }
  .outside strong {
    color: var(--ink);
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
  .foot {
    margin-top: 10px;
    max-width: 100ch;
  }
  .lists {
    display: grid;
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
