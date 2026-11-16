/**
 * E1-A synchronous bounded component-local iterative estimator.
 * RESEARCH BASELINE: every directed neighbor message arrives immediately
 * in each logical round, without link loss, per-hop delay, or E1 bandwidth use.
 * Honest nodes read only one-hop PREVIOUS-ROUND states, never the current
 * aggregate of the entire component. Global labels are for validation only.
 *
 * Faulty bits are used by the simulator to freeze malicious transmissions.
 * The honest update rule never reads labels or oracle truth.
 */
export const E1A_LOCAL_CONSENSUS_VERSION="e1a-local-synchronous-consensus-pilot-1.0.0";
export const E1A_LOCAL_CONSENSUS_DEFAULTS=Object.freeze({
 localConsensusRounds:4,localConsensusTrim:1,
 localConsensusRelaxation:0.75,localConsensusMinWeight:0.05
});
const finite=Number.isFinite;
const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
export function validateLocalConsensusOptions(options={}){
 if(options===null||typeof options!=="object"||Array.isArray(options))
  throw Error("Локальный консенсус: ожидается объект параметров");
 const p={...E1A_LOCAL_CONSENSUS_DEFAULTS,...options};
 for(const [key,lo,hi,integer] of [
  ["localConsensusRounds",0,20,true],
  ["localConsensusTrim",0,40,true],
  ["localConsensusRelaxation",0,1,false],
  ["localConsensusMinWeight",0.000001,1,false]
 ]){
  if(!finite(p[key])||p[key]<lo||p[key]>hi||
   integer&&!Number.isInteger(p[key]))
   throw Error("Локальный консенсус: недопустимый параметр "+key);
 }
 return p;
}
function validateTick(input){
 const {values,reputation,active,labels,adjacency,faulty}=input||{};
 const n=values?.length;
 if(!Number.isInteger(n)||n<2||n>160||!Array.isArray(reputation)||
  !Array.isArray(active)||!Array.isArray(labels)||!Array.isArray(adjacency)||
  [reputation,active,labels,adjacency].some(a=>a.length!==n)||
  faulty!==undefined&&(!Array.isArray(faulty)||faulty.length!==n))
  throw Error("Локальный консенсус: несогласованный состав агентов");
 for(let i=0;i<n;i++){
  if(typeof active[i]!=="boolean"||!Number.isInteger(labels[i])||
   labels[i]<-1||active[i]&&labels[i]<0||
   !active[i]&&labels[i]!==-1||
   !finite(reputation[i])||reputation[i]<0||reputation[i]>1||
   active[i]&&!finite(values[i])||
   faulty!==undefined&&typeof faulty[i]!=="boolean"||
   !Array.isArray(adjacency[i])||adjacency[i].length!==n)
   throw Error("Локальный консенсус: некорректные наблюдения агента "+i);
  for(let j=0;j<n;j++){
   const edge=adjacency[i][j];
   if(typeof edge!=="boolean"||edge!==adjacency[j]?.[i]||
    edge&&(i===j||!active[i]||!active[j]||labels[i]!==labels[j]))
    throw Error("Локальный консенсус: недопустимое ребро "+i+","+j);
  }
 }
 return n;
}
/** Exact tie-invariant fractional trimming without index-dependent boundary. */
export function localWeightedTrim(values,weights,k){
 if(!Array.isArray(values)||!Array.isArray(weights)||!values.length||
  values.length!==weights.length||!Number.isInteger(k)||k<0||
  values.some(v=>!finite(v))||weights.some(w=>!finite(w)||w<0))
  throw Error("Локальный консенсус: некорректная выборка для усечения");
 const cut=Math.min(k,Math.floor((values.length-1)/2));
 const pairs=values.map((v,i)=>({v,i})).sort((a,b)=>a.v-b.v);
 const first=cut,last=values.length-cut;
 let numerator=0,denominator=0,unweighted=0,count=0;
 for(let j=0;j<pairs.length;){
  let end=j+1;
  while(end<pairs.length&&pairs[end].v===pairs[j].v)end++;
  const keep=(Math.max(0,Math.min(end,last)-Math.max(j,first)))/(end-j);
  for(let z=j;z<end;z++){
   const index=pairs[z].i;
   numerator+=keep*weights[index]*pairs[z].v;
   denominator+=keep*weights[index];
   unweighted+=keep*pairs[z].v;count+=keep;
  }
  j=end;
 }
 return denominator>1e-15?numerator/denominator:unweighted/count;
}
/**
 * One topology snapshot, independent state at each active node.
 * Faulty flags control only the synthetic transmitter behavior.
 */
export function simulateLocalConsensusTick(input,options={}){
 const n=validateTick(input),p=validateLocalConsensusOptions(options);
 const low=options.safe_action_min??-2,high=options.safe_action_max??2;
 if(!finite(low)||!finite(high)||low>=high)
  throw Error("Локальный консенсус: недопустимый безопасный интервал");
 const {values,reputation,active,labels,adjacency}=input;
 const bad=input.faulty??Array(n).fill(false);
 let state=values.map((v,i)=>active[i]?clamp(v,low,high):null);
 const rounds=[{round:0,states:[...state],messages:0,updated:0}];
 let totalMessages=0;
 for(let round=1;round<=p.localConsensusRounds;round++){
  const previous=[...state],next=[...previous];
  for(let i=0;i<n;i++){
   if(!active[i]||bad[i])continue;
   const neighborhood=[i];
   for(let j=0;j<n;j++)if(adjacency[i][j]&&active[j])neighborhood.push(j);
   const eligible=neighborhood.filter(j=>finite(previous[j]));
   if(!eligible.length)continue;
   const readings=eligible.map(j=>previous[j]);
   const weights=eligible.map(j=>Math.max(p.localConsensusMinWeight,reputation[j]));
   const candidate=localWeightedTrim(readings,weights,p.localConsensusTrim);
   next[i]=clamp((1-p.localConsensusRelaxation)*previous[i]+
    p.localConsensusRelaxation*candidate,low,high);
  }
  // Every active neighbor sends one state to each directed neighbor.
  const messages=active.reduce((acc,is,i)=>acc+(is?
   adjacency[i].filter(Boolean).length:0),0);
  totalMessages+=messages;
  state=next;
  rounds.push({round,states:[...state],messages,
   updated:active.filter((v,i)=>v&&!bad[i]).length});
 }
 const parts=new Map();
 for(let i=0;i<n;i++)if(active[i]){
  const label=labels[i];
  if(!parts.has(label))parts.set(label,[]);
  parts.get(label).push(i);
 }
 const components=[...parts.entries()].sort((a,b)=>a[0]-b[0]).map(([label,nodes])=>{
  const honest=nodes.filter(i=>!bad[i]).map(i=>state[i]);
  const allValues=nodes.map(i=>state[i]);
  const avg=a=>a.reduce((s,x)=>s+x,0)/a.length;
  return {label,nodes,memberCount:nodes.length,
   honestCount:honest.length,
   honestSpread:honest.length?Math.max(...honest)-Math.min(...honest):null,
   componentMean:avg(allValues),
   honestMean:honest.length?avg(honest):null};
 });
 return Object.freeze({
  modelVersion:E1A_LOCAL_CONSENSUS_VERSION,
  role:"diagnostic_local_consensus_only_not_feedback_to_E1",
  step:input.step??null,states:[...state],initial:rounds[0].states,
  rounds,components,totalMessages,
  activeCount:active.filter(Boolean).length,
  warning:"Ideal synchronous one-hop rounds, unbudgeted traffic; no Byzantine agreement proof"
 });
}
