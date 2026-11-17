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

export const CROSS_SENSOR_VERSION="e1a-causal-remote-sensor-f-hull-1.1.0-geometric-observability";
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
export function crossSensorPhysicalPair(source,target,p){
 const n=p?.plantAgents;
 if(!Number.isInteger(n)||n<2||!Number.isInteger(source)||
  !Number.isInteger(target)||source<0||target<0||
  source>=n||target>=n||source===target)
  throw invalid("некорректная физическая пара измерителей");
 if(p.plantCrossObservationMode==="network_proxy"||
  p.plantCrossObservationMode===undefined)
  return Object.freeze({eligible:true,distance:null,errorBound:p.plantCrossBound});
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
 const geometry=crossSensorPhysicalPair(report.source,report.target,p);
 if(!geometry.eligible)
  throw invalid("геометрически недоступный внешний измеритель");
 let min=report.value-geometry.errorBound;
 let max=report.value+geometry.errorBound;
 for(let k=report.emitted;k<time;k++){
  const control=controlTape[k-1]?.[report.target];
  if(!finite(control)||Math.abs(control)>p.plantControlLimit+EPS)
   throw invalid("нет достоверной исполненной команды для причинного прогноза");
  min=p.plantA*min+p.plantB*control-p.plantDisturbanceBound;
  max=p.plantA*max+p.plantB*control+p.plantDisturbanceBound;
 }
 return Object.freeze({source:report.source,target:report.target,
  emitted:report.emitted,
  min:Math.max(-p.plantSafeBound,min),
  max:Math.min(p.plantSafeBound,max)});
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
export function createCrossSensorTransport(p,runIndex=0){
 const n=p.plantAgents,ttl=p.plantCrossTTL;
 if(!Number.isInteger(n)||n<2||n>32||
  !Number.isInteger(runIndex)||runIndex<0)
  throw invalid("неверная конфигурация канала");
 let step=0,active=null,adjacency=null;
 const waiting=new Map(),inFlight=[],cached=Array.from({length:n},()=>new Map());
 const history=[];
 const counts={generated:0,transmitted:0,delivered:0,lost:0,blocked:0,
  expired:0,superseded:0};
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
 const emit=({time,states,active:a,faulty,budget})=>{
  if(time!==step||history.at(-1)?.budget!==null||
   !Array.isArray(states)||states.length!==n||
   !Array.isArray(a)||a.length!==n||
   a.some((v,i)=>v!==active[i])||
   !Array.isArray(faulty)||faulty.length!==n||
   faulty.some(v=>typeof v!=="boolean")||
   states.some((v,i)=>active[i]&&!range(v,p))||
   !Number.isSafeInteger(budget)||budget<0||budget>p.plantCapacity)
   throw invalid("некорректный такт отправки или бюджет");
  for(let source=0;source<n;source++)if(active[source])
   for(let target=0;target<n;target++)if(edge(source,target)){
    const geometry=crossSensorPhysicalPair(source,target,p);
    if(!geometry.eligible)continue;
    const id=key(source,target);
    const rng=createRng(p.plantSeed,runIndex,0xC205,source,target,time);
    let value=clamp(states[target]+
     geometry.errorBound*(rng.random()*2-1),
     -p.plantSafeBound,p.plantSafeBound);
    if(faulty[source]&&time>=p.plantAttackStart)
     value=clamp(value+(source%2?-1:1)*p.plantAttackBias,
      -p.plantSafeBound,p.plantSafeBound);
    if(waiting.has(id)){waiting.delete(id);counts.superseded++;}
    waiting.set(id,{source,target,emitted:time,value});
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
   role:"simulator_only_authenticated_physical_cross_sensors",
   history:history.map(r=>({...r}))};
 };
 return Object.freeze({networkStep,read,emit,getDiagnostic:diagnostic});
}
