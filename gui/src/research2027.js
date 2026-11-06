import {wilson95,mean95,pairedDifference95,bootstrap95,pairedSignFlipP,holmAdjusted,STATISTICS_VERSION} from "./statistics2027.js";
import {METRIC_PASSPORT_VERSION,passportForStudy,auditResultMetrics} from "./metricPassport.js";
/* IMAS-lab 2027: independent, seeded, synthetic research kernels.
   The formulations are explicit experimental hypotheses, not field-calibrated evidence. */
export const STUDY_DEFS = [
  { id:"uncertainty", short:"Неопределённость", title:"Модель распределённой поддержки принятия решений интеллектуальными агентами по обеспечению кибербезопасности объектов информационной инфраструктуры в условиях информационной неопределённости",
    origin:"Статья 1 2027", defaults:{agents:21,runs:500,seed:20270101,signalNoise:0.30,loss:0.12,corruption:0.12,threshold:0.22,record_source_runs:0,source_run_limit:100} },
  { id:"probgraph", short:"Граф угроз", title:"Графо-вероятностное моделирование сценариев реализации угроз безопасности информации в интеллектуальной мультиагентной системе поддержки принятия решений с учётом межагентных взаимодействий",
    origin:"Статья 2 2027", defaults:{agents:30,runs:2500,seed:20270201,edgeProbability:0.16,spread:0.24,steps:6,criticalFraction:0.33} },
  { id:"petri", short:"Сети Петри", title:"Формальное моделирование сценариев реализации угроз безопасности информации и верификация достижимости опасных состояний интеллектуальной мультиагентной системы на основе временных раскрашенных сетей Петри",
    origin:"Статья 2 2027", defaults:{agents:7,runs:1,seed:20270202,steps:6,detectionDelay:3,isolationPolicy:0,criticalCount:3,stateLimit:30000} },
  { id:"cascade", short:"Каскадные риски", title:"Метод оценки рисков нарушения функционирования интеллектуальной мультиагентной системы поддержки принятия решений на основе сценарного моделирования каскадных последствий кибератак",
    origin:"Статья 3 2027", defaults:{agents:8,runs:3000,seed:20270301,spread:0.34,lossScale:1,defenseFactor:0.45} },
  { id:"misinformation", short:"Коллективное решение", title:"Метод оценки рисков нарушения процессов коллективного принятия решений в интеллектуальной мультиагентной системе при компрометации агентов и распространении недостоверной информации",
    origin:"Статья 3 2027", defaults:{agents:7,runs:3000,seed:20270302,spread:0.40,noise:0.24,attackBias:2.5,threshold:0.16,costWrong:1,costRefuse:0.2,record_source_runs:0,source_run_limit:100} }
];
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const avg=x=>x.length?x.reduce((a,b)=>a+b,0)/x.length:0;
const pct=(x,q)=>{if(!x.length)return 0;const z=[...x].sort((a,b)=>a-b);const h=(z.length-1)*q;const lo=Math.floor(h);return z[lo]+(z[Math.min(z.length-1,lo+1)]-z[lo])*(h-lo);};
export function rng(seed){let state=(Number(seed)>>>0)||1;const next=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return(state>>>0)/4294967296;};return {random:next,normal:()=>{const u=Math.max(next(),1e-12),v=next();return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v);},
 getState:()=>state>>>0,restore:old=>{if(!Number.isInteger(old)||old<1||old>4294967295)throw Error("Некорректная контрольная точка ГПСЧ");state=old>>>0;}};}
const sample=(rand,n)=>Math.floor(rand.random()*n);
export const RESEARCH_MODEL_VERSION="research-2027-2.10.0-remediation";
export function chooseUniqueNodes(rand,n,k){
 if(!Number.isInteger(n)||!Number.isInteger(k)||k<0||k>n)throw Error("initialCount: требуется 0≤K≤N");
 const nodes=Array.from({length:n},(_,i)=>i);
 for(let i=0;i<k;i++){const j=i+Math.floor(rand.random()*(n-i));[nodes[i],nodes[j]]=[nodes[j],nodes[i]];}
 return nodes.slice(0,k);
}
export function expectedShortfall(values,alpha=.95){
 if(!Array.isArray(values)||!values.length||values.some(x=>!Number.isFinite(x)))throw Error("ES: необходимы конечные наблюдения");
 if(!(alpha>=0&&alpha<1))throw Error("ES: alpha должно быть в [0,1)");
 const descending=[...values].sort((a,b)=>b-a),tailMass=(1-alpha)*values.length;
 const whole=Math.floor(tailMass),fraction=tailMass-whole;
 const total=descending.slice(0,whole).reduce((a,b)=>a+b,0)+(fraction>0?fraction*descending[whole]:0);
 return total/tailMass;
}
export function spreadOneTick(current,edges,uniforms,p){
 if(!Array.isArray(edges)||!Array.isArray(uniforms)||edges.length!==uniforms.length)throw Error("Ожидается одно случайное событие на ребро");
 const snapshot=new Set(current),newly=new Set(),activeEdges=[];
 edges.forEach(([a,b],i)=>{if(snapshot.has(a)&&!snapshot.has(b)&&uniforms[i]<p){newly.add(b);activeEdges.push([a,b]);}});
 return {next:new Set([...snapshot,...newly]),newly,activeEdges};
}
/**
 * Uses only observation values, their observed age and known noise scale.
 * Hidden malicious/stale flags and the true state are deliberately ignored.
 * This is a synthetic, not externally calibrated, reliability estimator.
 */
export function estimateReliabilityFromObservations(observations,noiseScale=.2){
 const values=observations.map(o=>o.x),center=pct(values,.5);
 const mad=pct(values.map(x=>Math.abs(x-center)),.5);
 const scale=Math.max(.15,1.4826*mad,noiseScale);
 return observations.map(o=>{
  const residual=Math.abs(o.x-center);
  const observableAge=Math.max(1,Number.isFinite(o.d)?o.d:1);
  return Math.max(.01,1/(1+residual/scale)/(1+.25*(observableAge-1)));
 });
}
const quantileInfo=x=>({mean:avg(x),p05:pct(x,.05),p50:pct(x,.5),p95:pct(x,.95)});
function graph(n,p,r){const edges=[];for(let i=0;i<n;i++)for(let j=0;j<n;j++)if(i!==j&&r.random()<p)edges.push([i,j]);return edges;}
const fixedEdges8=[[0,1],[0,2],[1,3],[1,4],[2,4],[2,5],[3,6],[4,6],[4,7],[5,7],[6,7]];
const fixedEdges7=[[0,1],[0,2],[1,3],[2,3],[2,4],[3,5],[4,5],[5,6],[1,6]];
const scenarioSettings=[
 {name:"Базовый сценарий (с допустимыми потерями)",noise:0.7,missing:0.2,delay:0},
 {name:"Неполнота данных",noise:1,missing:1.7,delay:0},
 {name:"Противоречивые данные",noise:1.8,missing:0.7,delay:0.2},
 {name:"Несвоевременные сообщения",noise:1.2,missing:0.9,delay:0.55}
];
export function runUncertainty(c,checkpoint=null){
 const r=rng(c.seed);if(checkpoint?.randomState!==undefined)r.restore(checkpoint.randomState);
 const rows=checkpoint?.rows?[...checkpoint.rows]:[],samples=[],oracleBenchmark=checkpoint?.oracleBenchmark?[...checkpoint.oracleBenchmark]:[],
 sourceRuns=checkpoint?.sourceRuns?[...checkpoint.sourceRuns]:[];
 const names=["Знак среднего","Робастное согласование","Оценка по наблюдаемым признакам"];
 for(let scenarioIndex=checkpoint?.nextScenario??0;scenarioIndex<scenarioSettings.length;scenarioIndex++){const s=scenarioSettings[scenarioIndex];const missingProbability=clamp(c.loss*s.missing,0,1);const acc=names.map(()=>({correct:0,accepted:0,delay:0,wrong:0})),oracle={correct:0,accepted:0};for(let k=0;k<c.runs;k++){
  const truth=r.random()<.5?-1:1;const obs=[],rawMessages=c.record_source_runs?[]:null;
  for(let i=0;i<c.agents;i++){
   const missing=r.random()<missingProbability;
   if(missing){if(rawMessages)rawMessages.push({agent:i+1,missing:true});continue;}
   const sigma=c.signalNoise*s.noise,attacked=r.random()<c.corruption,stale=r.random()<s.delay;
   const x=(stale?-truth:truth)+r.normal()*sigma+(attacked?-truth*1.6:0);
   const reliability=(attacked?.22:.93)/(sigma*sigma+.15)*(stale?.22:1);
   obs.push({x,oracleWeight:reliability,d:stale?3:1});
   if(rawMessages)rawMessages.push({agent:i+1,missing:false,x,age:stale?3:1,attacked,stale,oracleWeight:reliability});
  }
  const values=obs.map(o=>o.x).sort((a,b)=>a-b);const trim=Math.min(Math.floor(values.length*.16),Math.floor((values.length-1)/2));
  const trimmed=values.slice(trim,values.length-trim);
  const weights=estimateReliabilityFromObservations(obs.map(({x,d})=>({x,d})),c.signalNoise*s.noise);
  const decisions=[avg(values),avg(trimmed),obs.length?obs.reduce((a,o,i)=>a+o.x*weights[i],0)/weights.reduce((a,b)=>a+b,0):0];
  const oracleEstimate=obs.length?obs.reduce((a,o)=>a+o.x*o.oracleWeight,0)/obs.reduce((a,o)=>a+o.oracleWeight,0):0;
  if(obs.length>=Math.ceil(c.agents*.3)&&Math.abs(oracleEstimate)>=c.threshold){
   oracle.accepted++;if(Math.sign(oracleEstimate)===truth)oracle.correct++;
  }
  decisions.forEach((v,j)=>{const ready=obs.length>=Math.ceil(c.agents*.3)&&Math.abs(v)>=c.threshold;
   if(ready){acc[j].accepted++;if(Math.sign(v)===truth)acc[j].correct++;else acc[j].wrong++;acc[j].delay+=avg(obs.map(o=>o.d));}
  });
  if(rawMessages)sourceRuns.push({scenario:s.name,scenarioIndex,run:k,truth,
   messages:rawMessages,methodEstimates:[...decisions],oracleEstimate,
   observedCount:obs.length,estimatorUsesHiddenFlags:false});
 }
 acc.forEach((m,j)=>{
  const acceptedCI=wilson95(m.accepted,c.runs),correctCI=wilson95(m.correct,c.runs),wrongCI=wilson95(m.wrong,c.runs);
  const conditionalCI=m.accepted?wilson95(m.correct,m.accepted):null;
  const row={scenario:s.name,method:names[j],runs:c.runs,effectiveMissingProbability:missingProbability,coverage:m.accepted/c.runs,coverageCI95Low:acceptedCI.lower,coverageCI95High:acceptedCI.upper,
   correctUnconditional:m.correct/c.runs,correctCI95Low:correctCI.lower,correctCI95High:correctCI.upper,
   accuracy:m.accepted?m.correct/m.accepted:null,accuracyCI95Low:conditionalCI?.lower??null,accuracyCI95High:conditionalCI?.upper??null,
   errorRate:m.wrong/c.runs,errorCI95Low:wrongCI.lower,errorCI95High:wrongCI.upper,
   meanObservationAge:m.accepted?m.delay/m.accepted:null};
  rows.push(row);samples.push(row);
 });
 oracleBenchmark.push({scenario:s.name,effectiveMissingProbability:missingProbability,method:"Идеализированный контроль с истинными флагами",oracle:true,runs:c.runs,coverage:oracle.accepted/c.runs,accuracy:oracle.accepted?oracle.correct/oracle.accepted:null,correctUnconditional:oracle.correct/c.runs});
  if(checkpoint&&scenarioIndex<scenarioSettings.length-1)
   return {__checkpoint:{nextScenario:scenarioIndex+1,randomState:r.getState(),rows,oracleBenchmark,sourceRuns}};
 }
 return {rows,oracleBenchmark,
  ...(c.record_source_runs?{sourceRunJournal:{schemaVersion:1,studyId:"uncertainty",complete:true,
   runsPerScenario:c.runs,scenarios:4,agents:c.agents,threshold:c.threshold,entries:sourceRuns}}:{}),
  summary:"Три сравниваемых метода используют только наблюдения и одинаковый порог. Отдельный oracleBenchmark вычислен с истинными флагами и не входит в практическое ранжирование.",chartKey:"correctUnconditional",chartLabel:"P(правильное решение без отказа)",series:"method",limits:"Прикладной вес строится из отклонения от медианы и наблюдаемого возраста сообщения; оценщик синтетический и не калиброван. OracleBenchmark использует скрытые истинные флаги только как идеализированный контроль."};
}
export function propagate(n,edges,initial,r,p,steps,defense=0,tape=null){
 const infected=new Set(initial),history=[infected.size];let available=new Set(initial);
 for(let t=1;t<=steps;t++){
  const newly=new Set();
  for(let i=0;i<edges.length;i++){
   const [a,b]=edges[i],u=tape?tape[t-1][i]:r.random();
   if(available.has(a)&&!infected.has(b)&&u<clamp(p*(1-defense),0,1))newly.add(b);
  }
  for(const v of newly)infected.add(v);available=new Set([...available,...newly]);
  history.push(infected.size);
 }
 return {infected,history};
}
export function runProbGraph(c,checkpoint=null){
 const modes=[["Без дополнительного снижения",0],["Снижение вероятности распространения (η=0,38)",.38],["Снижение вероятности распространения (η=0,68)",.68]];
 const scenarios=[["Компрометация источника",.8,1],["Подмена межагентных сообщений",1.2,1],["Компрометация координатора",1.35,2],["Согласованная атака",1.25,3]];
 const rows=checkpoint?.rows?[...checkpoint.rows]:[],
 pairedRuns=checkpoint?.pairedRuns?[...checkpoint.pairedRuns]:[],
 pairedEffects=checkpoint?.pairedEffects?[...checkpoint.pairedEffects]:[];
 let replaySample=checkpoint?.replaySample||null;
 for(let scenarioIndex=checkpoint?.nextScenario??0;scenarioIndex<scenarios.length;scenarioIndex++){
 const [scenario,mult,start]=scenarios[scenarioIndex];
  const statistics=modes.map(()=>({losses:[],events:[],trajectories:Array(c.steps+1).fill(0)}));
  for(let run=0;run<c.runs;run++){
   // Exactly the same topology, initial compromised vertices and stochastic transmission
   // events are passed to every protection level within this paired run.
   const eventSeed=((c.seed>>>0)^Math.imul(scenarioIndex+1,0x9e3779b9)^Math.imul(run+1,0x85ebca6b))>>>0;
   const random=rng(eventSeed),edges=graph(c.agents,c.edgeProbability,random);
   const initialNodes=chooseUniqueNodes(random,c.agents,start);
   const tape=Array.from({length:c.steps},()=>edges.map(()=>random.random()));
   if(scenarioIndex===0&&run===0)replaySample={runId:"E3/scenario-0/run-0/baseline",scenario,run,eventSeed,
    initialNodes:[...initialNodes],edges:edges.map(e=>[...e]),eventTape:tape.map(t=>[...t]),
    scenarioMultiplier:mult,defenseFactor:0};
   const outcome={scenario,run,initialNodes,initialCount:initialNodes.length,eventSeed,edgeCount:edges.length,methods:[]};
   modes.forEach(([method,defense],index)=>{
    const result=propagate(c.agents,edges,initialNodes,random,c.spread*mult,c.steps,defense,tape);
    const fraction=result.infected.size/c.agents;
    statistics[index].losses.push(fraction);
    statistics[index].events.push(fraction>=c.criticalFraction?1:0);
    result.history.forEach((v,t)=>statistics[index].trajectories[t]+=v/c.agents);
    outcome.methods.push({method,defense,infectedCount:result.infected.size,finalFraction:fraction,danger:Number(fraction>=c.criticalFraction)});
   });
   pairedRuns.push(outcome);
  }
  modes.forEach(([method,defense],index)=>{
   const {losses,events,trajectories}=statistics[index];
   const ci=wilson95(events.reduce((a,b)=>a+b,0),c.runs),meanCI=mean95(losses);
   rows.push({scenario,method,defense,runs:c.runs,initialCount:start,expectedFraction:meanCI.estimate,
    expectedFractionCI95Low:meanCI.lower,expectedFractionCI95High:meanCI.upper,
    dangerProbability:ci.estimate,dangerCI95Low:ci.lower,dangerCI95High:ci.upper,dangerEvents:ci.events,
    p95Fraction:pct(losses,.95),...Object.fromEntries(trajectories.map((v,t)=>["t"+t,v/c.runs]))});
  });
  for(let mode=1;mode<modes.length;mode++){
   const ci=pairedDifference95(statistics[0].events,statistics[mode].events,c.seed+scenarioIndex*101+mode,300);
   const differences=statistics[0].events.map((v,i)=>v-statistics[mode].events[i]);
   const p=c.runs>=2?pairedSignFlipP(differences,c.seed+scenarioIndex*101+mode,4095):null;
   pairedEffects.push({scenario,baseline:modes[0][0],method:modes[mode][0],runs:c.runs,
    reductionDanger:ci.estimate,reductionCI95Low:ci.lower,reductionCI95High:ci.upper,
    pRaw:p?.p??null,pHolm:null,holmReject05:null,pMethod:p?.method??null,
    paired:true,intervalMethod:ci.method,warning:"Интервал учитывает вариацию Монте-Карло и не скорректирован на множественные сравнения. p-значения корректируются Холмом."});
  }
  if(checkpoint&&scenarioIndex<scenarios.length-1)
   return {__checkpoint:{nextScenario:scenarioIndex+1,rows,pairedRuns,pairedEffects,replaySample}};
 }
 const tested=pairedEffects.filter(row=>row.pRaw!==null);
 const adjusted=holmAdjusted(tested.map(row=>row.pRaw));
 tested.forEach((row,i)=>{row.pHolm=adjusted[i];row.holmReject05=adjusted[i]<.05;});
 return {rows,pairedRuns,pairedEffects,replaySample,statisticsVersion:STATISTICS_VERSION,
  multipleTesting:{family:"E3-protection-vs-baseline",tested:tested.length,planned:pairedEffects.length,correction:"Holm-FWER-0.05",unadjustedCI:true},
  comparisonDesign:"paired-common-random-numbers",summary:"Парный Монте-Карло: внутри каждого прогона все уровни снижения вероятности распространения сравниваются при одинаковом графе, наборе уникальных очагов и потоке случайных событий.",chartKey:"dangerProbability",chartLabel:"P(опасного состояния)",series:"method",limits:"Коэффициенты 0,38 и 0,68 уменьшают вероятность распространения, но сами по себе не моделируют алгоритмы фильтрации сообщений или робастной координации."};
}
export const PETRI_CHECKPOINT_BATCH=8192;
export function runPetri(c,checkpoint=null){
 const n=c.agents,T=c.steps,critical=c.criticalCount;
 const edges=fixedEdges7.filter(([a,b])=>a<n&&b<n);
 const start={mask:1,isolated:0,t:0,trace:["t=0: скомпрометирован A1"]};
 const saved=checkpoint?.bfs;
 let q=saved?[...saved.queue]:[start],index=saved?.index??0,
  seen=new Set(saved?.seen||["1:0:0"]),reachable=false,witness=[],
  statesByTime=saved?[...saved.statesByTime]:Array(T+1).fill(0),truncated=false;
 const stageEnd=checkpoint?Math.min(c.stateLimit,(checkpoint.nextScenario+1)*PETRI_CHECKPOINT_BATCH):c.stateLimit;
 const add=(mask,isolated,t,trace)=>{const key=[mask,isolated,t].join(":");if(!seen.has(key)){seen.add(key);q.push({mask,isolated,t,trace});}};
 const popcount=mask=>{let n=0;while(mask){n+=mask&1;mask>>>=1;}return n;};
 while(index<q.length&&index<c.stateLimit&&index<stageEnd){const state=q[index++];statesByTime[state.t]++;if(popcount(state.mask)>=critical){reachable=true;witness=state.trace;break;}
  if(state.t>=T)continue;
  // Timed transitions: transmission and isolation each consume one simulated tick.
  const next=state.t+1;
  if(c.isolationPolicy===1&&next>=c.detectionDelay){
   // Idealised PRIORITY controller. Detection is assumed perfect: all currently
   // compromised and non-isolated agents are isolated together in this tick.
   // Waiting/transmission are disabled whenever this mandatory rule is enabled.
   const newly=state.mask&~state.isolated;
   const names=Array.from({length:n},(_,i)=>newly&(1<<i)?"A"+(i+1):null).filter(Boolean);
   add(state.mask,state.isolated|newly,next,[...state.trace,
    "t="+next+": обязательная изоляция "+(names.join(", ")||"нет новых агентов")]);
   continue;
  }
  add(state.mask,state.isolated,next,[...state.trace,"t="+next+": ожидание"]);
  for(const [a,b] of edges)if(state.mask&(1<<a)&&!(state.isolated&(1<<a))&&!(state.mask&(1<<b))&&!(state.isolated&(1<<b)))
   add(state.mask|(1<<b),state.isolated,next,[...state.trace,"t="+next+": передача A"+(a+1)+" → A"+(b+1)]);
  if(c.isolationPolicy===0&&next>=c.detectionDelay){for(let v=0;v<n;v++)if((state.mask&(1<<v))&&!(state.isolated&(1<<v)))
   add(state.mask,state.isolated|(1<<v),next,[...state.trace,"t="+next+": изоляция A"+(v+1)]);}
 }
 if(checkpoint&&!reachable&&index<q.length&&index<c.stateLimit&&index>=stageEnd)
  return {__checkpoint:{nextScenario:checkpoint.nextScenario+1,
   bfs:{queue:q,index,seen:[...seen],statesByTime}}};
 if(!reachable&&index<q.length)truncated=true;
 const verdict=reachable?"reachable":truncated?"inconclusive":"unreachable_within_bound";
 const rows=[{criterion:"Достижимо опасное состояние",value:truncated?"Не установлено":(reachable?"Да":"Нет")},{criterion:"Число исследованных маркировок",value:index},{criterion:"Число зарегистрированных маркировок",value:seen.size},{criterion:"Горизонт, тактов",value:T},{criterion:"Порог компрометации",value:critical},{criterion:"Стратегия изоляции",value:c.isolationPolicy===0?"Необязательная":"Приоритетная, идеализированная"},{criterion:"Превышен предел пространства состояний",value:truncated?"Да":"Нет"}];
 return {rows,verdict,processed:index,enqueued:seen.size,witness,statesByTime,edges,isolationPolicy:c.isolationPolicy,policyName:c.isolationPolicy===0?"optional_nondeterministic":"ideal_mandatory_priority",summary:"Ограниченная по времени проверка достижимости в дискретной временной раскрашенной сети Петри: метки окрашены идентификатором агента; переходы заражения, ожидания и изоляции имеют задержку один такт.",chartKey:"",chartLabel:"",limits:"Текущий формализованный подкласс использует единичную задержку переходов и один цвет токена — идентификатор агента. При превышении предела поиска результат НЕ является доказательством недостижимости. Необязательная изоляция не обязана менять EF при варьировании τ. Приоритетная политика предполагает мгновенное безошибочное обнаружение всех ранее компрометированных агентов, одновременно изолирует их и запрещает ожидание и передачу на таком такте. Она является идеализированной верхней границей управляемой защиты, а не реалистичным детектором."};
}
export function runCascade(c,checkpoint=null){
 const rows=checkpoint?.rows?[...checkpoint.rows]:[],
 pairedRuns=checkpoint?.pairedRuns?[...checkpoint.pairedRuns]:[],
 pairedEffects=checkpoint?.pairedEffects?[...checkpoint.pairedEffects]:[];
 let replaySample=checkpoint?.replaySample||null;
 const impacts=[1,1.2,1.1,1.7,2.1,1.5,2.4,3].map(x=>x*c.lossScale);
 const criticalDamage=.45*impacts.reduce((a,b)=>a+b,0);
 const conditions=[["Без сдерживания",0],["Защитные меры",c.defenseFactor]];
 for(let start=checkpoint?.nextScenario??0;start<c.agents;start++){
  const scenario="Начальная компрометация A"+(start+1);
  const stats=conditions.map(()=>({losses:[],affected:[],critical:[]}));
  for(let run=0;run<c.runs;run++){
   const eventSeed=((c.seed>>>0)^Math.imul(start+1,0x9e3779b9)^Math.imul(run+1,0x85ebca6b))>>>0;
   const random=rng(eventSeed);
   const tape=Array.from({length:8},()=>fixedEdges8.map(()=>random.random()));
   if(start===0&&run===0)replaySample={runId:"E5/source-0/run-0/baseline",scenario,run,eventSeed,
    initialNode:start,edges:fixedEdges8.map(e=>[...e]),eventTape:tape.map(t=>[...t]),
    impactWeights:[...impacts],defenseFactor:0};
   const pair={scenario,run,eventSeed,initialNode:start,methods:[]};
   conditions.forEach(([method,defense],index)=>{
    const p=propagate(8,fixedEdges8,[start],random,c.spread,8,defense,tape);
    const cost=[...p.infected].reduce((sum,i)=>sum+impacts[i],0);
    const danger=Number(cost>=criticalDamage);
    stats[index].losses.push(cost);stats[index].affected.push(p.infected.size);
    stats[index].critical.push(danger);
    pair.methods.push({method,defense,loss:cost,danger,affectedCount:p.infected.size});
   });
   pairedRuns.push(pair);
  }
  conditions.forEach(([method,defense],index)=>{
   const {losses,affected,critical}=stats[index];
   const meanCI=mean95(losses),dangerCI=wilson95(critical.reduce((u,v)=>u+v,0),c.runs);
   const tail=bootstrap95(losses,values=>expectedShortfall(values,.95),c.seed+start*109+Math.round(defense*100),200);
   rows.push({scenario,method,runs:c.runs,directDamage:impacts[start],expectedDamage:meanCI.estimate,
    expectedDamageCI95Low:meanCI.lower,expectedDamageCI95High:meanCI.upper,
    excessDamage:avg(losses.map(v=>Math.max(0,v-impacts[start]))),
    dangerProbability:dangerCI.estimate,dangerCI95Low:dangerCI.lower,dangerCI95High:dangerCI.upper,
    dangerEvents:dangerCI.events,p95Damage:pct(losses,.95),
    es95:expectedShortfall(losses,.95),es95CI95Low:tail.lower,es95CI95High:tail.upper,
    tailSamples:.05*c.runs,
    tailWarning:.05*c.runs<10?"Менее 10 эквивалентных наблюдений верхних 5%; хвостовая оценка нестабильна":null,
    affectedAgents:avg(affected)});
  });
  const damage=pairedDifference95(stats[0].losses,stats[1].losses,c.seed+start*107+1,300);
  const danger=pairedDifference95(stats[0].critical,stats[1].critical,c.seed+start*107+2,300);
  const damageP=c.runs>=2?pairedSignFlipP(stats[0].losses.map((v,i)=>v-stats[1].losses[i]),c.seed+start*107+1,4095):null;
  const dangerP=c.runs>=2?pairedSignFlipP(stats[0].critical.map((v,i)=>v-stats[1].critical[i]),c.seed+start*107+2,4095):null;
  pairedEffects.push({scenario,runs:c.runs,baseline:conditions[0][0],method:conditions[1][0],
   reductionDamage:damage.estimate,reductionDamageCI95Low:damage.lower,reductionDamageCI95High:damage.upper,
   reductionDanger:danger.estimate,reductionDangerCI95Low:danger.lower,reductionDangerCI95High:danger.upper,
   pRawDamage:damageP?.p??null,pRawDanger:dangerP?.p??null,
   pHolmDamage:null,pHolmDanger:null,holmRejectDamage05:null,holmRejectDanger05:null,
   intervalMethod:damage.method,paired:true});
  if(checkpoint&&start<c.agents-1)
   return {__checkpoint:{nextScenario:start+1,rows,pairedRuns,pairedEffects,replaySample}};
 }
 const allTests=pairedEffects.flatMap(row=>[
  ...(row.pRawDamage===null?[]:[{row,metric:"Damage",p:row.pRawDamage}]),
  ...(row.pRawDanger===null?[]:[{row,metric:"Danger",p:row.pRawDanger}])
 ]);
 const corrected=holmAdjusted(allTests.map(x=>x.p));
 allTests.forEach((test,i)=>{
  test.row["pHolm"+test.metric]=corrected[i];
  test.row["holmReject"+test.metric+"05"]=corrected[i]<.05;
 });
 return {rows,pairedRuns,pairedEffects,replaySample,multipleTesting:{
   family:"E5-eight-sources-times-two-outcomes",tested:allTests.length,
   planned:pairedEffects.length*2,correction:"Holm-FWER-0.05",unadjustedCI:true},
  comparisonDesign:"paired-common-random-numbers",
  summary:"Сравнение режимов каскадного распространения выполняется на общих таблицах случайных событий. ES95 — средняя потеря худших 5% вероятностной массы, включая дробную массу на границе квантиля.",
  chartKey:"expectedDamage",chartLabel:"Математическое ожидание ущерба",series:"method",
  limits:"Коэффициенты критичности и распространения синтетические. Интервалы описывают только вариацию Монте-Карло; при малом числе хвостовых наблюдений оценки ES95 ненадёжны."};
}
function tmean(x,trimEachSide=3){if(!x.length)return 0;const a=[...x].sort((p,q)=>p-q),trim=Math.min(trimEachSide,Math.floor((a.length-1)/2));return avg(a.slice(trim,a.length-trim));}
export function runMisinformation(c,checkpoint=null){
 const r=rng(c.seed);if(checkpoint?.randomState!==undefined)r.restore(checkpoint.randomState);
 const rows=checkpoint?.rows?[...checkpoint.rows]:[],
  scenarioMetrics=checkpoint?.scenarioMetrics?[...checkpoint.scenarioMetrics]:[],
  robustnessSensitivity=checkpoint?.robustnessSensitivity?[...checkpoint.robustnessSensitivity]:[],
  sourceRuns=checkpoint?.sourceRuns?[...checkpoint.sourceRuns]:[];
 const methods=["Обычное среднее","Взвешивание по наблюдаемым признакам","Усечённое среднее (fmax=3)"];
 for(let bad=checkpoint?.nextScenario??0;bad<=Math.min(3,c.agents-1);bad++){
  const stats=methods.map(()=>({wrong:0,correct:0,abstain:0,deviation:0}));
  const trimStats=Array.from({length:4},()=>({wrong:0,correct:0,abstain:0,deviation:0}));let exposedSum=0;
  for(let k=0;k<c.runs;k++){
   const truth=r.random()<.5?1:-1;const seeds=new Set();while(seeds.size<bad)seeds.add(sample(r,c.agents));const exposed=new Set(seeds);
   const rawTapes=c.record_source_runs?[]:null;
   for(let t=0;t<3;t++){const eventTape=fixedEdges7.map(()=>r.random());
    if(rawTapes)rawTapes.push([...eventTape]);
    const tick=spreadOneTick(exposed,fixedEdges7,eventTape,c.spread);exposed.clear();for(const v of tick.next)exposed.add(v);}
   const points=[];for(let i=0;i<c.agents;i++){const compromised=seeds.has(i),misled=exposed.has(i);
    const x=truth+r.normal()*c.noise+(compromised?-truth*c.attackBias:misled?-truth*c.attackBias*.7:0);
    points.push({x});
   }
   exposedSum+=exposed.size/c.agents;
   const weights=estimateReliabilityFromObservations(points,c.noise);
   const observed=points.map(x=>x.x);
   const votes=[avg(observed),points.reduce((a,x,i)=>a+x.x*weights[i],0)/weights.reduce((a,b)=>a+b,0),tmean(observed,3)];
   if(rawTapes)sourceRuns.push({scenario:"Скомпрометировано "+bad+" из "+c.agents,
    compromised:bad,run:k,truth,initialCompromised:[...seeds].sort((a,b)=>a-b),
    exposed:[...exposed].sort((a,b)=>a-b),edges:fixedEdges7.map(e=>[...e]),
    eventTapes:rawTapes,observations:observed.map((x,i)=>({agent:i+1,value:x})),
    methodEstimates:[...votes],trimEstimates:Array.from({length:4},(_,trim)=>tmean(observed,trim)),
    estimatorUsesHiddenFlags:false});
   votes.forEach((v,j)=>{const m=stats[j];if(Math.abs(v)<c.threshold)m.abstain++;else if(Math.sign(v)===truth)m.correct++;else m.wrong++;
     m.deviation+=Math.abs(v-truth);});
   for(let trim=0;trim<=3;trim++){
    const estimate=tmean(observed,trim),m=trimStats[trim];
    if(Math.abs(estimate)<c.threshold)m.abstain++;
    else if(Math.sign(estimate)===truth)m.correct++;
    else m.wrong++;
    m.deviation+=Math.abs(estimate-truth);
   }
  }
  scenarioMetrics.push({scenario:"Скомпрометировано "+bad+" из "+c.agents,compromised:bad,runs:c.runs,meanExposedFraction:exposedSum/c.runs,appliesTo:"scenario-not-method"});
  stats.forEach((m,j)=>{
   const wrongCI=wilson95(m.wrong,c.runs),refuseCI=wilson95(m.abstain,c.runs),correctCI=wilson95(m.correct,c.runs);
   const risk=c.costWrong*wrongCI.estimate+c.costRefuse*refuseCI.estimate;
   rows.push({scenario:"Скомпрометировано "+bad+" из "+c.agents,compromised:bad,method:methods[j],runs:c.runs,
    wrongProbability:wrongCI.estimate,wrongCI95Low:wrongCI.lower,wrongCI95High:wrongCI.upper,
    correctProbability:correctCI.estimate,correctCI95Low:correctCI.lower,correctCI95High:correctCI.upper,
    abstentionProbability:refuseCI.estimate,abstentionCI95Low:refuseCI.lower,abstentionCI95High:refuseCI.upper,
    meanDeviation:m.deviation/c.runs,risk,costWrong:c.costWrong,costRefuse:c.costRefuse});
  });
  trimStats.forEach((m,trim)=>{
   const correct=m.correct/c.runs,wrong=m.wrong/c.runs,abstain=m.abstain/c.runs;
   robustnessSensitivity.push({scenario:"Скомпрометировано "+bad+" из "+c.agents,
    compromised:bad,trim_each_side:trim,runs:c.runs,
    correctProbability:correct,wrongProbability:wrong,abstentionProbability:abstain,
    meanDeviation:m.deviation/c.runs,risk:c.costWrong*wrong+c.costRefuse*abstain,
    costWrong:c.costWrong,costRefuse:c.costRefuse});
  });
  if(checkpoint&&bad<Math.min(3,c.agents-1))
   return {__checkpoint:{nextScenario:bad+1,randomState:r.getState(),rows,scenarioMetrics,robustnessSensitivity,sourceRuns}};
 }
 return {rows,scenarioMetrics,robustnessSensitivity,
  ...(c.record_source_runs?{sourceRunJournal:{schemaVersion:1,studyId:"misinformation",complete:true,
   runsPerScenario:c.runs,scenarios:4,agents:c.agents,threshold:c.threshold,entries:sourceRuns}}:{}),
  statisticsVersion:STATISTICS_VERSION,summary:"Сравнительная оценка риска неверного коллективного решения при компрометации от нуля до трёх агентов и распространении ложной информации по девяти ориентированным зависимостям.",chartKey:"wrongProbability",chartLabel:"P(ошибочного решения)",series:"method",limits:"Для сравниваемых методов истинная метка компрометации недоступна; веса определяются по наблюдаемым оценкам. Усечение трёх значений с каждой стороны при N=7 допускает fmax=3, но не гарантирует эффективность против согласованных атак. Результаты требуют внешней калибровки. Риск = costWrong·P(ошибка)+costRefuse·P(отказ), без стоимости задержки; охват общий для сценария."};
}
export function validateStudy(id,raw={}){
 const def=STUDY_DEFS.find(s=>s.id===id);if(!def)throw Error("Неизвестный эксперимент");
 if(!raw||typeof raw!=="object"||Array.isArray(raw))throw Error("Конфигурация должна быть объектом");
 const c={...def.defaults,...raw};
 for(const [key,value] of Object.entries(c))
  if(typeof value!=="number"||!Number.isFinite(value))throw Error("Параметр "+key+": требуется конечное число");
 const integer=(key,min,max)=>{const x=c[key];if(!Number.isInteger(x)||x<min||x>max)throw Error("Параметр "+key+": целое число от "+min+" до "+max);};
 const bounded=(key,min,max)=>{const x=c[key];if(x<min||x>max)throw Error("Параметр "+key+": диапазон ["+min+"; "+max+"]");};
 integer("agents",3,100);integer("runs",1,10000);integer("seed",-2147483648,2147483647);
  if("record_source_runs" in c){
   integer("record_source_runs",0,1);integer("source_run_limit",1,1000);
   if(c.record_source_runs){
    if(c.runs>c.source_run_limit)throw Error("Архив исходных прогонов: R превышает лимит полного архива");
    if(c.agents*c.runs*4>50000)throw Error("Архив исходных прогонов: превышен предел 50000 агентных наблюдений");
   }
  }
 for(const key of ["loss","corruption","edgeProbability","spread","criticalFraction","defenseFactor"])
  if(key in c)bounded(key,0,1);
 for(const key of ["noise","signalNoise","attackBias","threshold","costWrong","costRefuse"])
  if(key in c)bounded(key,0,100);
 if("steps" in c)integer("steps",1,20);
 if("criticalCount" in c)integer("criticalCount",1,c.agents);
 if("detectionDelay" in c)integer("detectionDelay",0,20);
 if("isolationPolicy" in c)integer("isolationPolicy",0,1);
 if("stateLimit" in c)integer("stateLimit",100,200000);
 if("lossScale" in c)bounded("lossScale",Number.MIN_VALUE,100);
 if(id==="petri"){
  if(c.agents!==7)throw Error("Параметр agents: фиксированная сеть Петри требует N=7");
  if(c.runs!==1)throw Error("Параметр runs: формальный поиск является единственным запуском (R=1)");
 }
 if(id==="cascade"&&c.agents!==8)throw Error("Параметр agents: для каскадов требуется N=8");
 if(id==="misinformation"&&c.agents!==7)throw Error("Параметр agents: для информационного графа требуется N=7");
 return c;
}
export const RESEARCH_CHECKPOINT_SCHEMA=1;
export const researchCheckpointUnits=(id,c)=>id==="cascade"?c.agents:
 id==="petri"?Math.ceil(c.stateLimit/PETRI_CHECKPOINT_BATCH):4;
export function validateResearchCheckpoint(id,c,state){
 const total=researchCheckpointUnits(id,c);
 if(!state||typeof state!=="object"||Array.isArray(state)||!Number.isInteger(state.nextScenario)||
    state.nextScenario<0||state.nextScenario>=total)throw Error("Некорректный индекс контрольной точки исследования");
 const n=state.nextScenario;
 if(state.accumulatedExecutionMs!==undefined&&
  (!Number.isFinite(state.accumulatedExecutionMs)||state.accumulatedExecutionMs<0))
  throw Error("Некорректное накопленное время вычисления");
 if(n>0&&(state.schemaVersion!==RESEARCH_CHECKPOINT_SCHEMA||state.studyId!==id||
   state.modelVersion!==RESEARCH_MODEL_VERSION||state.configSignature!==JSON.stringify(c)))
  throw Error("Контрольная точка относится к иной модели или конфигурации");
 if(id==="petri"&&n>0){
  const bfs=state.bfs;
  if(!bfs||!Array.isArray(bfs.queue)||!Array.isArray(bfs.seen)||
   !Array.isArray(bfs.statesByTime)||bfs.statesByTime.length!==c.steps+1||
   bfs.index!==n*PETRI_CHECKPOINT_BATCH||bfs.queue.length!==bfs.seen.length||
   bfs.queue.length<bfs.index)
   throw Error("Повреждена очередь контрольной точки BFS");
 }
 const lengths=id==="uncertainty"?{rows:3*n,oracleBenchmark:n,...(c.record_source_runs?{sourceRuns:n*c.runs}:{})}:
  id==="probgraph"?{rows:3*n,pairedRuns:c.runs*n,pairedEffects:2*n}:
  id==="cascade"?{rows:2*n,pairedRuns:c.runs*n,pairedEffects:n}:
  id==="misinformation"?{rows:3*n,scenarioMetrics:n,robustnessSensitivity:4*n,
   ...(c.record_source_runs?{sourceRuns:n*c.runs}:{})}:{};
 for(const [key,size] of Object.entries(lengths)){
  if((!Array.isArray(state[key])&&n>0)||(Array.isArray(state[key])&&state[key].length!==size))
   throw Error("Повреждена контрольная точка "+id+": "+key);
 }
 if(n>0&&(id==="uncertainty"||id==="misinformation")&&
    (!Number.isInteger(state.randomState)||state.randomState<1||state.randomState>4294967295))
  throw Error("Повреждено состояние ГПСЧ "+id);
 return true;
}
function completeResearchResult(id,c,result,elapsedMs){
 const metricIntegrity=auditResultMetrics(id,result);
 if(!metricIntegrity.valid)throw Error("Контроль показателей "+id+": "+metricIntegrity.issues.join("; "));
 return {id,config:c,model:"synthetic-experimental",modelVersion:RESEARCH_MODEL_VERSION,statisticsVersion:STATISTICS_VERSION,
  metricPassportVersion:METRIC_PASSPORT_VERSION,metricPassport:passportForStudy(id),metricIntegrity,
  ...result,replay:buildResearchReplay(id,c,result),elapsedMs};
}
const researchHandlers={uncertainty:runUncertainty,probgraph:runProbGraph,petri:runPetri,
 cascade:runCascade,misinformation:runMisinformation};
export function executeStudy(id,params={}){
 const c=validateStudy(id,params),start=Date.now();
 return completeResearchResult(id,c,researchHandlers[id](c),Date.now()-start);
}
/** One complete scenario/source per call, preserving the original RNG sequence. */
export function executeStudyChunk(id,params={},checkpoint=null){
 const c=validateStudy(id,params),start=Date.now(),totalUnits=researchCheckpointUnits(id,c);
 const state=checkpoint||{nextScenario:0};
 validateResearchCheckpoint(id,c,state);
 const raw=researchHandlers[id](c,state);
 if(raw.__checkpoint){
  const next={...raw.__checkpoint,schemaVersion:RESEARCH_CHECKPOINT_SCHEMA,studyId:id,
   modelVersion:RESEARCH_MODEL_VERSION,configSignature:JSON.stringify(c),
   accumulatedExecutionMs:(state.accumulatedExecutionMs||0)+(Date.now()-start)};
  validateResearchCheckpoint(id,c,next);
  if(next.nextScenario!==state.nextScenario+1)throw Error("Невалидный переход контрольной точки");
  return {done:false,completedUnits:next.nextScenario,totalUnits,state:next,elapsedMs:Date.now()-start};
 }
 return {done:true,completedUnits:id==="petri"?state.nextScenario+1:totalUnits,totalUnits,
  result:completeResearchResult(id,c,raw,(state.accumulatedExecutionMs||0)+(Date.now()-start))};
}
export function toCsv(rows){if(!rows?.length)return "";const columns=[...new Set(rows.flatMap(row=>Object.keys(row)))];const escape=x=>{const t=x==null?"":String(x);return /[";\r\n]/.test(t)?'"'+t.replaceAll('"','""')+'"':t;};return "\ufeff"+columns.join(";")+"\n"+rows.map(row=>columns.map(k=>escape(row[k])).join(";")).join("\n");}
export function statisticalIndicators(values){return quantileInfo(values);}


/* A deterministic, explicitly labelled path for graph playback.
   Statistical tables retain their independent Monte-Carlo interpretation. */
export function buildResearchReplay(id,c,result={}){
 const r=rng(c.seed), n=c.agents, vertices=Array.from({length:n},(_,i)=>({id:i,label:"А"+(i+1)}));
 const frames=[], snap=(step,status,activeEdges=[],info="",value=null)=>frames.push({
   step,status:[...status],activeEdges:activeEdges.map(e=>[...e]),info,value
 });
 const choose=(x)=>x===undefined?0:x;
 if(id==="uncertainty"){
   const edges=Array.from({length:n-1},(_,i)=>[i,n-1]); const truth=1;
   for(let t=0;t<9;t++){
     const status=Array(n).fill("normal"), observed=[],active=[];
     for(let i=0;i<n-1;i++){
       if(r.random()<c.loss){status[i]="missing";continue;}
       const corrupt=r.random()<c.corruption,stale=r.random()<(t%3===2?.35:.03);
       const x=(stale?-truth:truth)+r.normal()*c.signalNoise+(corrupt?-truth*1.6:0);
       if(corrupt||stale)status[i]="misled";else status[i]="normal";
       observed.push(x);active.push([i,n-1]);
     }
     const estimate=avg(observed),decision=observed.length<Math.ceil(n*.3)||Math.abs(estimate)<c.threshold?"оператор":estimate>0?"угроза":"норма";
     status[n-1]="coordinator";
     snap(t,status,active,"Принято сообщений: "+observed.length+"/"+(n-1)+"; решение: "+decision,estimate);
   }
   return {title:"Маршрут сообщений и автоматическая выработка решения",vertices,edges,frames,notes:"Иллюстративная отдельная трасса для фиксированного зерна; статистические показатели вычисляются по независимым прогонам.",valueLabel:"Оценка состояния"};
 }
 if(id==="probgraph"&&result?.replaySample){
   const sample=result.replaySample,edges=sample.edges;
   let infected=new Set(sample.initialNodes);
   const status=()=>Array.from({length:n},(_,i)=>infected.has(i)?"compromised":"normal");
   snap(0,status(),[],"Исходная компрометация: "+sample.initialNodes.map(i=>"А"+(i+1)).join(", "),infected.size/n);
   for(let t=1;t<=c.steps;t++){
    const tick=spreadOneTick(infected,edges,sample.eventTape[t-1],clamp(c.spread*sample.scenarioMultiplier*(1-sample.defenseFactor),0,1));
    infected=tick.next;
    snap(t,status(),tick.activeEdges,"Новые поражённые агенты: "+tick.newly.size+"; всего: "+infected.size+"/"+n,infected.size/n);
   }
   return {title:"Фактическая трасса парного прогона графа угроз",vertices,edges,frames,runId:sample.runId,eventSeed:sample.eventSeed,
    notes:"Фактический run=0 первого сценария без снижения вероятности. События и итог совпадают с pairedRuns[0].",valueLabel:"Доля поражённых"};
  }
 if(id==="probgraph"){
   const edges=graph(n,c.edgeProbability,r);const seeds=[sample(r,n)];const infected=new Set(seeds),available=new Set(seeds);
   const status=()=>Array.from({length:n},(_,i)=>infected.has(i)?"compromised":"normal");
   snap(0,status(),[],"Исходная компрометация: А"+(seeds[0]+1),infected.size/n);
   for(let t=1;t<=c.steps;t++){
     const active=[],newly=new Set();
     for(const [a,b] of edges)if(available.has(a)&&!infected.has(b)&&r.random()<clamp(c.spread*.8,0,1)){newly.add(b);active.push([a,b]);}
     for(const v of newly){infected.add(v);available.add(v);}
     snap(t,status(),active,"Новые поражённые агенты: "+newly.size+"; всего: "+infected.size+"/"+n,infected.size/n);
   }
   return {title:"Графо-вероятностное распространение нарушения",vertices,edges,frames,notes:"Первая реализация сценария «Компрометация источника» без дополнительной защиты; рёбра случайного графа фиксированы зерном.",valueLabel:"Доля поражённых"};
 }
 if(id==="petri"){
   const edges=result.edges||fixedEdges7.filter(([a,b])=>a<n&&b<n), compromised=new Set([0]),isolated=new Set(),witness=result.witness||[];
   const status=()=>Array.from({length:n},(_,i)=>isolated.has(i)?"isolated":compromised.has(i)?"compromised":"normal");
   snap(0,status(),[],"Начальная маркировка: токен компрометации агента А1",1);
   for(let t=1;t<=c.steps;t++){
     const idealWait=!witness.length&&c.isolationPolicy===1&&t>=c.detectionDelay;
     const line=witness[t]||(idealWait?"t="+t+": обязательная изоляция "+[...compromised].filter(i=>!isolated.has(i)).map(i=>"A"+(i+1)).join(", "):"t="+t+": ожидание");
     const transmitted=line.match(/передача A(\d+) → A(\d+)/),active=[];
     if(transmitted){compromised.add(Number(transmitted[2])-1);active.push([Number(transmitted[1])-1,Number(transmitted[2])-1]);}
     if(line.includes("обязательная изоляция")){
      for(const m of line.matchAll(/A(\d+)/g))isolated.add(Number(m[1])-1);
     }else{
      const blocked=line.match(/изоляция A(\d+)/);
      if(blocked)isolated.add(Number(blocked[1])-1);
     }
     snap(t,status(),active,line,compromised.size);
     if(witness.length&&t>=witness.length-1)break;
   }
   return {title:"Последовательность маркировок и переходов сети Петри",vertices,edges,frames,notes:result.witness?.length?"Воспроизводится найденная трасса-контрпример, содержащая достижение опасной маркировки.":result.verdict==="unreachable_within_bound"?"Фронт BFS исчерпан; показана отдельная допустимая траектория для выбранной политики.":result.verdict==="inconclusive"?"Поиск прерван до исчерпания фронта; показана иллюстративная траектория, безопасность не доказана.":"До расчёта показана иллюстративная траектория.",valueLabel:"Число компрометированных"};
 }
 if(id==="cascade"&&result?.replaySample){
   const sample=result.replaySample,edges=sample.edges;
   let infected=new Set([sample.initialNode]);
   const status=()=>Array.from({length:n},(_,i)=>infected.has(i)?"affected":"normal");
   const cost=()=>[...infected].reduce((acc,i)=>acc+sample.impactWeights[i],0);
   snap(0,status(),[],"Исходная компрометация: А"+(sample.initialNode+1)+"; прямой ущерб",cost());
   for(let t=1;t<=sample.eventTape.length;t++){
    const tick=spreadOneTick(infected,edges,sample.eventTape[t-1],clamp(c.spread*(1-sample.defenseFactor),0,1));
    infected=tick.next;
    snap(t,status(),tick.activeEdges,"Каскадные переходы: "+tick.newly.size+"; поражено "+infected.size+"/"+n,cost());
   }
   return {title:"Фактическая трасса парного каскадного прогона",vertices,edges,frames,runId:sample.runId,eventSeed:sample.eventSeed,
    notes:"Фактический run=0 при источнике А1 без сдерживания; события и ущерб совпадают с pairedRuns[0].",valueLabel:"Совокупный ущерб"};
  }
 if(id==="cascade"){
   const edges=fixedEdges8,infected=new Set([0]),available=new Set([0]),impacts=[1,1.2,1.1,1.7,2.1,1.5,2.4,3].map(x=>x*c.lossScale);
   const cost=()=>[...infected].reduce((a,i)=>a+impacts[i],0);
   const status=()=>Array.from({length:n},(_,i)=>infected.has(i)?"affected":"normal");
   snap(0,status(),[],"Исходная компрометация: А1; прямой ущерб",cost());
   for(let t=1;t<=8;t++){
     const active=[],newly=new Set();
     for(const [a,b] of edges)if(available.has(a)&&!infected.has(b)&&r.random()<c.spread){newly.add(b);active.push([a,b]);}
     for(const i of newly){infected.add(i);available.add(i);}
     snap(t,status(),active,"Каскадные переходы: "+newly.size+"; поражено "+infected.size+"/8",cost());
   }
   return {title:"Каскад функциональных нарушений",vertices,edges,frames,notes:"Первая реализация начальной компрометации А1 без сдерживания; условные коэффициенты ущерба совпадают с вычислительной моделью.",valueLabel:"Совокупный ущерб"};
 }
 if(id==="misinformation"){
   const edges=fixedEdges7,compromised=new Set([0,1]),exposed=new Set(compromised);
   const states=()=>Array.from({length:n},(_,i)=>compromised.has(i)?"compromised":exposed.has(i)?"misled":"normal");
   const evaluate=()=>{const points=Array.from({length:n},(_,i)=>1+r.normal()*c.noise+(compromised.has(i)?-c.attackBias:exposed.has(i)?-c.attackBias*.7:0));return avg(points);};
   snap(0,states(),[],"Начально скомпрометированы А1 и А2; эталонное состояние +1",evaluate());
   for(let t=1;t<=3;t++){
     const newly=new Set(),active=[];
     const tick=spreadOneTick(exposed,edges,edges.map(()=>r.random()),c.spread);
     for(const i of tick.newly)newly.add(i);
     for(const e of tick.activeEdges)active.push(e);
     for(const i of tick.newly)exposed.add(i);
     snap(t,states(),active,"Недостоверная информация достигла "+exposed.size+"/7 агентов; новых: "+newly.size,evaluate());
   }
   return {title:"Передача недостоверной информации и смещение коллективной оценки",vertices,edges,frames,notes:"Отдельная иллюстративная трасса при двух скомпрометированных агентах (из исследуемого диапазона 0–3).",valueLabel:"Средняя оценка"};
 }
 throw new Error("Неизвестная модель воспроизведения");
}
