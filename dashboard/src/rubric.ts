import {record,records,type RecordValue} from './model';
export const scaleNames=['','Unusable','Major revision','Revision needed','Minor polish','Ready to send'];
export function modelScore(model:unknown):number|null{const n=record(model).score;return typeof n==='number'&&Number.isInteger(n)&&n>=1&&n<=5?n:null;}
const bounded=(n:number)=>Math.max(0,Math.min(1,n));
export function hookScore(checks:RecordValue[],kind:'information'|'presentation'):number|null{
 if(!checks.length)return null;
 if(kind==='information'){
  if(checks.length<2)return null;
  const ratios=checks.map(c=>{const m=record(c.measurements),t=record(c.thresholds);return Number(m.characters??m.words)/Number(t.maximum);});
  if(ratios.some(r=>!Number.isFinite(r)))return null;
  return Math.max(1,5-2*Math.max(...ratios));
 }
 const risks:number[]=[];
 for(const c of checks){const m=record(c.measurements);switch(c.rule){
  case 'glued_prose':risks.push(Number(m.long_run_percent)/50);break;
  case 'repeated_token':risks.push(Math.min(Math.max(0,Number(m.most_frequent_count)-1)/79,Number(m.most_frequent_percent)/80));break;
  case 'repeated_line':risks.push(Math.min(Math.max(0,Number(m.dominant_line_count??m.most_repeated_line_count)-1)/9,Number(m.message_percent)/80));break;
  case 'punctuation_spacing':case 'needless_shorthand':risks.push(5*Number(m.matches)/Math.max(20,Number(m.prose_words)));break;
 }}
 if(risks.length<3||risks.some(r=>!Number.isFinite(r)))return null;
 return 5-4*bounded(Math.max(...risks));
}
export function modelDirection(model:unknown):boolean|null{
 const score=modelScore(model);if(score!==null)return score>=4;
 const m=record(model);
 if(m.grade==='pass')return true;
 if(m.grade==='fail')return false;
 return null;
}
export function comparison(checks:RecordValue[],model:unknown,kind:'information'|'presentation'):{label:string;detail:string;state:string}{
 const direction=modelDirection(model);
 if(hookScore(checks,kind)===null||direction===null)return {label:'Not comparable yet',detail:'A hook result and a model judgment are both needed.',state:'unknown'};
 const pass=!checks.some(c=>c.status==='block'||c.status==='warn');
 if(pass===direction)return {label:pass?'Both find no issue':'Both flag an issue',detail:pass?'Within the checks each covers.':'Both call for revision.',state:'agree'};
 return {label:'Different findings',detail:pass?'Hook passes; model calls for revision.':kind==='information'?'Hook flags a limit; model finds the message acceptable.':'Hook flags a surface signal; model finds the message acceptable.',state:'disagree'};
}
export const issueList=(model:unknown)=>records(record(model).issues);
