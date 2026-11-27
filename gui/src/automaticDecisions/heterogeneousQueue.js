// E2.29: heterogeneous operators, actual decision errors and on-demand reserve.
// Queue discipline and routing only use public posterior intervals and state.
// Common arrival/observation/work/error streams permit paired comparisons.
import {validateExt,lawsExt,calibration,tables,point,select,loss,seedFor} from "./extendedModel.js";
import {validateClosedQueue,makeQueueStream} from "./closedLoopQueue.js";
import {random} from "./kernel.js";
const sum=a=>a.reduce((s,v)=>s+v,0),real=(v,a,b)=>Number.isFinite(v)&&v>=a&&v<=b,int=(v,a,b)=>Number.isInteger(v)&&v>=a&&v<=b;
export const DEFAULT_OPERATORS=[
 {name:"Дежурный 1",rate:10,fp:.08,fn:.10,cost:.18,hourly:.65,reserve:false},
 {name:"Эксперт",rate:5,fp:.025,fn:.025,cost:.32,hourly:1.05,reserve:false},
 {name:"Резерв",rate:8,fp:.05,fn:.06,cost:.24,hourly:.8,reserve:true}
];
export const QUEUE_POLICIES=[
 {name:"Постоянный порог / полный штат",feedback:false,skill:false,dynamic:false},
 {name:"Обратная связь / полный штат",feedback:true,skill:false,dynamic:false},
 {name:"Риск-ориентированная / полный штат",feedback:true,skill:true,dynamic:false},
 {name:"Риск-ориентированная / резерв",feedback:true,skill:true,dynamic:true}
];
export function validateHeterogeneousQueue(c){
 validateClosedQueue(c);
 if(!Array.isArray(c.operatorSpec)||c.operatorSpec.length<1||c.operatorSpec.length>12||!int(c.reserveOn,1,1000)||!int(c.reserveOff,0,c.reserveOn-1))throw Error("СМО: 1–12 операторов и порог отключения резерва строго ниже порога включения");
 const names=new Set();
 for(const a of c.operatorSpec){
  if(!a||typeof a.name!=="string"||!a.name.trim()||a.name.length>80||names.has(a.name)||!real(a.rate,.01,100000)||![a.fp,a.fn].every(v=>real(v,0,1))||![a.cost,a.hourly].every(v=>real(v,0,1000))||typeof a.reserve!=="boolean")throw Error("Оператор: уникальное имя, rate>0, fp/fn в [0,1], cost/hourly>=0, reserve boolean");
  names.add(a.name);
 }
 if(c.operatorSpec.every(a=>a.reserve))throw Error("Необходим хотя бы один постоянно доступный оператор");
 if(!int(c.queueReps,1,30)||!real(c.arrival,.01,100000)||!real(c.deadline,0,10000)||c.queueReps*c.arrival*c.queueHorizon*(1+(c.peakEnd-c.peakStart)*(c.peakMultiplier-1))>300000)throw Error("Бюджет: до 300000 ожидаемых запросов по всем повторам");
 return c;
}
export function operatorRisk(c,o,p){
 return o.cost+(1-p)*c.f*o.fp+p*(c.b*o.fn+c.d*(1-o.fn));
}
export function operatorUpper(c,o,lo,hi){return Math.max(operatorRisk(c,o,lo),operatorRisk(c,o,hi));}
// work ~ Exp(1) and error ~ U[0,1) independent of observations.
// work and error are never used by scheduling decisions.
export function processHeterogeneousQueue(c,stream,policy){
 const spec=c.operatorSpec,servers=spec.map(o=>({o,active:!policy.dynamic||!o.reserve,job:null,hours:0,busy:0,served:0,errors:0,loss:0,wait:0,activations:0}));
 const waiting=[],events=[],trace=[];
 const acc={N:0,auto:0,escalated:0,served:0,rejected:0,timeout:0,autoMiss:0,autoFalse:0,operatorMiss:0,operatorFalse:0,failedThreat:0,operatorErrors:0,decisionLoss:0,taskCost:0,waitLoss:0,failureLoss:0,wait:0,serviceTime:0,unsafe:0,price:0,staffCost:0};
 let last=0,areaQ=0,peakQ=0;
 const measured=v=>v.t>=c.queueWarmup&&v.t<c.queueHorizon,free=()=>servers.filter(s=>s.active&&!s.job);
 function integrate(t){
  const dt=Math.max(0,Math.min(t,c.queueHorizon)-Math.max(last,c.queueWarmup));
  areaQ+=dt*waiting.length;
  for(const s of servers)if(s.active){s.hours+=dt;if(s.job)s.busy+=dt;acc.staffCost+=dt*s.o.hourly;}
  last=t;
 }
 function activate(demand){if(policy.dynamic&&demand>=c.reserveOn)for(const s of servers)if(s.o.reserve&&!s.active){s.active=true;s.activations++;}}
 function release(){if(policy.dynamic&&waiting.length<=c.reserveOff)for(const s of servers)if(s.o.reserve&&!s.job)s.active=false;}
 function log(v,outcome,t,extra={}){if(measured(v))events.push({id:v.id,t:v.t,x:v.x,lo:v.lo,hi:v.hi,price:v.price,outcome,finish:t,...extra});}
 function fail(v,kind,t){
  if(!measured(v))return;
  acc[kind]++;acc.failedThreat+=v.x;acc.decisionLoss+=c.b*v.x;acc.failureLoss+=c.failureCost;acc.waitLoss+=c.queueWaitCost*(t-v.t);
  log(v,kind,t,{wait:t-v.t,action:0,operator:null});
 }
 function pickJob(){
  if(!c.queuePriority)return 0;
  let j=0;for(let i=1;i<waiting.length;i++)if(waiting[i].high&&!waiting[j].high)j=i;
  return j;
 }
 function fill(t){
  activate(waiting.length);
  while(waiting.length&&free().length){
   const j=pickJob(),v=waiting.splice(j,1)[0],candidates=free();
   // An expected service-time penalty is a routing heuristic, not actual loss.
   // A faster source is preferred if predicted costs are equal.
   const score=s=>operatorUpper(c,s.o,v.lo,v.hi)+c.feedbackGain*(waiting.length>0?1/s.o.rate:0);
   const s=policy.skill?candidates.reduce((a,b)=>score(b)<score(a)-1e-12||Math.abs(score(b)-score(a))<=1e-12&&b.o.rate>a.o.rate?b:a):candidates[0];
   const service=v.work/s.o.rate,w=t-v.t;
   s.job={v,start:t,finish:t+service,wait:w,service};
  }
  release();
 }
 function complete(s,t){
  const {v,wait,service}=s.job,o=s.o,a=v.x?+(v.error>=o.fn):+(v.error<o.fp);
  if(measured(v)){
   const L=loss(c,a,v.x),error=+(a!==v.x);
   acc.served++;acc.operatorErrors+=error;acc.operatorMiss+=+(v.x===1&&a===0);acc.operatorFalse+=+(v.x===0&&a===1);
   acc.decisionLoss+=L;acc.taskCost+=o.cost;acc.waitLoss+=c.queueWaitCost*wait;acc.wait+=wait;acc.serviceTime+=service;
   s.served++;s.errors+=error;s.loss+=L+o.cost;s.wait+=wait;
   log(v,"served",t,{wait,service,action:a,operator:o.name});
  }
  s.job=null;
 }
 function advance(to){
  for(;;){
   const completion=Math.min(Infinity,...servers.filter(s=>s.job).map(s=>s.job.finish)),expiry=waiting.length?waiting[0].t+c.deadline:Infinity,t=Math.min(completion,expiry);
   if(!Number.isFinite(t)||t>to)break;
   integrate(t);
   for(const s of servers)if(s.job&&s.job.finish<=t)complete(s,t);
   // Exclusive deadline for starting service. Arrivals with immediate service
   // remain eligible when the waiting allowance is zero.
   while(waiting.length&&waiting[0].t+c.deadline<=t)fail(waiting.shift(),"timeout",t);
   fill(t);
  }
  if(Number.isFinite(to))integrate(to);
 }
 function price(v){
  const active=servers.filter(s=>s.active),capacity=sum(active.map(s=>s.o.rate)),w=free().length?0:(waiting.length+1)/capacity;
  if(policy.skill)return Math.min(...active.map(s=>operatorUpper(c,s.o,v.lo,v.hi)))+c.queueWaitCost*w+c.feedbackGain*w;
  return c.c+(policy.feedback?c.feedbackGain*w:0);
 }
 for(let i=0;i<stream.length;i++){
  const v={...stream[i]};advance(v.t);v.price=price(v);v.high=v.hi>=c.priorityThreshold;
  const a=select({...c,c:Math.min(v.price,c.safetyRisk)},v.lo,v.hi);
  if(measured(v)){acc.N++;acc.price+=v.price;}
  if(a!==2){
   if(measured(v)){acc.auto++;acc.autoMiss+=+(a===0&&v.x===1);acc.autoFalse+=+(a===1&&v.x===0);acc.decisionLoss+=loss(c,a,v.x);acc.unsafe+=+(select({...c,c:c.safetyRisk},v.lo,v.hi)!==a);log(v,"automatic",v.t,{wait:0,action:a,operator:null});}
  }else{
   if(measured(v))acc.escalated++;
   if(!free().length)activate(waiting.length+1);
   if(free().length){waiting.push(v);fill(v.t);}
   else if(waiting.length>=c.queueCapacity)fail(v,"rejected",v.t);
   else if(c.deadline===0)fail(v,"timeout",v.t);
   else {waiting.push(v);fill(v.t);}
   release();
  }
  if(v.t>=c.queueWarmup)peakQ=Math.max(peakQ,waiting.length);
  if(i%Math.max(1,Math.floor(stream.length/150))===0||i===stream.length-1)trace.push({t:v.t,queue:waiting.length,busy:servers.filter(s=>s.job).length,active:servers.filter(s=>s.active).length,price:v.price});
 }
 advance(c.queueHorizon);advance(Infinity);
 if(acc.auto+acc.served+acc.rejected+acc.timeout!==acc.N||events.length!==acc.N||acc.escalated!==acc.served+acc.rejected+acc.timeout)throw Error("Нарушен баланс запросов");
 const H=c.queueHorizon-c.queueWarmup,N=acc.N,rate=x=>N?x/N:null,staffHours=sum(servers.map(s=>s.hours)),busyHours=sum(servers.map(s=>s.busy)),total=acc.decisionLoss+acc.taskCost+acc.waitLoss+acc.failureLoss+acc.staffCost;
 const operators=servers.map(s=>({operator:s.o.name,reserve:s.o.reserve,activeHours:s.hours,busyHours:s.busy,utilization:s.hours?s.busy/s.hours:null,served:s.served,errors:s.errors,errorRate:s.served?s.errors/s.served:null,meanWait:s.served?s.wait/s.served:null,activations:s.activations}));
 return {summary:{policy:policy.name,N,loss:rate(total),decisionLoss:rate(acc.decisionLoss),taskCost:rate(acc.taskCost),waitLoss:rate(acc.waitLoss),failureLoss:rate(acc.failureLoss),staffCost:rate(acc.staffCost),coverage:rate(acc.auto),escalation:rate(acc.escalated),served:rate(acc.served),rejected:rate(acc.rejected),timeout:rate(acc.timeout),failed:rate(acc.rejected+acc.timeout),miss:rate(acc.autoMiss+acc.operatorMiss+acc.failedThreat),false:rate(acc.autoFalse+acc.operatorFalse),autoMiss:rate(acc.autoMiss),autoFalse:rate(acc.autoFalse),operatorError:acc.served?acc.operatorErrors/acc.served:null,operatorMiss:rate(acc.operatorMiss),operatorFalse:rate(acc.operatorFalse),failedThreat:rate(acc.failedThreat),Wq:acc.served?acc.wait/acc.served:null,meanService:acc.served?acc.serviceTime/acc.served:null,Lq:areaQ/H,rho:staffHours?busyHours/staffHours:null,meanStaff:staffHours/H,peakQ,meanPrice:rate(acc.price),unsafe:acc.unsafe},operators,counts:acc,trace,events};
}
export function heterogeneousQueue(raw,unit){
 const c=validateHeterogeneousQueue(validateExt({...raw,stress:"none",eta:0})),q=lawsExt(c).nominal,calSeed=seedFor(c.seed,111000+unit.rep),counts=calibration(c,q,calSeed),T=tables(c,counts);
 // Reuse the established piecewise-Poisson generator with unit rate, so the
 // stored service variate is dimensionless common workload.
 const {stream:rawStream,...seeds}=makeQueueStream({...c,service:1},unit.rep,T,q),errorSeed=seedFor(c.seed,112000+unit.rep),r=random(errorSeed),stream=rawStream.map(({service,...v})=>({...v,work:service,error:r()}));
 const results=QUEUE_POLICIES.map(p=>processHeterogeneousQueue(c,stream,p));
 return {unit,summary:results.map(v=>({...v.summary,rep:unit.rep})),trace:results.flatMap(v=>v.trace.map(r=>({...r,policy:v.summary.policy}))),operatorStats:results.flatMap(v=>v.operators.map(r=>({...r,policy:v.summary.policy}))),outcomes:results.map(v=>({policy:v.summary.policy,counts:v.counts,events:v.events})),calibrationCounts:counts,calSeed,errorSeed,...seeds,warning:"Условные ошибки операторов и цены заданы исследователем; очередность и маршрутизация используют только наблюдаемые интервалы. Дедлайн относится к началу обслуживания. Активация резерва мгновенная, отключение только после завершения работы. Затраты штата интегрируются в измеряемом окне, исходы всех поступивших в нём запросов учитываются до завершения. Сравнение эвристик, не глобальная оптимизация или полевой сертификат."};
}
