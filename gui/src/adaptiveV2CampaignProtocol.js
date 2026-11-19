/**
 * Pre-registered synthetic v2 experiment. Distinct from the already inspected
 * M5-A/M5-B confirmation sets; they MUST NOT be recycled for parameter fitting.
 * Current v2 options are FIXED. Train is exploratory and does not tune here.
 * Separate OOD holdout is reserved until v2 version is frozen.
 */
import {campaignAttackSchedule} from "./adaptiveCampaignProtocol.js";
import {validateAdaptiveStudy} from "./adaptiveExperiment.js";
export const E1A_V2_CAMPAIGN_VERSION="e1a-v2-huber-regret-factorial-1.0.0";
export const V2_CAMPAIGN_MODES=Object.freeze([
 "adaptive","risk_aware","regime_aware",
 "regime_aware_v2_discrete","regime_aware_v2_blend"
]);
export const V2_STAGE_COUNTS=Object.freeze({
 smoke:{cells:3,runs:2},train:{cells:48,runs:12},
 holdout:{cells:12,runs:60}
});
const key=x=>x.strategy+"__"+x.law+"__"+x.schedule+
 "__"+x.evidence+"__f"+x.f;
const cell=(stage,props,index,seedBase,runs)=>({
 ...props,stage,ordinal:index,runs,
 id:key(props),seed:seedBase+index*4096+313
});
export function v2CampaignDesign(){
 const train=[];
 for(const strategy of ["coordinated","pulsed","stealth"])
  for(const law of ["constant","pulsed"])
   for(const schedule of ["single","sustained"])
    for(const evidence of ["behavior_linked","correlated_witnesses"])
     for(const f of [6,12])
      train.push(cell("train",{strategy,law,schedule,evidence,f},
       train.length,1720000000,12));
 const holdout=[];
 for(const strategy of ["coordinated","pulsed"])
  for(const evidence of ["behavior_linked","correlated_witnesses","lagged_observation"])
   for(const f of [6,12])
    holdout.push(cell("holdout",{
     strategy,law:"linear",schedule:"double",evidence,f
    },holdout.length,1900000000,60));
 const smoke=[train[0],train[20],train[47]].map((x,i)=>({
  ...x,stage:"smoke",ordinal:i,runs:2,seed:2075000000+i*4096+313
 }));
 const combined=[...train,...holdout,...smoke];
 if(train.length!==48||holdout.length!==12||smoke.length!==3||
  combined.some(x=>x.seed<=0||x.seed>=2147483647)||
  new Set(combined.map(x=>x.seed)).size!==combined.length||
  new Set(train.map(x=>x.id)).size!==48||
  new Set(holdout.map(x=>x.id)).size!==12||
  train.some(x=>holdout.some(y=>y.id===x.id)))
  throw Error("E1-A v2: invalid fixed stage design");
 return Object.freeze({
  protocol:E1A_V2_CAMPAIGN_VERSION,
  frozenBeforeRuns:true,
  trainRole:"exploratory diagnostic; no holdout permitted for fitting",
  primary:"cell mean of paired whole-run RMSE(v2_discrete)-RMSE(proposed_robust), negative is better",
  secondary:["v2_blend","v1","risk","adaptive"],
  candidates:V2_CAMPAIGN_MODES,
  minimumPracticalEffectRmse:0.01,
  standardScenario:{N:30,T:48,k:6,noNetwork:true,noSybil:true,
   attackPeriod:8,attackDuty:4,evidenceCorrelation:0.7,
   evidenceLag:2,refusalPenalty:1},
  stageSizes:V2_STAGE_COUNTS,
  stages:{smoke,train,holdout},
  limitations:[
   "Observation-only Huber surrogate can be Byzantine manipulated",
   "Historical M5 holdout is not reused for tuning v2",
   "Holdout version and default hyperparameters frozen before looking at train",
   "No independent field cyber-security validation",
   "Equal cell weight is a synthetic design choice, not a real attack distribution",
   "Each whole seeded run is one observation; ticks are dependent"
  ]
 });
}
export function validateV2CampaignDesign(d){
 if(JSON.stringify(d)!==JSON.stringify(v2CampaignDesign()))
  throw Error("E1-A v2: mutated frozen protocol");
 return d;
}
export function v2CampaignParameters(c,mode){
 if(!V2_CAMPAIGN_MODES.includes(mode))throw Error("Unknown v2 campaign mode");
 const d=v2CampaignDesign();
 if(!d.stages[c.stage]?.some(x=>JSON.stringify(x)===JSON.stringify(c)))
  throw Error("E1-A v2: unfrozen factor cell");
 const alphaMode=mode.startsWith("regime_aware_v2")?"regime_aware_v2":mode;
 return validateAdaptiveStudy({
  n_agents:30,n_byzantine:c.f,n_steps:48,seed:c.seed,
  attack_start_step:c.schedule==="sustained"?13:9,
  trim_each_side:6,network_enabled:false,n_sybil_agents:0
 },{
  runs:c.runs,scenario:"dynamic",comparisonMode:"estimator_only",
  phases:campaignAttackSchedule(c.law,c.schedule),
  attackStrategy:c.strategy,attackPeriod:8,attackDuty:4,
  coordinatedBias:2,stealthBias:0.22,
  evidenceModel:c.evidence,evidenceCorrelation:0.7,evidenceLag:2,
  evidenceTolerance:0.45,evidenceNoiseSigma:0.025,
  witnessCorruption:0.8,
  alphaMode,v2ChoiceMode:mode==="regime_aware_v2_blend"?"blend":"discrete",
  trimEachSide:6,adaptiveTrim:false,trimMode:"source_first",
  gamma:1,warmupSteps:8,minimumEffectiveFraction:0.75,
  decisionRefusalPenalty:1
 });
}
