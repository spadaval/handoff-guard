<script lang="ts">
 import {scaleNames} from './rubric';
 let {value,label='Score',description=''}:{value:number|null;label?:string;description?:string}=$props();
</script>
<span class="score" class:unscored={value===null} title={value===null?'No score recorded under the five-point rubric.':description||scaleNames[Math.round(value)]} aria-label={value===null?label+': not scored':label+': '+value.toFixed(1)+' out of 5'}>
 {#if value!==null}<b>{value.toFixed(1)}<small>/5</small></b><span class="score-dots" aria-hidden="true">{#each [1,2,3,4,5] as n}<i><span style:width={Math.max(0,Math.min(1,value-(n-1)))*100+'%'}></span></i>{/each}</span>{:else}<span>Not scored</span>{/if}
</span>
