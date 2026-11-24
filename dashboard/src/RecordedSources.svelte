<script lang="ts">
 import {str,type Message,type Context,type RecordValue} from './model';
 let {message,context,review}:{message:Message;context?:Context;review?:RecordValue}=$props();
 let open=$state(false),sourceId=$state('');
 let source=$derived(message.contexts.find(c=>c.context_id===sourceId)??context);
 const human=(v:unknown)=>str(v,'Unknown').replace(/_/g,' ').replace(/^./,c=>c.toUpperCase());
 $effect(()=>{message.message_id;open=false;sourceId='';});
</script>
<details class="recorded-sources" bind:open>
 <summary>Inspect recorded source data</summary>
 {#if open}
  <p>Raw records for investigation. Choosing a record here does not change the assessment above.</p>
  {#if message.contexts.length>1}<label>Recorded context<select aria-label="Recorded context" bind:value={sourceId}><option value="">Context used for this assessment</option>{#each message.contexts as c,i}<option value={c.context_id}>{i+1}. {human(c.source)}{c.timestamp?' · '+str(c.timestamp):''}</option>{/each}</select></label>{/if}
  <pre>{str({message:{message_id:message.message_id,projects:message.projects,kinds:message.kinds},assessment_context:context?.context_id,review,context:source,mechanical:message.mechanical})}</pre>
 {/if}
</details>
