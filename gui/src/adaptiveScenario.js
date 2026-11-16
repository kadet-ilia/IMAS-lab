/**
 * E1-A synthetic attack / evidence generators.
 *
 * This is the SIMULATOR SIDE of the experiment. It may know Byzantine labels
 * to generate adversarial events. It never exposes these labels to the
 * decisionObserver or adaptive estimator.
 *
 * It intentionally does not replace the legacy E1 model. A null adapter means
 * exactly the original proposal and evidence generation paths.
 */
import {createRng} from "./trustEngine.js";
import {createDecisionChannel,validateDecisionChannelOptions,E1A_DECISION_CHANNEL_VERSION} from "./adaptiveDecisionChannel.js";
import {createRoutedDecisionChannel,validateRoutedChannelOptions,E1A_ROUTED_CHANNEL_VERSION,E1A_ROUTED_DEFAULTS} from "./adaptiveRoutedDecisionChannel.js";
import {simulateLocalConsensusTick,validateLocalConsensusOptions,E1A_LOCAL_CONSENSUS_DEFAULTS,E1A_LOCAL_CONSENSUS_VERSION} from "./adaptiveLocalConsensus.js";

export const ADAPTIVE_SCENARIO_VERSION="e1a-behavior-evidence-1.5.0-component-local-diagnostic";
export const ADAPTIVE_ATTACK_STRATEGIES=Object.freeze([
 {id:"legacy",label:"Исходная стратегия E1"},
 {id:"coordinated",label:"Согласованное смещение"},
 {id:"stealth",label:"Малозаметное смещение"},
 {id:"pulsed",label:"Периодическая атака"},
 {id:"reputation_boost",label:"Накопление репутации → атака"}
]);
export const ADAPTIVE_EVIDENCE_MODELS=Object.freeze([
 {id:"legacy",label:"Исходные свидетельства E1"},
 {id:"behavior_linked",label:"По наблюдаемому поведению"},
 {id:"correlated_witnesses",label:"Коррелированные свидетельства"},
 {id:"lagged_observation",label:"Запаздывающие наблюдения"}
]);
export const ADAPTIVE_SCENARIO_DEFAULTS=Object.freeze({
 attackStrategy:"legacy",evidenceModel:"legacy",
 attackPeriod:10,attackDuty:4,reputationWarmup:12,
 stealthBias:0.65,coordinatedBias:2.0,attackNoiseSigma:0.025,
 evidenceTolerance:0.45,evidenceNoiseSigma:0.025,
 witnessCorruption:0.8,evidenceCorrelation:0.45,evidenceLag:2,
 ...({decisionOriginAgent:0,decisionDelaySteps:1,decisionLossProbability:0,decisionMaxStalenessSteps:5}),
 ...E1A_ROUTED_DEFAULTS,
 localConsensusPilot:false,
 ...E1A_LOCAL_CONSENSUS_DEFAULTS
});
const clamp=(x,lo=0,hi=1)=>Math.min(hi,Math.max(lo,x));
function med(a){
 if(!a.length)return null;
 const ordered=[...a].sort((x,y)=>x-y);
 return (ordered[Math.floor((ordered.length-1)/2)]+ordered[Math.ceil((ordered.length-1)/2)])/2;
}
const finite=Number.isFinite;
const validateNumber=(key,v,lo,hi,integer=false)=>{
 if(!finite(v)||v<lo||v>hi||(integer&&!Number.isInteger(v)))
  throw Error("Параметр сценария "+key+": требуется "+lo+"…"+hi+(integer?" (целое)":""));
};
export function validateAdaptiveScenarioOptions(options={}){
 if(!options||typeof options!=="object"||Array.isArray(options))
  throw Error("Параметры сценария должны быть объектом");
 const o={...ADAPTIVE_SCENARIO_DEFAULTS,...options};
 if(!ADAPTIVE_ATTACK_STRATEGIES.some(x=>x.id===o.attackStrategy))
  throw Error("Неизвестная стратегия атакующего E1-А");
 if(!ADAPTIVE_EVIDENCE_MODELS.some(x=>x.id===o.evidenceModel))
  throw Error("Неизвестная модель свидетельств E1-А");
 const limits={
  attackPeriod:[1,500,true],attackDuty:[1,500,true],reputationWarmup:[0,50000,true],
  stealthBias:[0,100,false],coordinatedBias:[0,100,false],
  attackNoiseSigma:[0,10,false],evidenceTolerance:[0.000001,100,false],
  evidenceNoiseSigma:[0,1,false],witnessCorruption:[0,1,false],
  evidenceCorrelation:[0,1,false],evidenceLag:[0,500,true]
 };
 for(const [key,[lo,hi,int]] of Object.entries(limits))validateNumber(key,o[key],lo,hi,int);
 if(o.attackDuty>o.attackPeriod)throw Error("Длительность импульса превышает период атаки");
 validateDecisionChannelOptions(o);
 validateRoutedChannelOptions(o);
 validateLocalConsensusOptions(o);
 if(typeof o.localConsensusPilot!=="boolean")
  throw Error("Локальный консенсус: localConsensusPilot должен быть логическим");
 if(o.attackStrategy==="reputation_boost"&&o.evidenceModel==="legacy")
  throw Error("Накопление репутации требует модели свидетельств по поведению агентов");
 return o;
}
/** Returns null if E1-A requests the untouched legacy scenario. */
export function createAdaptiveScenarioAdapter(config,options,runIndex){
 const o=validateAdaptiveScenarioOptions(options);
 if(o.attackStrategy==="legacy"&&o.evidenceModel==="legacy"&&!o.localConsensusPilot)return null;
 if(!Number.isInteger(runIndex)||runIndex<0)throw Error("Некорректный индекс реализации E1-А");
 if(!Number.isInteger(config?.seed))throw Error("Отсутствует целочисленный seed");
 const routed=o.comparisonMode==="network_routed";
 const channel=routed?createRoutedDecisionChannel(config,o,runIndex):
  o.comparisonMode==="network_feedback"?createDecisionChannel(config,o,runIndex):null;
 const observedHistory=new Map();
 const qualityCache=new Map();
 const localConsensusHistory=[];
 let lastDeliveredStep=0;
 let feedbackDecision=null;
 const debug={behaviorEvidenceGenerated:0,uninformativeEvidence:0,maliciousWitnessed:0,
  generatedAttackProposals:0,laggedObservationCount:0,feedbackDecisionUsed:0,feedbackAbstentions:0};
 const rngFor=(step,source=0,target=0,stage=0)=>
  createRng(config.seed,runIndex,0x45A11,stage,step,source,target);
 const isActive=(step,intensity)=>{
  if(intensity<=0)return false;
  if(o.attackStrategy==="pulsed"&&(step-1)%o.attackPeriod>=o.attackDuty)return false;
  if(o.attackStrategy==="reputation_boost"&&step<=o.reputationWarmup)return false;
  return true;
 };
 const transformProposals=({step,values,byzantine,sybil,intensity})=>{
  if(o.attackStrategy==="legacy")return values;
  if(!Array.isArray(values)||values.length!==byzantine.length||values.length!==sybil.length)
   throw Error("Нарушена форма синтетического потока предложений");
  const out=[...values],attacking=isActive(step,intensity);
  // No attack during the reputation-building period. Honest Gaussian proposal
  // draws are retained on the original E1 process for every legitimate node.
  if(!attacking){
   if(o.attackStrategy==="reputation_boost")
    for(let i=0;i<out.length;i++)if(byzantine[i]){
     out[i]=config.desired_action+config.honest_noise_sigma*rngFor(step,i,0,1).normal();
    }
   return out;
  }
  const bias=o.attackStrategy==="stealth"?o.stealthBias:o.coordinatedBias;
  const common=rngFor(step,0,0,2).normal()*o.attackNoiseSigma;
  for(let i=0;i<out.length;i++)if(byzantine[i]){
   const local=rngFor(step,i,0,3).normal()*o.attackNoiseSigma;
   const additive=o.attackStrategy==="stealth"?local:common+0.1*local;
   out[i]=config.desired_action+config.attack_direction*bias*intensity+additive;
   debug.generatedAttackProposals++;
  }
  return out;
 };
 const onFeedbackDecision=({step,value})=>{
  if(!Number.isInteger(step)||step<1||!(value===null||finite(value)))
   throw Error("Недопустимое коллективное решение для обратной связи");
  if(["decision_feedback","network_routed"].includes(o.comparisonMode)&&lastDeliveredStep!==step)
   throw Error("Обратная связь должна следовать после доставки предложений текущего такта");
  feedbackDecision={step,value};
  if(channel)channel.transmit({step,value});
  qualityCache.clear();
 };
 const onLocalConsensusProposals=({step,values,reputation,active,labels,adjacency,byzantine})=>{
  const record=simulateLocalConsensusTick({
   step,values,reputation,active,labels,adjacency,faulty:byzantine
  },{...o,safe_action_min:config.safe_action_min,
   safe_action_max:config.safe_action_max});
  const honestSpreads=record.components.map(c=>c.honestSpread).filter(finite);
  localConsensusHistory.push({
   step,states:record.states,components:record.components,
   totalMessages:record.totalMessages,
   maxHonestSpread:honestSpreads.length?Math.max(...honestSpreads):null,
   componentCount:record.components.length,
   activeCount:record.activeCount,
   algorithmVersion:E1A_LOCAL_CONSENSUS_VERSION
  });
 };
 const effectiveIntensity=(step,intensity)=>
  o.attackStrategy==="legacy"||isActive(step,intensity)?intensity:0;
 const onNetworkState=({step,labels,active,adjacency})=>{
  if(channel)channel.networkStep({step,labels,active,adjacency});
 };
 const onProposalsDelivered=({step,values,available})=>{
  if(channel)channel.onProposalsDelivered({step,available});
  if(o.evidenceModel==="legacy")return;
  const copy={values:[...values],available:[...available]};
  if(lastDeliveredStep!==step-1)
   throw Error("Запаздывание свидетельств: обнаружено нарушение порядка тактов");
  lastDeliveredStep=step;
  qualityCache.clear();
  if(o.evidenceModel==="lagged_observation"){
   observedHistory.set(step,copy);
   // Only the most recent lag+1 source samples can be addressed by the
   // specified age. Avoid O(T*N) archive growth on long simulations.
   observedHistory.delete(step-o.evidenceLag-1);
  }
 };
 const evidenceValue=({step,observer,target,values,available,byzantine,intensity})=>{
  if(o.evidenceModel==="legacy")throw Error("Не должен вызываться генератор при legacy-свидетельствах");
  debug.behaviorEvidenceGenerated++;
  const lag=o.evidenceModel==="lagged_observation"?o.evidenceLag:0;
  const sample=lag?observedHistory.get(step-lag):{values,available};
  if(lag)debug.laggedObservationCount++;
  // Quality depends only on (step,target) and, in decision_feedback mode,
  // the method-specific current decision. Cache it once per target, while
  // retaining separate per-witness random and malicious components.
  const qualityKey=channel?observer+"|"+target:target;
  let qualityState=qualityCache.get(qualityKey);
  if(!qualityState){
   if(!sample||!sample.available[target]||!finite(sample.values[target]))
    qualityState={reason:"missing",quality:null};
   else{
    const peers=sample.values.filter((x,i)=>i!==target&&sample.available[i]&&finite(x));
    if(peers.length<2)qualityState={reason:"insufficient_peers",quality:null};
    else{
     let reference=med(peers);
     if(o.comparisonMode==="decision_feedback"){
      if(feedbackDecision?.step!==step)
       throw Error("Отсутствует коллективное решение текущего такта");
      if(!finite(feedbackDecision.value))
       qualityState={reason:"abstention",quality:null};
      else reference=feedbackDecision.value;
     }
     if(o.comparisonMode==="network_feedback"||o.comparisonMode==="network_routed"){
      const received=channel.referenceFor(observer,target);
      if(received===null)qualityState={reason:"undelivered_decision",quality:null};
      else reference=received;
     }
     if(!qualityState){
      const residual=Math.abs(sample.values[target]-reference);
      qualityState={reason:"ok",quality:1/(1+(residual/o.evidenceTolerance)**2)};
     }
    }
   }
   qualityCache.set(qualityKey,qualityState);
  }
  if(qualityState.reason!=="ok"){
   debug.uninformativeEvidence++;
   if(qualityState.reason==="abstention")debug.feedbackAbstentions++;
   return 0.5;
  }
  if(["decision_feedback","network_feedback","network_routed"].includes(o.comparisonMode))debug.feedbackDecisionUsed++;
  const quality=qualityState.quality;
  const random=rngFor(step,observer,target,4);
  let score=quality;
  if(o.evidenceModel==="correlated_witnesses"){
   const common=rngFor(step,0,target,5).normal()*o.evidenceNoiseSigma;
   score=quality+Math.sqrt(o.evidenceCorrelation)*common+
    Math.sqrt(1-o.evidenceCorrelation)*o.evidenceNoiseSigma*random.normal();
  }else score=quality+o.evidenceNoiseSigma*random.normal();
  // Byzantine observers may inject coordinated false evaluations. Labels are
  // known only to the SIMULATOR, never to an actual trust/decision algorithm.
  if(isActive(step,intensity)&&byzantine[observer]){
   const targetQuality=byzantine[target]?1:0;
   score=(1-o.witnessCorruption)*score+o.witnessCorruption*targetQuality;
   debug.maliciousWitnessed++;
  }
  return clamp(score);
 };
 return Object.freeze({
  transformProposals,onProposalsDelivered,onNetworkState,onFeedbackDecision,effectiveIntensity,
  ...(o.localConsensusPilot?{onLocalConsensusProposals}:{}),
  ...(routed?{
   reserveDecisionBandwidth:context=>channel.reserveDecisionBandwidth(context),
   afterEvidenceTransport:context=>channel.afterEvidenceTransport(context)
  }:{}),
  evidenceValue:o.evidenceModel==="legacy"?null:evidenceValue,
  getDiagnostic:()=>({...debug,modelVersion:ADAPTIVE_SCENARIO_VERSION,
   strategy:o.attackStrategy,evidenceModel:o.evidenceModel,
   decisionChannel:channel?.getDiagnostic()??null,
   decisionChannelModel:channel?(routed?E1A_ROUTED_CHANNEL_VERSION:E1A_DECISION_CHANNEL_VERSION):null,
   localConsensus:o.localConsensusPilot?{
    modelVersion:E1A_LOCAL_CONSENSUS_VERSION,
    role:"independent_diagnostic_only_no_E1_feedback",
    transport:"ideal_unbudgeted_synchronous_neighbor_rounds",
    history:localConsensusHistory.map(entry=>({...entry}))
   }:null}),
  version:ADAPTIVE_SCENARIO_VERSION
 });
}
