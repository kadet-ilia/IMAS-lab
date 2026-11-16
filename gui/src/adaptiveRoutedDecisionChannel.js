/**
 * E1-A hop-by-hop routed dissemination of centrally computed decisions.
 *
 * The link graph comes from the actual active E1 network, with partitions and
 * isolation enforced at EACH hop. Each destination has a separate packet.
 * Packets may wait for a route, but in-flight packets are discarded if their
 * selected link fails before arrival. Lost hops are NOT retransmitted.
 *
 * The legacy static and opportunistic policies retain their semantics.
 * The opt-in local_floor policy reserves separate bounded decision and causal
 * neighbor-message quotas BEFORE scheduling baseline E1 traffic.
 * These are not per-edge simultaneous channels and are NOT an optimal router.
 * A publication from t is never visible to witness evidence before t+1.
 */
import {createRng} from "./trustEngine.js";
import {validateDecisionChannelOptions} from "./adaptiveDecisionChannel.js";

export const E1A_ROUTED_CHANNEL_VERSION="e1a-shortest-path-shared-scheduler-1.2.0";
export const E1A_ROUTED_DEFAULTS=Object.freeze({decisionBandwidthFraction:0.25,decisionBandwidthPolicy:"static",localTransportBandwidthFraction:0.15});
const finite=Number.isFinite;
export function validateRoutedChannelOptions(options={}){
 const o={...E1A_ROUTED_DEFAULTS,...validateDecisionChannelOptions(options)};
 if(!finite(o.decisionBandwidthFraction)||o.decisionBandwidthFraction<0||
  o.decisionBandwidthFraction>1)
  throw Error("E1-А маршрутизация: доля резервирования канала должна принадлежать [0,1]");
 if(!["static","opportunistic","local_floor"].includes(o.decisionBandwidthPolicy))
  throw Error("E1-А маршрутизация: неизвестная политика распределения полосы");
 if(!finite(o.localTransportBandwidthFraction)||o.localTransportBandwidthFraction<0||
  o.localTransportBandwidthFraction>1)
  throw Error("E1-А маршрутизация: недопустимая доля локального транспорта");
 if(o.decisionBandwidthPolicy==="local_floor"&&
  o.decisionBandwidthFraction+o.localTransportBandwidthFraction>1+1e-12)
  throw Error("E1-А маршрутизация: сумма гарантированных долей превышает единицу");
 return o;
}
export function nextHopOnActiveGraph(adjacency,labels,active,from,to){
 const n=active.length;
 if(from===to)return from;
 if(!active[from]||!active[to]||labels[from]<0||labels[from]!==labels[to])
  return null;
 const pred=Array(n).fill(-1),queue=[from];
 pred[from]=from;
 for(let pos=0;pos<queue.length;pos++){
  const u=queue[pos];
  for(let v=0;v<n;v++){
   if(!adjacency[u][v]||!active[v]||labels[u]!==labels[v]||pred[v]!==-1)
    continue;
   pred[v]=u;
   if(v===to){
    let here=to;
    while(pred[here]!==from)here=pred[here];
    return here;
   }
   queue.push(v);
  }
 }
 return null;
}
export function createRoutedDecisionChannel(config,options={},runIndex=0){
 const p=validateRoutedChannelOptions(options),n=config?.n_agents+config?.n_sybil_agents;
 if(!Number.isInteger(n)||n<2||p.decisionOriginAgent>=n)
  throw Error("E1-А маршрутизация: некорректный источник или размер сети");
 if(!Number.isInteger(config.seed)||!Number.isInteger(runIndex)||runIndex<0)
  throw Error("E1-А маршрутизация: требуется целочисленный seed и номер прогона");
 const origin=p.decisionOriginAgent;
 let step=0,originAvailable=false,active=null,labels=null,adjacency=null;
 let lastCapacity=null,lastReserved=null,lastTargetReservation=null;
 let lastDecisionReserved=0,lastLocalReserved=0,nextId=0;
 const waiting=[],inFlight=[],received=Array(n).fill(null),history=[];
 const counters={
  attempted:0,delivered:0,lost:0,blocked:0,expired:0,
  notDispatched:0,abstentions:0,uninformedWitnesses:0,referencesUsed:0,
  hopsScheduled:0,hopsArrived:0,hopsLost:0,routeDeferrals:0,
  bandwidthDeferrals:0,transmittedSlots:0,e1UsedSlots:0,reservedSlots:0,
  sharedCapacitySlots:0,decisionBorrowedSlots:0,releasedToE1Slots:0,
  decisionGuaranteedSlots:0,localGuaranteedSlots:0
 };
 const reachable=(i,j)=>active[i]&&active[j]&&labels[i]>=0&&labels[i]===labels[j];
 const edge=(i,j)=>reachable(i,j)&&adjacency[i][j];
 const pending=()=>waiting.length+inFlight.length;
 const audit=()=>{
  if(counters.attempted!==counters.delivered+counters.lost+counters.blocked+
   counters.expired+pending())
   throw Error("E1-А маршрутизация: нарушен баланс адресных пакетов");
  if(counters.hopsArrived>counters.hopsScheduled||
   counters.transmittedSlots!==counters.hopsScheduled||
   counters.e1UsedSlots+counters.transmittedSlots>counters.sharedCapacitySlots)
   throw Error("E1-А маршрутизация: нарушен бюджет совместных сообщений");
 };
 const snapshot=()=>{
  audit();
  return {...counters,pending:pending(),waiting:waiting.length,inFlight:inFlight.length,
   origin,delay:p.decisionDelaySteps,lossProbability:p.decisionLossProbability,
   staleness:p.decisionMaxStalenessSteps,bandwidthFraction:p.decisionBandwidthFraction,
   bandwidthPolicy:p.decisionBandwidthPolicy,
   modelVersion:E1A_ROUTED_CHANNEL_VERSION,balance:0,
   history:history.map(h=>({...h}))};
 };
 const networkStep=({step:t,labels:nextLabels,active:nextActive,
  adjacency:nextAdjacency})=>{
  if(!Number.isInteger(t)||t!==step+1||!Array.isArray(nextLabels)||
   !Array.isArray(nextActive)||!Array.isArray(nextAdjacency)||
   nextLabels.length!==n||nextActive.length!==n||nextAdjacency.length!==n||
   nextLabels.some(x=>!Number.isInteger(x)||x< -1)||
   nextActive.some(x=>typeof x!=="boolean")||
   nextAdjacency.some((row,i)=>!Array.isArray(row)||row.length!==n||
    row.some((v,j)=>typeof v!=="boolean"||v!==nextAdjacency[j]?.[i])))
   throw Error("E1-А маршрутизация: необходим согласованный симметричный активный граф");
  active=[...nextActive];labels=[...nextLabels];
  adjacency=nextAdjacency.map(row=>[...row]);
  step=t;originAvailable=false;lastCapacity=null;lastReserved=null;lastTargetReservation=null;
  lastDecisionReserved=0;lastLocalReserved=0;
  const arrived=[];
  for(const packet of inFlight){
   if(t-packet.emitted>p.decisionMaxStalenessSteps){
    counters.expired++;continue;
   }
   if(t<packet.due){arrived.push(packet);continue;}
   if(packet.local?!active[origin]:!edge(packet.at,packet.next)){
    counters.blocked++;continue;
   }
   packet.at=packet.next;
   if(!packet.local){packet.hops++;counters.hopsArrived++;}
   if(packet.at===packet.target){
    const existing=received[packet.target];
    if(!existing||packet.emitted>=existing.emitted)
     received[packet.target]={value:packet.value,emitted:packet.emitted};
    counters.delivered++;
   }else waiting.push(packet);
  }
  inFlight.splice(0,inFlight.length,...arrived);
  const keep=[];
  for(const packet of waiting){
   if(t-packet.emitted>p.decisionMaxStalenessSteps)counters.expired++;
   else keep.push(packet);
  }
  waiting.splice(0,waiting.length,...keep);
  let reachableCount=0,informedCount=0;
  for(let i=0;i<n;i++){
   if(!reachable(origin,i))continue;
   reachableCount++;
   const reference=received[i];
   if(reference&&t-reference.emitted<=p.decisionMaxStalenessSteps)
    informedCount++;
  }
  history.push({step:t,reachable:reachableCount,informed:informedCount,
   coverage:reachableCount?informedCount/reachableCount:null,
   pending:pending(),routeDeferredThisStep:0,bandwidthDeferredThisStep:0,
   routingHopsThisStep:0,sharedCapacity:null,e1Used:null,
   reserved:null,decisionReserved:0,localReserved:0,
   availableForE1:null,targetReservation:null,
   releasedToE1:0,borrowedFromE1:0,sharedUnused:null});
  audit();
 };
 const reserveDecisionBandwidth=({step:t,capacity,localDemand=null})=>{
  if(t!==step||!Number.isSafeInteger(capacity)||capacity<1||lastCapacity!==null)
   throw Error("E1-А маршрутизация: невозможно выделить общий бюджет");
  lastCapacity=capacity;
  const target=Math.floor(capacity*p.decisionBandwidthFraction);
  lastTargetReservation=target;
  if(p.decisionBandwidthPolicy==="static"){
   lastDecisionReserved=target;
  }else if(p.decisionBandwidthPolicy==="local_floor"){
   // Local demand is measured AFTER local packets were staged this tick, with
   // no oracle information. Reserve only packets that can use a live edge.
   if(!Number.isSafeInteger(localDemand)||localDemand<0)
    throw Error("E1-А маршрутизация: необходим целочисленный спрос локальных сообщений");
   lastDecisionReserved=target;
   lastLocalReserved=Math.min(Math.floor(capacity*p.localTransportBandwidthFraction),localDemand);
  }else{
   // Demand-capped protection for OLD routed packets. Fresh decisions may
   // subsequently use the idle capacity left by E1.
   let demand=0;
   for(const packet of waiting){
    if(t-packet.emitted>=p.decisionMaxStalenessSteps)continue;
    if(nextHopOnActiveGraph(adjacency,labels,active,packet.at,packet.target)!==null)
     demand++;
    if(demand>=target)break;
   }
   lastDecisionReserved=Math.min(target,demand);
  }
  lastReserved=lastDecisionReserved+lastLocalReserved;
  if(lastReserved>capacity)throw Error("E1-А маршрутизация: переполнен общий резерв");
  return lastReserved;
 };
 const onProposalsDelivered=({step:t,available})=>{
  if(t!==step||!Array.isArray(available)||available.length!==n)
   throw Error("E1-А маршрутизация: несогласованный поток предложений");
  originAvailable=Boolean(available[origin]&&active[origin]&&labels[origin]>=0);
 };
 const transmit=({step:t,value})=>{
  if(t!==step||!(value===null||finite(value)))
   throw Error("E1-А маршрутизация: недопустимый такт/коллективное решение");
  if(!finite(value)){counters.abstentions++;return;}
  if(!originAvailable){counters.notDispatched++;return;}
  for(let j=0;j<n;j++){
   if(!reachable(origin,j))continue;
   counters.attempted++;
   const packet={id:nextId++,target:j,at:origin,value,emitted:t,hops:0};
   if(j===origin){
    // Local publication becomes visible only on NEXT tick.
    inFlight.push({...packet,next:origin,due:t+1,local:true});
   }else waiting.push(packet);
  }
 };
 const afterEvidenceTransport=({step:t,sharedCapacity,e1Used,reserved})=>{
  if(t!==step||sharedCapacity!==lastCapacity||reserved!==lastReserved||
   !Number.isSafeInteger(e1Used)||e1Used<0||e1Used>sharedCapacity-reserved)
   throw Error("E1-А маршрутизация: неверный бюджет E1 после передачи свидетельств");
  const slotsAvailable=p.decisionBandwidthPolicy==="opportunistic"
   ?sharedCapacity-e1Used:lastDecisionReserved;
  let slots=slotsAvailable,hops=0,routes=0,limited=0;
  const deferred=[];
  // Oldest packets first; deterministic tie-break by destination and creation.
  waiting.sort((a,b)=>a.emitted-b.emitted||a.target-b.target||a.id-b.id);
  for(const packet of waiting){
   if(t-packet.emitted>=p.decisionMaxStalenessSteps){
    // No new hop could arrive within its remaining freshness horizon.
    counters.expired++;continue;
   }
   // Bandwidth is checked BEFORE graph search, avoiding O(pending*N²)
   // work when the static routing quota is already exhausted.
   if(slots===0){limited++;deferred.push(packet);continue;}
   const next=nextHopOnActiveGraph(adjacency,labels,active,packet.at,packet.target);
   if(next===null){routes++;deferred.push(packet);continue;}
   slots--;hops++;counters.hopsScheduled++;
   const random=createRng(config.seed,runIndex,0xD3C16,packet.id,
    packet.emitted,packet.target,packet.at,next,t,packet.hops);
   if(random.random()<p.decisionLossProbability){
    counters.lost++;counters.hopsLost++;
   }else inFlight.push({...packet,next,due:t+p.decisionDelaySteps,local:false});
  }
  waiting.splice(0,waiting.length,...deferred);
  const borrowedFromE1=Math.max(0,hops-lastDecisionReserved);
  const releasedToE1=lastTargetReservation-lastDecisionReserved;
  if(hops>slotsAvailable||lastDecisionReserved>lastTargetReservation||releasedToE1<0||
   e1Used+hops+lastLocalReserved>sharedCapacity)
   throw Error("E1-А маршрутизация: превышение адаптивного общего бюджета");
  counters.routeDeferrals+=routes;counters.bandwidthDeferrals+=limited;
  counters.transmittedSlots+=hops;counters.e1UsedSlots+=e1Used;
  counters.reservedSlots+=reserved;counters.sharedCapacitySlots+=sharedCapacity;
  counters.decisionGuaranteedSlots+=lastDecisionReserved;
  counters.localGuaranteedSlots+=lastLocalReserved;
  counters.decisionBorrowedSlots+=borrowedFromE1;
  counters.releasedToE1Slots+=releasedToE1;
  Object.assign(history.at(-1),{
   pending:pending(),routeDeferredThisStep:routes,
   bandwidthDeferredThisStep:limited,routingHopsThisStep:hops,
   sharedCapacity,e1Used,reserved,decisionReserved:lastDecisionReserved,
   localReserved:lastLocalReserved,targetReservation:lastTargetReservation,
   releasedToE1,borrowedFromE1,availableForE1:sharedCapacity-reserved,
   sharedUsed:e1Used+hops,sharedUnused:sharedCapacity-e1Used-hops
  });
  audit();
  return {routingHops:hops,e1Used,reserved,sharedCapacity,
   localReserved:lastLocalReserved,decisionReserved:lastDecisionReserved};
 };
 const referenceFor=(observer,target)=>{
  if(!Number.isInteger(observer)||observer<0||observer>=n||
   !Number.isInteger(target)||target<0||target>=n)
   throw Error("E1-А маршрутизация: недопустимый индекс свидетеля");
  if(!reachable(origin,observer)||!reachable(origin,target)||
   !reachable(observer,target)){
   counters.uninformedWitnesses++;return null;
  }
  const ref=received[observer];
  if(!ref||step-ref.emitted>p.decisionMaxStalenessSteps){
   counters.uninformedWitnesses++;return null;
  }
  counters.referencesUsed++;return ref.value;
 };
 return Object.freeze({
  networkStep,reserveDecisionBandwidth,onProposalsDelivered,transmit,
  afterEvidenceTransport,referenceFor,getDiagnostic:snapshot
 });
}
