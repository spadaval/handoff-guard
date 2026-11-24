<script lang="ts">
  import type { Mission } from "../lib/api.ts";
  import { n, pct, docket } from "../lib/format.ts";
  import CIBar from "./CIBar.svelte";
  import Prop from "./Prop.svelte";

  let {
    missions,
    sparse,
    link,
    sampleLink,
  }: {
    missions: Mission[];
    sparse: number;
    link: (mission: string, day?: string) => string;
    sampleLink: (mission: string, day?: string) => string;
  } = $props();

  const dayLabel = (d: string) => {
    if (d === "unknown") return "No recorded time";
    const date = new Date(d + "T00:00:00Z");
    return date.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  };
  const span = (m: Mission) => (m.first_day && m.last_day ? (m.first_day === m.last_day ? dayLabel(m.first_day) : `${dayLabel(m.first_day)} to ${dayLabel(m.last_day)}`) : "No recorded time");
  let open = $state<Record<string, boolean>>({});
</script>

<div class="wrap">
  <table class="data missions">
    <thead>
      <tr>
        <th>Mission and day</th>
        <th class="r">Handoffs</th>
        <th colspan="2">Hook blocks <span class="muted">(exact)</span></th>
        <th class="r">Reviewed</th>
        <th>Needs work <span class="muted">(sample)</span></th>
      </tr>
    </thead>
    {#each missions as m, i (m.key)}
      {@const expanded = open[m.key] ?? i < 4}
      <tbody class="mission">
        <tr class="head">
          <td>
            <button class="toggle" aria-expanded={expanded} onclick={() => (open[m.key] = !expanded)}>
              <span class="name">{m.title ?? "Untitled thread"}</span>
            </button>
            <div class="sub xs">
              <a class="type" href={link(m.key)}>{docket(m.key)}</a> · {span(m)} · {m.days.length} {m.days.length === 1 ? "day" : "days"} ·
              {m.models.slice(0, 2).map((x) => `${x.model} ${n(x.n)}`).join(", ")}{m.models.length > 2 ? ", …" : ""}
            </div>
          </td>
          <td class="r"><a href={link(m.key)}>{n(m.inputs)}</a></td>
          <td class="bar"><CIBar x={m.hook_blocked} tone="hook" /></td>
          <td><Prop x={m.hook_blocked} /></td>
          <td class="r">{#if m.reviewed}<a href={sampleLink(m.key)}>{n(m.reviewed)}</a>{:else}<span class="muted">0</span>{/if}</td>
          <td>
            {#if m.reviewed && !m.sparse}<Prop x={m.needs_work} />{:else if m.reviewed}<span class="small muted">{n(m.needs_work?.k)}/{n(m.needs_work?.n)}, too few</span>{/if}
          </td>
        </tr>
        {#if expanded}
          {#each m.days as d (d.key)}
            <tr class="day">
              <td class="dayname"><a href={link(m.key, d.key)}>{dayLabel(d.key)}</a></td>
              <td class="r"><a href={link(m.key, d.key)}>{n(d.inputs)}</a></td>
              <td class="bar"><CIBar x={d.hook_blocked} tone="hook" /></td>
              <td class="small">{#if d.hook_blocked}<span class="num"><b>{pct(d.hook_blocked.p)}</b> <span class="quiet">{n(d.hook_blocked.k)}/{n(d.hook_blocked.n)}</span></span>{/if}</td>
              <td class="r small">{#if d.reviewed}<a href={sampleLink(m.key, d.key)}>{n(d.reviewed)}</a>{:else}<span class="muted">0</span>{/if}</td>
              <td class="small">
                {#if d.reviewed && !d.sparse}<Prop x={d.needs_work} />{:else if d.reviewed}<span class="muted">{n(d.needs_work?.k)}/{n(d.needs_work?.n)}, fewer than {sparse} reviewed</span>{/if}
              </td>
            </tr>
          {/each}
        {/if}
      </tbody>
    {/each}
  </table>
</div>

<style>
  .wrap {
    overflow-x: auto;
  }
  .missions td a {
    text-decoration: none;
  }
  .missions td a:hover {
    text-decoration: underline;
  }
  tbody.mission {
    border-top: 1px solid var(--rule-2);
  }
  .head td {
    padding-top: 12px;
    border-bottom: 0;
  }
  .toggle {
    border: 0;
    background: none;
    padding: 0;
    text-align: left;
    display: inline-flex;
    gap: 6px;
    align-items: baseline;
  }
  .toggle::before {
    content: "";
    width: 0;
    height: 0;
    border-left: 4px solid transparent;
    border-right: 4px solid transparent;
    border-top: 5px solid var(--ink-3);
    transform: rotate(-90deg) translateX(1px);
    transition: transform 150ms;
  }
  .toggle[aria-expanded="true"]::before {
    transform: none;
  }
  .name {
    font-weight: 650;
    font-size: var(--t-sm);
  }
  .sub {
    color: var(--ink-3);
    margin: 2px 0 0 14px;
  }
  .day td {
    padding-top: 4px;
    padding-bottom: 4px;
    border-bottom: 0;
  }
  .day:last-child td {
    padding-bottom: 12px;
  }
  .dayname {
    padding-left: 24px !important;
    font-size: var(--t-sm);
    color: var(--ink-2);
  }
  td.bar {
    width: 104px;
    padding-right: 0;
    vertical-align: middle;
  }
</style>
