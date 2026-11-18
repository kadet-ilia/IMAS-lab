/**
 * Experimental E1-A expert selection, causal and independent per simulation run.
 * Candidate set: historical combined E1, old adaptive E1-A, risk-aware E1-A.
 * The reference below is an OBSERVED next-tick median, NEVER oracle truth.
 */
import {createAdaptiveRiskController} from "./adaptiveRiskController.js";
import {assessAdaptiveEvidenceQuality} from "./adaptiveEvidenceQuality.js";
import {createAdaptiveRegimeDetector,validateRegimeDetectorOptions,
 REGIME_DETECTOR_DEFAULTS} from "./adaptiveRegimeDetector.js";

export const ADAPTIVE_POLICY_SELECTOR_VERSION="e1a-regime-policy-1.0.0";
export const ADAPTIVE_POLICY_EXPERTS=Object.freeze([
 "proposed_robust","adaptive","risk_aware"
]);
export const ADAPTIVE_POLICY_DEFAULTS=Object.freeze({
 ...REGIME_DETECTOR_DEFAULTS,regimeSelectionMode:"discrete",
 regimeMinimumPairs:5,regimeHoldSteps:3,regimeSwitchMargin:0.02,
 regimeLossDecay:0.85,regimeLossCap:8,regimeTemperature:0.25
});
const finite=Number.isFinite;
const clamp=(x,lo,hi)=>Math.min(hi,Math.max(lo,x));
export function validateAdaptivePolicyOptions(input={}){
 const o={...ADAPTIVE_POLICY_DEFAULTS,...input};
 validateRegimeDetectorOptions(o);
 if(!["discrete","blend"].includes(o.regimeSelectionMode))
  throw Error("E1-A policy: unknown selection mode");
 for(const [name,lo,hi,int] of [
  ["regimeMinimumPairs",1,5000,true],["regimeHoldSteps",0,1000,true],
  ["regimeSwitchMargin",0,100,false],["regimeLossDecay",0,0.9999,false],
  ["regimeLossCap",0.1,1000,false],["regimeTemperature",0.000001,100,false]]){
  if(!finite(o[name])||o[name]<lo||o[name]>hi||(int&&!Number.isInteger(o[name])))
   throw Error("E1-A policy: invalid "+name);
 }
 return o;
}
export function createAdaptivePolicySelector(options={}){
 const o=validateAdaptivePolicyOptions(options);
 const risk=createAdaptiveRiskController(o),detector=createAdaptiveRegimeDetector(o);
 let step=0,prev=null,pairs=0,selected="proposed_robust",lastSwitch=0,switches=0;
 let scores=Object.fromEntries(ADAPTIVE_POLICY_EXPERTS.map(name=>[name,null]));
 const clearScores=()=>{scores=Object.fromEntries(ADAPTIVE_POLICY_EXPERTS.map(name=>[name,null]));pairs=0;};
 const oneHot=name=>Object.fromEntries(ADAPTIVE_POLICY_EXPERTS.map(k=>[k,k===name?1:0]));
 const skip=nextStep=>{
  if(!Number.isInteger(nextStep)||nextStep!==step+1)
   throw Error("E1-A policy: skipped steps must be sequential");
  risk.skip(nextStep);detector.skip(nextStep);
  step=nextStep;prev=null;
  return Object.freeze({step,skipped:true,switches});
 };
 return Object.freeze({
  choose(entry={}){
   const {step:nextStep,reference,scale,plain,weighted,baseline,oldAlpha,
    readiness,support,disparity,nEffective,values,available,low,high}=entry;
   if(!Number.isInteger(nextStep)||nextStep!==step+1)
    throw Error("E1-A policy: steps must be sequential");
   if(![reference,scale,plain,weighted,readiness,support,disparity,
     nEffective,low,high,oldAlpha].every(finite)||
     scale<=0||low>=high||oldAlpha<0||oldAlpha>1||
     !Array.isArray(values)||!Array.isArray(available)||
     !finite(baseline)&&baseline!==null)
    throw Error("E1-A policy: invalid current observable estimator state");
   const riskInfo=risk.observe({
    step:nextStep,plain,weighted,reference,scale,readiness,support
   });
   const quality=assessAdaptiveEvidenceQuality({values,available,nEffective,scale},o);
   const detected=detector.observe({
    step:nextStep,reference,scale,disparity,qualityScore:quality.score
   });
   if(prev){
    // Only the previous tick's predictions are evaluated against the
    // current OBSERVED median. This proxy can itself be attacked.
    const normalization=Math.max(prev.scale,scale,1e-6);
    for(const name of ADAPTIVE_POLICY_EXPERTS){
     const residual=clamp((prev.candidates[name]-reference)/normalization,
      -o.regimeLossCap,o.regimeLossCap);
     const loss=residual*residual;
     scores[name]=scores[name]===null?loss:
      o.regimeLossDecay*scores[name]+(1-o.regimeLossDecay)*loss;
    }
    pairs++;
   }
   const candidates={
    proposed_robust:clamp(finite(baseline)?baseline:plain,low,high),
    adaptive:clamp((1-oldAlpha)*plain+oldAlpha*weighted,low,high),
    risk_aware:clamp((1-riskInfo.alpha)*plain+riskInfo.alpha*weighted,low,high)
   };
   step=nextStep;
   prev={scale,candidates};
   if(detected.changeDetected){
    // Never extrapolate scores from before a detected distributional shift
    // as if they had already been calibrated for the new regime.
    clearScores();
   }
   const ready=pairs>=o.regimeMinimumPairs&&
    quality.score>=o.regimeMinimumQuality&&
    detected.state==="stable_observed";
   let weights=oneHot("proposed_robust"),reason="insufficient_history_or_low_quality";
   if(!ready){
    if(selected!=="proposed_robust"){selected="proposed_robust";switches++;lastSwitch=step;}
    reason=detected.changeDetected?"observed_change_reset":reason;
   }else if(o.regimeSelectionMode==="blend"){
    const minimum=Math.min(...ADAPTIVE_POLICY_EXPERTS.map(k=>scores[k]));
    const unnormalized=Object.fromEntries(ADAPTIVE_POLICY_EXPERTS.map(name=>[
     name,Math.exp(-(scores[name]-minimum)/o.regimeTemperature)
    ]));
    const denominator=Object.values(unnormalized).reduce((a,b)=>a+b,0);
    weights=Object.fromEntries(ADAPTIVE_POLICY_EXPERTS.map(name=>[
     name,unnormalized[name]/denominator
    ]));
    selected="blend";reason="causal_proxy_weighting";
   }else{
    const best=ADAPTIVE_POLICY_EXPERTS.reduce((winner,name)=>
     scores[name]<scores[winner]?name:winner,"proposed_robust");
    if(selected==="blend")selected="proposed_robust";
    if(best!==selected&&
      scores[selected]-scores[best]>=o.regimeSwitchMargin&&
      step-lastSwitch>=o.regimeHoldSteps){
     selected=best;lastSwitch=step;switches++;
    }
    weights=oneHot(selected);reason="causal_proxy_and_hysteresis";
   }
   const value=clamp(ADAPTIVE_POLICY_EXPERTS.reduce((sum,name)=>
    sum+weights[name]*candidates[name],0),low,high);
   const alpha=selected==="adaptive"?oldAlpha:
    selected==="risk_aware"?riskInfo.alpha:null;
   return Object.freeze({
    value,alpha,selected,weights:Object.freeze({...weights}),
    scores:Object.freeze({...scores}),pairs,switches,reason,
    evidenceQuality:quality,regime:detected,riskInfo,
    referenceType:"observed_median; adversarially manipulable",
    noOracle:true
   });
  },
  skip,
  snapshot:()=>Object.freeze({step,selected,pairs,switches,scores:{...scores},
   risk:risk.snapshot(),regime:detector.snapshot(),
   modelVersion:ADAPTIVE_POLICY_SELECTOR_VERSION})
 });
}
