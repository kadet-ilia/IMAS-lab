// E2.15–E2.16: finite-horizon nonstationary FCFS/priority queue with feedback.
// Decisions use observable information only; true state is used to calculate loss.
import {validateExt,lawsExt,calibration,tables,point,select,loss,sampler,seedFor} from "./extendedModel.js";
import {random} from "./kernel.js";
const sum=a=>a.reduce((s,v)=>s+v,0),int=(v,a,b)=>Number.isInteger(v)&&v>=a&&v<=b,real=(v,a,b)=>Number.isFinite(v)&&v>=a&&v<=b;
export function validateClosedQueue(c){
 if(!real(c.queueHorizon,.01,1000)||!real(c.queueWarmup,0,c.queueHorizon-1e-6)||!real(c.peakMultiplier,.01,20)||!real(c.peakStart,.01,.98)||!real(c.peakEnd,c.peakStart+.001,.999)||!int(c.queueCapacity,0,1000)||!real(c.priorityThreshold,0,1)||typeof c.queuePriority!=="boolean"||!real(c.feedbackGain,0,1000)||!real(c.safetyRisk,0,1000)||!real(c.queueWaitCost,0,1000)||!real(c.failureCost,0,1000))throw Error("Некорректные параметры динамической СМО");
 const expected=c.arrival*c.queueHorizon*(1+(c.peakEnd-c.peakStart)*(c.peakMultiplier-1));
 if(expected>30000)throw Error("Ожидаемый поток превышает 30 000 запросов на повтор");
 return c;
}
export function makeQueueStream(c,rep,T,q){
 const arrivalSeed=seedFor(c.seed,91000+3*rep),observationSeed=seedFor(c.seed,91001+3*rep),serviceSeed=seedFor(c.seed,91002+3*rep);
 const r=random(arrivalSeed),next=sampler(c,q,random(observationSeed)),s=random(serviceSeed),stream=[];
 const bounds=[0,c.queueHorizon*c.peakStart,c.queueHorizon*c.peakEnd,c.queueHorizon],rates=[c.arrival,c.arrival*c.peakMultiplier,c.arrival];
 for(let seg=0;seg<3;seg++){let t=bounds[seg];for(;;){t+=-Math.log1p(-r())/rates[seg];if(t>=bounds[seg+1])break;const {x,ix}=next(),[lo,hi]=point(c,T,ix);stream.push({id:stream.length,t,x,lo,hi,service:-Math.log1p(-s())/c.service});if(stream.length>50000)throw Error("Реализованный поток превышает 50 000 запросов");}}
 return {stream,arrivalSeed,observationSeed,serviceSeed};
}
export function processQueue(c,stream,feedback){
 const servers=Array.from({length:c.operators},()=>null),waiting=[],trace=[],events=[];
 const measured=v=>v.t>=c.queueWarmup&&v.t<c.queueHorizon;
 const acc={N:0,auto:0,miss:0,fp:0,escalated:0,served:0,rejected:0,timeout:0,wait:0,loss:0,unsafe:0,price:0};
 let last=0,areaQ=0,areaBusy=0,peakQ=0,finished=0;
 function integrate(t){const dt=Math.max(0,Math.min(t,c.queueHorizon)-Math.max(last,c.queueWarmup));areaQ+=dt*waiting.length;areaBusy+=dt*servers.filter(Boolean).length;last=t;}
 function log(v,kind,t,wait=0){if(!measured(v))return;events.push({id:v.id,t:v.t,outcome:kind,finish:t,wait,action:v.action,price:v.price,lo:v.lo,hi:v.hi,x:v.x});}
 function fail(v,kind,t){if(measured(v)){acc[kind]++;acc.loss+=c.failureCost+c.b*v.x+c.queueWaitCost*(t-v.t);log(v,kind,t,t-v.t);}}
 function fill(t){for(let i=0;i<servers.length;i++)if(!servers[i]&&waiting.length){let j=c.queuePriority?waiting.findIndex(v=>v.high):-1;if(j<0)j=0;const v=waiting.splice(j,1)[0],w=t-v.t;servers[i]={v,start:t,finish:t+v.service};if(measured(v)){acc.served++;acc.wait+=w;acc.loss+=c.c+c.queueWaitCost*w;log(v,"served",t+v.service,w);}}}
 function advance(to){
  for(;;){const done=Math.min(Infinity,...servers.filter(Boolean).map(v=>v.finish)),expiry=waiting.length?waiting[0].t+c.deadline:Infinity,t=Math.min(done,expiry);if(!Number.isFinite(t)||t>to)break;integrate(t);
   for(let i=0;i<servers.length;i++)if(servers[i]&&servers[i].finish<=t){servers[i]=null;finished++;}
   // Waiting deadline is exclusive; expire before starting service at the same time.
   while(waiting.length&&waiting[0].t+c.deadline<=t){const v=waiting.shift();fail(v,"timeout",t);}
   fill(t);
  }
  if(Number.isFinite(to))integrate(to);
 }
 for(let i=0;i<stream.length;i++){
  const v={...stream[i]};advance(v.t);
  const busy=servers.filter(Boolean).length,estimatedWait=busy<c.operators?0:(waiting.length+1)/(c.operators*c.service);
  v.price=c.c+(feedback?c.feedbackGain*estimatedWait:0);
  const cap=Math.min(v.price,c.safetyRisk),a=select({...c,c:cap},v.lo,v.hi);v.action=a;v.high=v.hi>=c.priorityThreshold;
  if(measured(v)){acc.N++;acc.price+=v.price;}
  if(a!==2){
   if(measured(v)){acc.auto++;acc.miss+=+(a===0&&v.x===1);acc.fp+=+(a===1&&v.x===0);acc.unsafe+=+(select({...c,c:c.safetyRisk},v.lo,v.hi)!==a);acc.loss+=loss(c,a,v.x);log(v,"automatic",v.t);}
  }else{
   if(measured(v))acc.escalated++;
   if(busy<c.operators){waiting.push(v);fill(v.t);}
   else if(waiting.length>=c.queueCapacity)fail(v,"rejected",v.t);
   else if(c.deadline===0)fail(v,"timeout",v.t);
   else waiting.push(v);
  }
  if(v.t>=c.queueWarmup)peakQ=Math.max(peakQ,waiting.length);
  if(i%Math.max(1,Math.floor(stream.length/150))===0||i===stream.length-1)trace.push({t:v.t,queue:waiting.length,busy:servers.filter(Boolean).length,price:v.price,coverage:acc.N?acc.auto/acc.N:null,estimatedWait});
 }
 advance(c.queueHorizon);advance(Infinity);
 if(acc.auto+acc.served+acc.rejected+acc.timeout!==acc.N)throw Error("Нарушен баланс запросов");
 const N=acc.N,H=c.queueHorizon-c.queueWarmup,rate=v=>N?v/N:null;
 return {N,coverage:rate(acc.auto),loss:rate(acc.loss),miss:rate(acc.miss),false:rate(acc.fp),escalation:rate(acc.escalated),served:rate(acc.served),rejected:rate(acc.rejected),timeout:rate(acc.timeout),failed:rate(acc.rejected+acc.timeout),deadlineMiss:acc.escalated?(acc.rejected+acc.timeout)/acc.escalated:null,Wq:acc.served?acc.wait/acc.served:null,Lq:areaQ/H,rho:areaBusy/(H*c.operators),peakQ,meanPrice:rate(acc.price),unsafe:acc.unsafe,counts:acc,trace,events,finished};
}
export function closedQueue(raw,unit){
 const c=validateClosedQueue(validateExt({...raw,stress:"none",eta:0,...(unit.operators===undefined?{}:{operators:unit.operators}),...(unit.price===undefined?{}:{c:unit.price}),...(unit.gain===undefined?{}:{feedbackGain:unit.gain})}));
 const calSeed=seedFor(c.seed,90000+unit.rep),counts=calibration(c,lawsExt(c).cal,calSeed),T=tables(c,counts),{stream,...seeds}=makeQueueStream(c,unit.rep,T,lawsExt(c).test);
 const policies=unit.kind==="jointQueue"?[true]:[false,true],results=policies.map(feedback=>({policy:feedback?"Обратная связь":"Постоянная цена",...processQueue(c,stream,feedback)}));
 return {summary:results.map(({trace,events,counts,...a})=>({...a,rep:unit.rep,operators:c.operators,price:c.c,gain:c.feedbackGain})),trace:results.flatMap(r=>r.trace.map(v=>({...v,policy:r.policy}))),outcomes:results.map(({policy,events,counts})=>({policy,events,counts})),calibrationCounts:counts,calSeed,...seeds,config:c,warning:"Нестационарный поток с фиксированным пиковым интервалом. Приоритет определяется верхней оценкой вероятности, не истинным классом. Дедлайн относится к ожиданию. Номинальный предельный риск автоматического действия не зависит от очереди. Потери отказа: failureCost+bX+цена ожидания."};
}
export function jointPlan(c){
 if(!int(c.operatorMin,1,20)||!int(c.operatorMax,c.operatorMin,20)||!int(c.priceLevels,1,10)||!int(c.gainLevels,1,10)||!real(c.priceMin,0,1000)||!real(c.priceMax,c.priceMin,1000)||!real(c.gainMin,0,1000)||!real(c.gainMax,c.gainMin,1000)||!real(c.operatorCost,0,1000)||!real(c.failureLimit,0,1)||!real(c.requiredCoverage,0,1)||!real(c.riskLimit,0,1000))throw Error("Некорректная сетка совместной оптимизации");
 const grid=(a,b,n)=>[...new Set(Array.from({length:n},(_,i)=>n===1?a:a+(b-a)*i/(n-1)))],units=[];
 for(let operators=c.operatorMin;operators<=c.operatorMax;operators++)for(const price of grid(c.priceMin,c.priceMax,c.priceLevels))for(const gain of grid(c.gainMin,c.gainMax,c.gainLevels))for(let rep=0;rep<c.queueReps;rep++)units.push({kind:"jointQueue",operators,price,gain,rep});
 if(units.length>200)throw Error("Не более 200 расчётных единиц совместной оптимизации");
 if(units.length*Math.max(1,c.queueHorizon*c.arrival*(1+(c.peakEnd-c.peakStart)*(c.peakMultiplier-1)))>2000000)throw Error("Суммарный ожидаемый поток сетки превышает 2 млн");
 return units;
}
export function jointSummary(c,records){
 const map=new Map();for(const r of records){const {operators,price,gain}=r.unit,k=JSON.stringify([operators,price,gain]);if(!map.has(k))map.set(k,[]);map.get(k).push(r.summary[0]);}
 const rows=[];
 for(const a of map.values()){
  const v=a[0],valid=a.filter(r=>r.N>0),mean=k=>valid.length?sum(valid.map(r=>r[k]))/valid.length:null;
  // Bounds for averages of independent run-level bounded quantities; no request-iid assertion.
  // Empty measured streams are excluded from empirical averages; fail closed for certification.
  const K=jointPlan(c).length/c.queueReps,complete=a.length===c.queueReps&&valid.length===a.length,h=Math.sqrt(Math.log(3*K/c.alpha)/(2*a.length));
  const Lmax=Math.max(c.b,c.f,c.d,v.price+c.queueWaitCost*c.deadline,c.failureCost+c.b+c.queueWaitCost*c.deadline);
  const coverage=mean("coverage"),L=mean("loss"),failure=mean("failed"),lower=complete?Math.max(0,coverage-h):null,upperRisk=complete?Math.min(Lmax,L+Lmax*h):null,upperFailure=complete?Math.min(1,failure+h):null;
  const status=!complete?"incomplete":lower>=c.requiredCoverage&&upperRisk<=c.riskLimit&&upperFailure<=c.failureLimit?"simulation_bound":coverage>=c.requiredCoverage&&L<=c.riskLimit&&failure<=c.failureLimit?"empirical":"not_certified";
  rows.push({operators:v.operators,price:v.price,gain:v.gain,cost:v.operators*c.operatorCost,reps:a.length,validReps:valid.length,coverage,loss:L,failed:failure,lower,upperRisk,upperFailure,status,pareto:false,unsafe:sum(a.map(r=>r.unsafe))});
 }
 const candidates=rows.filter(r=>["simulation_bound","empirical"].includes(r.status));
 for(const r of candidates)r.pareto=!candidates.some(s=>s!==r&&s.cost<=r.cost&&s.loss<=r.loss&&s.failed<=r.failed&&s.coverage>=r.coverage&&(s.cost<r.cost||s.loss<r.loss||s.failed<r.failed||s.coverage>r.coverage));
 return {rows,aux:candidates.filter(r=>r.pareto)};
}
