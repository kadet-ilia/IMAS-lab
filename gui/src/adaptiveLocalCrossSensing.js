/**
 * Optional physical cross-sensing side channel for E1-A plant faults.
 * Each active source has an independently bounded instrument that directly
 * observes the PHYSICAL state of a neighboring target at emission time.
 * Simulator-only true states and attacker flags enter packet GENERATION;
 * only authenticated source IDs, observed values, timestamps and PUBLIC
 * model bounds enter interval propagation/fusion. No global trust oracle.
 *
 * The f-contamination certified set is the union of all states supported
 * by at least m-f distinct reporter intervals; its interval HULL is used.
 * It remains conservative even when Byzantine intervals are disjoint.
 */
import {createRng} from "./trustEngine.js";
import {syntheticOrbitVisibility} from "./adaptiveCrossOrbitalVisibility.js";

export const CROSS_SENSOR_VERSION="e1a-causal-remote-sensor-f-hull-1.4.0-authenticated-packet-boundary";
const finite=Number.isFinite;
const clamp=(x,lo,hi)=>Math.max(lo,Math.min(hi,x));
const EPS=1e-10;
const invalid=reason=>new Error("Перекрёстные измерения: "+reason);
function lost(reason){
 const error=invalid("сертификат утрачен: "+reason);
 error.code="CERTIFICATION_LOST";
 error.reason=reason;
 return error;
}
const range=(v,p)=>finite(v)&&Math.abs(v)<=p.plantSafeBound+EPS;
/**
 * Fixed-coordinate SYNTHETIC physical observation geometry. This geometry
 * is distinct from the communication adjacency supplied each tick.
 * Adjacent vertices in the communication graph do not imply optical/radio
 * range or independent availability of a measurement.
 *
 * network_proxy: backward-compatible ideal physically observable edge.
 * range_geometry: static agents equally spaced on a planar circle of
 * radius R, with public range D and bounded error V0+beta*d.
 * Both parties compute the SAME public error bound. Source declarations
 * about measurement accuracy are NOT trusted.
 */
export function crossSensorPhysicalPair(source,target,p,time=1){
 const n=p?.plantAgents;
 if(!Number.isInteger(n)||n<2||!Number.isInteger(source)||
  !Number.isInteger(target)||source<0||target<0||
  source>=n||target>=n||source===target)
  throw invalid("некорректная физическая пара измерителей");
 if(p.plantCrossObservationMode==="network_proxy"||
  p.plantCrossObservationMode===undefined)
  return Object.freeze({eligible:true,distance:null,errorBound:p.plantCrossBound});
 if(p.plantCrossObservationMode==="orbital_visibility"){
  if(!Number.isInteger(time)||time<1)
   throw invalid("неверная эпоха наблюдения");
  return syntheticOrbitVisibility(source,target,time,p);
 }
 if(p.plantCrossObservationMode!=="range_geometry")
  throw invalid("неизвестная геометрическая модель");
 const gap=Math.min(Math.abs(source-target),n-Math.abs(source-target));
 const distance=2*p.plantCrossGeometryRadius*Math.sin(Math.PI*gap/n);
 const eligible=distance<=p.plantCrossMaxRange+EPS;
 const errorBound=p.plantCrossBound+p.plantCrossDistanceErrorSlope*distance;
 if(!finite(errorBound)||errorBound<0||errorBound>=p.plantSafeBound)
  throw invalid("ошибка физического измерения не сертифицирована");
 return Object.freeze({eligible,distance,errorBound});
}

/**
 * A necessary (NOT sufficient) physical/communication condition for
 * certifying a remote state with <=f compromised reporter identities.
 * Only direct links are counted; the graph is supplied by the simulator
 * and no plant state, outcomes, or simulator attacker labels are used.
 * Queue loss and actual measurement overlap can still prevent certification.
 */
export function auditCrossObservationGraph(communicationAdjacency,p,time=1){
 const n=p?.plantAgents;
 if(!Number.isInteger(n)||!Array.isArray(communicationAdjacency)||
  communicationAdjacency.length!==n||
  communicationAdjacency.some((row,i)=>!Array.isArray(row)||
   row.length!==n||row.some((v,j)=>typeof v!=="boolean"||
    v!==communicationAdjacency[j]?.[i]||i===j&&v)))
  throw invalid("некорректный граф коммуникационной достижимости");
 if(!Number.isInteger(p.plantCrossFaultBudget)||p.plantCrossFaultBudget<0||
  p.plantCrossFaultBudget>=n)
  throw invalid("некорректная публичная граница числа нарушителей");
 const physicalSources=Array(n).fill(0);
 const admissibleDirectSources=Array(n).fill(0);
 for(let i=0;i<n;i++)for(let j=0;j<n;j++)if(i!==j){
  const physical=crossSensorPhysicalPair(j,i,p,time);
  if(physical.eligible){
   physicalSources[i]++;
   if(communicationAdjacency[j][i])admissibleDirectSources[i]++;
  }
 }
 return Object.freeze({
  physicalSources:Object.freeze(physicalSources),
  admissibleDirectSources:Object.freeze(admissibleDirectSources),
  structurallyObservable:Object.freeze(admissibleDirectSources.map(
   count=>count>p.plantCrossFaultBudget)),
  potentiallyObservableCount:admissibleDirectSources.filter(
   count=>count>p.plantCrossFaultBudget).length,
  necessaryCondition:"distinct delivered authenticated reporters m>f; not sufficient"
 });
}

/** Advance a timestamped, source-authenticated remote measurement to time t.
 * Every intervening control is the actual target actuator output, never a
 * neighbor decision. The true state is not used for propagation.
 */
export function projectCrossReport(report,time,controlTape,p){
 if(!report||!Number.isInteger(report.source)||report.source<0||
  report.source>=p.plantAgents||
  !Number.isInteger(report.target)||report.target<0||
  report.target>=p.plantAgents||report.target===report.source||
  !Number.isInteger(report.emitted)||report.emitted<1||
  !Number.isInteger(time)||time<=report.emitted||
  time-report.emitted>p.plantCrossTTL||
  !range(report.value,p)||!Array.isArray(controlTape)||
  controlTape.length<time-1)
  throw invalid("некорректная отметка времени, источник или журнал команд");
 // The authenticated PACKET time s bounds, but does not reveal, the actual
 // PHYSICAL measurement epoch k in [max(1,s-L),s]. The hull covers all
 // physically eligible k, using only real executed controls k..t-1.
 const L=p.plantCrossSampleLagMaxSteps??0;
 let outerMin=Infinity,outerMax=-Infinity;
 for(let s=Math.max(1,report.emitted-L);s<=report.emitted;s++){
  const g=crossSensorPhysicalPair(report.source,report.target,p,s);
  if(!g.eligible)continue;
  let min=report.value-g.errorBound,max=report.value+g.errorBound;
  for(let k=s;k<time;k++){
   const control=controlTape[k-1]?.[report.target];
   if(!finite(control)||Math.abs(control)>p.plantControlLimit+EPS)
    throw invalid("нет достоверной исполненной команды для причинного прогноза");
   min=p.plantA*min+p.plantB*control-p.plantDisturbanceBound;
   max=p.plantA*max+p.plantB*control+p.plantDisturbanceBound;
  }
  outerMin=Math.min(outerMin,min);
  outerMax=Math.max(outerMax,max);
 }
 if(!finite(outerMin)||!finite(outerMax))
  throw invalid("геометрически недоступный внешний измеритель");
 return Object.freeze({source:report.source,target:report.target,
  emitted:report.emitted,
  min:Math.max(-p.plantSafeBound,outerMin),
  max:Math.min(p.plantSafeBound,outerMax)});
}

/**
 * Robust to <=f Byzantine identities (f is a PUBLIC adversary-capability
 * upper bound, not the true attacker labels). For m>f, true state must be in
 * at least m-f of the m interval reports. Return the convex hull of that
 * possibly disconnected feasible set, intersected with the prior certificate.
 * With <=f reporters no useful cross certificate can be inferred.
 */
export function fuseCrossCertificates(prior,intervals,maxCorrupt,p){
 if(!prior||!finite(prior.min)||!finite(prior.max)||
  prior.min>prior.max||prior.min < -p.plantSafeBound-EPS||
  prior.max>p.plantSafeBound+EPS||
  !Array.isArray(intervals)||!Number.isInteger(maxCorrupt)||
  maxCorrupt<0||maxCorrupt>=p.plantAgents)
  throw invalid("неверная априорная область или модель нарушителя");
 const names=new Set();
 for(const item of intervals){
  if(!item||!Number.isInteger(item.source)||item.source<0||
   item.source>=p.plantAgents||names.has(item.source)||
   !finite(item.min)||!finite(item.max))
   throw invalid("повторный или некорректный источник");
  names.add(item.source);
 }
 const m=intervals.length,q=m-maxCorrupt;
 if(q<=0)return Object.freeze({interval:{...prior},reporters:m,
  requiredSupport:0,refined:false,supported:false});
 const usable=intervals.filter(i=>i.min<=i.max);
 const ends=[...new Set(usable.flatMap(i=>[i.min,i.max]))].sort((a,b)=>a-b);
 const feasible=ends.filter(x=>usable.filter(i=>
  i.min<=x+EPS&&i.max>=x-EPS).length>=q);
 if(!feasible.length)
  throw lost("нет области, совместимой как минимум с m-f аутентифицированными измерениями");
 const min=Math.max(prior.min,feasible[0]);
 const max=Math.min(prior.max,feasible.at(-1));
 if(min>max+EPS)
  throw lost("удалённые измерения противоречат сертифицированному состоянию");
 if(min>max)throw lost("численно пустое пересечение удалённых измерений");
 return Object.freeze({interval:{min,max},reporters:m,requiredSupport:q,
  supported:true,refined:min>prior.min+EPS||max<prior.max-EPS});
}

/** Delayed/lossy, bandwidth-capped, one-hop authenticated remote reports. */
export function createCrossSensorTransport(p,runIndex=0,authAdapter=null){
 const n=p.plantAgents,ttl=p.plantCrossTTL;
 if(p.plantCrossAuthMode==="verified_envelope"&&(
  !authAdapter||typeof authAdapter.sign!=="function"||
  typeof authAdapter.verify!=="function"))
  throw invalid("режим проверенных пакетов требует внешний криптографический адаптер");
 const authenticated=p.plantCrossAuthMode==="verified_envelope";
 const canonical=packet=>JSON.stringify([
  "e1a-cross-sensor-envelope-v1",packet.source,packet.target,
  packet.emitted,packet.value]);
 if(!Number.isInteger(n)||n<2||n>32||
  !Number.isInteger(runIndex)||runIndex<0)
  throw invalid("неверная конфигурация канала");
 let step=0,active=null,adjacency=null;
 const waiting=new Map(),inFlight=[],cached=Array.from({length:n},()=>new Map());
 const history=[];
 const counts={generated:0,transmitted:0,delivered:0,lost:0,blocked:0,
  expired:0,superseded:0,authenticationRejected:0};
 const key=(j,i)=>j+":"+i;
 const edge=(j,i)=>j!==i&&active[j]&&active[i]&&adjacency[j][i];
 const audit=()=>{
  if(counts.generated!==counts.delivered+counts.lost+counts.blocked+
   counts.expired+counts.superseded+waiting.size+inFlight.length)
   throw invalid("нарушен баланс канала перекрёстных измерений");
 };
 const networkStep=({time,active:a,adjacency:g})=>{
  if(!Number.isInteger(time)||time!==step+1||
   !Array.isArray(a)||a.length!==n||
   a.some(v=>typeof v!=="boolean")||
   !Array.isArray(g)||g.length!==n||
   g.some((row,i)=>!Array.isArray(row)||row.length!==n||
    row.some((v,j)=>typeof v!=="boolean"||v!==g[j]?.[i]||
     (v&&(i===j||!a[i]||!a[j])))))
   throw invalid("некорректный текущий физический граф");
  step=time;active=[...a];adjacency=g.map(row=>[...row]);
  for(const bucket of cached)
   for(const [from,packet] of bucket)
    if(time-packet.emitted>ttl)bucket.delete(from);
  let arrivals=0;
  const pending=[];
  for(const packet of inFlight){
   if(time-packet.emitted>ttl){counts.expired++;continue;}
   if(packet.due>time){pending.push(packet);continue;}
   if(!edge(packet.source,packet.target)){counts.blocked++;continue;}
   if(authenticated){
    let valid=false;
    try{valid=authAdapter.verify(packet.source,canonical(packet),
     packet.signature)===true;}catch{valid=false;}
    if(!valid){
     counts.blocked++;counts.authenticationRejected++;continue;
    }
   }
   const prior=cached[packet.target].get(packet.source);
   if(!prior||packet.emitted>=prior.emitted)
    cached[packet.target].set(packet.source,{...packet,arrived:time});
   counts.delivered++;arrivals++;
  }
  inFlight.splice(0,inFlight.length,...pending);
  for(const [id,packet] of waiting)
   if(time-packet.emitted+p.plantCrossDelay>ttl){
    waiting.delete(id);counts.expired++;
   }
  history.push({step:time,received:arrivals,sent:0,
   budget:null,reportsAvailable:cached.reduce((z,m)=>z+m.size,0)});
  audit();
 };
 const read=({time})=>{
  if(time!==step)throw invalid("отчёт запрошен до доставки");
  return cached.map(bucket=>[...bucket.values()].filter(packet=>
   packet.emitted<time&&time-packet.emitted<=ttl)
   .sort((a,b)=>a.source-b.source).map(packet=>({...packet})));
 };
 const emit=({time,states,historyStates=null,active:a,faulty,budget})=>{
  if(time!==step||history.at(-1)?.budget!==null||
   !Array.isArray(states)||states.length!==n||
   !Array.isArray(a)||a.length!==n||
   a.some((v,i)=>v!==active[i])||
   !Array.isArray(faulty)||faulty.length!==n||
   faulty.some(v=>typeof v!=="boolean")||
   states.some((v,i)=>active[i]&&!range(v,p))||
   !Number.isSafeInteger(budget)||budget<0||budget>p.plantCapacity||
   (p.plantCrossSampleLagMaxSteps>0&&(
    !Array.isArray(historyStates)||historyStates.length!==time||
    historyStates.some(row=>!Array.isArray(row)||row.length!==n||
     row.some(x=>!range(x,p)))||
    states.some((x,i)=>active[i]&&Math.abs(
     x-historyStates[time-1][i])>EPS))))
   throw invalid("некорректный такт отправки или бюджет");
  for(let source=0;source<n;source++)if(active[source])
   for(let target=0;target<n;target++)if(edge(source,target)){
    // The physical instrument chooses a buffered eligible epoch; its
    // actual sample epoch remains SIMULATOR-ONLY (not in its packet).
    const samples=[];
    for(let t=Math.max(1,time-(p.plantCrossSampleLagMaxSteps??0));
     t<=time;t++){
     const g=crossSensorPhysicalPair(source,target,p,t);
     if(g.eligible)samples.push({time:t,errorBound:g.errorBound});
    }
    if(!samples.length)continue;
    const id=key(source,target);
    const rng=createRng(p.plantSeed,runIndex,0xC205,source,target,time);
    const sample=samples.length===1?samples[0]:
     samples[Math.floor(rng.random()*samples.length)];
    const measured=p.plantCrossSampleLagMaxSteps?
     historyStates[sample.time-1][target]:states[target];
    let value=clamp(measured+
     sample.errorBound*(rng.random()*2-1),
     -p.plantSafeBound,p.plantSafeBound);
    if(faulty[source]&&time>=p.plantAttackStart)
     value=clamp(value+(source%2?-1:1)*p.plantAttackBias,
      -p.plantSafeBound,p.plantSafeBound);
    if(waiting.has(id)){waiting.delete(id);counts.superseded++;}
    const packet={source,target,emitted:time,value};
    if(authenticated){
     const signature=authAdapter.sign(source,canonical(packet));
     if(typeof signature!=="string"||!/^[0-9a-f]{64}$/.test(signature))
      throw invalid("криптографический адаптер вернул недопустимую подпись");
     packet.signature=signature;
    }
    waiting.set(id,packet);
    counts.generated++;
   }
  const ordered=[...waiting.entries()].sort((a,b)=>
   a[1].emitted-b[1].emitted||
   a[1].source-b[1].source||a[1].target-b[1].target);
  let sent=0;
  for(const [id,packet] of ordered){
   if(time-packet.emitted+p.plantCrossDelay>ttl){
    waiting.delete(id);counts.expired++;continue;
   }
   if(!edge(packet.source,packet.target))continue;
   if(sent>=budget)break;
   waiting.delete(id);sent++;counts.transmitted++;
   const rng=createRng(p.plantSeed,runIndex,0xC206,
    packet.source,packet.target,packet.emitted);
   if(rng.random()<p.plantCrossLoss)counts.lost++;
   else inFlight.push({...packet,due:time+p.plantCrossDelay});
  }
  Object.assign(history.at(-1),{sent,budget});
  audit();
  return sent;
 };
 const diagnostic=()=>{
  audit();
  return {...counts,pending:waiting.size+inFlight.length,
   waiting:waiting.size,inFlight:inFlight.length,
   modelVersion:CROSS_SENSOR_VERSION,
   observationMode:p.plantCrossObservationMode??"network_proxy",
   observationGeometryEpoch:"actual sample in [emitted-L,emitted], no disclosure",
   sampleLagBoundSteps:p.plantCrossSampleLagMaxSteps??0,
   authenticationMode:p.plantCrossAuthMode??"assumed_origin",
   authenticationRejected:counts.authenticationRejected,
   packetSampleEpochDisclosure:false,
   role:"simulator_only_authenticated_physical_cross_sensors",
   history:history.map(r=>({...r}))};
 };
 return Object.freeze({networkStep,read,emit,getDiagnostic:diagnostic});
}
