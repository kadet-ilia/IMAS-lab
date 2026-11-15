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

export const ADAPTIVE_SCENARIO_VERSION="e1a-behavior-evidence-1.0.0";
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
 witnessCorruption:0.8,evidenceCorrelation:0.45,evidenceLag:2
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
 return o;
}
/** Returns null if E1-A requests the untouched legacy scenario. */
export function createAdaptiveScenarioAdapter(config,options,runIndex){
 const o=validateAdaptiveScenarioOptions(options);
 if(o.attackStrategy==="legacy"&&o.evidenceModel==="legacy")return null;
 if(!Number.isInteger(runIndex)||runIndex<0)throw Error("Некорректный индекс реализации E1-А");
 if(!Number.isInteger(config?.seed))throw Error("Отсутствует целочисленный seed");
 const observedHistory=[];
 const knownLabels=[];
 const debug={behaviorEvidenceGenerated:0,uninformativeEvidence:0,maliciousWitnessed:0,
  generatedAttackProposals:0,laggedObservationCount:0};
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
 const onProposalsDelivered=({step,values,available})=>{
  if(o.evidenceModel==="legacy")return;
  const copy={values:[...values],available:[...available]};
  if(observedHistory.length!==step-1)
   throw Error("Запаздывание свидетельств: обнаружено нарушение порядка тактов");
  observedHistory.push(copy);
 };
 const evidenceValue=({step,observer,target,values,available,byzantine,intensity})=>{
  if(o.evidenceModel==="legacy")throw Error("Не должен вызываться генератор при legacy-свидетельствах");
  debug.behaviorEvidenceGenerated++;
  const lag=o.evidenceModel==="lagged_observation"?o.evidenceLag:0;
  const sample=lag?observedHistory[step-1-lag]:{values,available};
  if(lag)debug.laggedObservationCount++;
  // No directly observable proposal -> uninformative witness. Network delivery
  // still follows E1's existing transport ledger; this is not evidence latency.
  if(!sample||!sample.available[target]||!finite(sample.values[target])){
   debug.uninformativeEvidence++;return 0.5;
  }
  const peers=sample.values.filter((x,i)=>i!==target&&sample.available[i]&&finite(x));
  if(peers.length<2){debug.uninformativeEvidence++;return 0.5;}
  const reference=med(peers);
  const residual=Math.abs(sample.values[target]-reference);
  // A bounded quality score based on observable disagreement, not oracle truth.
  const quality=1/(1+(residual/o.evidenceTolerance)**2);
  const random=rngFor(step,observer,target,4);
  let score=quality;
  if(o.evidenceModel==="correlated_witnesses"){
   const common=rngFor(step,0,target,5).normal()*o.evidenceNoiseSigma;
   score=quality+o.evidenceCorrelation*common+
    (1-o.evidenceCorrelation)*o.evidenceNoiseSigma*random.normal();
  }else score=quality+o.evidenceNoiseSigma*random.normal();
  // Byzantine observers may inject coordinated false evaluations. Labels are
  // known only to the SIMULATOR, never to an actual trust/decision algorithm.
  if(intensity>0&&byzantine[observer]){
   const targetQuality=byzantine[target]?1:0;
   score=(1-o.witnessCorruption)*score+o.witnessCorruption*targetQuality;
   debug.maliciousWitnessed++;
  }
  return clamp(score);
 };
 return Object.freeze({
  transformProposals,onProposalsDelivered,
  evidenceValue:o.evidenceModel==="legacy"?null:evidenceValue,
  getDiagnostic:()=>({...debug,modelVersion:ADAPTIVE_SCENARIO_VERSION,
   strategy:o.attackStrategy,evidenceModel:o.evidenceModel}),
  version:ADAPTIVE_SCENARIO_VERSION
 });
}
