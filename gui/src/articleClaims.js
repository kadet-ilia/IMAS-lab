import {rng} from "./articleModel/common.js";
import {trimmedMean} from "./articleModel/aggregation.js";
import {initState} from "./articleModel/agents.js";
import {updateTrust} from "./articleModel/trust.js";
import {runArticleTask,validateArticleConfig} from "./articleEngine.js";
/** Numerical falsification tests, not a replacement for a formal proof. */
export function verifyArticleClaims(raw){
 const c=validateArticleConfig(raw),results=[];
 const q=.1,D0=c.initial_trust,lambda=c.trust_memory,threshold=c.isolation_threshold;
 let predicted=null;
 if(q<threshold&&threshold<D0){
  const real=Math.log((threshold-q)/(D0-q))/Math.log(lambda);
  predicted=Math.floor(real)+1; // strict D < threshold, no equality
 }
 const state=initState(c,0);
 const quality=Array.from({length:c.n_agents},(_,i)=>Array.from({length:c.n_agents},(_,j)=>i===j?null:q));
 let observed=null;
 for(let k=1;k<=c.n_steps;k++){
  updateTrust(state,quality,c);
  if(observed===null&&state.D[0][1]<threshold)observed=k;
 }
 results.push({name:"Утверждение 1: аналитический такт D < ϑ_iso",
  expected:predicted,observed,passed:predicted===null||predicted>c.n_steps?observed===null:observed===predicted});
 const r=rng(c.seed,"theorem2"),n=c.n_agents,f=c.n_byzantine,b=c.trim_each_side;
 let checks=0,failures=0;
 if(b>=f&&2*b<n){
  for(let trial=0;trial<128;trial++){
   const honest=Array.from({length:n-f},()=>Array.from({length:c.decision_dim},()=>r.normal()));
   const bad=Array.from({length:f},()=>Array.from({length:c.decision_dim},()=>1e6*r.normal()));
   const out=trimmedMean([...honest,...bad],b);
   for(let k=0;k<c.decision_dim;k++){
    const col=honest.map(v=>v[k]);
    if(out[k]<Math.min(...col)-1e-10||out[k]>Math.max(...col)+1e-10)failures++;
    checks++;
   }
  }
 }
 results.push({name:"Утверждение 2: диапазон корректных координат",
  expected:0,observed:failures,checks,passed:checks>0&&failures===0,
  note:b<f?"Проверка не применима: требуется b ≥ f.":null});
 const neutral=runArticleTask({...c,attack_shift:0,n_runs:1},0);
 const discrepancies=neutral.rows.filter(x=>x.psi!==1).length;
 results.push({name:"Контроль Ψ_L = 1 без воздействия",expected:0,observed:discrepancies,
  passed:discrepancies===0});
 const unsafe=neutral.rows.reduce((s,x)=>s+x.unsafeActions,0);
 results.push({name:"Контроль безопасности автоматических действий",expected:0,observed:unsafe,
  passed:unsafe===0});
 return {modelVersion:"imas-article-1.0.0",seed:c.seed,checks:results,
  passed:results.every(x=>x.passed),scope:"Детерминированные контрольные примеры; не является строгой проверкой универсальных условий применимости."};
}
