<script lang="ts">
 import InlineEvidence from './InlineEvidence.svelte';
 import {record,str,type RecordValue,type Context} from './model';
 let {review,context}:{review?:RecordValue;context?:Context}=$props();
 let task=$derived(record(record(review?.classification).task));
 const clean=(v:unknown,fallback:string)=>str(v,fallback).replace(/\s*Body:\s*ev-[a-f0-9]{64}\.?/g,'').trim();
</script>
<section class="strategic-context" aria-label="Situation and intent">
 <header class="section-heading"><h2>Situation &amp; intent</h2><span class="source-label">Model context</span></header>
 <dl><dt>Situation</dt><dd>{str(task.summary,'The surrounding task has not been reconstructed.')}{#if task.trigger}<p class="strategic-trigger">{str(task.trigger)}</p>{/if}<InlineEvidence claim={task} {context} forClaim="the situation and immediate trigger" /></dd><dt>Intent</dt><dd>{clean(record(review?.purpose).reason,'The intended instruction or information has not been identified.')}<InlineEvidence claim={review?.purpose} {context} forClaim="the stated intent" /></dd></dl>
 {#if record(review?.classification).position||context?.timestamp}<p class="strategic-meta">{str(record(record(review?.classification).position).value,'Unknown stage').replace(/^./,c=>c.toUpperCase())} in the exchange{#if context?.timestamp}{' · Observed '}{new Date(str(context.timestamp)).toLocaleString(undefined,{timeZoneName:'short'})}{/if}</p>{/if}
</section>
