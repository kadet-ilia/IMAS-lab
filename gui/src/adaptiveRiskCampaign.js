/**
 * Frozen E1-A prequential-risk ablation protocol. Unlike the 2026-11-16
 * historical campaign, this compares the NEW risk_aware alpha vs the old
 * adaptive alpha on the SAME exogenous realization per run. All stage seeds
 * are disjoint from the historical archived research.
 *
 * The risk rule is fixed before any new experiments. A small-sample "smoke"
 * is a code test, never an optimizer of hyperparameters.
 */
import {campaignDesign,campaignConfiguration,E1A_CAMPAIGN_LAWS} from "./adaptiveCampaignProtocol.js";
import {ADAPTIVE_RISK_DEFAULTS,ADAPTIVE_RISK_MODEL_VERSION} from "./adaptiveRiskController.js";
import {ADAPTIVE_MODEL_VERSION} from "./adaptiveDecisionEngine.js";
import {ADAPTIVE_STUDY_VERSION} from "./adaptiveExperiment.js";
import {TRUST_MODEL_VERSION} from "./trustEngine.js";

export const RISK_CAMPAIGN_VERSION="e1a-risk-ablation-1.0.0";
export const RISK_CAMPAIGN_CRITERION="mean per-run RMSE(risk_aware)-RMSE(adaptive_legacy); negative is better";
export const RISK_CAMPAIGN_TOLERANCE=0.01;
export function riskCampaignDesign(){
 const prior=campaignDesign();
 const bases={exploratory:1300000000,confirmatory:1900000000,smoke:2070000000};
 const items=Object.fromEntries(Object.entries(bases).map(([stage,base])=>[stage,
  prior.cells[stage].map((c,i)=>({
   ...c,stage,seed:base+i*4096+317,ordinal:i
  }))
 ]));
 const all=Object.values(items).flat();
 if(all.length!==87||new Set(all.map(c=>c.seed)).size!==87||
  all.some(c=>c.seed>2147483647||c.seed<1))
  throw Error("Risk campaign seeds are duplicated or exceed signed 32-bit");
 return {
  protocol:RISK_CAMPAIGN_VERSION,
  fixedBefore:"2026-11-16: prequential risk version 1.0.0; no tuning on prior heldout RMSE",
  basis:prior.protocol,modelVersions:{
   base:TRUST_MODEL_VERSION,adaptive:ADAPTIVE_MODEL_VERSION,
   study:ADAPTIVE_STUDY_VERSION,risk:ADAPTIVE_RISK_MODEL_VERSION
  },
  hypothesis:RISK_CAMPAIGN_CRITERION,
  practicalTolerance:RISK_CAMPAIGN_TOLERANCE,
  standardRiskOptions:ADAPTIVE_RISK_DEFAULTS,
  comparisonModes:["risk_aware","adaptive"],
  design:{
   N:30,T:48,trim:6,factors:"6 laws x 3 schedules x 4 Byzantine fractions",
   discoveryRuns:30,confirmatoryRuns:100,smokeRuns:2,
   countExploratory:72,countConfirmatory:12,
   primary:"RMSE(risk_aware) minus RMSE(legacy adaptive) on paired simulations",
   controls:["trimmed_unweighted","proposed_robust"],
   unit:"independent full-run RMSE, not an individual time tick",
   confirmatoryCaveat:"New random seeds but factorial conditions were previously inspected under a different method; not a fully blind external evaluation"
  },
  stages:items
 };
}
export function riskCampaignConfig(cell){
 const {config,options}=campaignConfiguration(cell);
 const o={...options,alphaMode:"risk_aware",runs:cell.runs,
  ...ADAPTIVE_RISK_DEFAULTS};
 return {
  config,
  risk:o,
  legacy:{...o,alphaMode:"adaptive"}
 };
}
export function riskCampaignAssertPair(risk,legacy){
 if(risk?.run!==legacy?.run||risk?.trajectory?.length!==legacy?.trajectory?.length)
  throw Error("Risk campaign pair uses different runs or trajectory lengths");
 for(let i=0;i<risk.trajectory.length;i++){
  const a=risk.trajectory[i],b=legacy.trajectory[i];
  if(a.step!==b.step||a.trimmed_unweighted!==b.trimmed_unweighted||
   a.proposed_robust!==b.proposed_robust||
   a.adaptive_unweighted!==b.adaptive_unweighted||
   a.adaptive_weighted!==b.adaptive_weighted)
   throw Error("Risk campaign exogenous baseline mismatch at step "+(i+1));
 }
 const get=(obj,method)=>{
  const metric=obj.metrics.find(x=>x.method===method);
  if(!metric||!Number.isFinite(metric.rmse))throw Error("Missing primary RMSE "+method);
  return metric.rmse;
 };
 const rr=get(risk,"adaptive_robust"),ar=get(legacy,"adaptive_robust");
 const tr=get(risk,"trimmed_unweighted"),wr=get(risk,"proposed_robust");
 const alphaMean=run=>{
  const a=run.trajectory.map(x=>x.diagnostics?.alpha).filter(Number.isFinite);
  return a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
 };
 return {run:risk.run,rmseRisk:rr,rmseLegacyAdaptive:ar,
  rmseTrimmed:tr,rmseCombined:wr,
  dRiskLegacy:rr-ar,dRiskTrimmed:rr-tr,dRiskCombined:rr-wr,
  meanAlphaRisk:alphaMean(risk),meanAlphaLegacy:alphaMean(legacy),
  riskCoverage:risk.metrics.find(x=>x.method==="adaptive_robust").decision_coverage,
  legacyCoverage:legacy.metrics.find(x=>x.method==="adaptive_robust").decision_coverage,
  meanRiskPairs:risk.trajectory.reduce((n,x)=>n+(x.diagnostics.riskPairs||0),0)/risk.trajectory.length
 };
}
export function riskCampaignValidateDesign(design){
 const expected=riskCampaignDesign();
 if(JSON.stringify(design)!==JSON.stringify(expected))
  throw Error("Risk campaign protocol changed; abort until separately versioned");
 return design;
}
