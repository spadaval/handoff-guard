/** Read-only dashboard API, mounted in the existing Artifact Hub server. */
import { DatabaseSync } from 'node:sqlite';
import type { IncomingMessage, ServerResponse } from 'node:http';

const prefix = '/api/handoff-review';
const latest = `WITH ranked AS (
 SELECT r.*, rr.created_at, row_number() OVER (PARTITION BY r.message_id ORDER BY rr.created_at DESC,r.review_id DESC) AS rank
 FROM reviews r JOIN review_runs rr USING(run_id) WHERE rr.rubric_version != 'intentionality-v1'
), current_review AS (SELECT * FROM ranked WHERE rank=1)`;
const decode = (value: string | null) => value ? JSON.parse(value) : null;
const mechanics = `SELECT result_json FROM mechanical_results JOIN mechanical_runs USING(run_id) WHERE message_id=? ORDER BY created_at DESC,run_id DESC LIMIT 1`;

export function createDashboardApi(databasePath: string) {
 let db: DatabaseSync | undefined;
 function database() {
  if (!db) { db = new DatabaseSync(databasePath, { readOnly: true }); db.exec('PRAGMA query_only=ON'); }
  return db;
 }
 function list(params: URLSearchParams) {
  const db = database();
  const page = integer(params.get('page'), 0, 1000000), pageSize = integer(params.get('page_size'), 50, 50, 1);
  const where: string[] = [], args: (string | number)[] = [];
  const view = params.get('view') || 'reviewed';
  if (!['reviewed','inputs','outputs','all'].includes(view)) throw new Error('Invalid message view');
  if (view === 'reviewed') where.push('l.review_id IS NOT NULL AND m.is_input=1');
  else if (view === 'inputs') where.push('m.is_input=1');
  else if (view === 'outputs') where.push('m.is_input=0 AND EXISTS (SELECT 1 FROM json_each(m.kinds) WHERE value LIKE \'%worker%\' OR value LIKE \'%completion%\' OR value LIKE \'%report%\')');
  for (const [param, path] of [['rating','$.clarity.rating'],['position','$.classification.position.value'],['messageType','$.classification.message_type.value']]) {
   if (params.get(param)) { where.push(`json_extract(l.record_json,'${path}')=?`); args.push(params.get(param)!); }
  }
  if (params.get('role')) { where.push("(json_extract(l.record_json,'$.classification.sender.role')=? OR json_extract(l.record_json,'$.classification.recipient.role')=?)"); args.push(params.get('role')!,params.get('role')!); }
  for (const [param, column] of [['project','projects'],['kind','kinds']]) {
   if (params.get(param)) { where.push(`EXISTS (SELECT 1 FROM json_each(m.${column}) WHERE value=?)`); args.push(params.get(param)!); }
  }
  const finding = params.get('mechanical');
  if (finding) {
   if (!['unassessed','block','pass'].includes(finding)) throw new Error('Invalid mechanical filter');
   const expression = `(SELECT json_extract(result_json,'$.blocked') FROM mechanical_results JOIN mechanical_runs USING(run_id) WHERE message_id=m.message_id ORDER BY created_at DESC,run_id DESC LIMIT 1)`;
   where.push(finding==='unassessed' ? `${expression} IS NULL` : `${expression}=?`);
   if (finding!=='unassessed') args.push(finding==='block'?1:0);
  }
  const query = (params.get('query') || '').trim();
  if (query.length > 1000) throw new Error('Search must be at most 1,000 characters');
  if (query) {
   where.push("(instr(lower(m.text),lower(?))>0 OR instr(lower(m.message_id),lower(?))>0 OR instr(lower(m.projects),lower(?))>0 OR instr(lower(coalesce(json_extract(l.record_json,'$.classification'),'')),lower(?))>0)");
   args.push(query,query,query,query);
  }
  const from = `FROM messages m LEFT JOIN current_review l ON l.message_id=m.message_id ${where.length?'WHERE '+where.join(' AND '):''}`;
  const total = Number((db.prepare(`${latest} SELECT count(*) AS n ${from}`).get(...args) as any).n);
  const actualPage = Math.min(page, Math.max(0,Math.ceil(total/pageSize)-1));
  const order = view==='reviewed' ? "CASE json_extract(l.record_json,'$.clarity.rating') WHEN 'unintelligible' THEN 0 WHEN 'difficult' THEN 0 WHEN 'minor_friction' THEN 1 WHEN 'unknown' THEN 2 WHEN 'clear' THEN 3 ELSE 4 END,m.words,m.message_id" : 'm.message_id';
  const rows = db.prepare(`${latest} SELECT m.message_id,substr(m.text,1,180) AS text,m.words,m.characters,m.kinds,m.projects,l.context_id,l.record_json,l.created_at ${from} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...args,pageSize,actualPage*pageSize) as any[];
  const messages = rows.map(row => {
   const r = decode(row.record_json);
   const review = r ? {review_id:r.review_id,rubric_version:r.rubric_version,reviewed_at:row.created_at,classification:r.classification,clarity:{rating:r.clarity?.rating,grade:r.clarity?.grade,issues:(r.clarity?.issues??[]).map((i:any)=>({kind:i.kind}))}} : null;
   return {message_id:row.message_id,text:row.text,words:row.words,characters:row.characters,kinds:decode(row.kinds),projects:decode(row.projects),body_deferred:true,contexts:review?[{context_id:row.context_id,analyses:[review]}]:[]};
  });
  const counts = db.prepare(`${latest} SELECT count(*) AS all_messages,sum(is_input) AS input,(SELECT count(*) FROM current_review JOIN messages USING(message_id) WHERE is_input=1) AS reviewed FROM messages`).get() as any;
  const facets = (column:string) => db.prepare(`SELECT DISTINCT value FROM messages,json_each(messages.${column}) ORDER BY value`).all().map((r:any)=>r.value);
  return {schema_version:1,messages,total,page:actualPage,page_size:pageSize,counts:{all:counts.all_messages,input:counts.input,reviewed:counts.reviewed},facets:{projects:facets('projects'),kinds:facets('kinds')}};
 }
 function detail(id:string) {
  if (!/^[a-f0-9]{64}$/.test(id)) return null;
  const db = database();
  const m = db.prepare('SELECT * FROM messages WHERE message_id=?').get(id) as any;
  if (!m) return null;
  const contexts = (db.prepare('SELECT c.*,o.record_json FROM contexts c JOIN observations o USING(observation_id) WHERE c.message_id=? ORDER BY c.context_id').all(id) as any[]).map(c=>{
   const o = decode(c.record_json);
   const evidence = (db.prepare('SELECT e.* FROM evidence e JOIN context_evidence ce USING(evidence_id) WHERE context_id=? ORDER BY evidence_id').all(c.context_id) as any[]).map(e=>({...e,provenance:decode(e.provenance)}));
   const references = (db.prepare('SELECT * FROM context_references WHERE context_id=? ORDER BY reference_id').all(c.context_id) as any[]).map(r=>({...decode(r.record_json),reference_id:r.reference_id}));
   for (const e of evidence) {
    const extracted = evidenceProse(e.text);
    if(extracted!==e.text){const chars=Array.from(extracted);e.reading_text=chars.slice(0,1000).join('');e.reading_omitted_characters=Math.max(0,chars.length-1000);e.reading_note='Message extracted from recorded tool arguments';}
   }
   for (const item of [...evidence,...references]) if (typeof item.text==='string' && Array.from(item.text).length>1000) {
    const chars = Array.from(item.text); item.snapshot_original_characters=chars.length; item.snapshot_omitted_characters=chars.length-1000; item.text=chars.slice(0,1000).join('');
   }
   const analyses = (db.prepare("SELECT r.record_json,rr.created_at FROM reviews r JOIN review_runs rr USING(run_id) WHERE context_id=? AND rr.rubric_version!='intentionality-v1' ORDER BY rr.created_at DESC,r.review_id DESC").all(c.context_id) as any[]).map(r=>({...decode(r.record_json),reviewed_at:r.created_at}));
   return {...Object.fromEntries(['kind','tool','timestamp','project','source','locator','sender_thread_id','target_thread_id'].map(k=>[k,o[k]??null])),timestamp:o.timestamp??(o.timestamp_ms!=null?new Date(o.timestamp_ms).toISOString():null),source_item_id:o.item_id,source_line:o.line,source_thread_id:o.thread_id,native_thread_id:o.native_thread_id,model:o.model,model_attribution:o.model_attribution,recorded_target:o.target,context_id:c.context_id,context_status:c.status,availability:decode(c.metadata_json),observation_id:c.observation_id,evidence,references,analyses};
  });
  const result = db.prepare(mechanics).get(id) as any;
  return {...m,kinds:decode(m.kinds),projects:decode(m.projects),historical_reviews:[],mechanical:decode(result?.result_json),contexts};
 }
 function middleware(req:IncomingMessage,res:ServerResponse,next:()=>void) {
  const url = new URL(req.url || '/', 'http://localhost');
  if (url.pathname!==prefix && !url.pathname.startsWith(prefix+'/')) { next(); return; }
  res.setHeader('Content-Type','application/json; charset=utf-8'); res.setHeader('Cache-Control','no-store');
  const send=(status:number,value:unknown)=>{res.statusCode=status;res.end(JSON.stringify(value));};
  if (req.method!=='GET') {res.setHeader('Allow','GET');send(405,{error:'Read-only API; use GET'});return;}
  try {
   if (url.pathname===prefix+'/messages') {send(200,list(url.searchParams));return;}
   if (url.pathname.startsWith(prefix+'/messages/')) {const m=detail(url.pathname.slice((prefix+'/messages/').length));send(m?200:404,m??{error:'Message not found'});return;}
   send(404,{error:'Endpoint not found'});
  } catch(e) {const message=e instanceof Error?e.message:String(e);const bad=/Invalid |must be/.test(message);send(bad?400:503,{error:bad?message:'The review database is unavailable.'});if(!bad)console.error('Handoff review API:',e);}
 }
 return {middleware,list,detail,close(){db?.close();db=undefined;}};
}
function integer(raw:string|null,fallback:number,max:number,min=0) {
 if(raw===null)return fallback;
 if(!/^\d+$/.test(raw)||!Number.isSafeInteger(Number(raw))||Number(raw)<min||Number(raw)>max)throw new Error('Invalid pagination');
 return Number(raw);
}
export function handoffReviewApi(databasePath:string) {
 return {name:'handoff-review-api',configureServer(server:any){const api=createDashboardApi(databasePath);server.middlewares.use(api.middleware);server.httpServer?.once('close',()=>api.close());}};
}

function evidenceProse(raw:string):string {
 try {
  const value=JSON.parse(raw);
  const candidates=[value?.input,value?.arguments,value];
  for(let candidate of candidates){
   if(typeof candidate==='string'){try{candidate=JSON.parse(candidate);}catch{continue;}}
   if(!candidate||typeof candidate!=='object')continue;
   for(const key of ['message','prompt','task','text'])if(typeof candidate[key]==='string')return candidate[key];
   if(Array.isArray(candidate.content)){const texts=candidate.content.filter((c:any)=>c.type==='text'&&typeof c.text==='string').map((c:any)=>c.text);if(texts.length)return texts.join('\n\n');}
  }
 }catch{}
 return raw;
}
