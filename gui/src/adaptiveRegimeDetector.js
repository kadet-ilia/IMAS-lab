/**
 * Causal change diagnostics over observable medians and estimator disparity.
 * No attacker strategy label, simulation truth, or future data is accepted.
 */
export const ADAPTIVE_REGIME_DETECTOR_VERSION="e1a-regime-detector-1.0.0";
export const REGIME_DETECTOR_DEFAULTS=Object.freeze({
 regimeMinHistory:5,regimeChangeThreshold:2.5,regimeDecay:0.8,
 regimeCooldown:3,regimeMinimumQuality:0.25
});
const finite=Number.isFinite;
const clamp=(x,lo,hi)=>Math.max(lo,Math.min(hi,x));
export function validateRegimeDetectorOptions(input={}){
 const o={...REGIME_DETECTOR_DEFAULTS,...input};
 for(const [name,lo,hi,integer] of [
  ["regimeMinHistory",2,1000,true],["regimeChangeThreshold",0.05,100,false],
  ["regimeDecay",0,0.9999,false],["regimeCooldown",0,1000,true],
  ["regimeMinimumQuality",0,1,false]]){
  if(!finite(o[name])||o[name]<lo||o[name]>hi||(integer&&!Number.isInteger(o[name])))
   throw Error("E1-A regime: invalid "+name);
 }
 return o;
}
export function createAdaptiveRegimeDetector(options={}){
 const o=validateRegimeDetectorOptions(options);
 let step=0,prev=null,history=0,ewmaInnovation=null,cusum=0;
 let lastChange=-Infinity,changeCount=0,lastState="insufficient_data";
 const skip=nextStep=>{
  if(!Number.isInteger(nextStep)||nextStep!==step+1)
   throw Error("E1-A regime: skipped steps must be sequential");
  step=nextStep;prev=null;cusum=0;
  lastState="insufficient_data";
  return Object.freeze({step,state:lastState,skipped:true,changeCount});
 };
 return Object.freeze({
  observe(data={}){
   const {step:nextStep,reference,scale,disparity=0,qualityScore}=data;
   if(!Number.isInteger(nextStep)||nextStep!==step+1)
    throw Error("E1-A regime: steps must be sequential");
   if(![reference,scale,disparity,qualityScore].every(finite)||scale<=0||disparity<0||
     qualityScore<0||qualityScore>1)
    throw Error("E1-A regime: invalid observable inputs");
   step=nextStep;
   const innovation=prev?
    Math.abs(reference-prev.reference)/Math.max(scale,prev.scale,1e-6):0;
   const changeInDisparity=prev?Math.abs(disparity-prev.disparity):0;
   const surprise=innovation+0.25*changeInDisparity;
   // One-sided CUSUM with forgetting: significant isolated jumps are visible,
   // while a sustained subthreshold drift can also accumulate.
   const baseline=ewmaInnovation===null?0:ewmaInnovation;
   cusum=Math.max(0,0.75*cusum+surprise-Math.max(0.1,baseline));
   ewmaInnovation=ewmaInnovation===null?surprise:
    o.regimeDecay*ewmaInnovation+(1-o.regimeDecay)*surprise;
   history++;
   const changed=history>=o.regimeMinHistory&&
    (surprise>=o.regimeChangeThreshold||cusum>=2*o.regimeChangeThreshold)&&
    step-lastChange>o.regimeCooldown;
   if(changed){lastChange=step;changeCount++;cusum=0;}
   const state=history<o.regimeMinHistory?"insufficient_data":
    qualityScore<o.regimeMinimumQuality?"low_evidence_quality":
    changed?"change_detected":"stable_observed";
   lastState=state;
   prev={reference,scale,disparity};
   return Object.freeze({step,state,innovation,surprise,cusum,
    ewmaInnovation,history,changeCount,changeDetected:changed,
    qualityScore,interpretation:"Observed statistical change only; not an identified attack"});
  },
  skip,
  snapshot:()=>Object.freeze({step,history,changeCount,lastState,cusum,
   ewmaInnovation,previous:prev?{...prev}:null,
   modelVersion:ADAPTIVE_REGIME_DETECTOR_VERSION})
 });
}
