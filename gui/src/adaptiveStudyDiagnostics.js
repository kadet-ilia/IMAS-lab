/**
 * E1-A research M6: inspectable whole-run comparisons and phase diagnostics.
 * Pure postprocessing. The simulator's truth is used ONLY after estimation.
 * Statistical units are seeded full runs; individual ticks are NOT replicas.
 */
import {ADAPTIVE_METHOD_IDS} from "./adaptiveDecisionEngine.js";
import {mean95} from "./statistics2027.js";

export const ADAPTIVE_ANALYSIS_VERSION="e1a-posthoc-run-phases-1.0.0";
export const ADAPTIVE_ANALYSIS_BASELINES=Object.freeze([
 "proposed_robust","trimmed_unweighted"
]);
export const ADAPTIVE_ANALYSIS_METRICS=Object.freeze([
 {id:"rmse",label:"Условный RMSE",delta:"deltaRmse"},
 {id:"unconditional_decision_loss",label:"Безусловная потеря",delta:"deltaLoss"}
]);
export const ADAPTIVE_ANALYSIS_PHASES=Object.freeze([
 "attack_active","attack_inactive"
]);
const finite=Number.isFinite;
const mean=a=>a.length?a.reduce((s,v)=>s+v,0)/a.length:null;
const rmse=errors=>errors.length?
 Math.sqrt(errors.reduce((s,e)=>s+e*e,0)/errors.length):null;
const supported=new Set(ADAPTIVE_METHOD_IDS);
const approx=(a,b)=>Math.abs(a-b)<1e-9*Math.max(1,Math.abs(a),Math.abs(b));

function assertStudy(result){
 if(!result||result.archiveFormat!=="imas-adaptive-collective-decisions"||
   result.archiveVersion!==1||!Array.isArray(result.runs)||
   !Number.isInteger(result.completedRuns)||result.runs.length!==result.completedRuns||
   !Number.isInteger(result.configuration?.n_steps)||result.configuration.n_steps<1||
   !finite(result.options?.decisionRefusalPenalty)||
   result.options.decisionRefusalPenalty<0)
  throw Error("E1-A M6: incompatible or incomplete research archive");
 const n=result.configuration.n_steps;
 for(const [index,run] of result.runs.entries()){
  if(!run||run.run!==index||!Array.isArray(run.trajectory)||
    run.trajectory.length!==n||!Array.isArray(run.metrics))
   throw Error("E1-A M6: broken run identity or trajectory");
  if(new Set(run.metrics.map(m=>m.method)).size!==ADAPTIVE_METHOD_IDS.length||
    ADAPTIVE_METHOD_IDS.some(id=>!run.metrics.some(m=>m.method===id)))
   throw Error("E1-A M6: missing or duplicated estimator metrics");
  for(const [stepIndex,tick] of run.trajectory.entries()){
   if(tick.step!==stepIndex+1||!finite(tick.truth)||
      !finite(tick.attack_intensity)||tick.attack_intensity<0)
    throw Error("E1-A M6: inconsistent time step or attack intensity");
   for(const method of ADAPTIVE_METHOD_IDS)
    if(tick[method]!==null&&!finite(tick[method]))
     throw Error("E1-A M6: nonfinite decision "+method);
  }
  // Independently reconstruct reported metrics from complete observed traces.
  // This detects accidental suppression of refusals or numerical inconsistencies.
  for(const method of ADAPTIVE_METHOD_IDS){
   const saved=run.metrics.find(item=>item.method===method);
   const accepted=run.trajectory.filter(t=>finite(t[method]));
   const squared=accepted.reduce((s,t)=>s+(t[method]-t.truth)**2,0);
   const missing=n-accepted.length;
   const expectedRmse=accepted.length?Math.sqrt(squared/accepted.length):null;
   const expectedLoss=(squared+missing*result.options.decisionRefusalPenalty)/n;
   if(!finite(saved.decision_coverage)||
     !approx(saved.decision_coverage,accepted.length/n)||
     saved.refusals!==missing||
     !finite(saved.unconditional_decision_loss)||
     !approx(saved.unconditional_decision_loss,expectedLoss)||
     !(saved.rmse===null&&expectedRmse===null||
       expectedRmse!==null&&finite(saved.rmse)&&approx(saved.rmse,expectedRmse)))
    throw Error("E1-A M6: run metrics disagree with trajectory for "+method);
  }
 }
 return result;
}

function metricValue(metric,key){
 const value=metric?.[key];
 if(value!==null&&value!==undefined&&!finite(value))
  throw Error("E1-A M6: invalid "+key+" metric");
 return value??null;
}
export function adaptiveRunComparisonRows(result,baseline="proposed_robust"){
 assertStudy(result);
 if(!ADAPTIVE_ANALYSIS_BASELINES.includes(baseline))
  throw Error("E1-A M6: unapproved reference method");
 return result.runs.map(run=>{
  const candidate=run.metrics.find(m=>m.method==="adaptive_robust");
  const control=run.metrics.find(m=>m.method===baseline);
  const a=metricValue(candidate,"rmse"),b=metricValue(control,"rmse");
  const la=metricValue(candidate,"unconditional_decision_loss");
  const lb=metricValue(control,"unconditional_decision_loss");
  const coverageA=metricValue(candidate,"decision_coverage");
  const coverageB=metricValue(control,"decision_coverage");
  if(![la,lb,coverageA,coverageB].every(finite))
   throw Error("E1-A M6: unconditional loss/coverage must be finite");
  const activeSteps=run.trajectory.filter(t=>t.attack_intensity>0).length;
  const nominalActiveSteps=run.trajectory.filter(t=>
   (t.nominal_attack_intensity??t.attack_intensity)>0).length;
  const last=run.trajectory.at(-1)?.diagnostics??{};
  return {run:run.run,baseline,rmseAdaptive:a,rmseBaseline:b,
   deltaRmse:a===null||b===null?null:a-b,
   lossAdaptive:la,lossBaseline:lb,deltaLoss:la-lb,
   coverageAdaptive:coverageA,coverageBaseline:coverageB,
   refusalsAdaptive:metricValue(candidate,"refusals"),
   refusalsBaseline:metricValue(control,"refusals"),
   activeSteps,nominalActiveSteps,
   suppressedSteps:nominalActiveSteps-activeSteps,
   switches:finite(last.policySwitches)?last.policySwitches:null,
   finalExpert:typeof last.regimeSelected==="string"?last.regimeSelected:null};
 });
}

export function summarizeAdaptiveComparison(rows,metric="rmse"){
 if(!Array.isArray(rows)||!rows.length)
  throw Error("E1-A M6: comparison requires completed whole runs");
 if(!["rmse","unconditional_decision_loss"].includes(metric))
  throw Error("E1-A M6: unknown comparison metric");
 const key=metric==="rmse"?"deltaRmse":"deltaLoss";
 const accepted=rows.map(r=>r[key]).filter(finite),n=rows.length;
 const ci=accepted.length?mean95(accepted):null;
 return {metric,nPaired:accepted.length,nRuns:n,nMissingPairs:n-accepted.length,
  meanDelta:ci?.estimate??null,ci95Low:ci?.lower??null,
  ci95High:ci?.upper??null,ciMethod:ci?.method??null,
  warning:accepted.length<2?"Недостаточно независимых полных прогонов для интервальной оценки":
   (ci?.warning??"Нормальная аппроксимация 95%; исследовательская без поправки на множественность"),
  wins:accepted.filter(v=>v<0).length,losses:accepted.filter(v=>v>0).length,
  ties:accepted.filter(v=>v===0).length,
  zeroAttackRuns:rows.filter(r=>r.activeSteps===0).length,
  methodologicalNote:"Whole run is a sampling unit; time steps are correlated; same seed pairs are not external validation"};
}

function phaseRow(run,method,phase,penalty){
 const ticks=run.trajectory.filter(t=>
  (phase==="attack_active") === (t.attack_intensity>0));
 const accepted=ticks.filter(t=>finite(t[method]));
 const errors=accepted.map(t=>t[method]-t.truth);
 const missing=ticks.length-accepted.length;
 const loss=ticks.length?
  (errors.reduce((s,e)=>s+e*e,0)+missing*penalty)/ticks.length:null;
 return {run:run.run,method,phase,steps:ticks.length,
  accepted:accepted.length,refusals:missing,
  coverage:ticks.length?accepted.length/ticks.length:null,
  rmse:rmse(errors),unconditionalLoss:loss};
}
export function adaptivePhaseRows(result){
 assertStudy(result);
 const penalty=result.options.decisionRefusalPenalty;
 return result.runs.flatMap(run=>ADAPTIVE_METHOD_IDS.flatMap(method=>
  ADAPTIVE_ANALYSIS_PHASES.map(phase=>phaseRow(run,method,phase,penalty))));
}
export function adaptivePhaseComparison(result,baseline="proposed_robust"){
 if(!ADAPTIVE_ANALYSIS_BASELINES.includes(baseline))
  throw Error("E1-A M6: unapproved reference method");
 const phaseRows=adaptivePhaseRows(result);
 const grouped=new Map(phaseRows.map(x=>[
  x.run+"|"+x.method+"|"+x.phase,x
 ]));
 return ADAPTIVE_ANALYSIS_PHASES.map(phase=>{
  const rows=result.runs.map(run=>{
   const a=grouped.get(run.run+"|adaptive_robust|"+phase);
   const b=grouped.get(run.run+"|"+baseline+"|"+phase);
   if(a.steps!==b.steps)
    throw Error("E1-A M6: invalid active-attack pairing");
   return {run:run.run,phase,steps:a.steps,
    deltaRmse:a.rmse===null||b.rmse===null?null:a.rmse-b.rmse,
    deltaLoss:a.unconditionalLoss===null||b.unconditionalLoss===null?
     null:a.unconditionalLoss-b.unconditionalLoss,
    candidateRmse:a.rmse,baselineRmse:b.rmse,
    candidateLoss:a.unconditionalLoss,baselineLoss:b.unconditionalLoss};
  });
  const actual=rows.filter(x=>x.steps>0);
  const rmseD=actual.map(x=>x.deltaRmse).filter(finite);
  const lossD=actual.map(x=>x.deltaLoss).filter(finite);
  const ci=rmseD.length?mean95(rmseD):null;
  return {phase,baseline,
   nRunsWithPhase:actual.length,nPairedRmse:rmseD.length,
   meanDeltaRmse:ci?.estimate??null,
   ci95Low:ci?.lower??null,ci95High:ci?.upper??null,
   meanDeltaLoss:mean(lossD),
   averageSteps:mean(actual.map(x=>x.steps)),
   rows,
   note:"Mean of paired phase-specific whole-run RMSE differences; not RMSE of pooled time ticks"};
 });
}
export function adaptivePolicyEventRows(result){
 assertStudy(result);
 return result.runs.flatMap(run=>run.trajectory.map(t=>{
  const d=t.diagnostics??{},w=d.policyWeights??{};
  return {run:run.run,step:t.step,attackIntensity:t.attack_intensity,
   selected:d.regimeSelected??null,regimeState:d.regimeState??null,
   switchCount:finite(d.policySwitches)?d.policySwitches:null,
   alpha:finite(d.alpha)?d.alpha:null,k:finite(d.k)?d.k:null,
   nEffective:finite(d.nEffective)?d.nEffective:null,
   quality:finite(d.evidenceQualityScore)?d.evidenceQualityScore:null,
   innovation:finite(d.regimeInnovation)?d.regimeInnovation:null,
   combinedWeight:finite(w.proposed_robust)?w.proposed_robust:null,
   adaptiveWeight:finite(w.adaptive)?w.adaptive:null,
   riskWeight:finite(w.risk_aware)?w.risk_aware:null,
   v2RegretAdaptive:finite(d.v2RegretAdaptive)?d.v2RegretAdaptive:null,
   v2RegretRisk:finite(d.v2RegretRisk)?d.v2RegretRisk:null,
   v2EffectivePairs:finite(d.v2EffectivePairs)?d.v2EffectivePairs:null,
   v2UncertaintyAdaptive:finite(d.v2UncertaintyAdaptive)?d.v2UncertaintyAdaptive:null,
   v2UncertaintyRisk:finite(d.v2UncertaintyRisk)?d.v2UncertaintyRisk:null,
   v2Reason:typeof d.v2Reason==="string"?d.v2Reason:null};
 }));
}

export const ADAPTIVE_RUN_EXPORT_FIELDS=Object.freeze([
 "run","baseline","rmseAdaptive","rmseBaseline","deltaRmse",
 "lossAdaptive","lossBaseline","deltaLoss","coverageAdaptive","coverageBaseline",
 "refusalsAdaptive","refusalsBaseline","activeSteps","nominalActiveSteps",
 "suppressedSteps","switches","finalExpert"
]);
export const ADAPTIVE_PHASE_EXPORT_FIELDS=Object.freeze([
 "run","method","phase","steps","accepted","refusals","coverage",
 "rmse","unconditionalLoss"
]);
export const ADAPTIVE_EVENT_EXPORT_FIELDS=Object.freeze([
 "run","step","attackIntensity","selected","regimeState","switchCount",
 "alpha","k","nEffective","quality","innovation",
 "combinedWeight","adaptiveWeight","riskWeight",
 "v2RegretAdaptive","v2RegretRisk","v2EffectivePairs",
 "v2UncertaintyAdaptive","v2UncertaintyRisk","v2Reason"
]);
export function adaptiveRecordsCsv(rows,fields){
 if(!Array.isArray(rows)||!Array.isArray(fields)||!fields.length||
   fields.some(field=>typeof field!=="string"||!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(field)))
  throw Error("E1-A M6: invalid scientific CSV schema");
 const cell=value=>{
  if(value===null||value===undefined)return "";
  if(typeof value!=="number"&&typeof value!=="string"&&typeof value!=="boolean")
   throw Error("E1-A M6: nested object forbidden in flat CSV");
  if(typeof value==="number"&&!finite(value))
   throw Error("E1-A M6: nonfinite CSV value");
  let v=String(value);
  // Formula injection defense for any text eventually opened in a spreadsheet.
  if(typeof value==="string"&&/^[\s]*[=+@\-\t\r]/.test(v))v="'"+v;
  return /[;"\r\n]/.test(v)?'"'+v.replaceAll('"','""')+'"':v;
 };
 return fields.join(";")+"\n"+
  rows.map(row=>fields.map(field=>cell(row[field])).join(";")).join("\n")+
  (rows.length?"\n":"");
}
export function adaptiveReproductionManifest(result,rows){
 assertStudy(result);
 if(!Array.isArray(rows)||rows.length!==result.runs.length)
  throw Error("E1-A M6: inconsistent manifest and run metrics");
 return {format:"imas-e1a-reproduction-manifest",version:1,
  archiveVersion:result.archiveVersion,
  models:result.models,
  configuration:result.configuration,
  options:result.options,
  completedRuns:result.completedRuns,
  requestedRuns:result.requestedRuns,
  partial:result.partial,
  runIndices:result.runs.map(x=>x.run),
  methodIds:ADAPTIVE_METHOD_IDS,
  primaryControl:"proposed_robust",
  secondaryControl:"trimmed_unweighted",
  refusalPenalty:result.options.decisionRefusalPenalty,
  comparisonMode:result.options.comparisonMode,
  analysisVersion:ADAPTIVE_ANALYSIS_VERSION,
  provenance:"Model versions and configuration are metadata only; browser export does not contain independently verified source SHA-256 or authenticated origin.",
  inference:"Exploratory paired synthetic runs; source/calibration uncertainty and dependent time ticks are not covered by within-run CI.",
  warning:result.partial?"Incomplete run series: do not use as final comparative evidence":null
 };
}
