import {test,beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {createServer,type Server} from 'node:http';
import {createDashboardApi} from '../scripts/dashboard-api.ts';
let directory:string,path:string,api:ReturnType<typeof createDashboardApi>,server:Server,base:string;
const id=(n:number)=>n.toString(16).padStart(64,'0');
beforeEach(async()=>{
 directory=mkdtempSync(join(tmpdir(),'handoff-api-'));path=join(directory,'test.sqlite3');
 const db=new DatabaseSync(path);
 db.exec(`CREATE TABLE messages(message_id TEXT PRIMARY KEY,text TEXT,characters INT,words INT,kinds TEXT,projects TEXT,is_input INT);
 CREATE TABLE review_runs(run_id TEXT PRIMARY KEY,rubric_version TEXT,created_at TEXT);
 CREATE TABLE reviews(review_id TEXT PRIMARY KEY,run_id TEXT,context_id TEXT,message_id TEXT,record_json TEXT);
 CREATE TABLE contexts(context_id TEXT PRIMARY KEY,observation_id TEXT,message_id TEXT,status TEXT,metadata_json TEXT);
 CREATE TABLE observations(observation_id TEXT PRIMARY KEY,record_json TEXT);
 CREATE TABLE evidence(evidence_id TEXT PRIMARY KEY,kind TEXT,text TEXT,provenance TEXT,visibility TEXT);
 CREATE TABLE context_evidence(context_id TEXT,evidence_id TEXT);
 CREATE TABLE context_references(reference_id TEXT,context_id TEXT,record_json TEXT);
 CREATE TABLE mechanical_runs(run_id TEXT PRIMARY KEY,created_at TEXT);
 CREATE TABLE mechanical_results(run_id TEXT,message_id TEXT,result_json TEXT);`);
 for(let n=1;n<=8;n++){
  const text=`  Synthetic body ${n}. `+'Ordinary text. '.repeat(40)+(n===4?'Find the deep needle.':'')+'\n\tLiteral <script> stays text.  ';
  db.prepare('INSERT INTO messages VALUES(?,?,?,?,?,?,?)').run(id(n),text,text.length,100,JSON.stringify([n<=6?'assignment':'worker_report']),JSON.stringify([n<=4?'Alpha':'Beta']),n<=6?1:0);
 }
 for(const [run,version,date] of [['v2','intentionality-v2','2026-01-01'],['v1','intentionality-v1','2099-01-01']])db.prepare('INSERT INTO review_runs VALUES(?,?,?)').run(run,version,date);
 const review={review_id:'new',rubric_version:'intentionality-v2',classification:{sender:{role:'coordinator'},recipient:{role:'reviewer'},position:{value:'initial'},message_type:{value:'request'}},clarity:{rating:'difficult',grade:'fail',issues:[{kind:'fused_prose',quote:'Synthetic'}]},purpose:{reason:'Inspect the change.'}};
 db.prepare('INSERT INTO reviews VALUES(?,?,?,?,?)').run('new','v2','ctx',id(1),JSON.stringify(review));
 db.prepare('INSERT INTO reviews VALUES(?,?,?,?,?)').run('obsolete','v1','ctx',id(1),JSON.stringify({...review,review_id:'obsolete'}));
 db.prepare('INSERT INTO contexts VALUES(?,?,?,?,?)').run('ctx','obs',id(1),'partial','{}');
 db.prepare('INSERT INTO observations VALUES(?,?)').run('obs',JSON.stringify({timestamp_ms:1000,source:'synthetic'}));
 db.prepare('INSERT INTO evidence VALUES(?,?,?,?,?)').run('e','preceding_message','😀'.repeat(1010),'{}','sender_context');
 db.prepare('INSERT INTO context_evidence VALUES(?,?)').run('ctx','e');
 db.prepare('INSERT INTO mechanical_runs VALUES(?,?)').run('m','2026-01-01');
 db.prepare('INSERT INTO mechanical_results VALUES(?,?,?)').run('m',id(1),JSON.stringify({blocked:true,checks:[]}));
 db.close();api=createDashboardApi(path);
 server=createServer((req,res)=>api.middleware(req,res,()=>{res.statusCode=404;res.end();}));
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${(server.address() as any).port}/api/handoff-review`;
});
afterEach(async()=>{await new Promise<void>(r=>server.close(()=>r()));api.close();rmSync(directory,{recursive:true});});
const get=async(query='')=>(await fetch(base+'/messages'+query)).json() as Promise<any>;
test('bounded pagination returns previews, full-text search finds text beyond them',async()=>{
 const first=await get('?view=all&page_size=3'),second=await get('?view=all&page_size=3&page=1');
 assert.equal(first.total,8);assert.equal(first.messages.length,3);assert.equal(second.messages.length,3);
 assert(!first.messages.some((m:any)=>second.messages.some((n:any)=>m.message_id===n.message_id)));
 assert(first.messages.every((m:any)=>m.body_deferred&&m.text.length===180));
 const found=await get('?view=inputs&query=deep%20needle');assert.equal(found.total,1);assert.equal(found.messages[0].message_id,id(4));
 assert.equal((await get('?view=all&page=999&page_size=3')).page,2);
});
test('current reviews, facets, scope and all UI filters match the database',async()=>{
 const page=await get();assert.equal(page.total,1);assert.equal(page.counts.all,8);assert.equal(page.counts.input,6);assert.equal(page.counts.reviewed,1);
 assert.equal(page.messages[0].contexts[0].analyses[0].review_id,'new');assert.equal(page.messages[0].contexts[0].analyses[0].clarity.issues[0].kind,'fused_prose');assert.deepEqual(page.facets.projects,['Alpha','Beta']);
 for(const query of ['role=reviewer','position=initial','messageType=request','rating=difficult','mechanical=block','project=Alpha','kind=assignment'])assert.equal((await get('?'+query)).total,1,query);
 assert.equal((await get('?role=implementer')).total,0);assert.equal((await get('?view=outputs')).total,2);
 assert.equal((await get('?view=inputs&mechanical=unassessed')).total,5);
});
test('detail preserves original body, evidence bindings and Unicode excerpt counts, excluding v1',async()=>{
 const detail=await (await fetch(base+'/messages/'+id(1))).json() as any;
 const db=new DatabaseSync(path,{readOnly:true});assert.equal(detail.text,(db.prepare('select text from messages where message_id=?').get(id(1)) as any).text);db.close();
 assert.equal(detail.contexts[0].analyses.length,1);assert.equal(detail.contexts[0].analyses[0].review_id,'new');
 assert.equal(Array.from(detail.contexts[0].evidence[0].text).length,1000);assert.equal(detail.contexts[0].evidence[0].snapshot_omitted_characters,10);
 assert.equal(detail.contexts[0].timestamp,'1970-01-01T00:00:01.000Z');assert.equal(detail.mechanical.blocked,true);
});
test('context display extracts prose before truncation while preserving recorded envelope text',async()=>{
 const db=new DatabaseSync(path);const prose='Readable instruction. '+'Text. '.repeat(300);const raw=JSON.stringify({input:{message:prose}});
 db.prepare('UPDATE evidence SET text=? WHERE evidence_id=?').run(raw,'e');db.close();
 const detail=await (await fetch(base+'/messages/'+id(1))).json() as any;
 const e=detail.contexts[0].evidence[0];assert.equal(e.reading_text,prose.slice(0,1000));assert.equal(e.reading_omitted_characters,prose.length-1000);assert.equal(e.text,raw.slice(0,1000));
});
test('HTTP API rejects writes, invalid pagination and unknown IDs without changing SQLite',async()=>{
 const before=createHash('sha256').update(readFileSync(path)).digest('hex');
 for(const method of ['POST','PUT','DELETE'])assert.equal((await fetch(base+'/messages',{method})).status,405);
 for(const query of ['page=-1','page_size=100000','view=bad','page=NaN','query='+('x'.repeat(1001))])assert.equal((await fetch(base+'/messages?'+query)).status,400);
 assert.equal((await fetch(base+'/messages/not-an-id')).status,404);assert.equal((await fetch(base+'/messages/'+id(999))).status,404);
 assert.equal((await get('?view=all&query='+encodeURIComponent("'; DROP TABLE messages; --"))).total,0);
 assert.equal(createHash('sha256').update(readFileSync(path)).digest('hex'),before);
});
