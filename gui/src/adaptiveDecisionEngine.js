/**
 * E1-A: adaptive collective decision estimation.
 * Observable inputs only. No agent-type flags, oracle truth or future evidence.
 * All calculations are deterministic, including fractional treatment of ties.
 */
import {aggregateProposals} from "./trustEngine.js";
import {ADAPTIVE_SCENARIO_DEFAULTS,validateAdaptiveScenarioOptions} from "./adaptiveScenario.js";
import {ADAPTIVE_RISK_DEFAULTS,validateAdaptiveRiskOptions} from "./adaptiveRiskController.js";
import {ADAPTIVE_POLICY_DEFAULTS,validateAdaptivePolicyOptions} from "./adaptivePolicySelector.js";
import {E1A_DECISION_CHANNEL_DEFAULTS,validateDecisionChannelOptions} from "./adaptiveDecisionChannel.js";
import {E1A_ROUTED_DEFAULTS,validateRoutedChannelOptions} from "./adaptiveRoutedDecisionChannel.js";

export const ADAPTIVE_MODEL_VERSION="adaptive-collective-1.6.0-regime-aware-opt-in";
export const ADAPTIVE_METHODS=Object.freeze([
 Object.freeze({id:"trimmed_unweighted",label:"Усечённое среднее E1",color:"#d18a31"}),
 Object.freeze({id:"proposed_robust",label:"Комбинированное среднее E1",color:"#123a63"}),
 Object.freeze({id:"adaptive_unweighted",label:"Усечённое среднее E1-А",color:"#9b73b5"}),
 Object.freeze({id:"adaptive_weighted",label:"Доверительно-усечённое E1-А",color:"#079b91"}),
 Object.freeze({id:"adaptive_robust",label:"Адаптивное коллективное решение E1-А",color:"#c13f62"})
]);
export const ADAPTIVE_METHOD_IDS=Object.freeze(ADAPTIVE_METHODS.map(m=>m.id));
export const ADAPTIVE_DEFAULTS=Object.freeze({
 alphaMode:"adaptive",fixedAlpha:0.5,trimMode:"source_first",
 ...ADAPTIVE_RISK_DEFAULTS,
 ...ADAPTIVE_POLICY_DEFAULTS,
 ...E1A_DECISION_CHANNEL_DEFAULTS,
 ...E1A_ROUTED_DEFAULTS,
 comparisonMode:"estimator_only",
 adaptiveTrim:false,trimEachSide:null,maxAdaptiveTrim:12,minRetained:5,
 outlierThreshold:2.5,scaleFloor:0.15,
 gamma:1,minWeight:0.05,maxWeight:1,
 warmupSteps:8,minimumEffectiveFraction:0.75,disagreementPenalty:1.5,
 feedbackGain:0.5,feedbackInitialError:1,decisionRefusalPenalty:1,
 runs:30,scenario:"dynamic",phases:null,
 ...ADAPTIVE_SCENARIO_DEFAULTS
});
const finite=Number.isFinite;
const clamp=(x,lo,hi)=>Math.max(lo,Math.min(hi,x));
const sum=x=>x.reduce((a,b)=>a+b,0);
const mean=x=>sum(x)/x.length;
function median(values){
 if(!values.length)return null;
 const a=[...values].sort((x,y)=>x-y),i=(a.length-1)/2,lo=Math.floor(i);
 return (a[lo]+a[Math.ceil(i)])/2;
}
function assertNumber(name,v,min,max,integer=false){
 if(!finite(v)||v<min||v>max||(integer&&!Number.isInteger(v)))
  throw Error(name+": значение должно принадлежать "+min+"…"+max);
}
export function validateAdaptiveOptions(input={}){
 if(input===null||typeof input!=="object"||Array.isArray(input))throw Error("Параметры адаптации должны быть объектом");
 const o={...ADAPTIVE_DEFAULTS,...input};
 if(!["adaptive","off","fixed","risk_aware","regime_aware"].includes(o.alphaMode))throw Error("Неизвестный режим alpha");
 if(!["estimator_only","decision_feedback","network_feedback","network_routed"].includes(o.comparisonMode))
  throw Error("Неизвестный режим сравнения E1-А");
 if(!["legacy_clip_first","source_first"].includes(o.trimMode))throw Error("Неизвестный порядок усечения");
 if(!["dynamic","static_bias","subtle_bias","on_off","collusion"].includes(o.scenario))throw Error("Неизвестный сценарий");
 if(typeof o.adaptiveTrim!=="boolean")throw Error("adaptiveTrim должен быть логическим");
 if(o.trimEachSide!==null)assertNumber("trimEachSide",o.trimEachSide,0,159,true);
 for(const [key,lo,hi,int] of [
  ["fixedAlpha",0,1,false],["maxAdaptiveTrim",0,159,true],["minRetained",1,160,true],
  ["outlierThreshold",0.1,100,false],["scaleFloor",1e-6,100,false],
  ["gamma",0,5,false],["minWeight",0,1,false],["maxWeight",0,5,false],
  ["warmupSteps",1,50000,true],["minimumEffectiveFraction",1e-6,1,false],
  ["disagreementPenalty",0,100,false],["feedbackGain",1e-6,1.999999,false],
  ["feedbackInitialError",-100,100,false],["decisionRefusalPenalty",0,10000,false],["runs",1,200,true]
 ])assertNumber(key,o[key],lo,hi,Boolean(int));
 if(o.minWeight>o.maxWeight||o.maxWeight===0)throw Error("Ограничения весов несовместимы");
 if(o.phases!==null&&!Array.isArray(o.phases))throw Error("Фазы атаки должны быть массивом");
 validateAdaptiveScenarioOptions(o);
 validateAdaptiveRiskOptions(o);
 validateAdaptivePolicyOptions(o);
 validateDecisionChannelOptions(o);
 validateRoutedChannelOptions(o);
 return o;
}
function fractionalRetained(values,trim){
 // Each equal-value group contributes the same fractional retention to all
 // its members. Thus a permutation of agents cannot change the weighted result.
 const order=values.map((v,i)=>({v,i})).sort((a,b)=>a.v-b.v);
 const keepFrom=trim,keepTo=order.length-trim,fractions=Array(values.length).fill(0);
 for(let start=0;start<order.length;){
  let end=start+1;while(end<order.length&&order[end].v===order[start].v)end++;
  const count=Math.max(0,Math.min(end,keepTo)-Math.max(start,keepFrom));
  const frac=count/(end-start);
  for(let j=start;j<end;j++)fractions[order[j].i]=frac;
  start=end;
 }
 return fractions;
}
export function estimateAdaptiveDecision(observation,options={},coreConfig={},riskController=null,policySelector=null){
 const o=validateAdaptiveOptions(options),x=observation?.values,w=observation?.reputation,a=observation?.available;
 if(!Array.isArray(x)||!Array.isArray(w)||!Array.isArray(a)||x.length!==w.length||x.length!==a.length)
  throw Error("Требуются равной длины массивы предложений, репутаций и доступности");
 const core={
  minimum_weight:coreConfig.minimum_weight??0.05,
  trim_each_side:coreConfig.trim_each_side??10,
  clip_radius:coreConfig.clip_radius??1.25,
  safe_action_min:coreConfig.safe_action_min??-2,
  safe_action_max:coreConfig.safe_action_max??2
 };
 if(!finite(core.clip_radius)||core.clip_radius<0||!Number.isInteger(core.trim_each_side)||core.trim_each_side<0||
  !finite(core.safe_action_min)||!finite(core.safe_action_max)||core.safe_action_min>=core.safe_action_max)
  throw Error("Некорректные параметры исходного агрегатора");
 const used=[];for(let i=0;i<x.length;i++){
  if(!a[i]||!finite(x[i]))continue;
  if(!finite(w[i])||w[i]<0)throw Error("Некорректная репутация агента");
  used.push({value:x[i],reputation:w[i]});
 }
 const legacy=aggregateProposals(x.map(v=>v===null?NaN:v),w,a,core);
 if(!used.length){
  if(o.alphaMode==="risk_aware"){
   if(!riskController||typeof riskController.skip!=="function"||
    !Number.isInteger(observation.step)||observation.step<1)
    throw Error("E1-А риск: для пропуска такта требуется контроллер со счётчиком");
   riskController.skip(observation.step);
  }
  if(o.alphaMode==="regime_aware"){
   if(!policySelector||typeof policySelector.skip!=="function"||
    !Number.isInteger(observation.step)||observation.step<1)
    throw Error("E1-А режим: для пропуска такта требуется причинная политика");
   policySelector.skip(observation.step);
  }
  return {decisions:{trimmed_unweighted:null,proposed_robust:null,adaptive_unweighted:null,
   adaptive_weighted:null,adaptive_robust:null},
   diagnostics:{alpha:null,k:null,nEffective:null,readiness:null,disagreement:null,outlierCount:null,
    available:0,retained:0,weightConcentration:null,riskContrast:null,riskPairs:0,riskWeightVote:null,
    regimeSelected:null,regimeState:"insufficient_data",evidenceQualityScore:null,
    regimeInnovation:null,regimeCusum:null,policySwitches:0,policyPairs:0,policyWeights:null}};
 }
 const raw=used.map(p=>p.value),med=median(raw);
 const absDeviation=raw.map(v=>Math.abs(v-med)),scale=Math.max(o.scaleFloor,1.4826*median(absDeviation));
 const outlierCount=absDeviation.filter(d=>d>o.outlierThreshold*scale).length;
 const maximum=Math.min(Math.floor((used.length-1)/2),Math.floor((used.length-o.minRetained)/2));
 const possible=Math.max(0,maximum);
 const baseTrim=o.trimEachSide===null?core.trim_each_side:o.trimEachSide;
 const k=o.adaptiveTrim?Math.min(possible,o.maxAdaptiveTrim,outlierCount):Math.min(possible,baseTrim);
 const prepared=o.trimMode==="legacy_clip_first"
  ?raw.map(v=>clamp(v,med-core.clip_radius,med+core.clip_radius)):raw;
 const fractions=fractionalRetained(prepared,k);
 const values=o.trimMode==="source_first"
  ?raw.map(v=>clamp(v,med-core.clip_radius,med+core.clip_radius)):prepared;
 const weights=used.map(p=>clamp(Math.pow(p.reputation,o.gamma),o.minWeight,o.maxWeight));
 const weightedFractions=fractions.map((f,i)=>f*weights[i]);
 const unweightedDen=sum(fractions),weightedDen=sum(weightedFractions);
 if(unweightedDen<=0)throw Error("Алгоритм исключил все предложения");
 const plain=clamp(sum(values.map((v,i)=>v*fractions[i]))/unweightedDen,core.safe_action_min,core.safe_action_max);
 const weighted=weightedDen>1e-15
  ?clamp(sum(values.map((v,i)=>v*weightedFractions[i]))/weightedDen,core.safe_action_min,core.safe_action_max)
  :plain;
 const neff=weightedDen>1e-15?weightedDen*weightedDen/sum(weightedFractions.map(v=>v*v)):unweightedDen;
 const disparity=Math.abs(plain-weighted)/scale;
 const historySteps=Math.max(0,Number.isInteger(observation.historySteps)?observation.historySteps:0);
 // Readiness is a heuristic history-length proxy, NOT calibrated evidence reliability.
 const readiness=Math.min(1,historySteps/o.warmupSteps);
 const effectiveFraction=neff/Math.max(1,used.length-k*2);
 const support=Math.min(1,effectiveFraction/o.minimumEffectiveFraction);
 let riskInfo=null;
 if(o.alphaMode==="risk_aware"){
  if(!riskController||typeof riskController.observe!=="function")
   throw Error("E1-А риск: требуется отдельное причинное состояние контроллера");
  if(!Number.isInteger(observation.step)||observation.step<1)
   throw Error("E1-А риск: требуется монотонный номер текущего такта");
  riskInfo=riskController.observe({
   step:observation.step,plain,weighted,reference:med,scale,support,readiness
  });
 }
 const oldAlpha=clamp(readiness*support*Math.exp(-o.disagreementPenalty*disparity),0,1);
 let selectedPolicy=null;
 if(o.alphaMode==="regime_aware"){
  if(!policySelector||typeof policySelector.choose!=="function")
   throw Error("E1-А режим: требуется причинный контроллер выбора оценивателя");
  if(!Number.isInteger(observation.step)||observation.step<1)
   throw Error("E1-А режим: требуется монотонный номер такта");
  selectedPolicy=policySelector.choose({
   step:observation.step,reference:med,scale,plain,weighted,
   baseline:legacy.proposed_robust,oldAlpha,readiness,support,disparity,
   nEffective:neff,values:x,available:a,
   low:core.safe_action_min,high:core.safe_action_max
  });
  riskInfo=selectedPolicy.riskInfo;
 }
 const alpha=selectedPolicy?selectedPolicy.alpha:
  o.alphaMode==="risk_aware"?riskInfo.alpha:
  o.alphaMode==="off"?0:o.alphaMode==="fixed"?o.fixedAlpha:oldAlpha;
 const decision=selectedPolicy?selectedPolicy.value:
  clamp((1-alpha)*plain+alpha*weighted,core.safe_action_min,core.safe_action_max);
 return {
  decisions:{trimmed_unweighted:legacy.trimmed_unweighted,proposed_robust:legacy.proposed_robust,
   adaptive_unweighted:plain,adaptive_weighted:weighted,adaptive_robust:decision},
  diagnostics:{alpha,k,nEffective:neff,readiness,disagreement:disparity,outlierCount,
   available:used.length,retained:unweightedDen,weightConcentration:weightedDen>1e-15?
    Math.max(...weightedFractions)/weightedDen:null,
   riskContrast:riskInfo?.contrast??null,riskPairs:riskInfo?.pairs??0,
   riskWeightVote:riskInfo?.weightVote??null,
   riskLossPlain:riskInfo?.lossPlain??null,riskLossWeighted:riskInfo?.lossWeighted??null,
   regimeSelected:selectedPolicy?.selected??null,regimeState:selectedPolicy?.regime.state??null,
   evidenceQualityScore:selectedPolicy?.evidenceQuality.score??null,
   regimeInnovation:selectedPolicy?.regime.innovation??null,
   regimeCusum:selectedPolicy?.regime.cusum??null,
   policySwitches:selectedPolicy?.switches??null,policyPairs:selectedPolicy?.pairs??null,
   policyWeights:selectedPolicy?.weights??null}
 };
}
