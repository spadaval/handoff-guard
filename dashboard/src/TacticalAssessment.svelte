<script lang="ts">
 import {record,records,str,number,type RecordValue,type Context} from './model';
 import {hookScore,modelScore,comparison,issueList} from './rubric';
 import Score from './Score.svelte';
 import InlineEvidence from './InlineEvidence.svelte';
 let {title,kind,checks,model,context,text='',onHighlight=(_r:string)=>{},onQuote=(_q:string)=>{}}:{title:string;kind:'information'|'presentation';checks:RecordValue[];model?:unknown;context?:Context;text?:string;onHighlight?:(r:string)=>void;onQuote?:(q:string)=>void}=$props();
 let agreement=$derived(comparison(checks,model,kind));
 const names:Record<string,string>={characters:'Character limit',words:'Word limit',glued_prose:'Word spacing',repeated_token:'Repeated words',repeated_line:'Repeated lines',punctuation_spacing:'Punctuation spacing',needless_shorthand:'Needless shorthand'};
 const clean=(v:unknown)=>str(v,'No model assessment recorded.').replace(/\s*Body:\s*ev-[a-f0-9]{64}\.?/g,'').replace(/\bev-[a-f0-9]{64}\b/g,'the cited context').replace(/\bref-[a-f0-9]{64}\b/g,'the cited document').trim();
 const pct=(n:unknown)=>typeof n==='number'?Number(n.toFixed(1))+'%':'Not measured';
 function finding(c:RecordValue){const m=record(c.measurements),t=record(c.thresholds);switch(c.rule){
  case 'characters':return `${number(m.characters)} / ${number(t.maximum)} characters`;
  case 'words':return `${number(m.words)} / ${number(t.maximum)} words`;
  case 'glued_prose':return `${number(m.long_run_letters)} letters in long runs (${pct(m.long_run_percent)}); threshold ${number(t.minimum_total_letters)} and ${number(t.minimum_percent)}%`;
  case 'repeated_token':return `${number(m.most_frequent_count)} / ${number(m.words)} words; threshold ${number(t.minimum_percent)}% of ${number(t.minimum_words)}+ words`;
  case 'repeated_line':return `${number(m.dominant_line_count??m.most_repeated_line_count)} copies; threshold ${number(t.minimum_count)} copies and ${number(t.minimum_percent)}%`;
  case 'punctuation_spacing':case 'needless_shorthand':return `${number(m.matches)} matches / ${number(m.prose_words)} prose words (${pct(m.matches_per_100_words)}); advisory`;
  default:return 'Not measured';}}
</script>
<section class="tactical-section" aria-label={title}>
 <header class="tactical-heading"><h3>{title}</h3><a class="rubric-link" href="./communication-rubric.md" target="_blank" rel="noreferrer">1–5 anchors ↗</a></header>
 <div class="assessment-source hook-source">
  <header><span class="source-label">Hook <small>{kind==='information'?'length only':'includes advisory checks'}</small></span><Score value={hookScore(checks,kind)} label={title+' hook score'} description={kind==='information'?'Length-policy fit only':'Measured surface checks only'} /></header>
  <ul class="hook-checklist" aria-label={title+' hook checklist'}>
   {#each checks as check}<li data-result={check.status}><span class="check-symbol" aria-label={check.status==='block'?'Failed':check.status==='warn'?'Advisory finding':'Passed'}>{check.status==='block'?'×':check.status==='warn'?'!':'✓'}</span><span class="check-name">{names[str(check.rule)]}</span><span class="check-finding">{finding(check)}{#if check.status==='block'||check.status==='warn'} <button class="match-link" onclick={()=>onHighlight(str(check.rule))}>Show match</button>{/if}</span></li>{/each}
   {#if !checks.length}<li data-result="unknown"><span class="check-symbol">—</span><span class="check-name">No measurements</span><span class="check-finding">Run the mechanical analysis for this message.</span></li>{/if}

  </ul>
 </div>
 <div class="assessment-source model-source">
  <header><span class="source-label">Model</span><Score value={modelScore(model)} label={title+' model score'} /></header>
  <p class="model-reason">{clean(record(model).reason)}</p>
  {#each issueList(model) as issue}<div class="model-issue"><span>{str(issue.kind,'Finding').replace(/_/g,' ')}</span>{#if issue.quote}<blockquote>{#if typeof issue.quote==='string'&&text.includes(issue.quote)}<button class="quote-link" title="Highlight passage in the original message" onclick={()=>onQuote(str(issue.quote))}>{issue.quote}<span aria-hidden="true"> ↗</span></button>{:else}{str(issue.quote)}{/if}</blockquote>{/if}{#if issue.remedy}<p><b>Rewrite:</b> {str(issue.remedy)}</p>{/if}</div>{/each}
  {#if record(model).remedy}<p class="model-remedy">{str(record(model).remedy)}</p>{/if}
  <InlineEvidence claim={model} {context} forClaim={title.toLowerCase()+' judgment'} />
 </div>
 <footer class="agreement-line" data-state={agreement.state}><span>Agreement</span><b>{agreement.label}</b><small>{agreement.detail}</small></footer>
</section>
