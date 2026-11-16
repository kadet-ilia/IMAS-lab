/**
 * E1-A decision dissemination surrogate for the network_feedback experiment.
 *
 * There is ONE designated decision origin and a one-to-many broadcast restricted
 * to the actual active E1 connectivity component at both emission and arrival.
 * This is NOT per-edge routing, not decentralized consensus, and not included
 * in the original E1 proposal/evidence traffic ledger.
 *
 * A message emitted at t can first be used at t+delay (delay >= 1).
 * A receiver retains its latest successfully delivered reference for a bounded
 * time, unless disconnected from the source or isolated in the current step.
 */
import {createRng} from "./trustEngine.js";
export const E1A_DECISION_CHANNEL_VERSION="e1a-decision-component-broadcast-1.0.0";
export const E1A_DECISION_CHANNEL_DEFAULTS=Object.freeze({
 decisionOriginAgent:0,
 decisionDelaySteps:1,
 decisionLossProbability:0,
 decisionMaxStalenessSteps:5
});
const finite=Number.isFinite;
export function validateDecisionChannelOptions(options={}){
 const o={...E1A_DECISION_CHANNEL_DEFAULTS,...options};
 for(const [name,min,max,integer] of [
  ["decisionOriginAgent",0,159,true],["decisionDelaySteps",1,50,true],
  ["decisionLossProbability",0,1,false],["decisionMaxStalenessSteps",1,500,true]
 ]){
  const x=o[name];
  if(!finite(x)||x<min||x>max||(integer&&!Number.isInteger(x)))
   throw Error("E1-А канал решений: недопустимый параметр "+name);
 }
 if(o.decisionMaxStalenessSteps<o.decisionDelaySteps)
  throw Error("E1-А канал решений: срок хранения должен быть не меньше задержки");
 return o;
}
export function createDecisionChannel(config,options={},runIndex=0){
 const p=validateDecisionChannelOptions(options);
 const n=config?.n_agents+config?.n_sybil_agents;
 if(!Number.isInteger(n)||n<2||p.decisionOriginAgent>=n)
  throw Error("E1-А канал решений: отсутствует назначенный источник в списке агентов");
 if(!Number.isInteger(config.seed)||!Number.isInteger(runIndex)||runIndex<0)
  throw Error("E1-А канал решений: требуется seed и индекс реализации");
 const origin=p.decisionOriginAgent;
 let step=0,labels=null,active=null,originAvailable=false;
 const pending=[],last=Array(n).fill(null);
 const counters={attempted:0,lost:0,delivered:0,blocked:0,expired:0,
  notDispatched:0,abstentions:0,uninformedWitnesses:0,referencesUsed:0};
 const feedbackCoverage=[],snapshot=()=>({
  ...counters,pending:pending.length,origin,delay:p.decisionDelaySteps,
  lossProbability:p.decisionLossProbability,staleness:p.decisionMaxStalenessSteps,
  history:feedbackCoverage.map(x=>({...x})),modelVersion:E1A_DECISION_CHANNEL_VERSION
 });
 const same=(i,j)=>active[i]&&active[j]&&labels[i]>=0&&labels[i]===labels[j];
 const networkStep=({step:t,labels:nextLabels,active:nextActive})=>{
  if(!Number.isInteger(t)||t!==step+1||!Array.isArray(nextLabels)||
   !Array.isArray(nextActive)||nextLabels.length!==n||nextActive.length!==n)
   throw Error("E1-А канал решений: несогласованный такт и состав сетевых агентов");
  if(nextLabels.some(x=>!Number.isInteger(x)||x< -1)||
   nextActive.some(x=>typeof x!=="boolean"))
   throw Error("E1-А канал решений: недопустимые компоненты связности");
  labels=[...nextLabels];active=[...nextActive];step=t;originAvailable=false;
  const remaining=[];
  for(const packet of pending){
   if(packet.due>t){remaining.push(packet);continue;}
   if(t-packet.emitted>p.decisionMaxStalenessSteps){
    counters.expired++;continue;
   }
   if(!same(origin,packet.target)){
    counters.blocked++;continue;
   }
   const existing=last[packet.target];
   if(!existing||packet.emitted>=existing.emitted){
    last[packet.target]={emitted:packet.emitted,value:packet.value};
   }
   counters.delivered++;
  }
  pending.splice(0,pending.length,...remaining);
  let informed=0,reachable=0;
  for(let i=0;i<n;i++){
   if(!same(origin,i))continue;
   reachable++;
   const ref=last[i];
   if(ref&&t-ref.emitted<=p.decisionMaxStalenessSteps)informed++;
  }
  feedbackCoverage.push({step:t,reachable,informed,
   coverage:reachable?informed/reachable:null,pending:pending.length});
 };
 const onProposalsDelivered=({step:t,available})=>{
  if(t!==step||!Array.isArray(available)||available.length!==n)
   throw Error("E1-А канал решений: нарушение порядка доставки предложений");
  originAvailable=Boolean(available[origin]&&active[origin]&&labels[origin]>=0);
 };
 const transmit=({step:t,value})=>{
  if(t!==step||!(value===null||finite(value)))
   throw Error("E1-А канал решений: нарушение очередности или недопустимое значение");
  if(!finite(value)){counters.abstentions++;return;}
  if(!originAvailable){counters.notDispatched++;return;}
  for(let i=0;i<n;i++){
   if(!same(origin,i))continue;
   counters.attempted++;
   const rng=createRng(config.seed,runIndex,0xD3C15,t,origin,i);
   if(rng.random()<p.decisionLossProbability){counters.lost++;continue;}
   pending.push({target:i,emitted:t,due:t+p.decisionDelaySteps,value});
  }
 };
 const referenceFor=(observer,target)=>{
  if(!Number.isInteger(observer)||observer<0||observer>=n||
   !Number.isInteger(target)||target<0||target>=n)
   throw Error("E1-А канал решений: недопустимый индекс свидетеля или объекта");
  if(!same(origin,observer)||!same(origin,target)||
   labels[observer]!==labels[target]){
   counters.uninformedWitnesses++;return null;
  }
  const ref=last[observer];
  if(!ref||step-ref.emitted>p.decisionMaxStalenessSteps){
   counters.uninformedWitnesses++;return null;
  }
  counters.referencesUsed++;return ref.value;
 };
 return Object.freeze({networkStep,onProposalsDelivered,transmit,referenceFor,
  getDiagnostic:snapshot});
}
