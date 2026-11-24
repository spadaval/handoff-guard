export type RecordValue = Record<string, unknown>;
export type Evidence = RecordValue & { evidence_id: string; text: string };
export type Context = RecordValue & { context_id: string; evidence: Evidence[]; references: RecordValue[]; analyses: RecordValue[] };
export type Message = RecordValue & { message_id: string; text: string; kinds: string[]; projects: string[]; historical_reviews: RecordValue[]; contexts: Context[] };
export type Snapshot = RecordValue & { schema_version: 1; messages: Message[] };
export const record = (x: unknown): RecordValue => x && typeof x === 'object' && !Array.isArray(x) ? x as RecordValue : {};
export const records = (x: unknown): RecordValue[] => Array.isArray(x) ? x.filter(v => v && typeof v === 'object' && !Array.isArray(v)) : [];
export const str = (x: unknown, fallback = 'Not recorded'): string => x == null || x === '' ? fallback : typeof x === 'string' ? x : JSON.stringify(x, null, 2);
export const strings = (x: unknown): string[] => Array.isArray(x) ? x.filter(v => typeof v === 'string') : [];
export const number = (x: unknown): string => typeof x === 'number' ? x.toLocaleString() : 'Not recorded';
export function analyses(m: Message): RecordValue[] {
  return m.contexts.flatMap(c=>c.analyses).sort((a,b)=>str(b.reviewed_at,'').localeCompare(str(a.reviewed_at,'')) || str(b.rubric_version,'').localeCompare(str(a.rubric_version,'')));
}
export function parseResponse(raw: string): Snapshot {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error('The review API returned invalid JSON.'); }
  const root = record(parsed);
  if (root.schema_version !== 1) throw new Error('Unsupported review API response version.');
  if (!Array.isArray(root.messages)) throw new Error('The review API response must contain a messages array.');
  const seen = new Set<string>();
  const messages = root.messages.map((value: unknown, i: number) => {
    const m = record(value);
    if (typeof m.message_id !== 'string' || !m.message_id || typeof m.text !== 'string') throw new Error(`Message ${i + 1} requires a message_id and original text string.`);
    if (seen.has(m.message_id)) throw new Error(`Message ${i + 1} repeats a message_id. Each page must contain distinct messages.`);
    seen.add(m.message_id);
    return { ...m, message_id: m.message_id, text: m.text, kinds: strings(m.kinds), projects: strings(m.projects), historical_reviews: [], contexts: records(m.contexts).map((c, j) => ({ ...c, context_id: str(c.context_id, `unidentified-context-${j + 1}`), evidence: records(c.evidence).map((e, k) => ({ ...e, evidence_id: str(e.evidence_id, `unidentified-evidence-${k + 1}`), text: typeof e.text === 'string' ? e.text : '' })), references: records(c.references), analyses: records(c.analyses).filter(r=>r.rubric_version!=='intentionality-v1') })) } as Message;
  });
  return { ...root, schema_version: 1, messages };
}
export interface Filters { query: string; scope: string; project: string; kind: string; review: string; history: string; context: string; grade: string; position?: string; messageType?: string; role?: string; mechanical?: string; rating?: string }
export function highlightedSegments(text: string, mechanical: unknown, selectedRule = '', selectedQuote = ''): {text:string;rules:string[]}[] {
  const chars=Array.from(text);
  const spans=records(record(mechanical).checks).filter(c=>selectedRule!=='off'&&(c.status==='block'||(c.status==='warn'&&selectedRule===c.rule))&&(!selectedRule||c.rule===selectedRule)).flatMap(c=>records(c.spans).map(s=>({start:s.start,end:s.end,rule:str(c.rule)}))).filter((s):s is {start:number;end:number;rule:string}=>typeof s.start==='number'&&typeof s.end==='number'&&Number.isInteger(s.start)&&Number.isInteger(s.end)&&s.start>=0&&s.end>s.start&&s.end<=chars.length);
  if(selectedQuote){let from=0,index;while((index=text.indexOf(selectedQuote,from))>=0){const start=Array.from(text.slice(0,index)).length;spans.push({start,end:start+Array.from(selectedQuote).length,rule:'review-quote'});from=index+selectedQuote.length;}}
  if(!spans.length) return [{text,rules:[]}];
  const points=[...new Set([0,chars.length,...spans.flatMap(s=>[s.start,s.end])])].sort((a,b)=>a-b);
  return points.slice(0,-1).map((start,i)=>({text:chars.slice(start,points[i+1]).join(''),rules:[...new Set(spans.filter(s=>s.start<=start&&s.end>=points[i+1]).map(s=>s.rule))]}));
}
