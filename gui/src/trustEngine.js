import {pairedDifference95,pairedSignFlipP,holmAdjusted} from "./statistics2027.js";
import {auditFactorialDesign,estimateFactorialContrasts,FACTORIAL_AUDIT_VERSION} from "./factorialAudit.js";
import {METRIC_PASSPORT_VERSION,passportForStudy,auditResultMetrics} from "./metricPassport.js";
/**
 * IMAS_LaB_test — browser-only JavaScript port of experiment.py.
 *
 * The definitions of agents, network transport, discounted Beta evidence,
 * regularized EigenTrust, coordinate-wise trimmed aggregation and statistics
 * follow the source Python implementation. Random generators differ:
 * NumPy SeedSequence/PCG64 is replaced with deterministic xorshift32+Box-Muller.
 * Hence statistical and structural equivalence is tested, not bitwise parity.
 *
 * No network calls and no server resources are used by this module.
 */
export const METHODS=["arithmetic_mean","trust_weighted_mean","proposed_robust"];
export const SCENARIOS=["static_bias","subtle_bias","on_off","collusion"];
export const DEFAULTS={
 seed:20260716,n_agents:50,n_byzantine:10,n_sybil_agents:0,sybil_activation_step:20,
 n_steps:200,n_runs:100,n_sensitivity_runs:20,factorial_runs_per_point:6,
 factorial_max_points:64,bootstrap_samples:1000,parallel_workers:0,
 desired_action:.6,attack_start_step:20,attack_direction:-1,
 honest_quality:.92,byzantine_quality:.1,honest_noise_sigma:.2,observer_noise_sigma:.02,
 static_bias:4,subtle_bias:.65,collusion_bias:1.5,on_off_period:10,on_off_attack_steps:4,
 trust_window_steps:20,forgetting_factor:.95,initial_trust:.5,trust_prior_strength:2,
 minimum_weight:.05,reputation_damping:.85,isolation_enabled:true,isolation_threshold:.25,isolation_patience:3,
 minimum_evidence_steps:8,isolation_cooldown_steps:30,trim_each_side:10,
 clip_radius:1.25,safe_action_min:-2,safe_action_max:2,correctness_tolerance:.5,
 paired_exogenous_events:false,network_enabled:false,network_topology:"complete",network_edge_probability:.25,
 small_world_neighbors:4,small_world_rewire_probability:.1,
 message_loss_probability:0,message_delay_min_steps:0,message_delay_max_steps:0,
 max_message_staleness_steps:5,bandwidth_messages_per_step:100000,
 partition_enabled:false,partition_start_step:70,partition_end_step:110,partition_fraction:.5,
  record_source_events:false,source_event_limit:50000
};
const clamp=(x,a,b)=>Math.min(b,Math.max(a,x));
const sum=a=>a.reduce((p,x)=>p+x,0);
const mean=a=>a.length?sum(a)/a.length:NaN;
const variance=a=>a.length>1?a.reduce((v,x)=>v+(x-mean(a))**2,0)/(a.length-1):0;
const stdev=a=>Math.sqrt(variance(a));
const good=x=>Number.isFinite(x);
const valid=a=>a.filter(good);
const sorted=a=>a.filter(good).sort((a,b)=>a-b);
const median=a=>quantile(a,.5);
export function quantile(a,q){const v=sorted(a);if(!v.length)return NaN;const p=(v.length-1)*q,i=Math.floor(p);return v[i]+(v[Math.min(i+1,v.length-1)]-v[i])*(p-i);}
const rngSeed=(...parts)=>{let h=0x9e3779b9;for(const part of parts){let v=Number(part)|0;h=Math.imul(h^(v+0x9e3779b9),0x85ebca6b);h^=h>>>13;h=Math.imul(h,0xc2b2ae35);h^=h>>>16;}return h||1;};
export function createRng(...parts){let s=rngSeed(...parts),spare=null;const random=()=>{s^=s<<13;s^=s>>>17;s^=s<<5;return(s>>>0)/4294967296;};
const normal=()=>{if(spare!==null){const v=spare;spare=null;return v;}const r=Math.sqrt(-2*Math.log(Math.max(random(),1e-12))),t=2*Math.PI*random();spare=r*Math.sin(t);return r*Math.cos(t);};
const integer=(a,b)=>a+Math.floor(random()*(b-a+1));const shuffle=a=>{const b=[...a];for(let i=b.length-1;i>0;i--){const j=integer(0,i);[b[i],b[j]]=[b[j],b[i]];}return b;};
return{random,normal,integer,shuffle,choice:(a,n)=>shuffle(a).slice(0,n)};}
const EXOGENOUS_STAGES=Object.freeze({proposal:1101,transport:2202,observation:3303,evidenceLoss:4404,evidencePriority:5505});
/**
 * Counter-keyed reproducible exogenous events (not a mutable shared RNG).
 * Identical (seed, run, stage, step, observer, target) addresses yield identical
 * independent random streams irrespective of agent activity or isolation.
 * The stochastic graph/initial Byzantine identity is seeded separately but
 * identically for all ablation arms with the same run index.
 */
export function exogenousEventRng(seed,run,stage,step,source=0,target=0){
 if(!Object.hasOwn(EXOGENOUS_STAGES,stage))throw Error("Неизвестная стадия экзогенного события");
 return createRng(seed,run,EXOGENOUS_STAGES[stage],step,source,target);
}
export const EXOGENOUS_EVENT_STAGES=Object.keys(EXOGENOUS_STAGES);
export const TRUST_MODEL_VERSION="trust-js-2.9.0-remediation";
const integerRanges={
 seed:[-2147483648,2147483647],n_agents:[3,160],n_byzantine:[0,159],n_sybil_agents:[0,160],
 sybil_activation_step:[1,500],n_steps:[1,500],n_runs:[1,500],n_sensitivity_runs:[1,100],
 factorial_runs_per_point:[1,50],factorial_max_points:[32,64],bootstrap_samples:[100,10000],parallel_workers:[0,32],
 attack_start_step:[1,500],on_off_period:[1,500],on_off_attack_steps:[1,500],trust_window_steps:[2,100],
 isolation_patience:[1,100],minimum_evidence_steps:[1,500],isolation_cooldown_steps:[0,500],trim_each_side:[0,159],
 small_world_neighbors:[2,160],message_delay_min_steps:[0,500],message_delay_max_steps:[0,500],
 max_message_staleness_steps:[0,500],bandwidth_messages_per_step:[0,1000000],partition_start_step:[1,500],partition_end_step:[1,500],source_event_limit:[1,250000]
};
const numericRanges={
 desired_action:[-2,2],honest_quality:[0,1],byzantine_quality:[0,1],honest_noise_sigma:[0,10],
 observer_noise_sigma:[0,10],static_bias:[0,100],subtle_bias:[0,100],collusion_bias:[0,100],
 forgetting_factor:[0,1],initial_trust:[0,1],trust_prior_strength:[0,1000000],minimum_weight:[0,1],
 reputation_damping:[0,1],isolation_threshold:[0,1],clip_radius:[0,100],
 safe_action_min:[-100,100],safe_action_max:[-100,100],correctness_tolerance:[0,100],
 network_edge_probability:[0,1],small_world_rewire_probability:[0,1],message_loss_probability:[0,1],
 partition_fraction:[0,1],attack_direction:[-1,1]
};
const requireField=(ok,k,message)=>{if(!ok)throw Error("Параметр "+k+": "+message);};
export function validateConfig(value={}){
 requireField(value!==null&&typeof value==="object"&&!Array.isArray(value),"config","ожидается объект");
 const c={...DEFAULTS,...value};
 for(const [k,defaultValue] of Object.entries(DEFAULTS)){
  const v=c[k];
  const ok=typeof defaultValue==="number"?typeof v==="number"&&Number.isFinite(v):typeof v===typeof defaultValue;
  requireField(ok,k,"недопустимый тип или нечисловое значение");
 }
 for(const [k,[lo,hi]] of Object.entries(integerRanges)){
  requireField(Number.isInteger(c[k]),k,"требуется целое число");
  requireField(c[k]>=lo&&c[k]<=hi,k,"допустимо ["+lo+"; "+hi+"]");
 }
 for(const [k,[lo,hi]] of Object.entries(numericRanges))
  requireField(c[k]>=lo&&c[k]<=hi,k,"допустимо ["+lo+"; "+hi+"]");
 requireField(c.n_byzantine<c.n_agents/2,"n_byzantine","необходимо N>2f");
 requireField(c.n_agents+c.n_sybil_agents<=160,"n_sybil_agents","число агентов не более 160");
 requireField(c.attack_start_step<=c.n_steps,"attack_start_step","превышает горизонт T");
 if(c.n_sybil_agents)requireField(c.sybil_activation_step<=c.n_steps,"sybil_activation_step","превышает горизонт T");
 requireField(c.safe_action_min<c.safe_action_max,"safe_action_min","минимум должен быть ниже максимума");
 requireField(c.initial_trust>0&&c.initial_trust<1,"initial_trust","необходимо 0<w0<1");
 requireField(c.forgetting_factor>0,"forgetting_factor","необходимо 0<λ≤1");
 requireField(c.reputation_damping<1,"reputation_damping","коэффициент должен быть меньше 1");
 requireField(c.trust_prior_strength>0,"trust_prior_strength","сила prior должна быть положительной");
 requireField(c.clip_radius>0,"clip_radius","радиус должен быть положительным");
 requireField(c.on_off_attack_steps<=c.on_off_period,"on_off_attack_steps","не превышать период");
 requireField(c.factorial_max_points===32||c.factorial_max_points===64,"factorial_max_points","допустим только полный план 64 или регулярный полуплан 32");
 requireField(c.trim_each_side<=Math.floor((c.n_agents-1)/2),"trim_each_side","нельзя удалить все наблюдения");
 requireField(c.message_delay_max_steps>=c.message_delay_min_steps,"message_delay_max_steps","меньше минимальной задержки");
 requireField(c.attack_direction===-1||c.attack_direction===1,"attack_direction","допустимы -1 или 1");
 requireField(["complete","ring","random","small_world"].includes(c.network_topology),"network_topology","неизвестная топология");
 if(c.network_enabled&&c.network_topology==="small_world")
  requireField(c.small_world_neighbors<c.n_agents+c.n_sybil_agents,"small_world_neighbors","недопустимое число соседей");
 if(c.partition_enabled){
  requireField(c.partition_start_step<=c.partition_end_step,"partition_start_step","начало позже конца");
  requireField(c.partition_end_step<=c.n_steps,"partition_end_step","превышает горизонт T");
  requireField(c.partition_fraction>0&&c.partition_fraction<1,"partition_fraction","необходимо 0<доля<1");
 }
 return c;
}
const all=(n)=>Array.from({length:n},(_,i)=>i);
const makeMat=(n,value=0)=>Array.from({length:n},()=>Array(n).fill(value));
export function buildAdjacency(c,r,byzantine){
 const n=c.n_agents+c.n_sybil_agents,a=makeMat(n,false);
 if(!c.network_enabled||c.network_topology==="complete"){for(let i=0;i<n;i++)for(let j=0;j<n;j++)a[i][j]=i!==j;return a;}
 const link=(i,j)=>{if(i!==j){a[i][j]=true;a[j][i]=true;}};
 if(c.network_topology==="ring")for(let i=0;i<n;i++)link(i,(i+1)%n);
 if(c.network_topology==="random"){for(let i=0;i<n;i++)for(let j=i+1;j<n;j++)if(r.random()<c.network_edge_probability)link(i,j);}
 if(c.network_topology==="small_world"){
  const half=Math.max(1,Math.floor(Math.min(c.small_world_neighbors,n-1)/2));
  for(let i=0;i<n;i++)for(let k=1;k<=half;k++)link(i,(i+k)%n);
  for(let i=0;i<n;i++)for(let k=1;k<=half;k++){const j=(i+k)%n;if(r.random()>=c.small_world_rewire_probability)continue;
    const choices=all(n).filter(x=>x!==i&&x!==j&&!a[i][x]);if(!choices.length)continue;const target=choices[r.integer(0,choices.length-1)];
    a[i][j]=a[j][i]=false;link(i,target);
  }
 }
 if(c.n_sybil_agents)for(let i=c.n_agents;i<n;i++){
   for(let j=c.n_agents;j<n;j++)if(i!==j)link(i,j);
   for(let j=0;j<Math.min(c.n_agents,c.n_byzantine+2);j++)link(i,j);
 }
 return a;
}
function components(adj,active,groups,partition){
 const n=active.length,labels=Array(n).fill(-1),comps=[];
 const connected=(i,j)=>adj[i][j]&&(!partition||groups[i]===groups[j])&&active[i]&&active[j];
 for(let i=0;i<n;i++)if(active[i]&&labels[i]<0){
   const q=[i],members=[];labels[i]=comps.length;
   for(let qi=0;qi<q.length;qi++){const x=q[qi];members.push(x);
     for(let j=0;j<n;j++)if(connected(x,j)&&labels[j]<0){labels[j]=labels[i];q.push(j);}
   }
   comps.push(members);
 }
 return {comps,labels};
}
export function betaTrust(history,c,n){
 const p=c.initial_trust*c.trust_prior_strength,q=(1-c.initial_trust)*c.trust_prior_strength,alpha=makeMat(n,p),beta=makeMat(n,q);
 for(let age=0;age<history.length;age++){const e=history[history.length-1-age],w=c.forgetting_factor**age;
  for(let i=0;i<n;i++)for(let j=0;j<n;j++)if(good(e[i][j])){alpha[i][j]+=w*e[i][j];beta[i][j]+=w*(1-e[i][j]);}}
 return alpha.map((row,i)=>row.map((x,j)=>x/(x+beta[i][j])));
}
export function eigenTrust(direct,active,damping){
 const n=active.length,idx=all(n).filter(i=>active[i]),scores=Array(n).fill(0);
 if(!idx.length)return scores;
 const size=idx.length,c=idx.map(i=>idx.map(j=>Math.max(0,direct[i][j]-.5)));
 for(const row of c){const total=sum(row);for(let j=0;j<size;j++)row[j]=total>1e-15?row[j]/total:1/size;}
 let v=Array(size).fill(1/size);
 for(let it=0;it<150;it++){
  const next=Array(size).fill((1-damping)/size);
  for(let i=0;i<size;i++)for(let j=0;j<size;j++)next[j]+=damping*c[i][j]*v[i];
  const err=sum(next.map((x,i)=>Math.abs(x-v[i])));v=next;if(err<1e-10)break;
 }
 const scale=Math.max(...v,1e-15);idx.forEach((i,j)=>scores[i]=v[j]/scale);return scores;
}
export function trimmedWeightedMean(values,weights,k){
 if(!values.length)throw Error("Не заданы значения для агрегирования");
 const order=all(values.length).sort((i,j)=>values[i]-values[j]||i-j);k=Math.min(k,Math.floor((order.length-1)/2));
 const keep=order.slice(k,order.length-k),w=keep.map(i=>Math.max(weights[i],0)),total=sum(w);
 return total<=1e-15?mean(keep.map(i=>values[i])):sum(keep.map((i,j)=>values[i]*w[j]))/total;
}
function aggregate(proposals,reputation,available,c,last){
 const idx=all(proposals.length).filter(i=>available[i]&&good(proposals[i]));
 if(!idx.length)return Object.fromEntries(METHODS.map(method=>[method,null]));
 const v=idx.map(i=>proposals[i]),w=idx.map(i=>Math.max(reputation[i],c.minimum_weight)),arithmetic=mean(v);
 const weighted=sum(v.map((x,i)=>x*w[i]))/sum(w),center=median(v),cv=v.map(x=>clamp(x,center-c.clip_radius,center+c.clip_radius));
 return {arithmetic_mean:arithmetic,trust_weighted_mean:weighted,proposed_robust:clamp(trimmedWeightedMean(cv,w,c.trim_each_side),c.safe_action_min,c.safe_action_max)};
}
const activeAttack=(t,scenario,c)=>t+1>=c.attack_start_step&&(scenario!=="on_off"||((t+1-c.attack_start_step)%Math.max(1,c.on_off_period))<c.on_off_attack_steps);
function samples(t,scenario,c,bad,sybil,r){
 const n=bad.length,x=all(n).map(()=>c.desired_action+c.honest_noise_sigma*r.normal());if(!activeAttack(t,scenario,c))return x;
 const b=all(n).filter(i=>bad[i]),v=c.desired_action;
 if(scenario==="collusion"){const common=v+c.attack_direction*c.collusion_bias+.02*r.normal();for(const i of b)x[i]=common+.01*r.normal();}
 else {const bias=scenario==="subtle_bias"?c.subtle_bias:c.static_bias;for(const i of b)x[i]=v+c.attack_direction*bias+.05*r.normal();}
 if(c.n_sybil_agents){const common=v+c.attack_direction*c.collusion_bias+.005*r.normal();for(let i=c.n_agents;i<n;i++)x[i]=common+.002*r.normal();}
 return x;
}
export function observations(t,scenario,c,bad,active,labels,r,budget,runIndex=0,record=null){
 const n=bad.length,attack=activeAttack(t,scenario,c),e=makeMat(n,NaN);
 for(let i=0;i<n;i++)for(let j=0;j<n;j++){
  // Exclude inactive, isolated and not-yet-activated identities, even offline.
  if(!active[i]||!active[j])continue;
  const quality=attack&&bad[j]?c.byzantine_quality:c.honest_quality;
  const eventRng=c.paired_exogenous_events?exogenousEventRng(c.seed,runIndex,"observation",t,i,j):r;
  let v=attack&&bad[i]?(bad[j]?.98:.02):clamp((eventRng.random()<quality?1:0)+eventRng.normal()*c.observer_noise_sigma,0,1);
  if(i===j)v=c.honest_quality;
  e[i][j]=v;
 }
 if(!c.network_enabled)return{matrix:e,stats:{attempted:active.filter(Boolean).length**2,delivered:active.filter(Boolean).length**2,lost:0,bandwidth_dropped:0}};
 let attempted=0,lost=0,dropped=0,delivered=0;
 const candidates=[];
 for(let i=0;i<n;i++)for(let j=0;j<n;j++){
  if(!(active[i]&&active[j]&&labels[i]>=0&&labels[i]===labels[j])){e[i][j]=NaN;continue;}
  attempted++;
  const lossRng=c.paired_exogenous_events?exogenousEventRng(c.seed,runIndex,"evidenceLoss",t,i,j):r;
  if(i!==j&&lossRng.random()<c.message_loss_probability){e[i][j]=NaN;lost++;}else candidates.push([i,j]);
 }
 let keep=candidates;
 if(candidates.length>budget){
  if(c.paired_exogenous_events){
   // Per-edge priorities are fixed even if other candidates vanish after isolation.
   const ranked=candidates.map(([i,j])=>({id:i*n+j,rank:exogenousEventRng(c.seed,runIndex,"evidencePriority",t,i,j).random()}))
    .sort((a,b)=>a.rank-b.rank||a.id-b.id);
   const selected=new Set(ranked.slice(0,Math.max(0,budget)).map(x=>x.id));
   keep=candidates.filter(([i,j])=>selected.has(i*n+j));
  }else{
   const selected=new Set(r.choice(all(candidates.length),Math.max(0,budget)));
   keep=candidates.filter((x,i)=>selected.has(i));
  }
  dropped=candidates.length-keep.length;
 }
 const allowed=new Set(keep.map(([i,j])=>i*n+j));for(let i=0;i<n;i++)for(let j=0;j<n;j++)if(!allowed.has(i*n+j))e[i][j]=NaN;
 delivered=keep.length;
 return{matrix:e,stats:{attempted,delivered,lost,bandwidth_dropped:dropped}};
}
export function transport(t,proposals,active,comps,queue,lastValues,lastSteps,c,r,runIndex=0,record=null){
 const n=active.length;if(!c.network_enabled)return{values:[...proposals],available:[...active],budget:c.bandwidth_messages_per_step,stats:{attempted:active.filter(Boolean).length,delivered:active.filter(Boolean).length,lost:0,bandwidth_dropped:0,expired:0,backlogged:0,component_size:active.filter(Boolean).length,queued:0,mean_delay:0}};
 const largest=[...comps].sort((a,b)=>b.length-a.length||a[0]-b[0])[0]||[],set=new Set(largest);
 let lost=0;
 for(const i of largest){
  const eventRng=c.paired_exogenous_events?exogenousEventRng(c.seed,runIndex,"transport",t,i):r;
  if(eventRng.random()<c.message_loss_probability){lost++;continue;}
  const delay=eventRng.integer(c.message_delay_min_steps,c.message_delay_max_steps);
  queue.push({due:t+delay,sent:t,source:i,value:proposals[i],delay});
 }
 queue.sort((a,b)=>a.due-b.due);
 let budget=c.bandwidth_messages_per_step,delivered=0,expired=0;const delayList=[],retain=[];
 for(const q of queue){
  // A queued message is not dropped simply because bandwidth is exhausted.
  // Expiration is measured from its original production tick, not delivery tick.
  if(t-q.sent>c.max_message_staleness_steps){expired++;continue;}
  if(q.due<=t&&budget>0){
   lastValues[q.source]=q.value;lastSteps[q.source]=q.sent;budget--;delivered++;delayList.push(t-q.sent);
  }else retain.push(q);
 }
 queue.splice(0,queue.length,...retain);
 const backlogged=queue.filter(q=>q.due<=t).length;
 return{values:[...lastValues],available:all(n).map(i=>set.has(i)&&good(lastValues[i])&&t-lastSteps[i]<=c.max_message_staleness_steps),
 budget,stats:{attempted:largest.length,delivered,lost,expired,backlogged,
 bandwidth_dropped:0,component_size:largest.length,queued:queue.length,mean_delay:delayList.length?mean(delayList):0}};
}
/** Optional complete, deterministic, single-trace source-event journal. */
export function makeSourceEventRecorder(limit){
 if(!Number.isInteger(limit)||limit<1||limit>250000)throw Error("Invalid source-event record limit");
 const events=[];
 const record=event=>{
  if(events.length>=limit)throw Error("Лимит журнала исходных событий ("+limit+") исчерпан; результат не публикуется и не усекaется");
  events.push(event);
 };
 return {events,record,limit};
}
/** Reconstruct communications independently from recorded attempts and outcomes. */
export function auditSourceEventJournal(events,ledger){
 if(!Array.isArray(events)||!Array.isArray(ledger)||!ledger.length)throw Error("Source-event journal or ledger missing");
 const count=(kind,status)=>events.filter(e=>e.kind===kind&&(!status||e.status===status)).length;
 const pLost=count("proposal_attempt","lost"),pAccepted=count("proposal_attempt","queued"),
  pDelivered=count("proposal_final","delivered"),pExpired=count("proposal_final","expired");
 const eDelivered=count("evidence","delivered"),eLost=count("evidence","lost"),
  eDropped=count("evidence","dropped");
 const final=ledger.at(-1),p=final.proposal,e=final.evidence;
 const issues=[];
 const expect=(ok,k)=>{if(!ok)issues.push(k);};
 expect(p.attempted===pLost+pAccepted,"proposal_attempts");
 expect(p.delivered===pDelivered&&p.lost===pLost&&p.expired===pExpired,"proposal_outcomes");
 expect(p.pending===pAccepted-pDelivered-pExpired,"proposal_pending");
 expect(e.attempted===eDelivered+eLost+eDropped,"evidence_attempts");
 expect(e.delivered===eDelivered&&e.lost===eLost&&e.bandwidth_dropped===eDropped,"evidence_outcomes");
 expect(final.total.balance===0,"total_balance");
 return {valid:issues.length===0,issues,counts:{proposalLost:pLost,proposalAccepted:pAccepted,
  proposalDelivered:pDelivered,proposalExpired:pExpired,evidenceDelivered:eDelivered,
  evidenceLost:eLost,evidenceDropped:eDropped}};
}
const COMMUNICATION_COUNT_FIELDS=["attempted","delivered","lost","bandwidth_dropped","expired"];
/**
 * Verify independent per-channel conservation at each tick. A queued proposal
 * remains in the stock, while evidence has no queue; stale proposals are counted
 * as expired only when actually removed from that stock.
 */
export function accountCommunicationStep(previous,transportStats,evidenceStats,pendingProposals,step){
 const channel=(name,old,stats,pending)=>{
  if(!Number.isInteger(pending)||pending<0)throw Error("Communication "+name+": invalid pending at tick "+step);
  const cumulative={};
  for(const field of COMMUNICATION_COUNT_FIELDS){
   const increment=stats[field]??0,prior=old?.[field]??0;
   if(!Number.isSafeInteger(increment)||increment<0||!Number.isSafeInteger(prior)||prior<0)
    throw Error("Communication "+name+": invalid "+field+" at tick "+step);
   cumulative[field]=prior+increment;
  }
  const balance=cumulative.attempted-cumulative.delivered-cumulative.lost-
   cumulative.bandwidth_dropped-cumulative.expired-pending;
  if(balance!==0)throw Error("Communication "+name+": message conservation failed at tick "+step+" (balance "+balance+")");
  return {...cumulative,pending,balance};
 };
 const proposal=channel("proposal",previous?.proposal,transportStats,pendingProposals);
 const evidence=channel("evidence",previous?.evidence,evidenceStats,0);
 const total=Object.fromEntries([...COMMUNICATION_COUNT_FIELDS,"pending"].map(field=>[field,proposal[field]+evidence[field]]));
 total.balance=proposal.balance+evidence.balance;
 return {step,proposal,evidence,total};
}
const finiteMean=a=>mean(valid(a));
function configDetail(c){return {...c,modelVersion:TRUST_MODEL_VERSION,
 effective_agent_count:c.n_agents+c.n_sybil_agents,
 effective_byzantine_count:c.n_byzantine+c.n_sybil_agents,
 topology_semantics:c.network_enabled&&c.n_sybil_agents>0&&c.network_topology!=="complete"?
  "base_"+c.network_topology+"+forced_sybil_clique_and_index_anchors":
  c.network_enabled?c.network_topology:"complete_without_transport_constraints"};}
export function simulateRun(rawConfig={},scenario="collusion",runIndex=0,scenarioIndex=0,detail=false){
 const c=validateConfig(rawConfig),startWall=performance.now(),n=c.n_agents+c.n_sybil_agents,r=createRng(c.seed,scenarioIndex,runIndex);
 const sybil=all(n).map(i=>i>=c.n_agents),bad=sybil.slice(),badIds=r.choice(all(c.n_agents),c.n_byzantine);badIds.forEach(i=>bad[i]=true);
 const a=buildAdjacency(c,r,bad),groups=Array(n).fill(0);
 r.choice(all(n),clamp(Math.round(n*c.partition_fraction),1,n-1)).forEach(i=>groups[i]=1);
 let active=all(n).map(i=>!sybil[i]),low=Array(n).fill(0),isolatedAt=Array(n).fill(null),until=Array(n).fill(-1);
 const firstAttackIsolationAt=Array(n).fill(null);
 const hist=[],queue=[],lastValues=Array(n).fill(NaN),lastSteps=Array(n).fill(-1e9);
 let previous=Object.fromEntries(METHODS.map(m=>[m,null]));
 const errors=Object.fromEntries(METHODS.map(m=>[m,[]])),signed=Object.fromEntries(METHODS.map(m=>[m,[]])),correct=Object.fromEntries(METHODS.map(m=>[m,[]])),consensus=Object.fromEntries(METHODS.map(m=>[m,[]])),cover=Object.fromEntries(METHODS.map(m=>[m,[]])),availableDecision=Object.fromEntries(METHODS.map(m=>[m,[]]));
 let attempted=0,delivered=0,lost=0,dropped=0,expired=0,queued=0;
 let communicationState=null;const messageLedger=[];
 const series=[],network_series=[],reputationHistory=[],states=[],events=[];
 const sourceJournal=detail&&c.record_source_events?makeSourceEventRecorder(c.source_event_limit):null;
 const record=sourceJournal?.record||null;
 let aggregateBundleWallMs=0,trustWallMs=0,transportWallMs=0;
 for(let t=0;t<c.n_steps;t++){
  const eligible=all(n).map(i=>!sybil[i]||t+1>=c.sybil_activation_step);
  for(let i=0;i<n;i++){if(!active[i]&&eligible[i]&&(sybil[i]&&until[i]<0||until[i]>=0&&until[i]<t)){active[i]=true;low[i]=0;}}
  const running=active.map((x,i)=>x&&eligible[i]),partition=Boolean(c.network_enabled&&c.partition_enabled&&t+1>=c.partition_start_step&&t+1<=c.partition_end_step);
  const {comps,labels}=components(a,running,groups,partition);
  const proposalsRng=c.paired_exogenous_events?exogenousEventRng(c.seed,runIndex,"proposal",t):r;
  const proposed=samples(t,scenario,c,bad,sybil,proposalsRng),trustT0=performance.now(),direct=betaTrust(hist,c,n),scores=Array(n).fill(c.initial_trust);
   if(record)for(let i=0;i<n;i++)record({kind:"proposal_generated",step:t+1,source:i+1,value:proposed[i],
    active:running[i],byzantine:bad[i],sybil:sybil[i]});
  for(const comp of comps)for(const j of comp)scores[j]=median(comp.map(i=>direct[i][j]));
  const eigen=eigenTrust(direct,running,c.reputation_damping),rep=scores.map((s,i)=>.7*s+.3*eigen[i]);trustWallMs+=performance.now()-trustT0;
  const transportT0=performance.now();
  const tx=transport(t,proposed,running,comps,queue,lastValues,lastSteps,c,r,runIndex,record);
  transportWallMs+=performance.now()-transportT0;
  const aggregateT0=performance.now();
  const decisions=aggregate(tx.values,rep,tx.available,c,previous);
  aggregateBundleWallMs+=performance.now()-aggregateT0;previous=decisions;
  const honest=all(n).filter(i=>tx.available[i]&&!bad[i]),reference=honest.length?median(honest.map(i=>tx.values[i])):null;
  const half=honest.length?1.96*c.honest_noise_sigma/Math.sqrt(honest.length):null;
  for(const m of METHODS){
    const accepted=good(decisions[m]);availableDecision[m].push(accepted?1:0);
    if(!accepted){correct[m].push(0);continue;}
    const e=decisions[m]-c.desired_action;
    errors[m].push(Math.abs(e));signed[m].push(e);
    correct[m].push(Math.abs(e)<=c.correctness_tolerance?1:0);
    if(good(reference))consensus[m].push(Math.abs(decisions[m]-reference));
    if(good(half))cover[m].push(Math.abs(e)<=half?1:0);
  }
  const evidenceT0=performance.now();
  const evidence=observations(t,scenario,c,bad,running,labels,r,tx.budget,runIndex,record);
  hist.push(evidence.matrix);if(hist.length>c.trust_window_steps)hist.shift();
  attempted+=tx.stats.attempted+evidence.stats.attempted;delivered+=tx.stats.delivered+evidence.stats.delivered;lost+=tx.stats.lost+evidence.stats.lost;dropped+=tx.stats.bandwidth_dropped+evidence.stats.bandwidth_dropped;expired+=tx.stats.expired;queued=tx.stats.queued;
   communicationState=accountCommunicationStep(communicationState,tx.stats,evidence.stats,queue.length,t+1);
   if(queued!==queue.length||communicationState.total.attempted!==attempted||
     communicationState.total.delivered!==delivered||communicationState.total.lost!==lost||
     communicationState.total.bandwidth_dropped!==dropped||
     communicationState.total.expired!==expired||communicationState.total.pending!==queued)
    throw Error("Communication: disagreement between transport counters and channel ledger at tick "+(t+1));
   if(detail)messageLedger.push(communicationState);
  const updated=betaTrust(hist,c,n),newScores=Array(n).fill(c.initial_trust);
  for(const comp of comps)for(const j of comp)newScores[j]=median(comp.map(i=>updated[i][j]));
  trustWallMs+=performance.now()-evidenceT0;
  if(c.isolation_enabled&&t+1>=c.minimum_evidence_steps){
   for(let i=0;i<n;i++){
    low[i]=running[i]&&newScores[i]<c.isolation_threshold?low[i]+1:0;
    if(running[i]&&low[i]>=c.isolation_patience){
     if(isolatedAt[i]===null)isolatedAt[i]=t+1;
     const postAttack=t+1>=c.attack_start_step;
     if(bad[i]&&postAttack&&firstAttackIsolationAt[i]===null)firstAttackIsolationAt[i]=t+1;
     if(detail)events.push({step:t+1,agent:i+1,type:bad[i]&&postAttack?(sybil[i]?"sybil":"byzantine"):"false_positive",prematureByzantineIsolation:Boolean(bad[i]&&!postAttack),reason:"local_post_evidence_below_threshold",confirmations:low[i],duration:c.isolation_cooldown_steps,reputation:rep[i],isolationScore:newScores[i],threshold:c.isolation_threshold});
     active[i]=false;until[i]=t+c.isolation_cooldown_steps;
    }
   }
  }
  const row={step:t+1,truth:c.desired_action,active_agents:running.filter((x,i)=>x&&active[i]).length,available_agents:tx.available.filter(Boolean).length,isolated_agents:eligible.filter((x,i)=>x&&!active[i]).length,
    largest_component:tx.stats.component_size,messages_delivered:tx.stats.delivered+evidence.stats.delivered,messages_lost:tx.stats.lost+evidence.stats.lost,messages_bandwidth_dropped:tx.stats.bandwidth_dropped+evidence.stats.bandwidth_dropped,messages_expired:tx.stats.expired,messages_backlogged:tx.stats.backlogged,messages_queued:tx.stats.queued,
    partition_active:Number(partition),attack_active:Number(activeAttack(t,scenario,c)),...decisions};
  series.push(row);
  if(detail){
   network_series.push({...row,proposal_queue:tx.stats.queued,mean_message_delay:tx.stats.mean_delay,delivery_ratio:delivered/Math.max(1,attempted),message_balance:communicationState.total.balance,proposal_message_balance:communicationState.proposal.balance,evidence_message_balance:communicationState.evidence.balance});
   for(let i=0;i<n;i++){
    reputationHistory.push({step:t+1,agent:i+1,reputation:rep[i],localTrust:scores[i],eigenReputation:eigen[i],isolationScore:newScores[i],isolationThreshold:c.isolation_threshold,byzantine:bad[i],sybil:sybil[i],active:active[i]});
    states.push({step:t+1,agent:i+1,state:sybil[i]&&!eligible[i]?"dormant":!active[i]?"isolated":sybil[i]?"sybil":bad[i]?"byzantine":"honest"});
   }
  }
 }
 // A pre-attack isolation of a latent Byzantine identity is not attack detection.
 const found=all(n).filter(i=>firstAttackIsolationAt[i]!==null),allBad=bad.filter(Boolean).length;
 const detectionRate=found.length/Math.max(1,allBad);
 const meanTime=found.length?mean(found.map(i=>firstAttackIsolationAt[i]-c.attack_start_step)):null;
 const prematureBad=all(n).filter(i=>bad[i]&&isolatedAt[i]!==null&&isolatedAt[i]<c.attack_start_step).length;
 const fp=all(n).filter(i=>isolatedAt[i]!==null&&!bad[i]).length+prematureBad;
 const preserved=all(n).filter(i=>active[i]&&!bad[i]).length/Math.max(1,bad.filter(x=>!x).length),ratio=delivered/Math.max(1,attempted);
 const rows=METHODS.map(method=>{
   const e=errors[method],sgn=signed[method];
   return{scenario,run:runIndex,method,modelVersion:TRUST_MODEL_VERSION,
      probability_correct:mean(correct[method]),decision_coverage:mean(availableDecision[method]),
      abstention_probability:1-mean(availableDecision[method]),
      accuracy_accepted:e.length?sum(correct[method])/e.length:null,
      mae_to_truth:e.length?mean(e):null,rmse_to_truth:e.length?Math.sqrt(mean(e.map(x=>x*x))):null,
      bias:sgn.length?mean(sgn):null,nominal_band_rate:cover[method].length?mean(cover[method]):null,
      consensus_error:consensus[method].length?mean(consensus[method]):null,
      isolation_enabled:c.isolation_enabled,detection_rate:detectionRate,mean_detection_time_steps:meanTime,mean_detection_delay_steps:meanTime,premature_byzantine_isolations:prematureBad,false_isolations:fp,preserved_functionality:preserved,
      communication_messages:delivered,communication_attempted:attempted,communication_lost:lost,communication_bandwidth_dropped:dropped,communication_expired:expired,communication_queued:queued,
      delivery_ratio:ratio,simulation_wall_ms:performance.now()-startWall,aggregation_bundle_wall_ms:aggregateBundleWallMs,trust_evidence_wall_ms:trustWallMs,transport_wall_ms:transportWallMs,completed_steps:c.n_steps};
 });
 if(!detail)return{rows,trajectory:series};
 const sourceEventLog=sourceJournal?{
    schemaVersion:1,modelVersion:TRUST_MODEL_VERSION,seed:c.seed,runIndex,scenario,
    totalEvents:sourceJournal.events.length,limit:sourceJournal.limit,complete:true,
    rngScheme:c.paired_exogenous_events?"keyed-exogenous-v1":"stateful-xorshift32",
    events:sourceJournal.events,
    audit:auditSourceEventJournal(sourceJournal.events,messageLedger)}:null;
 if(sourceEventLog&&!sourceEventLog.audit.valid)
  throw Error("Сбой проверки журнала исходных событий: "+sourceEventLog.audit.issues.join(", "));
 return{rows,trajectory:series,result:{modelVersion:TRUST_MODEL_VERSION,series,network_series,message_ledger:messageLedger,source_event_log:sourceEventLog,reputation:reputationHistory,states,events,
   metrics:METHODS.map((method,i)=>({method,probability_correct:rows[i].probability_correct,mae:rows[i].mae_to_truth,rmse:rows[i].rmse_to_truth,bias:rows[i].bias,nominal_band_rate:rows[i].nominal_band_rate})),
   agents:all(n).map(i=>({agent:i+1,byzantine:bad[i],sybil:sybil[i],active:active[i],isolated_at:isolatedAt[i],first_attack_isolation_at:firstAttackIsolationAt[i]})),
   summary:{detection_rate:detectionRate,mean_detection_time:meanTime,mean_detection_delay_steps:meanTime,premature_byzantine_isolations:prematureBad,false_isolations:fp,preserved_functionality:preserved,delivery_ratio:ratio,communication_attempted:attempted,communication_delivered:delivered,communication_lost:lost,communication_bandwidth_dropped:dropped,communication_expired:expired,communication_queued:queued,message_balance:communicationState.total.balance,communication_channel_ledger:communicationState,honest_majority_with_sybils:n>2*allBad,completed_steps:c.n_steps},
   configuration:configDetail(c),scenario,run_index:runIndex,partial:false}};
}
const metrics=["probability_correct","mae_to_truth","rmse_to_truth","bias","nominal_band_rate","consensus_error","detection_rate","mean_detection_time_steps","mean_detection_delay_steps","premature_byzantine_isolations","false_isolations","preserved_functionality","communication_messages","communication_attempted","communication_lost","communication_bandwidth_dropped","communication_expired","communication_queued","delivery_ratio","simulation_wall_ms","aggregation_bundle_wall_ms","trust_evidence_wall_ms","transport_wall_ms","completed_steps"];
export function summaryFromRuns(rows){
 const out=[];for(const method of METHODS){const group=rows.filter(x=>x.method===method);if(!group.length)continue;
 const row={scenario:group[0].scenario,method};for(const m of metrics){const v=valid(group.map(x=>x[m]));row[m+"_mean"]=v.length?mean(v):null;row[m+"_std"]=v.length>1?stdev(v):null;row[m+"_ci95"]=v.length>1?1.96*stdev(v)/Math.sqrt(v.length):null;row[m+"_n"]=v.length;}out.push(row);}
 return out;
}
export function trajectoryStats(paths,c){
 if(!paths.length)return [];const length=Math.min(...paths.map(x=>x.length));const out=[];
 for(let t=0;t<length;t++){
  const values=k=>paths.map(x=>x[t][k]),v=values("active_agents");
  const row={step:t+1,truth:c.desired_action,run_count:paths.length,active_agents_mean:mean(v),active_agents_std:stdev(v),available_agents_mean:mean(values("available_agents")),largest_component_mean:mean(values("largest_component")),tolerance_band:[c.desired_action-c.correctness_tolerance,c.desired_action+c.correctness_tolerance]};
  for(const method of METHODS){
   const a=valid(values(method)),mu=a.length?mean(a):null,sd=a.length>1?stdev(a):a.length?0:null;
   const q=p=>a.length?quantile(a,p):null;
   const band=k=>a.length?[mu-k*sd,mu+k*sd]:null;
   Object.assign(row,{[method+"_mean"]:mu,[method+"_std"]:sd,[method+"_available_runs"]:a.length,
     [method+"_band1"]:band(1),[method+"_band2"]:band(2),
     [method+"_q05"]:q(.05),[method+"_q25"]:q(.25),[method+"_median"]:q(.5),
     [method+"_q75"]:q(.75),[method+"_q95"]:q(.95),
     [method+"_band50"]:a.length?[q(.25),q(.75)]:null,
     [method+"_band90"]:a.length?[q(.05),q(.95)]:null});
  }
  out.push(row);
 }return out;
}
export function bootstrapComparisons(rows,c){
 const r=createRng(c.seed,99173),result=[];
 for(const metric of ["rmse_to_truth","mae_to_truth","probability_correct","consensus_error"]){
  for(const baseline of ["arithmetic_mean","trust_weighted_mean"]){
   const byRun=new Map();for(const x of rows){const v=byRun.get(x.run)||{};v[x.method]=x[metric];byRun.set(x.run,v);}
   const differences=[...byRun.values()].filter(v=>good(v.proposed_robust)&&good(v[baseline])).map(v=>v.proposed_robust-v[baseline]);
   if(!differences.length)continue;const sign=["rmse_to_truth","mae_to_truth","consensus_error"].includes(metric)?-1:1,benefit=differences.map(x=>sign*x),boot=[];
   for(let b=0;b<c.bootstrap_samples;b++){let total=0;for(let j=0;j<benefit.length;j++)total+=benefit[r.integer(0,benefit.length-1)];boot.push(total/benefit.length);}
   const lo=quantile(boot,.025),hi=quantile(boot,.975);
   result.push({metric,baseline,proposed:"proposed_robust",n_pairs:differences.length,raw_difference_mean:mean(differences),benefit_mean:mean(benefit),benefit_ci_low:lo,benefit_ci_high:hi,probability_better:boot.filter(x=>x>0).length/boot.length,significant:lo>0||hi<0,direction:"positive_benefit_means_proposed_is_better",bootstrap_samples:c.bootstrap_samples});
  }
 }return result;
}
export function distributionPayload(rows){
 const out=[];for(const method of METHODS)for(const metric of ["rmse_to_truth","mae_to_truth","probability_correct","detection_rate","mean_detection_time_steps"]){
  const x=valid(rows.filter(r=>r.method===method).map(r=>r[metric]));if(!x.length)continue;
  const lo=Math.min(...x),hi=Math.max(...x),count=lo===hi?5:clamp(Math.round(Math.sqrt(x.length)),6,24);
  const pad=lo===hi?Math.max(.01,Math.abs(lo)*.05):0,left=lo-pad,right=hi+pad,width=(right-left)/count;
  const bins=Array.from({length:count},(_,i)=>({x0:left+i*width,x1:left+(i+1)*width,center:left+(i+.5)*width,count:0,label:(left+i*width).toFixed(3)+"–"+(left+(i+1)*width).toFixed(3)}));
  for(const v of x){const i=width?clamp(Math.floor((v-left)/width),0,count-1):0;bins[i].count++;}
  out.push({method,metric,count:x.length,min:lo,q05:quantile(x,.05),q25:quantile(x,.25),median:median(x),q75:quantile(x,.75),q95:quantile(x,.95),max:hi,mean:mean(x),std:stdev(x),histogram:bins});
 }return out;
}
function factorialRanges(c){
 const maxF=Math.floor((c.n_agents-1)/2),lo=Math.max(0,Math.round(c.n_byzantine*.5)),hi=Math.min(maxF,Math.max(lo+1,Math.round(c.n_byzantine*1.5)));
 return {n_byzantine:[lo,hi],isolation_threshold:[Math.max(.05,c.isolation_threshold-.10),Math.min(.9,c.isolation_threshold+.10)],trust_window_steps:[Math.max(2,Math.round(c.trust_window_steps*.6)),Math.min(100,Math.max(3,Math.round(c.trust_window_steps*1.4)))],
  forgetting_factor:[Math.max(.60,c.forgetting_factor-.05),Math.min(1,c.forgetting_factor+.04)],attack_intensity_multiplier:[.6,1.4],honest_noise_sigma:[Math.max(.01,c.honest_noise_sigma*.6),Math.min(2,c.honest_noise_sigma*1.4)]};
}
function factorialDesign(c,rawRanges){
 const ranges={...factorialRanges(c)};for(const [k,v] of Object.entries(rawRanges||{}))if(k in ranges&&Array.isArray(v)&&v.length===2)ranges[k]=v;
 const factors=Object.keys(ranges),full=Array.from({length:2**factors.length},(_,i)=>factors.map((_,j)=>i&(1<<(factors.length-j-1))?1:-1));
 // The regular half-fraction I=ABCDEF (resolution VI) preserves orthogonality
 // of main and two-factor columns. Arbitrary random subsets do not.
 const selected=c.factorial_max_points===64?full:
   full.filter(coded=>coded[5]===coded.slice(0,5).reduce((p,v)=>p*v,1));
 if(selected.length!==c.factorial_max_points)throw Error("Нарушена структура регулярного факторного плана");
 const designs=selected.map((coded,index)=>{
  const settings={...c},values={};factors.forEach((f,j)=>{const v=ranges[f][coded[j]>0?1:0];values[f]=v;if(f==="attack_intensity_multiplier"){settings.static_bias=c.static_bias*v;settings.subtle_bias=c.subtle_bias*v;settings.collusion_bias=c.collusion_bias*v;}else settings[f]=["n_byzantine","trust_window_steps"].includes(f)?Math.round(v):v;});
  // Keep the aggregation rule fixed when varying f.
  return{index,coded,values,settings:validateConfig(settings)};
 });
 const audit=auditFactorialDesign(factors,ranges,designs);
 return{factors,ranges,designs,designMetadata:{...audit,methodologyVersion:FACTORIAL_AUDIT_VERSION,
  type:c.factorial_max_points===64?"complete-2^6":"regular-2^(6-1)",
  points:c.factorial_max_points,designResolution:c.factorial_max_points===64?"full":"VI",
  definingRelation:c.factorial_max_points===64?"none":"I=ABCDEF",
  inferenceLimit:c.factorial_max_points===64?
   "Полный двухуровневый план; эффекты оцениваются как маргинальные контрасты.":
   "Главные эффекты смешаны с пятикратными, двухфакторные — с четырёхфакторными взаимодействиями; интерпретация предполагает пренебрежение эффектами высших порядков."
 }};
}
/**
 * Exploratory 2x2 isolation / attack-schedule design. The same run index and
 * generator seed preserve initial Byzantine identities and starting graph.
 * Dynamic streams can diverge after policy-dependent branches: NOT a strict
 * common-random-numbers experiment.
 */
export const ABLATION_ARMS=[
 {id:"on_off_no_isolation",schedule:"on_off",scenario:"on_off",isolation_enabled:false},
 {id:"on_off_with_isolation",schedule:"on_off",scenario:"on_off",isolation_enabled:true},
 {id:"persistent_no_isolation",schedule:"persistent",scenario:"static_bias",isolation_enabled:false},
 {id:"persistent_with_isolation",schedule:"persistent",scenario:"static_bias",isolation_enabled:true}
];
function summarizeAblation(plan,rows,partial,completed){
 const ablation_rows=[];
 for(const arm of ABLATION_ARMS)for(const method of METHODS){
  const group=rows.filter(x=>x.arm_id===arm.id&&x.method===method);
  if(!group.length)continue;
  const possible=group.map(x=>x.rmse_to_truth).filter(good);
  ablation_rows.push({
   arm_id:arm.id,attack_schedule:arm.schedule,isolation_enabled:arm.isolation_enabled,
   method,runs:group.length,unconditional_correct:finiteMean(group.map(x=>x.probability_correct)),
   decision_coverage:finiteMean(group.map(x=>x.decision_coverage)),
   conditional_rmse:possible.length?mean(possible):null,conditional_rmse_n:possible.length,
   detection_rate:finiteMean(group.map(x=>x.detection_rate)),
   false_isolations:finiteMean(group.map(x=>x.false_isolations)),
   attack_active_steps:finiteMean(group.map(x=>x.attack_active_steps)),
   attack_on_correct:group.some(x=>good(x.attack_on_correct))?finiteMean(group.map(x=>x.attack_on_correct)):null,
   attack_off_correct:group.some(x=>good(x.attack_off_correct))?finiteMean(group.map(x=>x.attack_off_correct)):null,
   attack_off_steps:finiteMean(group.map(x=>x.attack_off_steps))
  });
 }
 const key=(a,m,r)=>a+"/"+m+"/"+r;
 const lookup=new Map(rows.map(x=>[key(x.arm_id,x.method,x.run),x]));
 const contrasts=[];
 const add=(category,armA,methodA,armB,methodB,metric,definition)=>{
  const aa=[],bb=[];
  for(let run=0;run<plan.c.n_sensitivity_runs;run++){
   const first=lookup.get(key(armA,methodA,run)),second=lookup.get(key(armB,methodB,run));
   if(first&&second&&good(first[metric])&&good(second[metric])){aa.push(first[metric]);bb.push(second[metric]);}
  }
  const delta=aa.length?mean(aa.map((v,i)=>v-bb[i])):null;
  const seed=plan.c.seed+category.length+methodA.length+armA.length;
  const confidence=aa.length>=10?pairedDifference95(aa,bb,seed,300):null;
  const signFlip=aa.length>=10?pairedSignFlipP(aa.map((v,i)=>v-bb[i]),seed,4095):null;
  contrasts.push({category,armA,methodA,armB,methodB,metric,definition,n_pairs:aa.length,
    difference_mean:delta,ci95_low:confidence?.lower??null,ci95_high:confidence?.upper??null,
    intervalMethod:confidence?"seed-matched percentile-bootstrap, unadjusted 95%":null,
    pRaw:signFlip?.p??null,pHolm:null,holmReject05:null,
    pMethod:signFlip?.method??null});
 };
 for(const schedule of ["on_off","persistent"]){
  const a=schedule+"_with_isolation",b=schedule+"_no_isolation";
  for(const method of METHODS){
   add("isolation",a,method,b,method,"probability_correct","Изоляция включена минус выключена, при фиксированном агрегаторе");
   add("isolation",a,method,b,method,"decision_coverage","Покрытие: изоляция включена минус выключена");
  }
 }
 for(const schedule of ["on_off","persistent"])for(const iso of ["with_isolation","no_isolation"]){
  const a=schedule+"_"+iso;
  for(const method of ["arithmetic_mean","trust_weighted_mean"])
   add("aggregation",a,"proposed_robust",a,method,"probability_correct","Робастный агрегатор минус базовый при фиксированной политике изоляции");
 }
 for(const iso of ["with_isolation","no_isolation"])for(const method of METHODS)
  add("attack_schedule","on_off_"+iso,method,"persistent_"+iso,method,
   "probability_correct","On–off минус постоянное смещение при равном максимальном сдвиге");
 const validIndices=contrasts.map((row,index)=>row.pRaw===null?null:index).filter(index=>index!==null);
 const adjusted=holmAdjusted(validIndices.map(index=>contrasts[index].pRaw));
 validIndices.forEach((index,i)=>{
  contrasts[index].pHolm=adjusted[i];
  contrasts[index].holmReject05=adjusted[i]<.05;
 });
 return {mode:"ablation",ablation_rows,ablation_contrasts:contrasts,raw_runs:rows,
  multipleTesting:{family:"all-confirmable-ablation-contrasts",tested:validIndices.length,
   planned:contrasts.length,correction:"Holm-FWER-0.05",
   pMethod:"two-sided paired sign-flip (exact n≤14, seeded randomisation n>14)",
   unadjustedCI:true,limitation:"Holm относится к p-значениям, а не к показываемым 95%-м percentile-bootstrap интервалам. Требуется допущение попарной обменности знаков при нулевой гипотезе."},
  modelVersion:TRUST_MODEL_VERSION,configuration:configDetail(plan.c),partial,
  completed_tasks:completed,requested_tasks:plan.total,parallel_workers_used:1,
  design:{controller:["isolation_enabled=false","isolation_enabled=true"],
   schedule:["on_off (cyclic)","persistent (static_bias)"],methods:METHODS,
   sameSeed:true,sameInitialBadAgents:true,strictCommonRandomNumbers:true,
   exogenousEventScheme:"keyed-by-seed-run-stage-step-source-target-v1",
   scope:"Внешние шумы, транспортные решения и свидетельства для совпадающих адресов событий; распределения эндогенных состояний могут различаться.",
   disclaimer:"Экзогенные случайные события привязаны к фиксированным адресам (seed, run, стадия, такт, агент, цель) и совпадают между ветвями при одинаковых адресах. При этом активные множества и история изоляции закономерно различаются. Парная оценка условна по модели; для набора доступных контрастов двусторонние p-значения корректируются по Холму (FWER 0,05), но показанные 95%-е bootstrap-интервалы остаются нескорректированными. Ни проверка обменности знаков при нулевой гипотезе, ни перенос на реальные ИМАС без калибровки не подтверждены."}};
}
export function makePlan(payload){
 const c=validateConfig(payload.config),scenario=payload.scenario||"collusion";
 if(!SCENARIOS.includes(scenario))throw Error("Неизвестный сценарий "+scenario);
 const action=payload.action||"trace";
 if(action==="trace")return{action,c,scenario,tasks:[{index:0,c,run:payload.run_index||0}],total:1};
 if(action==="monte_carlo")return{action,c,scenario,tasks:all(c.n_runs).map(i=>({index:i,c,run:i})),total:c.n_runs};
 if(action==="sensitivity"){
  const mode=payload.sensitivity_mode||"one_factor";
  if(mode==="one_factor"){
   const fValues=[...new Set((payload.f_values||[0,2,4,6,8,10]).map(Number).filter(x=>Number.isInteger(x)&&x>=0&&x<c.n_agents/2))].sort((a,b)=>a-b);
   const tasks=fValues.flatMap(f=>all(c.n_sensitivity_runs).map(run=>({index:f,c:{...c,n_byzantine:f},run})));
   return{action,c,scenario,mode,tasks,total:tasks.length};
  }
  if(mode==="ablation"){
    const tasks=ABLATION_ARMS.flatMap((arm,armIndex)=>all(c.n_sensitivity_runs).map(run=>({
      index:armIndex*c.n_sensitivity_runs+run,c:{...c,isolation_enabled:arm.isolation_enabled,paired_exogenous_events:true},
      scenario:arm.scenario,run,arm
    })));
    return {action,c,scenario,mode,tasks,total:tasks.length};
  }
  if(mode==="factorial"){
    const {factors,ranges,designs,designMetadata}=factorialDesign(c,payload.factor_ranges);
    const tasks=designs.flatMap(d=>all(c.factorial_runs_per_point).map(run=>({index:d.index,c:d.settings,run,design:d})));
    return{action,c,scenario,mode,tasks,total:tasks.length,factors,ranges,designs,designMetadata};
  }
 }throw Error("Неизвестный режим моделирования "+action);
}
function withMetricPassport(result){
 const integrity=auditResultMetrics("trust",result);
 if(!integrity.valid)throw Error("Контроль показателей доверия: "+integrity.issues.join("; "));
 return {...result,metricPassport:passportForStudy("trust"),metricPassportVersion:METRIC_PASSPORT_VERSION,
  metricIntegrity:integrity};
}
export function assembleResult(plan,completed){
 const {c,scenario,action,mode,tasks,total}=plan;const partial=completed.length<total;
 if(action==="trace")return withMetricPassport(completed[0]?.detail||simulateRun(c,scenario,0,0,true).result);
 const rows=completed.flatMap(x=>x.rows);
 if(action==="monte_carlo"){
  const paths=completed.map(x=>x.trajectory);
  return withMetricPassport({summary:summaryFromRuns(rows),runs:rows,trajectory_statistics:trajectoryStats(paths,c),
  trajectory_statistics_definition:{center:"sample_mean_and_median",dispersion:"sample_standard_deviation",ddof:1,run_count:completed.length,requested_run_count:c.n_runs,bands:["mean ± 1s","mean ± 2s","P25–P75","P5–P95"],quantiles:[.05,.25,.5,.75,.95]},
  bootstrap_comparisons:bootstrapComparisons(rows,c),distributions:distributionPayload(rows),configuration:configDetail(c),scenario,partial,completed_runs:completed.length,requested_runs:c.n_runs,resumed_runs:0,parallel_workers_used:1});
 }
 if(mode==="ablation")
  return withMetricPassport(summarizeAblation(plan,rows,partial,completed.length));
 if(mode==="one_factor"){
  const result=[];for(const f of [...new Set(tasks.map(x=>x.index))])for(const method of METHODS){const rr=rows.filter(x=>x.n_byzantine===f&&x.method===method);if(!rr.length)continue;
   result.push({n_byzantine:f,method,probability_correct:finiteMean(rr.map(x=>x.probability_correct)),rmse:rr.some(x=>good(x.rmse_to_truth))?finiteMean(rr.map(x=>x.rmse_to_truth)):null,detection_rate:finiteMean(rr.map(x=>x.detection_rate)),delivery_ratio:finiteMean(rr.map(x=>x.delivery_ratio))});}
  return withMetricPassport({mode,sensitivity:result,raw_runs:rows,configuration:configDetail(c),partial,completed_tasks:completed.length,requested_tasks:total,parallel_workers_used:1});
 }
 const results=[];for(const d of plan.designs)for(const method of METHODS){
  const rr=rows.filter(x=>x.design_index===d.index&&x.method===method);if(!rr.length)continue;
  const x={design_index:d.index,method,probability_correct:mean(rr.map(x=>x.probability_correct)),rmse_to_truth:rr.some(x=>good(x.rmse_to_truth))?finiteMean(rr.map(x=>x.rmse_to_truth)):null,detection_rate:mean(rr.map(x=>x.detection_rate)),delivery_ratio:mean(rr.map(x=>x.delivery_ratio))};
  for(let i=0;i<plan.factors.length;i++){x["factor_"+plan.factors[i]]=d.values[plan.factors[i]];x["coded_"+plan.factors[i]]=d.coded[i];}
  results.push(x);
 }
 const keys=["probability_correct","rmse_to_truth","detection_rate","delivery_ratio"];
 const analysed=estimateFactorialContrasts(plan.designs,rows,keys);
 const effects=analysed.effects.map(e=>({
  ...e,factor:plan.factors[e.factorIndex],effect_high_minus_low:e.effect,
  benefit_effect:e.effect===null?null:(e.metric==="rmse_to_truth"?-e.effect:e.effect),
  low_value:plan.ranges[plan.factors[e.factorIndex]][0],
  high_value:plan.ranges[plan.factors[e.factorIndex]][1]
 }));
 const interactions=analysed.interactions.map(e=>({
  ...e,factors:e.factorIndices.map(j=>plan.factors[j])
 }));
 const estimable=effects.filter(e=>e.estimable).length;
 const withCI=effects.filter(e=>e.ci95_low!==null).length;
 const factorialUncertainty={
  method:"within-cell-replicate-independent-normal-approx-95",metrics:keys,
  expectedMainEffects:6*keys.length,estimableMainEffects:estimable,
  mainEffectsWithCI:withCI,confidenceLevel:.95,
  caveat:"Точечные эффекты оцениваются только при полном наборе ячеек. Интервал рассчитывается по вариации отдельных повторов внутри каждой ячейки (≥2 на ячейку), без учёта неопределённости самой модели, смешения высших взаимодействий или поправки на множественные сравнения."
 };
 return withMetricPassport({mode:"factorial",factors:plan.factors,factor_ranges:plan.ranges,designMetadata:plan.designMetadata,factorialUncertainty,design_points:results,main_effects:effects,interaction_effects:interactions.sort((a,b)=>(b.absolute_effect??-1)-(a.absolute_effect??-1)).slice(0,30),raw_runs:rows,configuration:configDetail(c),partial,completed_tasks:completed.length,requested_tasks:total,parallel_workers_used:1});
}
export function runTask(plan,task){
 const scenarioIndex=plan.action==="sensitivity"&&plan.mode==="factorial"?task.index:0;
 const value=simulateRun(task.c,task.scenario||plan.scenario,task.run,scenarioIndex,plan.action==="trace");
 if(plan.action==="trace")return{detail:value.result,rows:value.rows,trajectory:value.trajectory};
 const rows=value.rows.map(row=>{
  if(plan.action==="sensitivity"&&plan.mode==="ablation"){
   const activeSteps=value.trajectory.filter(step=>step.attack_active);
   const pauseSteps=value.trajectory.filter(step=>step.step>=task.c.attack_start_step&&!step.attack_active);
   const pCorrect=steps=>steps.length?steps.filter(step=>good(step[row.method])&&Math.abs(step[row.method]-task.c.desired_action)<=task.c.correctness_tolerance).length/steps.length:null;
   return {...row,arm_id:task.arm.id,attack_schedule:task.arm.schedule,
     isolation_enabled:task.arm.isolation_enabled,
     attack_active_steps:activeSteps.length,attack_off_steps:pauseSteps.length,
     attack_on_correct:pCorrect(activeSteps),attack_off_correct:pCorrect(pauseSteps)};
  }
  if(plan.action==="sensitivity"&&plan.mode==="one_factor")return{...row,n_byzantine:task.index};
  if(plan.action==="sensitivity"&&plan.mode==="factorial"){
   const out={...row,design_index:task.index};for(const [f,v]of Object.entries(task.design.values))out["factor_"+f]=v;
   plan.factors.forEach((f,i)=>out["coded_"+f]=task.design.coded[i]);return out;
  }
  return row;
 });
 return{rows,trajectory:value.trajectory};
}
export function runActionSync(payload,progress=()=>{}){
 const plan=makePlan(payload),done=[];
 for(const task of plan.tasks){done.push(runTask(plan,task));progress(done.length,plan.total);}
 return assembleResult(plan,done);
}
