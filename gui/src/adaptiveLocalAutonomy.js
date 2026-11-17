/**
 * Opt-in E1-A autonomous local decision estimator.
 * Each node owns its directed Beta trust records. Inputs are its own observations
 * and causal, delivered direct-neighbor packets; global E1 reputation and oracle
 * truth are not inputs. This is NOT Byzantine consensus or full-system closed-loop control.
 */
import {localWeightedTrim} from "./adaptiveLocalConsensus.js";

export const E1A_LOCAL_AUTONOMY_VERSION="e1a-local-directed-beta-shadow-1.2.0-action-feedback";
export const E1A_LOCAL_AUTONOMY_DEFAULTS=Object.freeze({
 localAutonomyEnabled:false,
 localAutonomyEvidenceTolerance:0.45,
 localAutonomyDecay:0.95,
 localAutonomyMinNeighbors:1,
 localAutonomyGuardEnabled:false,
 localAutonomyGuardThreshold:0.30,
 localAutonomyGuardHysteresis:0.15,
 localAutonomyGuardMinEvidence:3,
 // Optional local-only action state: accepted decisions affect NEXT neighbor
 // packets. They never affect the central E1 simulator or trust oracle.
 localAutonomyActionFeedbackEnabled:false,
 localAutonomyActionGain:0.5,
 localAutonomyActionMaxStep:0.25,
 localAutonomyActionRefusalPolicy:"hold",
 // Evaluation-only squared-error cost of missing a local decision.
 localAutonomyRefusalPenalty:1
});
const finite=Number.isFinite;
const clamp=(x,low,high)=>Math.max(low,Math.min(high,x));
export function validateLocalAutonomyOptions(options={}){
 if(!options||typeof options!=="object"||Array.isArray(options))
  throw Error("Автономные локальные решения: ожидается объект параметров");
 const p={...E1A_LOCAL_AUTONOMY_DEFAULTS,...options};
 if(typeof p.localAutonomyEnabled!=="boolean"||
  !finite(p.localAutonomyEvidenceTolerance)||p.localAutonomyEvidenceTolerance<=0||
  p.localAutonomyEvidenceTolerance>100||
  !finite(p.localAutonomyDecay)||p.localAutonomyDecay<0||p.localAutonomyDecay>1||
  !Number.isInteger(p.localAutonomyMinNeighbors)||p.localAutonomyMinNeighbors<0||
  p.localAutonomyMinNeighbors>159||
  typeof p.localAutonomyGuardEnabled!=="boolean"||
  !finite(p.localAutonomyGuardThreshold)||p.localAutonomyGuardThreshold<=0||
  p.localAutonomyGuardThreshold>=1||
  !finite(p.localAutonomyGuardHysteresis)||p.localAutonomyGuardHysteresis<0||
  p.localAutonomyGuardThreshold+p.localAutonomyGuardHysteresis>=1||
  !Number.isInteger(p.localAutonomyGuardMinEvidence)||
  p.localAutonomyGuardMinEvidence<1||p.localAutonomyGuardMinEvidence>500||
  typeof p.localAutonomyActionFeedbackEnabled!=="boolean"||
  !finite(p.localAutonomyActionGain)||p.localAutonomyActionGain<0||
  p.localAutonomyActionGain>1||
  !finite(p.localAutonomyActionMaxStep)||p.localAutonomyActionMaxStep<=0||
  p.localAutonomyActionMaxStep>100||
  !["hold","observe"].includes(p.localAutonomyActionRefusalPolicy)||
  !finite(p.localAutonomyRefusalPenalty)||p.localAutonomyRefusalPenalty<0||
  p.localAutonomyRefusalPenalty>10000)
  throw Error("Автономные локальные решения: недопустимые параметры");
 return p;
}
export function createLocalAutonomy(n,low,high,options={}){
 const p=validateLocalAutonomyOptions(options);
 if(!Number.isInteger(n)||n<2||n>160||!finite(low)||!finite(high)||low>=high||
  !Number.isInteger(p.localTransportMaxAgeSteps)||p.localTransportMaxAgeSteps<1||
  p.localTransportMaxAgeSteps>500||
  !Number.isInteger(p.localConsensusTrim)||p.localConsensusTrim<0||
  !finite(p.localConsensusRelaxation)||p.localConsensusRelaxation<0||
  p.localConsensusRelaxation>1||
  !finite(p.localConsensusMinWeight)||p.localConsensusMinWeight<=0)
  throw Error("Автономные локальные решения: неверная численная область");
 const ownHistory=Array.from({length:n},()=>new Map());
 const trust=Array.from({length:n},()=>new Map());
 // Last applied local action; NO central aggregated decision or ground truth.
 const actionState=Array(n).fill(null);
 let lastStep=0,totalUpdates=0,totalRefusals=0,totalUnmatched=0;
 let totalGuarded=0,totalReleased=0,totalExcluded=0;
 let totalActionUpdates=0,totalActionRefusals=0,totalActionResets=0;
 const decay=(entry,t)=>{
  const age=t-entry.lastUpdate;
  if(age>0){
   const factor=Math.pow(p.localAutonomyDecay,age);
   entry.alpha=1+(entry.alpha-1)*factor;
   entry.beta=1+(entry.beta-1)*factor;
   entry.lastUpdate=t;
  }
 };
 const tick=({step,own,active,messages})=>{
  if(!Number.isInteger(step)||step!==lastStep+1||
   !Array.isArray(own)||!Array.isArray(active)||!Array.isArray(messages)||
   own.length!==n||active.length!==n||messages.length!==n||
   active.some(x=>typeof x!=="boolean")||
   own.some((v,i)=>active[i]&&!finite(v)))
   throw Error("Автономные локальные решения: нарушен порядок тактов или форма входа");
  lastStep=step;
  const projected=own.map((v,i)=>active[i]?clamp(v,low,high):null);
  for(let i=0;i<n;i++){
   if(active[i])ownHistory[i].set(step,projected[i]);
   for(const s of ownHistory[i].keys())
    if(s<step-p.localTransportMaxAgeSteps)ownHistory[i].delete(s);
  }
  const decisions=Array(n).fill(null),trustByNode=Array(n).fill(null);
  let updates=0,refusals=0,unmatched=0,readings=0,trustSum=0;
  let guarded=0,released=0,excluded=0;
  for(let i=0;i<n;i++){
   if(!Array.isArray(messages[i])||(!active[i]&&messages[i].length))
    throw Error("Автономные локальные решения: сообщения неактивного узла");
   if(!active[i])continue;
   const values=[projected[i]],weights=[1],seen=new Set(),relations=[];
   let acceptedNeighbors=0;
   for(const sample of messages[i]){
    if(!sample||!Number.isInteger(sample.source)||sample.source<0||
     sample.source>=n||sample.source===i||seen.has(sample.source)||
     !finite(sample.value)||sample.value<low||sample.value>high||
     !Number.isInteger(sample.emitted)||sample.emitted<1||sample.emitted>=step||
     step-sample.emitted>p.localTransportMaxAgeSteps||
     !Number.isInteger(sample.arrived)||sample.arrived<sample.emitted+1||
     sample.arrived>step)
     throw Error("Автономные локальные решения: недоставленное или повторное сообщение");
    seen.add(sample.source);
    let entry=trust[i].get(sample.source);
    if(!entry){
     entry={alpha:1,beta:1,lastUpdate:step,lastProcessed:0,
      evidenceCount:0,quarantined:false};
     trust[i].set(sample.source,entry);
    }
    decay(entry,step);
    if(sample.arrived===step&&sample.emitted>entry.lastProcessed){
     const baseline=ownHistory[i].get(sample.emitted);
     if(finite(baseline)){
      const ratio=(sample.value-baseline)/p.localAutonomyEvidenceTolerance;
      const consistency=1/(1+ratio*ratio);
      entry.alpha+=consistency;entry.beta+=1-consistency;
      entry.evidenceCount++;updates++;totalUpdates++;
      if(p.localAutonomyGuardEnabled&&
       entry.evidenceCount>=p.localAutonomyGuardMinEvidence){
       const credibility=entry.alpha/(entry.alpha+entry.beta);
       if(!entry.quarantined&&credibility<p.localAutonomyGuardThreshold){
        entry.quarantined=true;guarded++;totalGuarded++;
       }else if(entry.quarantined&&
        credibility>p.localAutonomyGuardThreshold+p.localAutonomyGuardHysteresis){
        entry.quarantined=false;released++;totalReleased++;
       }
      }
     }else{unmatched++;totalUnmatched++;}
     entry.lastProcessed=sample.emitted;
    }
    const score=entry.alpha/(entry.alpha+entry.beta);
    if(!entry.quarantined){
     values.push(sample.value);
     weights.push(Math.max(p.localConsensusMinWeight,score));
     acceptedNeighbors++;readings++;
    }else{excluded++;totalExcluded++;}
    trustSum+=score;
    relations.push({source:sample.source,trust:score,emitted:sample.emitted,
     arrived:sample.arrived,quarantined:entry.quarantined,
     evidenceCount:entry.evidenceCount});
   }
   trustByNode[i]=relations;
   if(acceptedNeighbors<p.localAutonomyMinNeighbors){
    refusals++;totalRefusals++;continue;
   }
   decisions[i]=clamp(
    (1-p.localConsensusRelaxation)*projected[i]+
    p.localConsensusRelaxation*localWeightedTrim(values,weights,p.localConsensusTrim),
    low,high);
  }
  // A bounded local information-feedback loop, distinct from plant or E1
  // control: z_i(t) depends only on z_i(t-1) and u_i(t), and is offered
  // as a causal message to neighbors at the END of this tick.
  const actions=Array(n).fill(null);
  let actionUpdates=0,actionRefusals=0,actionResets=0;
  if(p.localAutonomyActionFeedbackEnabled)for(let i=0;i<n;i++){
   if(!active[i]){
    if(finite(actionState[i])){actionResets++;totalActionResets++;}
    actionState[i]=null;continue;
   }
   const prior=finite(actionState[i])?actionState[i]:projected[i];
   if(finite(decisions[i])){
    const delta=clamp(p.localAutonomyActionGain*(decisions[i]-prior),
     -p.localAutonomyActionMaxStep,p.localAutonomyActionMaxStep);
    actions[i]=clamp(prior+delta,low,high);
    actionUpdates++;totalActionUpdates++;
   }else{
    // A refusal never counts as a new accepted collective decision.
    // The local action state can hold safely or reset to own observation.
    actions[i]=p.localAutonomyActionRefusalPolicy==="hold"?prior:projected[i];
    actionRefusals++;totalActionRefusals++;
   }
   actionState[i]=actions[i];
  }
  const activeCount=active.filter(Boolean).length;
  const allObserved=readings+excluded;
  return {step,decisions,trustByNode,updates,refusals,unmatched,readings,
   guarded,released,excluded,actions,actionUpdates,actionRefusals,actionResets,
   meanTrust:allObserved?trustSum/allObserved:null,activeCount,
   coverage:activeCount?decisions.filter(finite).length/activeCount:null};
 };
 const getDiagnostic=()=>({modelVersion:E1A_LOCAL_AUTONOMY_VERSION,
  steps:lastStep,updates:totalUpdates,refusals:totalRefusals,
  unmatched:totalUnmatched,guarded:totalGuarded,released:totalReleased,
  excluded:totalExcluded,
  actionFeedbackEnabled:p.localAutonomyActionFeedbackEnabled,
  actionUpdates:totalActionUpdates,actionRefusals:totalActionRefusals,
  actionResets:totalActionResets,
  directedGuardedPairs:trust.reduce((sum,relations)=>sum+
   [...relations.values()].filter(x=>x.quarantined).length,0),
  role:"independent_directed_trust_from_delivered_messages"});
 return Object.freeze({tick,getDiagnostic});
}
