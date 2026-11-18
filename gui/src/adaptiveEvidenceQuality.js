/**
 * E1-A research-only heuristic describing usability of available observations.
 * It is NOT a posterior probability of agent honesty and must never see oracle truth.
 */
export const ADAPTIVE_EVIDENCE_QUALITY_VERSION="e1a-evidence-quality-1.0.0";
const finite=Number.isFinite;
const clamp=(x,lo=0,hi=1)=>Math.max(lo,Math.min(hi,x));

/**
 * Values and flags are the actual observable inputs supplied to the estimator.
 * evidenceLag and evidenceCorrelation are configured MODEL assumptions, not
 * packet timestamps or measured independence of real witnesses.
 */
export function assessAdaptiveEvidenceQuality(observation={},model={}){
 const {values,available,nEffective=null,scale=null}=observation;
 if(!Array.isArray(values)||!Array.isArray(available)||values.length!==available.length)
  throw Error("E1-A quality: values/available must be equal-length arrays");
 if(nEffective!==null&&(!finite(nEffective)||nEffective<0))
  throw Error("E1-A quality: nEffective must be nonnegative");
 if(scale!==null&&(!finite(scale)||scale<=0))
  throw Error("E1-A quality: scale must be positive");
 const lag=model.evidenceModel==="lagged_observation"?(model.evidenceLag??0):0;
 const correlation=model.evidenceModel==="correlated_witnesses"?(model.evidenceCorrelation??0):0;
 if(!finite(lag)||lag<0||!finite(correlation)||correlation<0||correlation>1)
  throw Error("E1-A quality: invalid model lag/correlation");
 const total=available.length;
 const count=available.reduce((n,isAvailable,i)=>n+(Boolean(isAvailable)&&finite(values[i])?1:0),0);
 const coverage=total?count/total:0;
 const effectiveFraction=count?clamp(nEffective===null?1:nEffective/count):0;
 // Conservative monotone diagnostics only; not an empirically calibrated risk.
 const lagFactor=1/(1+lag/4);
 const dependenceFactor=1-0.5*correlation;
 const score=clamp(coverage*(0.5+0.5*effectiveFraction)*lagFactor*dependenceFactor);
 return Object.freeze({score,coverage,observedCount:count,requestedCount:total,
  effectiveFraction,configuredLag:lag,configuredCorrelation:correlation,
  lagFactor,dependenceFactor,modelAssumptionsOnly:true,
  interpretation:"Heuristic usability; not probability of honesty or measured witness independence"});
}
