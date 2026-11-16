/**
 * E1-A online risk-sensitive choice of trust weighting.
 *
 * A causal prequential proxy is constructed from the NEXT step's ROBUST
 * cross-sectional median, never the simulation oracle. The controller compares
 * t-1 plain and weighted estimates with the median observable at t; only then
 * computes alpha(t). Changing future data cannot change earlier choices.
 *
 * IMPORTANT: predictive consistency with the next median is NOT a calibrated
 * estimator risk and may fail under coordinated majority manipulation, drift,
 * or correlated honest noise. No universally optimal decision is claimed.
 */
export const ADAPTIVE_RISK_MODEL_VERSION="e1a-risk-prequential-1.0.0";
export const ADAPTIVE_RISK_DEFAULTS=Object.freeze({
 riskDecay:0.85,riskSensitivity:5,riskMinimumPairs:4,
 riskLossCap:8,riskFloor:0.05,riskPrior:0.5
});
const finite=Number.isFinite;
const clamp=(x,lo,hi)=>Math.min(hi,Math.max(lo,x));
function check(key,value,lo,hi,integer=false){
 if(!finite(value)||value<lo||value>hi||(integer&&!Number.isInteger(value)))
  throw Error("E1-А риск: недопустимое значение "+key);
}
export function validateAdaptiveRiskOptions(params={}){
 if(params===null||typeof params!=="object"||Array.isArray(params))
  throw Error("E1-А риск: ожидается объект параметров");
 const p={...ADAPTIVE_RISK_DEFAULTS,...params};
 check("riskDecay",p.riskDecay,0,0.9999);
 check("riskSensitivity",p.riskSensitivity,0,40);
 check("riskMinimumPairs",p.riskMinimumPairs,1,5000,true);
 check("riskLossCap",p.riskLossCap,0.1,1000);
 check("riskFloor",p.riskFloor,1e-8,100);
 check("riskPrior",p.riskPrior,0,1);
 return p;
}
export function createAdaptiveRiskController(options={}){
 const cfg=validateAdaptiveRiskOptions(options);
 let prev=null,step=0,lossPlain=null,lossWeighted=null,pairs=0;
 return Object.freeze({
  observe(entry){
   const {step:nextStep,plain,weighted,reference,scale,support,readiness}=entry||{};
   if(!Number.isInteger(nextStep)||nextStep!==step+1)
    throw Error("E1-А риск: такты должны поступать последовательно без повторов");
   if(![plain,weighted,reference,scale,support,readiness].every(finite)||
    scale<=0||support<0||support>1||readiness<0||readiness>1)
    throw Error("E1-А риск: требуются только текущие наблюдаемые конечные величины");
   step=nextStep;
   // All scores at step t are for decisions from t-1, against the current
   // median. These are *predictive* proxy scores, not oracle accuracy.
   if(prev){
    const normalization=Math.max(scale,prev.scale,1e-6);
    const cap=cfg.riskLossCap;
    const plainResidual=clamp((prev.plain-reference)/normalization,-cap,cap);
    const weightResidual=clamp((prev.weighted-reference)/normalization,-cap,cap);
    const lp=plainResidual*plainResidual,lw=weightResidual*weightResidual;
    lossPlain=lossPlain===null?lp:cfg.riskDecay*lossPlain+(1-cfg.riskDecay)*lp;
    lossWeighted=lossWeighted===null?lw:cfg.riskDecay*lossWeighted+(1-cfg.riskDecay)*lw;
    pairs++;
   }
   prev={plain,weighted,scale};
   const available=pairs>=cfg.riskMinimumPairs;
   const contrast=available?(lossWeighted-lossPlain)/
    Math.max(cfg.riskFloor,lossWeighted+lossPlain+cfg.riskFloor):null;
   // tanh avoids overflow at any permissible sensitivity and contrast.
   const vote=available?0.5*(1-Math.tanh(cfg.riskSensitivity*contrast/2)):cfg.riskPrior;
   const alpha=clamp(readiness*support*vote,0,1);
   return Object.freeze({alpha,contrast,pairs,
    lossPlain,lossWeighted,weightVote:vote,informationReady:available,
    referenceType:"current_observed_median_for_previous_step"});
  },
  snapshot:()=>Object.freeze({step,pairs,lossPlain,lossWeighted,
   previous:prev?{...prev}:null,modelVersion:ADAPTIVE_RISK_MODEL_VERSION})
 });
}
