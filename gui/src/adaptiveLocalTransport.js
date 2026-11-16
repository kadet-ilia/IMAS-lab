/**
 * E1-A causal ONE-HOP neighbor-value communication for local estimators.
 *
 * Opt-in diagnostic only: it does not replace central E1 decisions, witness
 * scores, isolation, or the routed decision-feedback source.
 *
 * Each node computes from its OWN current proposal and only PREVIOUSLY
 * delivered direct-neighbor values. One message is offered per active
 * directed edge at the end of each tick, using only global bandwidth left
 * after baseline E1 and (if present) routed decision forwarding. Messages
 * are delayed, lossy, TTL-bounded, and rechecked against the actual edge on
 * arrival. This is deliberately low priority and NOT a decentralized
 * Byzantine consensus protocol or a fair/shared-priority scheduler.
 */
import {createRng} from "./trustEngine.js";
import {localWeightedTrim,validateLocalConsensusOptions} from "./adaptiveLocalConsensus.js";

export const E1A_LOCAL_TRANSPORT_VERSION="e1a-local-causal-idle-slot-1.0.0";
export const E1A_LOCAL_TRANSPORT_DEFAULTS=Object.freeze({
 localTransportEnabled:false,
 localTransportDelaySteps:1,
 localTransportLossProbability:0,
 localTransportMaxAgeSteps:4
});
const finite=Number.isFinite;
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
export function validateLocalTransportOptions(options={}){
 if(!options||typeof options!=="object"||Array.isArray(options))
  throw Error("Локальные сообщения: требуется объект параметров");
 const o={...E1A_LOCAL_TRANSPORT_DEFAULTS,...options};
 if(typeof o.localTransportEnabled!=="boolean")
  throw Error("Локальные сообщения: localTransportEnabled должен быть логическим");
 for(const [key,lo,hi,int] of [
  ["localTransportDelaySteps",1,50,true],
  ["localTransportLossProbability",0,1,false],
  ["localTransportMaxAgeSteps",1,500,true]
 ]){
  if(!finite(o[key])||o[key]<lo||o[key]>hi||
    (int&&!Number.isInteger(o[key])))
   throw Error("Локальные сообщения: недопустимый параметр "+key);
 }
 if(o.localTransportMaxAgeSteps<o.localTransportDelaySteps)
  throw Error("Локальные сообщения: срок актуальности меньше задержки");
 validateLocalConsensusOptions(o);
 return o;
}
export function createLocalTransport(config,options={},runIndex=0){
 const p=validateLocalTransportOptions(options);
 const n=config?.n_agents+config?.n_sybil_agents;
 const low=config?.safe_action_min,high=config?.safe_action_max;
 if(!Number.isInteger(n)||n<2||n>160||!Number.isInteger(config?.seed)||
  !Number.isInteger(runIndex)||runIndex<0||!finite(low)||!finite(high)||low>=high)
  throw Error("Локальные сообщения: некорректная конфигурация среды");
 let step=0,active=null,labels=null,adjacency=null,prepared=false;
 const received=Array.from({length:n},()=>new Map());
 const waiting=new Map(),inFlight=[],history=[];
 const counters={generated:0,transmitted:0,delivered:0,lost:0,
  blocked:0,expired:0,superseded:0,bandwidthDeferred:0,
  disconnectedDeferred:0,neighborReadingsUsed:0,maliciousHolds:0,
  slotsE1:0,slotsDecisions:0,slotsLocal:0,slotsCapacity:0};
 const key=(i,j)=>i+":"+j;
 const edge=(i,j)=>i!==j&&active[i]&&active[j]&&
  labels[i]>=0&&labels[i]===labels[j]&&adjacency[i][j];
 const audit=()=>{
  if(counters.generated!==counters.delivered+counters.lost+
   counters.blocked+counters.expired+counters.superseded+
   waiting.size+inFlight.length)
   throw Error("Локальные сообщения: нарушен баланс адресных сообщений");
  if(counters.slotsE1+counters.slotsDecisions+counters.slotsLocal>
   counters.slotsCapacity||counters.transmitted!==counters.slotsLocal)
   throw Error("Локальные сообщения: превышен общий ресурс E1");
 };
 const networkStep=({step:t,active:a,labels:l,adjacency:g})=>{
  if(!Number.isInteger(t)||t!==step+1||!Array.isArray(a)||
   !Array.isArray(l)||!Array.isArray(g)||a.length!==n||
   l.length!==n||g.length!==n||
   a.some(v=>typeof v!=="boolean")||
   l.some(v=>!Number.isInteger(v)||v< -1)||
   g.some((row,i)=>!Array.isArray(row)||row.length!==n||
    row.some((v,j)=>typeof v!=="boolean"||v!==g[j]?.[i]||
     v&&(i===j||!a[i]||!a[j]||l[i]!==l[j]))))
   throw Error("Локальные сообщения: некорректный текущий граф E1");
  active=[...a];labels=[...l];adjacency=g.map(row=>[...row]);
  step=t;prepared=false;
  const remain=[];
  for(const packet of inFlight){
   if(t-packet.emitted>p.localTransportMaxAgeSteps){
    counters.expired++;continue;
   }
   if(packet.due>t){remain.push(packet);continue;}
   if(!edge(packet.from,packet.to)){
    counters.blocked++;continue;
   }
   const prior=received[packet.to].get(packet.from);
   if(!prior||packet.emitted>=prior.emitted)
    received[packet.to].set(packet.from,{
     value:packet.value,emitted:packet.emitted,arrived:t
    });
   counters.delivered++;
  }
  inFlight.splice(0,inFlight.length,...remain);
  for(const [id,packet] of waiting)if(t-packet.emitted+
   p.localTransportDelaySteps>p.localTransportMaxAgeSteps){
   waiting.delete(id);counters.expired++;
  }
  history.push({step:t,
   generatedThisStep:0,transmittedThisStep:0,
   receivedThisStep:0,neighborReadingsThisStep:0,activeNodes:a.filter(Boolean).length,
   informedNodes:0,meanReceivedNeighbors:0,meanLocalValue:null,
   localValues:null,localHonestSpread:null,delayedQueue:waiting.size+inFlight.length,
   bandwidthDeferred:0,disconnectedDeferred:0,
   E1Used:null,decisionUsed:null,localUsed:null,totalUsed:null,
   sharedCapacity:null,sharedUtilization:null});
  audit();
 };
 const onProposals=({step:t,values,reputation,active:a,faulty})=>{
  if(t!==step||prepared||!Array.isArray(values)||!Array.isArray(reputation)||
   values.length!==n||reputation.length!==n||
   !Array.isArray(a)||a.length!==n||a.some((v,i)=>v!==active[i])||
   !Array.isArray(faulty)||faulty.length!==n||
   faulty.some(x=>typeof x!=="boolean")||
   reputation.some(x=>!finite(x)||x<0||x>1)||
   values.some((v,i)=>active[i]&&!finite(v)))
   throw Error("Локальные сообщения: некорректный поток текущих предложений");
  const next=Array(n).fill(null);
  let readings=0,informed=0,activeCount=0;
  for(let i=0;i<n;i++)if(active[i]){
   activeCount++;
   const own=clamp(values[i],low,high),v=[own],w=[
    Math.max(p.localConsensusMinWeight,reputation[i])
   ];
   for(let j=0;j<n;j++){
    if(!edge(i,j))continue;
    const sample=received[i].get(j);
    if(!sample||sample.emitted>=t||
     t-sample.emitted>p.localTransportMaxAgeSteps)continue;
    v.push(sample.value);w.push(Math.max(p.localConsensusMinWeight,reputation[j]));
    readings++;
   }
   if(v.length>1)informed++;
   // Faulty simulation behavior: attacker's outgoing value remains its OWN
   // generated proposal. Honest update never gets the faulty labels.
   next[i]=faulty[i]?own:clamp(
    (1-p.localConsensusRelaxation)*own+
    p.localConsensusRelaxation*localWeightedTrim(v,w,p.localConsensusTrim),low,high
   );
   if(faulty[i])counters.maliciousHolds++;
  }
  counters.neighborReadingsUsed+=readings;
  for(let i=0;i<n;i++)if(active[i])for(let j=0;j<n;j++)if(edge(i,j)){
   const id=key(i,j);
   if(waiting.has(id)){counters.superseded++;waiting.delete(id);}
   waiting.set(id,{id,from:i,to:j,value:next[i],emitted:t});
   counters.generated++;
  }
  const valid=next.filter(finite);
  const mean=arr=>arr.length?arr.reduce((s,x)=>s+x,0)/arr.length:null;
  const groups=new Map();
  for(let i=0;i<n;i++)if(active[i]&&!faulty[i]&&finite(next[i])){
   if(!groups.has(labels[i]))groups.set(labels[i],[]);
   groups.get(labels[i]).push(next[i]);
  }
  const spreads=[...groups.values()].map(arr=>Math.max(...arr)-Math.min(...arr));
  const localHonestSpread=spreads.length?Math.max(...spreads):null;
  Object.assign(history.at(-1),{
   generatedThisStep:active.reduce((s,a,i)=>s+(a?
    adjacency[i].filter(Boolean).length:0),0),
   neighborReadingsThisStep:readings,informedNodes:informed,
   meanReceivedNeighbors:activeCount?readings/activeCount:null,
   meanLocalValue:mean(valid),localHonestSpread,
   localValues:next,delayedQueue:waiting.size+inFlight.length
  });
  prepared=true;audit();
  return Object.freeze([...next]);
 };
 const afterEvidenceTransport=({step:t,sharedCapacity,e1Used,decisionUsed=0})=>{
  if(t!==step||!prepared||!Number.isSafeInteger(sharedCapacity)||
   !Number.isSafeInteger(e1Used)||!Number.isSafeInteger(decisionUsed)||
   sharedCapacity<0||e1Used<0||decisionUsed<0||
   e1Used+decisionUsed>sharedCapacity)
   throw Error("Локальные сообщения: неверный бюджет после E1 и маршрутизации");
  let slots=sharedCapacity-e1Used-decisionUsed,transmitted=0;
  let blockedThisStep=0,deferredThisStep=0;
  const eligible=[...waiting.values()].sort((x,y)=>
   x.emitted-y.emitted||x.from-y.from||x.to-y.to);
  for(const packet of eligible){
   if(t-packet.emitted+p.localTransportDelaySteps>p.localTransportMaxAgeSteps){
    waiting.delete(packet.id);counters.expired++;continue;
   }
   if(!edge(packet.from,packet.to)){
    blockedThisStep++;continue;
   }
   if(slots<=0){deferredThisStep++;continue;}
   waiting.delete(packet.id);
   slots--;transmitted++;counters.transmitted++;
   const rng=createRng(config.seed,runIndex,0x19C011,
    packet.from,packet.to,packet.emitted);
   if(rng.random()<p.localTransportLossProbability)counters.lost++;
   else inFlight.push({...packet,due:t+p.localTransportDelaySteps});
  }
  counters.bandwidthDeferred+=deferredThisStep;
  counters.disconnectedDeferred+=blockedThisStep;
  counters.slotsE1+=e1Used;counters.slotsDecisions+=decisionUsed;
  counters.slotsLocal+=transmitted;counters.slotsCapacity+=sharedCapacity;
  Object.assign(history.at(-1),{
   transmittedThisStep:transmitted,delayedQueue:waiting.size+inFlight.length,
   bandwidthDeferred:deferredThisStep,disconnectedDeferred:blockedThisStep,
   E1Used:e1Used,decisionUsed,localUsed:transmitted,
   totalUsed:e1Used+decisionUsed+transmitted,sharedCapacity,
   sharedUtilization:sharedCapacity?
    (e1Used+decisionUsed+transmitted)/sharedCapacity:null
  });
  audit();
  return {localTransmissions:transmitted,sharedUnused:slots};
 };
 const getDiagnostic=()=>{
  audit();
  return {...counters,waiting:waiting.size,inFlight:inFlight.length,
   pending:waiting.size+inFlight.length,
   modelVersion:E1A_LOCAL_TRANSPORT_VERSION,role:"causal_local_diagnostic_only",
   policy:"LOW_PRIORITY_LEFTOVER_ONLY",
   history:history.map(h=>({...h,localValues:h.localValues?[...h.localValues]:null}))};
 };
 return Object.freeze({networkStep,onProposals,afterEvidenceTransport,getDiagnostic});
}
