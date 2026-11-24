<script lang="ts">
 import {record,records,type RecordValue,type Context} from './model';
 import StrategicContext from './StrategicContext.svelte';
 import TacticalAssessment from './TacticalAssessment.svelte';
 let {review,context,mechanical,text='',onHighlight=(_r:string)=>{},onQuote=(_q:string)=>{}}:{review?:RecordValue;context?:Context;mechanical?:unknown;text?:string;onHighlight?:(r:string)=>void;onQuote?:(q:string)=>void}=$props();
 let checks=$derived(records(record(mechanical).checks));
</script>
<div class="message-analysis" aria-label="Message analysis">
 <StrategicContext {review} {context} />
 <section class="tactical-analysis" aria-label="Tactical assessment">
  <header class="section-heading"><h2>Information &amp; presentation</h2></header>
  <TacticalAssessment title="Information selection" kind="information" checks={checks.filter(c=>c.category==='size')} model={review?.information_selection} {context} {text} {onHighlight} {onQuote} />
  <TacticalAssessment title="Presentation" kind="presentation" checks={checks.filter(c=>c.category==='style')} model={review?.presentation??review?.clarity} {context} {text} {onHighlight} {onQuote} />
 </section>
</div>
