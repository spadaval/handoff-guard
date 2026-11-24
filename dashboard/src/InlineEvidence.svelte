<script lang="ts">
 import {marked} from 'marked';
 import DOMPurify from 'dompurify';
 import {record,str,strings,number,type Context} from './model';
 let {claim,context,forClaim}:{claim?:unknown;context?:Context;forClaim:string}=$props();
 let open=$state(false);
 let citations=$derived(new Set([...strings(record(claim).evidence_ids),...strings(record(claim).reference_ids)]));
 const human=(v:unknown)=>str(v,'Source').replace(/_/g,' ').replace(/^./,c=>c.toUpperCase()).replace(/^Cache origin /,'').replace(/^Preceding recorded /,'Earlier ').replace(/^Preceding /,'Earlier ');
 const excerpt=(text:string)=>text.replace(/^Delegated task (?:node:|[^\n]*in child thread)[^\n]*\n+/, '');
 const html=(text:string)=>DOMPurify.sanitize(marked.parse(excerpt(text),{async:false}),{FORBID_TAGS:['img','iframe','audio','video','style','form','input','a'],FORBID_ATTR:['style']});
 const when=(p:unknown)=>{const v=record(p);const stamp=v.timestamp??v.created_at??v.timestamp_ms;const d=typeof stamp==='number'?new Date(stamp):typeof stamp==='string'?new Date(stamp):null;return d&&!Number.isNaN(d.getTime())?d.toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}):'';};
 let sources=$derived([
  ...(context?.evidence??[]).filter(e=>citations.has(e.evidence_id)&&e.kind!=='recorded_handoff_body'&&!str(e.kind,'').includes('reasoning')).map(e=>({id:e.evidence_id,label:human(e.kind),text:str(e.reading_text??e.text,''),omitted:e.reading_text?e.reading_omitted_characters:e.snapshot_omitted_characters,visibility:e.visibility,time:when(e.provenance),note:str(e.reading_note,''),path:''})),
  ...(context?.references??[]).filter(r=>citations.has(str(r.reference_id))).map(r=>({id:str(r.reference_id),label:'Referenced document',text:str(r.text??r.recovered_text,r.reason?str(r.reason):'No document text recovered.'),omitted:r.snapshot_omitted_characters,visibility:'unknown',time:when(r),note:'Historical document; recipient access is not established.',path:str(r.path??r.issue,'')}))
 ]);
 $effect(()=>{context?.context_id;claim;open=false;});
</script>
{#if sources.length}
 <details class="inline-evidence" bind:open>
  <summary>Evidence <span>{sources.length} cited {sources.length===1?'source':'sources'}</span></summary>
  {#if open}
   <div class="evidence-content">
    <p class="evidence-purpose">Cited by the model for {forClaim}.</p>
    {#if context?.context_status==='partial'}<p class="evidence-limit">The recovered history is partial. Sender history alone does not establish recipient knowledge.</p>{/if}
    {#each sources as source (source.id)}
     <article class="evidence-source">
      <header><h4>{source.label}</h4>{#if source.time}<time>{source.time}</time>{/if}</header>
      <p class="evidence-access" data-visibility={source.visibility}>{source.visibility==='recipient_visible'?'Recorded as recipient-visible':source.visibility==='sender_context'?'Sender history · recipient access not established':'Recipient access unknown'}</p>
      {#if source.path}<p class="evidence-path">{source.path}</p>{/if}
      {#if source.note}<p class="evidence-note">{source.note}</p>{/if}
      <div class="context-prose">{@html html(source.text)}</div>
      {#if source.omitted}<p class="evidence-note">Excerpt: {number(source.omitted)} characters omitted. The longer record remains in SQLite.</p>{/if}
     </article>
    {/each}
   </div>
  {/if}
 </details>
{/if}
