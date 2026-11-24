<script lang="ts">
 import {onMount,tick} from 'svelte';
 import ExchangeHeader from './ExchangeHeader.svelte';
 import UnifiedAssessment from './UnifiedAssessment.svelte';
 import RecordedSources from './RecordedSources.svelte';
 import {parseResponse,analyses,str,number,record,records,highlightedSegments,type Snapshot,type Message,type Filters} from './model';
 const api='/api/handoff-review/messages';
 let snapshot=$state.raw<Snapshot|null>(null);
 let selectedDetail=$state.raw<Message|undefined>();
 let mounted=$state(false),busy=$state(false),error=$state(''),detailsError=$state('');
 let selectedId=$state(''),highlightedRule=$state(''),selectedQuote=$state('');
 let fullscreen=$state(false),embedded=$state(false),view=$state('reviewed'),page=$state(0),refreshToken=$state(0);
 let f=$state<Filters>({query:'',scope:'input',project:'',kind:'',review:'',history:'',context:'',grade:'',position:'',messageType:'',role:'',mechanical:'',rating:''});
 let messages=$derived(snapshot?.messages??[]);
 let visible=$derived(messages);
 let total=$derived(typeof snapshot?.total==='number'?snapshot.total:0);
 let pages=$derived(Math.max(1,Math.ceil(total/50)));
 let selectedIndex=$derived(messages.find(m=>m.message_id===selectedId)??messages[0]);
 let selected=$derived(selectedDetail?.message_id===selectedIndex?.message_id?selectedDetail:selectedIndex);
 let context=$derived(selected?.contexts.find(c=>c.analyses.some(r=>r.review_id===analyses(selected)[0]?.review_id))??selected?.contexts.find(c=>c.context_status==='partial'||c.context_status==='recovered')??selected?.contexts[0]);
 let review=$derived(context?.analyses[0]);
 let segments=$derived(highlightedSegments(selected?.text??'',selected?.mechanical,highlightedRule,selectedQuote));
 let projects=$derived((record(snapshot?.facets).projects??[]) as string[]);
 let kinds=$derived((record(snapshot?.facets).kinds??[]) as string[]);
 let reviewed=$derived(Number(record(snapshot?.counts).reviewed??0));
 let inputCount=$derived(Number(record(snapshot?.counts).input??0));
 let filterKey=$derived(JSON.stringify({view,query:f.query,project:f.project,kind:f.kind,position:f.position,messageType:f.messageType,role:f.role,mechanical:f.mechanical,rating:f.rating}));
 onMount(()=>{mounted=true;embedded=window.self!==window.top;const changed=()=>fullscreen=!!document.fullscreenElement;document.addEventListener('fullscreenchange',changed);return()=>document.removeEventListener('fullscreenchange',changed);});
 $effect(()=>{filterKey;page=0;});
 $effect(()=>{
  if(!mounted)return;
  const values=JSON.parse(filterKey),requestedPage=page;refreshToken;
  const controller=new AbortController();
  const timer=setTimeout(()=>void loadPage(values,requestedPage,controller.signal),values.query?180:0);
  return()=>{clearTimeout(timer);controller.abort();};
 });
 async function loadPage(values:Record<string,string>,requestedPage:number,signal:AbortSignal){
  busy=true;error='';
  try{
   const params=new URLSearchParams({...values,page:String(requestedPage),page_size:'50'});
   const response=await fetch(api+'?'+params,{signal});
   if(!response.ok)throw new Error(`Message request failed (HTTP ${response.status}).`);
   const result=parseResponse(await response.text());
   if(signal.aborted)return;
   snapshot=result;
   if(result.page!==requestedPage)page=Number(result.page);
  }catch(e){if(!signal.aborted)error=e instanceof Error?e.message:String(e);}
  finally{if(!signal.aborted)busy=false;}
 }
 $effect(()=>{
  const row=selectedIndex;refreshToken;
  if(!row)return;
  const controller=new AbortController();
  void loadDetails(row,controller.signal);
  return()=>controller.abort();
 });
 $effect(()=>{selectedIndex?.message_id;highlightedRule='';selectedQuote='';document.querySelector('.message-pane')?.scrollTo?.({top:0});});
 async function loadDetails(row:Message,signal?:AbortSignal){
  detailsError='';
  try{
   const response=await fetch(api+'/'+encodeURIComponent(row.message_id),{signal});
   if(!response.ok)throw new Error(`Message detail request failed (HTTP ${response.status}).`);
   const full=parseResponse(JSON.stringify({schema_version:1,messages:[JSON.parse(await response.text())]})).messages[0];
   if(full.message_id!==row.message_id)throw new Error('The response does not match the selected message.');
   if(!signal?.aborted)selectedDetail=full;
  }catch(e){if(!signal?.aborted)detailsError=e instanceof Error?e.message:String(e);}
 }
 function changeView(next:string){view=next;selectedId='';}
 function reset(){f={query:'',scope:'input',project:'',kind:'',review:'',history:'',context:'',grade:'',position:'',messageType:'',role:'',mechanical:'',rating:''};}
 async function highlight(rule:string){highlightedRule=rule;await tick();document.querySelector('.original mark')?.scrollIntoView?.({block:'center',behavior:'smooth'});}
 async function showQuote(quote:string){selectedQuote=quote;await tick();const mark=document.querySelector<HTMLElement>('.original .quote-highlight');mark?.focus({preventScroll:true});mark?.scrollIntoView?.({block:'center',behavior:'smooth'});}
 async function toggleFullscreen(){try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{error='Browser full screen is unavailable. The dashboard already fills the window.';}}
 const human=(v:unknown)=>str(v,'Unknown').replace(/_/g,' ').replace(/^./,x=>x.toUpperCase());
 const grade=(v:unknown)=>str(record(v).grade,'unknown');
 const status=(m:Message)=>{const r=analyses(m)[0];if(!r)return 'Unreviewed';const c=record(r.clarity);const labels=[...new Set(records(c.issues).map(i=>human(i.kind)))];return labels.length?(c.rating==='minor_friction'?'Local: ':'')+labels.slice(0,2).join(' · '):c.rating==='clear'||c.grade==='pass'?'No readability issue recorded':'Readability not established';};
 const exchangeCaption=(m:Message)=>{const c=record(analyses(m)[0]?.classification);return Object.keys(c).length?[str(record(c.sender).role,'unknown')+' → '+str(record(c.recipient).role,'unknown'),str(record(c.message_type).value,'unknown'),str(record(c.position).value,'unknown')].join(' · '):human(m.kinds[0]);};
 const title=(m:Message)=>str(record(record(analyses(m)[0]?.classification).task).summary,'')||(m.text.split('\n').map(x=>x.trim()).find(Boolean)??'(Empty message)').slice(0,140);
</script>

<svelte:head><title>Handoff review</title><meta name="description" content="Read original agent messages beside a contextual review, with cited evidence available beside each assessment." /></svelte:head>

<main class="app-shell">
  <header class="topbar">
    <div class="brand"><h1>Handoff review</h1></div>
    <div class="toolbar">
      {#if embedded}<a class="button-link" href="./" target="_blank" rel="noreferrer">Open in new tab ↗</a>{/if}
      <button disabled={busy} onclick={()=>refreshToken++}>Refresh data</button>
      <button class="fullscreen-button" aria-pressed={fullscreen} onclick={()=>{void toggleFullscreen();}}>{fullscreen?'Exit full screen':'Full screen'} ↗</button>
      <details class="utility-menu"><summary>Data & rubric</summary><div class="utility-panel">
        <h2>Communication rubric</h2><p>Situation and intent provide unscored context. Information selection and presentation each use a five-point scale, from 1 (unusable) to 5 (ready to send).</p><p>Hook checklists show measured rules. Model assessments judge meaning and wording. Agreement compares whether each calls for revision, within their different coverage.</p><p>Existing model explanations predate the five-point rubric and remain unscored. Punctuation and shorthand findings are advisory and do not deny delivery. Hook scores vary continuously with the measured burden.</p>
        <p><a href="./communication-rubric.md" target="_blank" rel="noreferrer">Read the full rubric and per-axis anchors ↗</a></p><p>Live read-only SQLite connection. Lists contain at most 50 previews; message text and context load on selection. Search covers full message text.</p>
      </div></details>
    </div>
  </header>
  {#if error}<div class="error" role="alert">{error} <button onclick={()=>refreshToken++}>Retry</button></div>{/if}
  {#if !snapshot}
    <section class="welcome"><h2>{error?'Unable to load messages':'Loading messages…'}</h2><p>The dashboard reads one page directly from SQLite.</p></section>
  {:else}
    <div class="workbench">
      <aside class="browser-pane" aria-label="Message browser">
        <div class="browser-controls">
          <label>Browse<select aria-label="Message view" value={view} onchange={e=>changeView(e.currentTarget.value)}><option value="reviewed">Reviewed sample ({reviewed.toLocaleString()})</option><option value="inputs">All handoffs ({number(record(snapshot.counts).input??inputCount)})</option><option value="outputs">Worker outputs</option><option value="all">All messages ({number(record(snapshot.counts).all??messages.length)})</option></select></label>
          <label class="search-label">{'Search'}<input type="search" aria-label="Search messages" placeholder={'Search full message text…'} bind:value={f.query} /></label>
          <details class="more-filters"><summary>Filter messages</summary><label>Model readability<select aria-label="Readability filter" bind:value={f.rating}><option value="">Any readability level</option><option value="clear">Clear</option><option value="minor_friction">Minor friction</option><option value="difficult">Issues identified (prior review)</option><option value="unintelligible">Unintelligible</option><option value="unknown">Unknown</option></select></label><label>Project<select bind:value={f.project}><option value="">All projects</option>{#each projects as project}<option>{project}</option>{/each}</select></label><label>Kind<select bind:value={f.kind}><option value="">All kinds</option>{#each kinds as kind}<option value={kind}>{human(kind)}</option>{/each}</select></label><label>Message stage<select bind:value={f.position}><option value="">Any stage</option><option value="initial">Initial</option><option value="middle">Middle</option><option value="final">Final</option><option value="unknown">Unknown</option></select></label><label>Message type<select bind:value={f.messageType}><option value="">Any type</option>{#each ['instruction','request','question','update','result','acknowledgement','unknown'] as type}<option value={type}>{human(type)}</option>{/each}</select></label><label>Participant role<select bind:value={f.role}><option value="">Any role</option>{#each ['coordinator','implementer','reviewer','validator','researcher','worker','user','unknown'] as role}<option value={role}>{human(role)}</option>{/each}</select></label><label>Mechanical finding<select bind:value={f.mechanical}><option value="">Any rule result</option><option value="block">Rule triggered</option><option value="pass">No rule triggered</option><option value="unassessed">Not measured</option></select></label></details>
          {#if view==='reviewed'}<p class="sort-note">Readability problems first</p>{/if}<div class="list-caption"><span aria-live="polite">{total.toLocaleString()} messages</span><button class="text-button" onclick={reset}>Reset filters</button></div>
        </div>
        {#if busy}<p class="status-message" role="status">Loading messages…</p>{/if}
        <nav class="message-list" aria-label="Filtered messages">{#each visible as m,i (m.message_id)}<button class="message-row" class:selected={selected?.message_id===m.message_id} aria-current={selected?.message_id===m.message_id?'true':undefined} onclick={()=>{selectedId=m.message_id;}}><span class="row-meta"><span>#{page*50+i+1} · {number(m.words)} words</span><span class="grade-pill" data-grade={grade(analyses(m)[0]?.rubric_version==='intentionality-v2'?analyses(m)[0]?.clarity:analyses(m)[0]?.overall)}>{status(m)}</span></span><span class="excerpt">{title(m)}</span><span class="row-foot">{exchangeCaption(m)}</span></button>{/each}{#if !messages.length}<div class="empty-list"><h2>No matching messages</h2><p>{view==='reviewed'?'No reviewed messages match this selection. Choose All handoffs to explore the rest of the corpus.':'Try a different search or reset the filters.'}</p></div>{/if}</nav>
        <div class="pagination"><button disabled={busy||page<=0} onclick={()=>page--}>← Previous</button><span>{Math.min(page+1,pages)} / {pages}</span><button disabled={busy||page+1>=pages} onclick={()=>page++}>Next →</button></div>
      </aside>
      <div class="reading-area">
        <article class="message-pane" aria-label="Message and assessment" data-message-id={selected?.message_id}>
        {#if selected}
          <ExchangeHeader project={selected.projects.join(' · ')||'Agent message'} {review} />
          {#if detailsError}<div class="error" role="alert">{detailsError} <button onclick={()=>{if(selectedIndex)void loadDetails(selectedIndex);}}>Retry message</button></div>{/if}
          {#if selected.body_deferred}<div class="message-loading" role="status">Loading this message…</div>{:else}
          <div class="message-heading"><h3>Message</h3><span>{number(selected.words)} words · {number(selected.characters??Array.from(selected.text).length)} characters</span></div>
          <section class="original" id="original-message" aria-label="Original message"><pre>{#each segments as segment}{#if segment.rules.length}<mark class:quote-highlight={segment.rules.includes('review-quote')} tabindex="-1" title={segment.rules.includes('review-quote')?'Reviewer quote':segment.rules.join(', ')}>{segment.text}</mark>{:else}{segment.text}{/if}{/each}</pre></section>
          <div class="document-tools">{#if record(selected.mechanical).blocked||(highlightedRule&&highlightedRule!=='off')}<button class="text-button" onclick={()=>highlightedRule=highlightedRule==='off'?'':'off'}>{highlightedRule==='off'?'Show rule highlights':'Hide rule highlights'}</button>{/if}</div>
          <UnifiedAssessment {review} {context} text={selected.text} mechanical={selected.mechanical} onHighlight={highlight} onQuote={showQuote} />
          <RecordedSources message={selected} {context} {review} />
          {/if}

        {:else}<div class="empty-detail"><h2>Select a message</h2><p>The original text and its assessment will appear here.</p></div>{/if}
        </article>

      </div>
    </div>
  {/if}
</main>
