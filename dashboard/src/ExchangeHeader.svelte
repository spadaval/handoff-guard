<script lang="ts">
 import RoleNode from './RoleNode.svelte';
 import {record,str,type RecordValue} from './model';
 let {project,review}:{project:string;review?:RecordValue}=$props();
 let c=$derived(record(review?.classification));
 const human=(v:unknown)=>str(v,'Unknown').replace(/_/g,' ').replace(/^./,x=>x.toUpperCase());
</script>
<header class="exchange-header">
 <h2>{project}</h2>
 <div class="exchange-graph" aria-label={`${human(record(c.sender).role)} sends ${human(record(c.message_type).value)} to ${human(record(c.recipient).role)}`}>
  <RoleNode role={str(record(c.sender).role,'unknown')} />
  <div class="exchange-edge"><span>{human(record(c.message_type).value)}</span><svg viewBox="0 0 180 20" preserveAspectRatio="none" aria-hidden="true"><path d="M0 10h176m-7-6 7 6-7 6"/></svg></div>
  <RoleNode role={str(record(c.recipient).role,'unknown')} />
 </div>
</header>
