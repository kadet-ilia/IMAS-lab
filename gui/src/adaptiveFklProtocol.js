/**
 * Frozen E1-A factorial protocol: independently vary Byzantine count f,
 * symmetric trimming k and witness observation lag L.
 *
 * Experiments are paired in TWO dimensions:
 * - within cell, exactly same keyed exogenous event stream for all four policies;
 * - within f and runIndex, a common base seed is shared across k x L,
 *   yielding matched factorial blocks (NOT 80 independent random samples).
 *
 * Never tune parameters from confirmation results. OOD confirmatory cells
 * change the attack strategy and intensity law; this tests transfer.
 */
import {validateAdaptiveOptions} from "./adaptiveDecisionEngine.js";
import {campaignAttackSchedule} from "./adaptiveCampaignProtocol.js";

export const E1A_FKL_VERSION="e1a-fkl-regime-factorial-1.0.0";
export const E1A_FKL_F=Object.freeze([3,6,9,12]);
export const E1A_FKL_K=Object.freeze([0,3,6,9,12]);
export const E1A_FKL_LAG=Object.freeze([0,1,2,4]);
export const E1A_FKL_MODES=Object.freeze([
 "adaptive","risk_aware","regime_aware_discrete","regime_aware_blend"
]);
export const E1A_FKL_R=Object.freeze({smoke:2,exploratory:30,confirmatory:100});
const N=30,T=48;
const BASE_SEED=Object.freeze({smoke:2010000000,exploratory:1560000000,confirmatory:1700000000});
function cell(stage,f,k,lag,fIndex,kIndex,lagIndex,ordinal){
 return {id:"f"+f+"__k"+k+"__lag"+lag,stage,f,k,lag,ordinal,
  runs:E1A_FKL_R[stage],seed:BASE_SEED[stage]+fIndex*8192+997,
  block:"f"+f,attackStrategy:stage==="confirmatory"?"pulsed":"coordinated",
  temporalLaw:stage==="confirmatory"?"hyperbolic":"constant",
  temporalSchedule:stage==="confirmatory"?"double":"sustained",
  evidenceModel:"lagged_observation"};
}
export function fklDesign(){
 const exploratory=[];
 for(const [fi,f] of E1A_FKL_F.entries())
  for(const [ki,k] of E1A_FKL_K.entries())
   for(const [li,lag] of E1A_FKL_LAG.entries())
    exploratory.push(cell("exploratory",f,k,lag,fi,ki,li,exploratory.length));
 const confirmatory=[];
 // Prespecified, mechanically selected OOD parameter combinations.
 // Their outcome cannot be used to tune the model. Each k retains its f block seed.
 for(const [fi,f] of E1A_FKL_F.entries())
  for(const [ki,k] of [0,3,6,9].entries()){
   const li=(fi+ki)%E1A_FKL_LAG.length;
   confirmatory.push(cell("confirmatory",f,k,E1A_FKL_LAG[li],
    fi,ki,li,confirmatory.length));
  }
 const smoke=[0,37,79].map((index,i)=>{
  const base=exploratory[index],fi=E1A_FKL_F.indexOf(base.f);
  return {...base,stage:"smoke",ordinal:i,runs:E1A_FKL_R.smoke,
   seed:BASE_SEED.smoke+fi*8192+997};
 });
 if(exploratory.length!==80||confirmatory.length!==16||smoke.length!==3||
   new Set(exploratory.map(c=>c.id)).size!==80||
   new Set(confirmatory.map(c=>c.id)).size!==16)
  throw Error("E1-A FKL: factorial design is incomplete");
 const all=[...exploratory,...confirmatory,...smoke];
 if(all.some(c=>!Number.isInteger(c.seed)||c.seed<0||c.seed>2147483647))
  throw Error("E1-A FKL: invalid signed-32 bit seeds");
 for(const stages of ["exploratory","confirmatory","smoke"]){
  const group=all.filter(c=>c.stage===stages);
  for(const f of E1A_FKL_F){
   if(new Set(group.filter(c=>c.f===f).map(c=>c.seed)).size>1)
    throw Error("E1-A FKL: lost within-f common seed block");
  }
 }
 return {
  protocol:E1A_FKL_VERSION,
  frozenBeforeAnalysis:"Fixed factorial and holdout before running any experiments; no parameter search on confirmatory data",
  researchQuestions:[
   "Does regime_aware (discrete/blend) reduce RMSE compared with historical proposed_robust E1?",
   "Does f x k interaction alter ranking of expert policies?",
   "Does witness observation lag L change estimates under shared exogenous blocks?",
   "Do any improvements transfer to an unseen joint periodic-behavior/hyperbolic-double attack regime?"
  ],
  comparators:["proposed_robust","trimmed_unweighted",
   "adaptive","risk_aware","regime_aware_discrete","regime_aware_blend"],
  modes:E1A_FKL_MODES,model:{N,T,network_enabled:false,n_sybil_agents:0,
   estimatorOnly:true,evidenceModel:"lagged_observation"},
  factorial:{f:E1A_FKL_F,k:E1A_FKL_K,lag:E1A_FKL_LAG,
   exploratoryCells:80,exploratoryRunsPerCell:30,
   confirmatoryCells:16,confirmatoryRunsPerCell:100,
   smokeCells:3,smokeRunsPerCell:2},
  stageSeedBlocks:BASE_SEED,
  randomization:"Each f has one disjoint stage seed, shared deliberately over all k x lag. RunIndex independently keys exogenous draws within f; cells with same f/runIndex are repeated-condition observations, NOT independent cases.",
  experiment:"Common synthetic 30-agent E1 baseline; four different alpha choices with identical delivered events within each cell/run.",
  estimand:"Mean per-run RMSE(method)-RMSE(combined E1) for each fixed cell, negative is better; refusals independently assessed using unconditional loss.",
  exploratoryInference:"Descriptive run-level bootstrap intervals, unadjusted; no claim of across-cell independence or generalization to arbitrary attacks.",
  confirmatoryInference:"Prespecified OOD 16 cells; independently held-out seed blocks, no tuning or stopping based on results; no field validation.",
  constraints:["Simulation truth only for post hoc metrics","Never infer f from observed outliers",
   "A cross-lag contrast with common seed is blocked, not 80 independent trials",
   "Proxy median can be manipulated; no true cybersecurity risk calibration"],
  stages:{smoke,exploratory,confirmatory}
 };
}
export function validateFklDesign(design){
 const fixed=fklDesign();
 if(JSON.stringify(design)!==JSON.stringify(fixed))
  throw Error("E1-A FKL: frozen design mismatch; create a new version rather than edit");
 return design;
}
export function fklCellConfiguration(c){
 if(!c||!["smoke","exploratory","confirmatory"].includes(c.stage)||
   !E1A_FKL_F.includes(c.f)||!E1A_FKL_K.includes(c.k)||!E1A_FKL_LAG.includes(c.lag))
  throw Error("E1-A FKL: invalid factorial cell");
 const options=validateAdaptiveOptions({
  scenario:"dynamic",comparisonMode:"estimator_only",
  phases:campaignAttackSchedule(c.temporalLaw,c.temporalSchedule),
  attackStrategy:c.attackStrategy,evidenceModel:c.evidenceModel,evidenceLag:c.lag,
  coordinatedBias:2,attackPeriod:10,attackDuty:4,
  evidenceTolerance:0.45,evidenceNoiseSigma:0.025,
  witnessCorruption:0.8,evidenceCorrelation:0.45,
  runs:c.runs,trimEachSide:c.k,adaptiveTrim:false,
  trimMode:"source_first",gamma:1,minWeight:0.05,maxWeight:1,
  warmupSteps:8,minimumEffectiveFraction:0.75,disagreementPenalty:1.5,
  alphaMode:"adaptive",decisionRefusalPenalty:1
 });
 const config={n_agents:N,n_byzantine:c.f,n_steps:T,seed:c.seed,
  trim_each_side:c.k,attack_start_step:c.stage==="confirmatory"?9:13,
  network_enabled:false,n_sybil_agents:0,paired_exogenous_events:true};
 return {config,options};
}
export function fklModeOptions(base,mode){
 if(!E1A_FKL_MODES.includes(mode))throw Error("E1-A FKL: unknown fixed policy");
 const o={...base,alphaMode:mode.startsWith("regime_aware")?"regime_aware":mode};
 if(mode==="regime_aware_discrete")o.regimeSelectionMode="discrete";
 if(mode==="regime_aware_blend")o.regimeSelectionMode="blend";
 return validateAdaptiveOptions(o);
}
