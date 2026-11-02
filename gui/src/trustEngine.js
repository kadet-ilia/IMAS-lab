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
 minimum_weight:.05,reputation_damping:.85,isolation_threshold:.25,isolation_patience:3,
 minimum_evidence_steps:8,isolation_cooldown_steps:30,trim_each_side:10,
 clip_radius:1.25,safe_action_min:-2,safe_action_max:2,correctness_tolerance:.5,
 network_enabled:false,network_topology:"complete",network_edge_probability:.25,
 small_world_neighbors:4,small_world_rewire_probability:.1,
 message_loss_probability:0,message_delay_min_steps:0,message_delay_max_steps:0,
 max_message_staleness_steps:5,bandwidth_messages_per_step:100000,
 partition_enabled:false,partition_start_step:70,partition_end_step:110,partition_fraction:.5
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
export function validateConfig(value={}){
 const c={...DEFAULTS,...value};
 for(const [k,v] of Object.entries(DEFAULTS)){if(typeof v==="number"&&(!good(Number(c[k]))))throw Error("Недопустимое значение параметра "+k);}
 if(c.n_agents<3||c.n_agents>160||c.n_byzantine<0||c.n_byzantine>=c.n_agents/2)throw Error("Необходимо 3≤N≤160 и N>2f");
 if(c.n_sybil_agents<0||c.n_agents+c.n_sybil_agents>160)throw Error("Общее число агентов не должно превышать 160");
 if(c.n_steps<1||c.n_steps>500||c.n_runs<1||c.n_runs>500)throw Error("Ограничения интерфейса: 1..500 тактов и прогонов");
 if(c.attack_start_step<1||c.attack_start_step>c.n_steps)throw Error("Некорректное время начала атаки");
 if(c.n_sybil_agents&& (c.sybil_activation_step<1||c.sybil_activation_step>c.n_steps))throw Error("Некорректный момент активации Sybil");
 if(c.safe_action_min>=c.safe_action_max)throw Error("Пустой безопасный интервал");
 if(!(c.initial_trust>0&&c.initial_trust<1)||!(c.forgetting_factor>0&&c.forgetting_factor<=1))throw Error("Неправильные параметры памяти доверия");
 if(c.trim_each_side<0||c.minimum_evidence_steps<1||c.isolation_patience<1)throw Error("Некорректные параметры изоляции");
 if(!["complete","ring","random","small_world"].includes(c.network_topology))throw Error("Неизвестная топология");
 if(c.message_delay_max_steps<c.message_delay_min_steps||c.message_delay_min_steps<0)throw Error("Некорректная задержка сообщений");
 if(c.partition_enabled&&(c.partition_start_step>c.partition_end_step||c.partition_end_step>c.n_steps))throw Error("Некорректный интервал разделения сети");
 if(c.bootstrap_samples<100||c.bootstrap_samples>10000)throw Error("Bootstrap: требуется 100..10000 выборок");
 if(c.factorial_max_points<1||c.factorial_max_points>128)throw Error("Недопустимое число точек плана");
 return c;
}
const all=(n)=>Array.from({length:n},(_,i)=>i);
const makeMat=(n,value=0)=>Array.from({length:n},()=>Array(n).fill(value));
function buildAdjacency(c,r,byzantine){
 const n=c.n_agents+c.n_sybil_agents,a=makeMat(n,false);
 if(!c.network_enabled||c.network_topology==="complete"){for(let i=0;i<n;i++)for(let j=0;j<n;j++)a[i][j]=i!==j;return a;}
 const link=(i,j)=>{if(i!==j){a[i][j]=true;a[j][i]=true;}};
 if(c.network_topology==="ring")for(let i=0;i<n;i++)link(i,(i+1)%n);
 if(c.network_topology==="random"){for(let i=0;i<n;i++)for(let j=i+1;j<n;j++)if(r.random()<c.network_edge_probability)link(i,j);for(let i=0;i<n;i++)link(i,(i+1)%n);}
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
 if(!idx.length)return{...last};
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
function observations(t,scenario,c,bad,active,labels,r,budget){
 const n=bad.length,attack=activeAttack(t,scenario,c),e=makeMat(n,NaN);
 for(let i=0;i<n;i++)for(let j=0;j<n;j++){
  const quality=attack&&bad[j]?c.byzantine_quality:c.honest_quality;
  let v=bad[i]?(bad[j]?.98:.02):clamp((r.random()<quality?1:0)+r.normal()*c.observer_noise_sigma,0,1);
  if(i===j)v=c.honest_quality;
  e[i][j]=v;
 }
 if(!c.network_enabled)return{matrix:e,stats:{attempted:active.filter(Boolean).length**2,delivered:active.filter(Boolean).length**2,lost:0,bandwidth_dropped:0}};
 let attempted=0,lost=0,dropped=0,delivered=0;
 const candidates=[];
 for(let i=0;i<n;i++)for(let j=0;j<n;j++){
  if(!(active[i]&&active[j]&&labels[i]>=0&&labels[i]===labels[j])){e[i][j]=NaN;continue;}
  attempted++;if(i!==j&&r.random()<c.message_loss_probability){e[i][j]=NaN;lost++;}else candidates.push([i,j]);
 }
 let keep=candidates;
 if(candidates.length>budget){const selected=new Set(r.choice(all(candidates.length),Math.max(0,budget)));keep=candidates.filter((x,i)=>selected.has(i));dropped=candidates.length-keep.length;}
 const allowed=new Set(keep.map(([i,j])=>i*n+j));for(let i=0;i<n;i++)for(let j=0;j<n;j++)if(!allowed.has(i*n+j))e[i][j]=NaN;
 delivered=keep.length;
 return{matrix:e,stats:{attempted,delivered,lost,bandwidth_dropped:dropped}};
}
function transport(t,proposals,active,comps,queue,lastValues,lastSteps,c,r){
 const n=active.length;if(!c.network_enabled)return{values:[...proposals],available:[...active],budget:c.bandwidth_messages_per_step,stats:{attempted:active.filter(Boolean).length,delivered:active.filter(Boolean).length,lost:0,bandwidth_dropped:0,component_size:active.filter(Boolean).length,queued:0,mean_delay:0}};
 const largest=[...comps].sort((a,b)=>b.length-a.length||a[0]-b[0])[0]||[],set=new Set(largest);
 let lost=0;for(const i of largest){if(r.random()<c.message_loss_probability){lost++;continue;}const delay=r.integer(c.message_delay_min_steps,c.message_delay_max_steps);queue.push({due:t+delay,source:i,value:proposals[i],delay});}
 queue.sort((a,b)=>a.due-b.due);
 let budget=c.bandwidth_messages_per_step,delivered=0,dropped=0;const delayList=[],retain=[];
 for(const q of queue){if(q.due<=t&&budget>0){lastValues[q.source]=q.value;lastSteps[q.source]=t;budget--;delivered++;delayList.push(q.delay);}
  else{retain.push(q);if(q.due<=t)dropped++;}}
 queue.splice(0,queue.length,...retain);
 return{values:[...lastValues],available:all(n).map(i=>set.has(i)&&good(lastValues[i])&&t-lastSteps[i]<=c.max_message_staleness_steps),
 budget,stats:{attempted:largest.length,delivered,lost,bandwidth_dropped:dropped,component_size:largest.length,queued:queue.length,mean_delay:delayList.length?mean(delayList):0}};
}
const finiteMean=a=>mean(valid(a));
function configDetail(c){return {...c,effective_agent_count:c.n_agents+c.n_sybil_agents,effective_byzantine_count:c.n_byzantine+c.n_sybil_agents};}
export function simulateRun(rawConfig={},scenario="collusion",runIndex=0,scenarioIndex=0,detail=false){
 const c=validateConfig(rawConfig),n=c.n_agents+c.n_sybil_agents,r=createRng(c.seed,scenarioIndex,runIndex);
 const sybil=all(n).map(i=>i>=c.n_agents),bad=sybil.slice(),badIds=r.choice(all(c.n_agents),c.n_byzantine);badIds.forEach(i=>bad[i]=true);
 const a=buildAdjacency(c,r,bad),groups=Array(n).fill(0);
 r.choice(all(n),clamp(Math.round(n*c.partition_fraction),1,n-1)).forEach(i=>groups[i]=1);
 let active=all(n).map(i=>!sybil[i]),low=Array(n).fill(0),isolatedAt=Array(n).fill(null),until=Array(n).fill(-1);
 const hist=[],queue=[],lastValues=Array(n).fill(NaN),lastSteps=Array(n).fill(-1e9);
 let previous=Object.fromEntries(METHODS.map(m=>[m,c.desired_action]));
 const errors=Object.fromEntries(METHODS.map(m=>[m,[]])),signed=Object.fromEntries(METHODS.map(m=>[m,[]])),correct=Object.fromEntries(METHODS.map(m=>[m,[]])),consensus=Object.fromEntries(METHODS.map(m=>[m,[]])),cover=Object.fromEntries(METHODS.map(m=>[m,[]]));
 let attempted=0,delivered=0,lost=0,dropped=0;
 const series=[],network_series=[],reputationHistory=[],states=[],events=[];
 const t0=performance.now();
 for(let t=0;t<c.n_steps;t++){
  const eligible=all(n).map(i=>!sybil[i]||t+1>=c.sybil_activation_step);
  for(let i=0;i<n;i++){if(!active[i]&&eligible[i]&&(sybil[i]&&until[i]<0||until[i]>=0&&until[i]<t)){active[i]=true;low[i]=0;}}
  if(!active.some((x,i)=>x&&eligible[i])){const i=all(n).find(i=>!sybil[i]);active[i]=true;until[i]=-1;low[i]=0;}
  const running=active.map((x,i)=>x&&eligible[i]),partition=Boolean(c.network_enabled&&c.partition_enabled&&t+1>=c.partition_start_step&&t+1<=c.partition_end_step);
  const {comps,labels}=components(a,running,groups,partition);
  const proposed=samples(t,scenario,c,bad,sybil,r),direct=betaTrust(hist,c,n),scores=Array(n).fill(c.initial_trust);
  for(const comp of comps)for(const j of comp)scores[j]=median(comp.map(i=>direct[i][j]));
  const eigen=eigenTrust(direct,running,c.reputation_damping),rep=scores.map((s,i)=>.7*s+.3*eigen[i]);
  const tx=transport(t,proposed,running,comps,queue,lastValues,lastSteps,c,r),decisions=aggregate(tx.values,rep,tx.available,c,previous);previous=decisions;
  const honest=all(n).filter(i=>tx.available[i]&&!bad[i]),reference=honest.length?median(honest.map(i=>tx.values[i])):c.desired_action;
  const half=1.96*c.honest_noise_sigma/Math.sqrt(Math.max(1,honest.length));
  for(const m of METHODS){const e=decisions[m]-c.desired_action;errors[m].push(Math.abs(e));signed[m].push(e);correct[m].push(Math.abs(e)<=c.correctness_tolerance?1:0);consensus[m].push(Math.abs(decisions[m]-reference));cover[m].push(Math.abs(e)<=half?1:0);}
  const evidence=observations(t,scenario,c,bad,running,labels,r,tx.budget);
  hist.push(evidence.matrix);if(hist.length>c.trust_window_steps)hist.shift();
  attempted+=tx.stats.attempted+evidence.stats.attempted;delivered+=tx.stats.delivered+evidence.stats.delivered;lost+=tx.stats.lost+evidence.stats.lost;dropped+=tx.stats.bandwidth_dropped+evidence.stats.bandwidth_dropped;
  if(t+1>=c.minimum_evidence_steps){
   const updated=betaTrust(hist,c,n),newScores=Array(n).fill(c.initial_trust);
   for(const comp of comps)for(const j of comp)newScores[j]=median(comp.map(i=>updated[i][j]));
   for(let i=0;i<n;i++){
    low[i]=running[i]&&newScores[i]<c.isolation_threshold?low[i]+1:0;
    if(running[i]&&low[i]>=c.isolation_patience){
     if(isolatedAt[i]===null)isolatedAt[i]=t+1;
     if(detail)events.push({step:t+1,agent:i+1,type:sybil[i]?"sybil":bad[i]?"byzantine":"false_positive",reason:"reputation_below_threshold",confirmations:low[i],duration:c.isolation_cooldown_steps,reputation:newScores[i]});
     active[i]=false;until[i]=t+c.isolation_cooldown_steps;
    }
   }
  }
  const row={step:t+1,truth:c.desired_action,active_agents:running.filter((x,i)=>x&&active[i]).length,available_agents:tx.available.filter(Boolean).length,isolated_agents:eligible.filter((x,i)=>x&&!active[i]).length,
    largest_component:tx.stats.component_size,messages_delivered:tx.stats.delivered+evidence.stats.delivered,messages_lost:tx.stats.lost+evidence.stats.lost,messages_bandwidth_dropped:tx.stats.bandwidth_dropped+evidence.stats.bandwidth_dropped,
    partition_active:Number(partition),attack_active:Number(activeAttack(t,scenario,c)),...decisions};
  series.push(row);
  if(detail){
   network_series.push({...row,proposal_queue:tx.stats.queued,mean_message_delay:tx.stats.mean_delay,delivery_ratio:row.messages_delivered/Math.max(1,tx.stats.attempted+evidence.stats.attempted)});
   for(let i=0;i<n;i++){
    reputationHistory.push({step:t+1,agent:i+1,reputation:rep[i],byzantine:bad[i],sybil:sybil[i],active:active[i]});
    states.push({step:t+1,agent:i+1,state:sybil[i]&&!eligible[i]?"dormant":!active[i]?"isolated":sybil[i]?"sybil":bad[i]?"byzantine":"honest"});
   }
  }
 }
 const found=all(n).filter(i=>isolatedAt[i]!==null&&bad[i]),allBad=bad.filter(Boolean).length;
 const detectionRate=found.length/Math.max(1,allBad),meanTime=found.length?mean(found.map(i=>isolatedAt[i])):null,fp=all(n).filter(i=>isolatedAt[i]!==null&&!bad[i]).length;
 const preserved=all(n).filter(i=>active[i]&&!bad[i]).length/Math.max(1,bad.filter(x=>!x).length),ratio=delivered/Math.max(1,attempted);
 const rows=METHODS.map(method=>{
   const e=errors[method],sgn=signed[method];
   return{scenario,run:runIndex,method,probability_correct:mean(correct[method]),mae_to_truth:mean(e),rmse_to_truth:Math.sqrt(mean(e.map(x=>x*x))),
      bias:mean(sgn),coverage95:mean(cover[method]),consensus_error:mean(consensus[method]),
      detection_rate:detectionRate,mean_detection_time_steps:meanTime,false_isolations:fp,preserved_functionality:preserved,
      communication_messages:delivered,communication_attempted:attempted,communication_lost:lost,communication_bandwidth_dropped:dropped,
      delivery_ratio:ratio,aggregation_seconds:(performance.now()-t0)/1000,completed_steps:c.n_steps};
 });
 if(!detail)return{rows,trajectory:series};
 return{rows,trajectory:series,result:{series,network_series,reputation:reputationHistory,states,events,
   metrics:METHODS.map((method,i)=>({method,probability_correct:rows[i].probability_correct,mae:rows[i].mae_to_truth,rmse:rows[i].rmse_to_truth,bias:rows[i].bias,coverage95:rows[i].coverage95})),
   agents:all(n).map(i=>({agent:i+1,byzantine:bad[i],sybil:sybil[i],active:active[i],isolated_at:isolatedAt[i]})),
   summary:{detection_rate:detectionRate,mean_detection_time:meanTime,false_isolations:fp,preserved_functionality:preserved,delivery_ratio:ratio,communication_attempted:attempted,communication_delivered:delivered,communication_lost:lost,communication_bandwidth_dropped:dropped,honest_majority_with_sybils:n>2*allBad,completed_steps:c.n_steps},
   configuration:configDetail(c),scenario,run_index:runIndex,partial:false}};
}
const metrics=["probability_correct","mae_to_truth","rmse_to_truth","bias","coverage95","consensus_error","detection_rate","mean_detection_time_steps","false_isolations","preserved_functionality","communication_messages","communication_attempted","communication_lost","communication_bandwidth_dropped","delivery_ratio","aggregation_seconds","completed_steps"];
export function summaryFromRuns(rows){
 const out=[];for(const method of METHODS){const group=rows.filter(x=>x.method===method);if(!group.length)continue;
 const row={scenario:group[0].scenario,method};for(const m of metrics){const v=valid(group.map(x=>x[m]));row[m+"_mean"]=v.length?mean(v):null;row[m+"_std"]=v.length>1?stdev(v):0;row[m+"_ci95"]=v.length?1.96*(v.length>1?stdev(v):0)/Math.sqrt(v.length):null;}out.push(row);}
 return out;
}
export function trajectoryStats(paths,c){
 if(!paths.length)return [];const length=Math.min(...paths.map(x=>x.length));const out=[];
 for(let t=0;t<length;t++){
  const values=k=>paths.map(x=>x[t][k]),v=values("active_agents");
  const row={step:t+1,truth:c.desired_action,run_count:paths.length,active_agents_mean:mean(v),active_agents_std:stdev(v),available_agents_mean:mean(values("available_agents")),largest_component_mean:mean(values("largest_component")),tolerance_band:[c.desired_action-c.correctness_tolerance,c.desired_action+c.correctness_tolerance]};
  for(const method of METHODS){const a=values(method),mu=mean(a),sd=stdev(a),q=(p)=>quantile(a,p);
   Object.assign(row,{[method+"_mean"]:mu,[method+"_std"]:sd,[method+"_band1"]:[mu-sd,mu+sd],[method+"_band2"]:[mu-2*sd,mu+2*sd],
     [method+"_q05"]:q(.05),[method+"_q25"]:q(.25),[method+"_median"]:q(.5),[method+"_q75"]:q(.75),[method+"_q95"]:q(.95),[method+"_band50"]:[q(.25),q(.75)],[method+"_band90"]:[q(.05),q(.95)]});}
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
 const selected=full.length>c.factorial_max_points?createRng(c.seed,541).choice(all(full.length),c.factorial_max_points).sort((a,b)=>a-b).map(i=>full[i]):full;
 const designs=selected.map((coded,index)=>{
  const settings={...c},values={};factors.forEach((f,j)=>{const v=ranges[f][coded[j]>0?1:0];values[f]=v;if(f==="attack_intensity_multiplier"){settings.static_bias=c.static_bias*v;settings.subtle_bias=c.subtle_bias*v;settings.collusion_bias=c.collusion_bias*v;}else settings[f]=["n_byzantine","trust_window_steps"].includes(f)?Math.round(v):v;});
  settings.trim_each_side=settings.n_byzantine;return{index,coded,values,settings:validateConfig(settings)};
 });
 return{factors,ranges,designs};
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
   const tasks=fValues.flatMap(f=>all(c.n_sensitivity_runs).map(run=>({index:f,c:{...c,n_byzantine:f,trim_each_side:f},run})));
   return{action,c,scenario,mode,tasks,total:tasks.length};
  }
  if(mode==="factorial"){
    const {factors,ranges,designs}=factorialDesign(c,payload.factor_ranges);
    const tasks=designs.flatMap(d=>all(c.factorial_runs_per_point).map(run=>({index:d.index,c:d.settings,run,design:d})));
    return{action,c,scenario,mode,tasks,total:tasks.length,factors,ranges,designs};
  }
 }throw Error("Неизвестный режим моделирования "+action);
}
export function assembleResult(plan,completed){
 const {c,scenario,action,mode,tasks,total}=plan;const partial=completed.length<total;
 if(action==="trace")return completed[0]?.detail||simulateRun(c,scenario,0,0,true).result;
 const rows=completed.flatMap(x=>x.rows);
 if(action==="monte_carlo"){
  const paths=completed.map(x=>x.trajectory);
  return {summary:summaryFromRuns(rows),runs:rows,trajectory_statistics:trajectoryStats(paths,c),
  trajectory_statistics_definition:{center:"sample_mean_and_median",dispersion:"sample_standard_deviation",ddof:1,run_count:completed.length,requested_run_count:c.n_runs,bands:["mean ± 1s","mean ± 2s","P25–P75","P5–P95"],quantiles:[.05,.25,.5,.75,.95]},
  bootstrap_comparisons:bootstrapComparisons(rows,c),distributions:distributionPayload(rows),configuration:configDetail(c),scenario,partial,completed_runs:completed.length,requested_runs:c.n_runs,resumed_runs:0,parallel_workers_used:1};
 }
 if(mode==="one_factor"){
  const result=[];for(const f of [...new Set(tasks.map(x=>x.index))])for(const method of METHODS){const rr=rows.filter(x=>x.n_byzantine===f&&x.method===method);if(!rr.length)continue;
   result.push({n_byzantine:f,method,probability_correct:mean(rr.map(x=>x.probability_correct)),rmse:mean(rr.map(x=>x.rmse_to_truth)),detection_rate:mean(rr.map(x=>x.detection_rate)),delivery_ratio:mean(rr.map(x=>x.delivery_ratio))});}
  return {mode,sensitivity:result,raw_runs:rows,configuration:configDetail(c),partial,completed_tasks:completed.length,requested_tasks:total,parallel_workers_used:1};
 }
 const results=[];for(const d of plan.designs)for(const method of METHODS){
  const rr=rows.filter(x=>x.design_index===d.index&&x.method===method);if(!rr.length)continue;
  const x={design_index:d.index,method,probability_correct:mean(rr.map(x=>x.probability_correct)),rmse_to_truth:mean(rr.map(x=>x.rmse_to_truth)),detection_rate:mean(rr.map(x=>x.detection_rate)),delivery_ratio:mean(rr.map(x=>x.delivery_ratio))};
  for(let i=0;i<plan.factors.length;i++){x["factor_"+plan.factors[i]]=d.values[plan.factors[i]];x["coded_"+plan.factors[i]]=d.coded[i];}
  results.push(x);
 }
 const proposed=results.filter(x=>x.method==="proposed_robust"),effects=[],interactions=[];
 for(const metric of ["probability_correct","rmse_to_truth","detection_rate","delivery_ratio"]){
  for(const factor of plan.factors){
   const high=proposed.filter(x=>x["coded_"+factor]>0),low=proposed.filter(x=>x["coded_"+factor]<0);
   if(!high.length||!low.length)continue;
   const effect=mean(high.map(x=>x[metric]))-mean(low.map(x=>x[metric]));
   effects.push({metric,factor,effect_high_minus_low:effect,benefit_effect:metric==="rmse_to_truth"?-effect:effect,low_value:plan.ranges[factor][0],high_value:plan.ranges[factor][1]});
  }
  for(let i=0;i<plan.factors.length;i++)for(let j=i+1;j<plan.factors.length;j++){
   const one=plan.factors[i],two=plan.factors[j],high=proposed.filter(x=>x["coded_"+one]*x["coded_"+two]>0),low=proposed.filter(x=>x["coded_"+one]*x["coded_"+two]<0);
   if(high.length&&low.length){const e=mean(high.map(x=>x[metric]))-mean(low.map(x=>x[metric]));interactions.push({metric,factors:[one,two],effect:e,absolute_effect:Math.abs(e)});}
  }
 }
 return {mode:"factorial",factors:plan.factors,factor_ranges:plan.ranges,design_points:results,main_effects:effects,interaction_effects:interactions.sort((a,b)=>b.absolute_effect-a.absolute_effect).slice(0,30),raw_runs:rows,configuration:configDetail(c),partial,completed_tasks:completed.length,requested_tasks:total,parallel_workers_used:1};
}
export function runTask(plan,task){
 const scenarioIndex=plan.action==="sensitivity"&&plan.mode==="factorial"?task.index:0;
 const value=simulateRun(task.c,plan.scenario,task.run,scenarioIndex,plan.action==="trace");
 if(plan.action==="trace")return{detail:value.result,rows:value.rows,trajectory:value.trajectory};
 const rows=value.rows.map(row=>{
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
