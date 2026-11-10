import {clamp,mean,median,stdev,rng} from "./articleModel/common.js";
import {initState,activeAttack,generateMessages,ATTACK_SCENARIOS} from "./articleModel/agents.js";
import {interactionQuality} from "./articleModel/quality.js";
import {updateTrust} from "./articleModel/trust.js";
import {updateIsolation} from "./articleModel/isolation.js";
import {chooseAction,DEFAULT_ACTION_UTILITIES} from "./articleModel/choice.js";
import {aggregateAll,ARTICLE_METHODS} from "./articleModel/aggregation.js";
import {indicators,psi,jt} from "./articleModel/resilience.js";
export const ARTICLE_MODEL_VERSION="imas-article-1.0.0";
export const ARTICLE_DEFAULTS=Object.freeze({
 model:"article",seed:20260716,n_agents:21,n_byzantine:4,decision_dim:4,
 reference_vector:[.4,-.2,.6,.1],reference_drift:0,observation_fraction:1,
 n_steps:40,n_runs:500,attack_start_step:5,attack_scenario:"collusion",attack_shift:4,
 attack_vector:[1,1,1,1],subtle_shift:.2,on_off_period:2,on_off_attack_steps:1,
 honest_noise_sigma:.08,quality_mode:"synthetic",honest_quality:.92,byzantine_quality:.1,quality_sigma:.04,
 quality_weights:[.5,.3,.2],consistency_scale:1,stability_scale:1,
 manipulate_reputation:true,reputation_low:0,mask_quality:.37,
 initial_trust:.5,trust_memory:.8,trust_alpha:.7,reputation_eps:.001,
 admission_threshold:.5,isolation_threshold:.35,isolation_patience:3,
 cusum_enabled:false,cusum_mu:.65,cusum_limit:1.5,trim_each_side:4,
 update_norm_bound:20,global_step:1,minimum_admitted:3,
 score_noise_sigma:.05,score_attack_shift:1,decision_margin:.02,
 action_utilities:DEFAULT_ACTION_UTILITIES,operator_availability:.5,
 error_scale:3,resilience_weights:[.25,.25,.25,.25],resilience_window:40,psi_min:.85,
 bootstrap_samples:500
});
const assert=(ok,key,desc)=>{if(!ok)throw Error("Параметр "+key+": "+desc);};
const scalar=(c,k,lo,hi,strictLo=false)=>{const x=c[k];assert(typeof x==="number"&&Number.isFinite(x)&&(strictLo?x>lo:x>=lo)&&x<=hi,k,"ожидается число в интервале");};
const integer=(c,k,lo,hi)=>{scalar(c,k,lo,hi);assert(Number.isInteger(c[k]),k,"ожидается целое число");};
const vector=(c,k,len,lo,hi)=>{assert(Array.isArray(c[k])&&c[k].length===len,k,"неверная размерность");c[k].forEach((x,i)=>{assert(typeof x==="number"&&Number.isFinite(x)&&x>=lo&&x<=hi,k+"["+i+"]","недопустимое значение");});};
export function validateArticleConfig(value={}){
 assert(value&&typeof value==="object"&&!Array.isArray(value),"config","ожидается объект");
 const c={...ARTICLE_DEFAULTS,...value};
 c.reference_vector=[...(value.reference_vector||ARTICLE_DEFAULTS.reference_vector)];
 c.attack_vector=[...(value.attack_vector||ARTICLE_DEFAULTS.attack_vector)];
 c.quality_weights=[...(value.quality_weights||ARTICLE_DEFAULTS.quality_weights)];
 c.resilience_weights=[...(value.resilience_weights||ARTICLE_DEFAULTS.resilience_weights)];
 c.action_utilities={...DEFAULT_ACTION_UTILITIES,...value.action_utilities};
 assert(c.model==="article","model","допустима только модель article");
 for(const [k,lo,hi] of [["n_agents",3,160],["n_byzantine",0,159],["decision_dim",1,32],
  ["n_steps",1,500],["n_runs",1,10000],["attack_start_step",0,500],["on_off_period",1,500],
  ["on_off_attack_steps",1,500],["isolation_patience",1,100],["trim_each_side",0,159],
  ["minimum_admitted",1,160],["resilience_window",1,500],["bootstrap_samples",100,10000]])integer(c,k,lo,hi);
 assert(Number.isSafeInteger(c.seed),"seed","ожидается целое безопасное число");
 assert(c.n_agents>2*c.n_byzantine,"n_byzantine","необходимо N > 2f");
 assert(c.attack_start_step<c.n_steps,"attack_start_step","такт атаки за горизонтом T");
 assert(c.on_off_attack_steps<=c.on_off_period,"on_off_attack_steps","должно быть <= периода");
 assert(2*c.trim_each_side<c.n_agents,"trim_each_side","при запуске 2b < N");
 assert(c.minimum_admitted<=c.n_agents,"minimum_admitted","не больше N");
 assert(c.resilience_window<=c.n_steps,"resilience_window","не больше горизонта");
 vector(c,"reference_vector",c.decision_dim,-1e4,1e4);
 vector(c,"attack_vector",c.decision_dim,-1e4,1e4);
 vector(c,"quality_weights",3,0,1);
 vector(c,"resilience_weights",4,0,1);
 const eq1=a=>Math.abs(a.reduce((s,x)=>s+x,0)-1)<1e-10;
 assert(eq1(c.quality_weights),"quality_weights","сумма beta должна равняться 1");
 assert(eq1(c.resilience_weights),"resilience_weights","сумма gamma должна равняться 1");
 for(const [k,lo,hi,strict] of [
  ["reference_drift",0,1e3],["observation_fraction",0,1],["attack_shift",0,1000],
  ["subtle_shift",0,1000],["honest_noise_sigma",0,100],["quality_sigma",0,10],
  ["honest_quality",0,1],["byzantine_quality",0,1],["reputation_low",0,1],
  ["mask_quality",0,1],["initial_trust",0,1],["trust_memory",0,1,true],
  ["trust_alpha",0,1],["reputation_eps",0,1e3],["admission_threshold",0,1],
  ["isolation_threshold",0,1],["cusum_mu",0,1],["cusum_limit",0,1000],
  ["update_norm_bound",0,1e5,true],["global_step",0,1e3,true],
  ["score_noise_sigma",0,100],["score_attack_shift",0,100],
  ["decision_margin",0,100],["operator_availability",0,1],
  ["error_scale",0,1e6,true],["psi_min",0,1e3],
  ["consistency_scale",0,1e6,true],["stability_scale",0,1e6,true]])scalar(c,k,lo,hi,strict);
 assert(c.trust_memory<1,"trust_memory","необходимо 0 < lambda < 1");
 assert(c.initial_trust>0&&c.initial_trust<1,"initial_trust","необходимо 0 < D0 < 1");
 assert(c.isolation_threshold<=c.admission_threshold,"admission_threshold","theta_iso <= theta_in");
 assert(c.observation_fraction>0,"observation_fraction","не допускается полная ненаблюдаемость");
 assert(ATTACK_SCENARIOS.includes(c.attack_scenario),"attack_scenario","неизвестный сценарий");
 assert(["synthetic","computed"].includes(c.quality_mode),"quality_mode","режим отсутствует");
 for(const name of ["manipulate_reputation","cusum_enabled"])
  assert(typeof c[name]==="boolean",name,"ожидается логическое значение");
 for(const mode of ["normal","attack"])vector(c.action_utilities,mode,5,-1e3,1e3);
 return c;
}
export const ARTICLE_PRESETS={
 table2:{n_agents:21,n_byzantine:4,decision_dim:4,reference_vector:[.4,-.2,.6,.1],
  attack_shift:4,honest_noise_sigma:.08,attack_start_step:5,n_steps:40,n_runs:500,
  seed:20260716,trust_memory:.8,isolation_threshold:.35,trim_each_side:4,
  attack_scenario:"collusion",manipulate_reputation:true},
 table3:{n_runs:300,n_steps:40},
 figure1:{n_runs:300,n_steps:40},
 psi:{n_runs:300,n_steps:40}
};
/** One experiment; identical keyed exogenous streams across paired attack modes. */
export function runArticle(raw={},runIndex=0,attacked=true,detail=false){
 const c=validateArticleConfig(raw),st=initState(c,runIndex),trace=[];
 const attackedRows=Object.fromEntries(ARTICLE_METHODS.map(m=>[m,[]]));
 const functionality=Object.fromEntries(ARTICLE_METHODS.map(m=>[m,[]]));
 for(let t=0;t<c.n_steps;t++){
  const observation=generateMessages(st,t,c,attacked);
  const q=interactionQuality(st,t,c,observation);
  updateTrust(st,q,c);
  const isolation=updateIsolation(st,q,t,c,observation.attackActive);
  const choice=chooseAction(st,t,c,observation,isolation.admitted);
  const aggregation=aggregateAll(st,c,observation,isolation.admitted);
  const chi=Object.fromEntries(ARTICLE_METHODS.map(m=>[m,indicators(choice,aggregation,st,observation,c,m)]));
  for(const m of ARTICLE_METHODS){
   functionality[m].push(chi[m]);
   if(t>=c.attack_start_step&&aggregation[m].error!==null)attackedRows[m].push(aggregation[m].error);
  }
  trace.push({step:t,attackActive:observation.attackActive,reference:observation.reference,
   trustMedian:median(st.alive().map(i=>st.tau[i]))??0,trust:[...st.tau],
   live:st.alive().length,admitted:isolation.admitted.length,choice,
   methods:aggregation,chi,isolationEvents:isolation.events,
   ...(detail?{messages:observation.messages,quality:q,D:st.D.map(x=>[...x]),
    E:[...st.E],T:st.T.map(x=>[...x]),z:[...st.z]}:{})});
  st.previousMessages=observation.messages;
 }
 const windowStart=Math.max(0,c.n_steps-c.resilience_window);
 const J=Object.fromEntries(ARTICLE_METHODS.map(m=>[m,
  mean(functionality[m].slice(windowStart).map(chi=>jt(chi,c.resilience_weights)))]));
 const errors=Object.fromEntries(ARTICLE_METHODS.map(m=>[m,mean(attackedRows[m])]));
 const maliciousIsolations=st.isolationEvents.filter(e=>e.malicious&&e.duringAttack);
 const honestIsolations=st.isolationEvents.filter(e=>!e.malicious);
 const isolationTimes=maliciousIsolations.map(e=>e.attackTick);
 const correctFraction=mean(trace.map(r=>r.choice.correct?1:0));
 const operatorFraction=mean(trace.map(r=>r.choice.action==="operator"?1:0));
 return {runIndex,attacked,trace:detail?trace:trace.map(({step,attackActive,trustMedian,live,admitted,choice,methods,chi,isolationEvents})=>
   ({step,attackActive,trustMedian,live,admitted,choice,methods,chi,isolationEvents})),
  metrics:{J,errors,isolatedMalicious:maliciousIsolations.length,
   isolationFraction:c.n_byzantine?maliciousIsolations.length/c.n_byzantine:1,
   isolationTimes,meanIsolationTime:mean(isolationTimes),
   falseIsolations:honestIsolations.length,operatorFraction,correctFraction,
   unsafeActions:trace.filter(r=>!r.choice.safe).length,
   trimFallbacks:Object.fromEntries(ARTICLE_METHODS.map(m=>[m,trace.filter(r=>r.methods[m].trimFallback).length])),
   events:st.isolationEvents}};
}
/** One deterministic paired independent run for worker / checkpoint sharding. */
export function runArticleTask(raw,runIndex=0,includeTrace=false){
 const c=validateArticleConfig(raw);
 const clean=runArticle(c,runIndex,false,false);
 const attack=runArticle(c,runIndex,true,includeTrace);
 const ratios=Object.fromEntries(ARTICLE_METHODS.map(m=>{
  const Ja=attack.metrics.J[m],J0=clean.metrics.J[m];
  return [m,{Ja,J0,psi:J0>0?Ja/J0:null,violates:Ja>J0}];
 }));
 return {runIndex,rows:ARTICLE_METHODS.map(method=>({run:runIndex,method,
  error:attack.metrics.errors[method],psi:ratios[method].psi,
  Ja:ratios[method].Ja,J0:ratios[method].J0,
  isolationFraction:attack.metrics.isolationFraction,
  meanIsolationTime:attack.metrics.meanIsolationTime,
  falseIsolations:attack.metrics.falseIsolations,
  operatorFraction:attack.metrics.operatorFraction,correctFraction:attack.metrics.correctFraction,
  unsafeActions:attack.metrics.unsafeActions,
  trimFallbacks:attack.metrics.trimFallbacks[method]})),
  events:attack.metrics.events,
  trace:includeTrace?attack.trace:null,
  reference:c.reference_vector};
}
const quantile=(xs,p)=>{if(!xs.length)return null;const a=[...xs].sort((x,y)=>x-y),v=(a.length-1)*p,k=Math.floor(v);return a[k]+(a[Math.min(k+1,a.length-1)]-a[k])*(v-k);};
const valid=xs=>xs.filter(x=>x!==null&&Number.isFinite(x));
function interval(xs,c,key){
 const a=valid(xs);if(a.length<2)return [a[0]??null,a[0]??null];
 const random=rng(c.seed,"bootstrap",key),bootstrap=[];
 for(let i=0;i<c.bootstrap_samples;i++){let s=0;for(let j=0;j<a.length;j++)s+=a[random.integer(a.length)];bootstrap.push(s/a.length);}
 return [quantile(bootstrap,.025),quantile(bootstrap,.975)];
}
/** Publication-style table summaries; all observations indexed by identical run IDs. */
export function summarizeArticleTasks(raw,tasks){
 const c=validateArticleConfig(raw),runs=[...tasks].sort((a,b)=>a.runIndex-b.runIndex);
 const rows=[];
 for(const method of ARTICLE_METHODS){
  const sample=runs.flatMap(run=>run.rows.filter(r=>r.method===method));
  const errors=valid(sample.map(r=>r.error)),psis=valid(sample.map(r=>r.psi));
  const ci=interval(psis,c,method);
  const times=valid(sample.map(r=>r.meanIsolationTime));
  rows.push({method,runs:sample.length,meanError:mean(errors),sdError:stdev(errors),
   meanPsi:mean(psis),psiCI95Low:ci[0],psiCI95High:ci[1],
   psiPassRate:psis.length?psis.filter(x=>x>=c.psi_min).length/psis.length:null,
   psiAboveOne:psis.filter(x=>x>1+1e-12).length,
   isolationFraction:mean(sample.map(r=>r.isolationFraction)),
   meanIsolationTime:mean(times),isolationTimeP95:quantile(times,.95),
   falseIsolations:mean(sample.map(r=>r.falseIsolations)),
   operatorFraction:mean(sample.map(r=>r.operatorFraction)),
   correctFraction:mean(sample.map(r=>r.correctFraction)),
   unsafeActions:sample.reduce((s,r)=>s+r.unsafeActions,0),
   trimFallbacks:sample.reduce((s,r)=>s+r.trimFallbacks,0)});
 }
 const trace=runs.find(r=>r.trace)?.trace||null;
 const trajectory=trace?.map(t=>({step:t.step,trustMedian:t.trustMedian,
   ...Object.fromEntries(ARTICLE_METHODS.map(m=>[m,t.methods[m].error]))}))||[];
 return {modelVersion:ARTICLE_MODEL_VERSION,config:c,rows,trace,trajectory,
  completed_runs:runs.length,requested_runs:c.n_runs,
  metricPassport:{tickIndexing:"t=0..T-1",attackRule:"t >= attack_start_step",
   isolationTime:"isolation_step-attack_start_step+1",
   error:"mean Euclidean norm after attack_start_step, then sample mean/sd across runs",
   resilience:"paired J_attack/J_clean over last resilience_window steps",
   reproducibility:"keyed xorshift32/Box-Muller by seed, run, subsystem, tick, agent",
   limitations:"Synthetic quality and utilities are explicit assumptions, not empirical calibration."}};
}
