/**
 * M7 computational-cost experiment. Fixed workload rather than tuning.
 * Measures WHOLE simulator+estimator, not isolated cost of alpha controller.
 * A run is measured on the SAME host/process with order rotation, but
 * JIT/GC/scheduling noise remains. Not a validated real-time guarantee.
 */
import {campaignAttackSchedule} from "./adaptiveCampaignProtocol.js";
import {validateAdaptiveStudy} from "./adaptiveExperiment.js";

export const E1A_COST_VERSION="e1a-cost-pilot-1.0.0";
export const E1A_COST_MODES=Object.freeze([
 "adaptive","risk_aware","regime_aware_discrete","regime_aware_blend"
]);
export const E1A_COST_STAGES=Object.freeze({
 smoke:{warmup:2,measured:2},reference:{warmup:3,measured:16}
});
export const E1A_COST_CASES=Object.freeze([
 Object.freeze({id:"common_estimator",comparisonMode:"estimator_only",seed:202611180}),
 Object.freeze({id:"closed_decision_feedback",comparisonMode:"decision_feedback",seed:202611190})
]);
export function costStudyDesign(){
 return {
  protocol:E1A_COST_VERSION,stages:E1A_COST_STAGES,
  cases:E1A_COST_CASES,modes:E1A_COST_MODES,
  fixedParameters:{N:30,T:48,f:9,k:6,
   attackStrategy:"pulsed",attackPeriod:10,attackDuty:4,
   attackLaw:"constant",attackSchedule:"sustained",
   evidenceModel:"behavior_linked",networkEnabled:false,
   sybilAgents:0},
  measurement:"End-to-end single-run elapsed wall time and process CPU time; heap delta is an unreliable diagnostic only",
  invariance:"Within a case/runIndex, compare common exogenous inputs and historical E1 output against each alpha mode",
  scientificLimits:[
   "Benchmarks do not isolate alpha computation from simulation and E1 aggregation",
   "CI virtual CPUs, JIT compilation, garbage collection and scheduling add noise",
   "Results on one machine cannot be extrapolated to real-time performance or a spacecraft",
   "Independent closed decision feedback can change method-specific reputation trajectories",
   "This study is diagnostic only, not used for algorithm selection or tuning"
  ]
 };
}
export function costStudyParameters(design,stage,mode,c){
 const fixed=costStudyDesign();
 if(JSON.stringify(design)!==JSON.stringify(fixed))
  throw Error("M7 cost protocol has been modified");
 if(!Object.hasOwn(E1A_COST_STAGES,stage)||
    !E1A_COST_MODES.includes(mode)||
    !E1A_COST_CASES.some(x=>x.id===c?.id&&x.comparisonMode===c.comparisonMode&&x.seed===c.seed))
  throw Error("M7 cost parameters are outside the frozen design");
 const options={
  runs:E1A_COST_STAGES[stage].measured,
  comparisonMode:c.comparisonMode,
  scenario:"dynamic",phases:campaignAttackSchedule("constant","sustained"),
  attackStrategy:"pulsed",attackPeriod:10,attackDuty:4,
  evidenceModel:"behavior_linked",
  trimEachSide:6,adaptiveTrim:false,trimMode:"source_first",
  alphaMode:mode.startsWith("regime_aware")?"regime_aware":mode,
  regimeSelectionMode:mode==="regime_aware_blend"?"blend":"discrete",
  decisionRefusalPenalty:1
 };
 const config={n_agents:30,n_byzantine:9,n_steps:48,
  seed:c.seed,trim_each_side:6,attack_start_step:13,
  network_enabled:false,n_sybil_agents:0,paired_exogenous_events:true};
 return validateAdaptiveStudy(config,options);
}
