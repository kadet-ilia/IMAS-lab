/**
 * E1-A regime_aware_v2: distinct, opt-in, causal research policy.
 *
 * At t, score LAST tick's expert proposals against a clipped robust centre
 * of observations actually AVAILABLE at t. The surrogate is vulnerable to
 * coordinated compromise; it is NOT oracle RMSE, calibrated trust or a
 * guarantee of an improved decision. Compare each expert's robust loss
 * against the historical combined E1 and penalize uncertain switching.
 *
 * This module deliberately does not import/modify the original v1 selector.
 */
import {createAdaptiveRiskController} from "./adaptiveRiskController.js";
import {assessAdaptiveEvidenceQuality} from "./adaptiveEvidenceQuality.js";
import {createAdaptiveRegimeDetector,validateRegimeDetectorOptions}
 from "./adaptiveRegimeDetector.js";

export const ADAPTIVE_V2_VERSION="e1a-regime-v2-huber-regret-1.0.0-experimental";
export const ADAPTIVE_V2_EXPERTS=Object.freeze([
 "proposed_robust","adaptive","risk_aware"
]);
export const ADAPTIVE_V2_DEFAULTS=Object.freeze({
 v2ChoiceMode:"discrete",
 v2MinimumPairs:4,v2MinEvidence:0.08,
 v2LossDecay:0.85,v2HuberThreshold:0.8,v2ReferenceClip:1.5,
 v2LossCap:8,v2Confidence:0.25,v2ImprovementMargin:0.002,
 v2SwitchCost:0.002,v2HoldSteps:3,
 v2Temperature:0.04,v2BaselineFloor:0.6,
 v2ResetRetention:0.7
});
const finite=Number.isFinite;
const clamp=(x,lo,hi)=>Math.min(hi,Math.max(lo,x));
const mean=x=>x.reduce((s,v)=>s+v,0)/x.length;
const median=x=>{const sorted=[...x].sort((a,b)=>a-b),middle=(sorted.length-1)/2;
 return (sorted[Math.floor(middle)]+sorted[Math.ceil(middle)])/2;};
const oneHot=selected=>Object.fromEntries(ADAPTIVE_V2_EXPERTS.map(k=>[
 k,k===selected?1:0
]));
const huber=(value,threshold)=>{
 const abs=Math.abs(value);
 return abs<=threshold?0.5*abs*abs:threshold*(abs-0.5*threshold);
};
export function validateAdaptiveV2Options(input={}){
 if(!input||typeof input!=="object"||Array.isArray(input))
  throw Error("E1-A v2: expected options object");
 const cfg={...ADAPTIVE_V2_DEFAULTS,...input};
 validateRegimeDetectorOptions(cfg);
 if(!["discrete","blend"].includes(cfg.v2ChoiceMode))
  throw Error("E1-A v2: unsupported selection mode");
 for(const [name,min,max,integer] of [
  ["v2MinimumPairs",1,5000,true],["v2MinEvidence",0,1,false],
  ["v2LossDecay",0,0.9999,false],["v2HuberThreshold",0.001,100,false],
  ["v2ReferenceClip",0.001,100,false],["v2LossCap",0.1,1000,false],
  ["v2Confidence",0,10,false],["v2ImprovementMargin",0,100,false],
  ["v2SwitchCost",0,100,false],["v2HoldSteps",0,1000,true],
  ["v2Temperature",0.000001,100,false],
  ["v2BaselineFloor",0,1,false],["v2ResetRetention",0,1,false]
 ]){
  const v=cfg[name];
  if(!finite(v)||v<min||v>max||(integer&&!Number.isInteger(v)))
   throw Error("E1-A v2: invalid "+name);
 }
 return cfg;
}
export function createAdaptivePolicySelectorV2(options={}){
 const o=validateAdaptiveV2Options(options);
 const risk=createAdaptiveRiskController(o);
 const detector=createAdaptiveRegimeDetector(o);
 let step=0,previous=null,completePairs=0,effectivePairs=0;
 let selected="proposed_robust",lastSwitch=0,switches=0;
 let regret={adaptive:0,risk_aware:0};
 let dispersion={adaptive:0,risk_aware:0};
 const candidateNames=["adaptive","risk_aware"];
 const skip=nextStep=>{
  if(!Number.isInteger(nextStep)||nextStep!==step+1)
   throw Error("E1-A v2: skipped steps must be sequential");
  risk.skip(nextStep);detector.skip(nextStep);
  step=nextStep;previous=null;
  return Object.freeze({step,skipped:true});
 };
 return Object.freeze({
  choose(entry={}){
   const {step:nextStep,reference,scale,plain,weighted,baseline,oldAlpha,
    readiness,support,disparity,nEffective,values,available,low,high}=entry;
   if(!Number.isInteger(nextStep)||nextStep!==step+1)
    throw Error("E1-A v2: steps must be sequential");
   if(![reference,scale,plain,weighted,baseline,oldAlpha,readiness,
    support,disparity,nEffective,low,high].every(finite)||
    scale<=0||low>=high||oldAlpha<0||oldAlpha>1||
    !Array.isArray(values)||!Array.isArray(available)||
    values.length!==available.length||disparity<0)
    throw Error("E1-A v2: invalid observable estimator input");
   const current=values.filter((v,i)=>Boolean(available[i])&&finite(v));
   if(!current.length)throw Error("E1-A v2: empty observable validation sample");
   const quality=assessAdaptiveEvidenceQuality({
    values,available,nEffective,scale
   },o);
   const riskInfo=risk.observe({
    step:nextStep,plain,weighted,reference,scale,readiness,support
   });
   const detected=detector.observe({
    step:nextStep,reference,scale,disparity,qualityScore:quality.score
   });
   // Validation proxy uses only central clipped current values. Candidate
   // predictions under evaluation were fixed on the PREVIOUS tick.
   const centre=median(current),radius=o.v2ReferenceClip*scale;
   const clipped=current.map(v=>clamp(v,centre-radius,centre+radius));
   const currentLoss=prediction=>{
    const distance=Math.max(scale,previous?.scale??scale,1e-6);
    return mean(clipped.map(v=>huber(clamp((prediction-v)/distance,
     -o.v2LossCap,o.v2LossCap),o.v2HuberThreshold)));
   };
   if(previous){
    const refLoss=currentLoss(previous.candidates.proposed_robust);
    for(const expert of candidateNames){
     const difference=clamp(currentLoss(previous.candidates[expert])-refLoss,
      -o.v2LossCap,o.v2LossCap);
     // Weight only by current-observed quality, not hidden agent labels.
     // The effective sample size below is a heuristic (dependent in time).
     const factor=quality.score*(1-o.v2LossDecay);
     regret[expert]=(1-factor)*regret[expert]+factor*difference;
     dispersion[expert]=(1-factor)*dispersion[expert]+
      factor*difference*difference;
    }
    completePairs++;
    effectivePairs+=quality.score;
   }
   if(detected.changeDetected){
    // Keep evidence instead of hard-clearing it as v1 did. Shrink
    // stale comparative beliefs and support after an observed change.
    for(const expert of candidateNames){
     regret[expert]*=o.v2ResetRetention;
     dispersion[expert]*=o.v2ResetRetention;
    }
    effectivePairs*=o.v2ResetRetention;
   }
   const candidates={
    proposed_robust:clamp(baseline,low,high),
    adaptive:clamp((1-oldAlpha)*plain+oldAlpha*weighted,low,high),
    risk_aware:clamp((1-riskInfo.alpha)*plain+riskInfo.alpha*weighted,low,high)
   };
   const credibility=Object.fromEntries(candidateNames.map(expert=>{
    const variance=Math.max(0,dispersion[expert]-regret[expert]**2);
    const penalty=o.v2Confidence*Math.sqrt(variance/Math.max(1,effectivePairs));
    return [expert,{regret:regret[expert],uncertainty:penalty,
     conservativeCost:regret[expert]+penalty}];
   }));
   const ready=completePairs>=o.v2MinimumPairs&&
    effectivePairs>=o.v2MinimumPairs*o.v2MinEvidence&&
    quality.score>=o.v2MinEvidence;
   let weights=oneHot("proposed_robust");
   let reason="insufficient_or_low_quality_evidence";
   const baselineCost=0;
   const costs={proposed_robust:baselineCost,
    adaptive:credibility.adaptive.conservativeCost,
    risk_aware:credibility.risk_aware.conservativeCost};
   if(!ready){
    if(selected!=="proposed_robust"){
     selected="proposed_robust";switches++;lastSwitch=nextStep;
    }
    reason=detected.changeDetected?"regime_change_quality_fallback":reason;
   }else if(o.v2ChoiceMode==="blend"){
    // Soft weights with an explicit E1 floor; not the v1 unconstrained
    // softmax. A weak proxy cannot eliminate the historical E1 control.
    const minimum=Math.min(...Object.values(costs));
    const raw=Object.fromEntries(ADAPTIVE_V2_EXPERTS.map(k=>[
     k,Math.exp(-(costs[k]-minimum)/o.v2Temperature)
    ]));
    const denominator=Object.values(raw).reduce((s,v)=>s+v,0);
    const fraction=clamp(o.v2BaselineFloor,0,1);
    weights=Object.fromEntries(ADAPTIVE_V2_EXPERTS.map(k=>[
     k,(1-fraction)*raw[k]/denominator+(k==="proposed_robust"?fraction:0)
    ]));
    selected="blend";reason="conservative_robust_proxy_mix";
   }else{
    if(selected==="blend")selected="proposed_robust";
    const admissible=ADAPTIVE_V2_EXPERTS.map(name=>({
     name,cost:costs[name]+(name!==selected?o.v2SwitchCost:0)
    })).sort((a,b)=>a.cost-b.cost);
    const best=admissible[0];
    const incumbent=costs[selected];
    if(best.name!==selected&&
     incumbent-best.cost>=o.v2ImprovementMargin&&
     nextStep-lastSwitch>=o.v2HoldSteps){
     selected=best.name;lastSwitch=nextStep;switches++;
    }
    weights=oneHot(selected);reason="costed_huber_regret_switch";
   }
   step=nextStep;
   previous={scale,candidates};
   const value=clamp(ADAPTIVE_V2_EXPERTS.reduce((s,k)=>
    s+weights[k]*candidates[k],0),low,high);
   return Object.freeze({
    value,selected,weights:Object.freeze({...weights}),
    alpha:selected==="adaptive"?oldAlpha:
     selected==="risk_aware"?riskInfo.alpha:null,
    scores:Object.freeze({...costs}),
    regret:Object.freeze({...regret}),
    uncertainty:Object.freeze(Object.fromEntries(candidateNames.map(k=>[
     k,credibility[k].uncertainty]))),
    effectivePairs,completePairs,switches,reason,quality,
    evidenceQuality:quality,regime:detected,riskInfo,
    referenceType:"next-tick clipped observable proposals; contamination possible",
    modelVersion:ADAPTIVE_V2_VERSION,noOracle:true,
    warning:"Synthetic uncalibrated proxy, not guaranteed improvement or confidence interval"
   });
  },
  skip,
  snapshot:()=>Object.freeze({step,selected,switches,completePairs,
   effectivePairs,regret:{...regret},dispersion:{...dispersion},
   risk:risk.snapshot(),detector:detector.snapshot(),modelVersion:ADAPTIVE_V2_VERSION})
 });
}
