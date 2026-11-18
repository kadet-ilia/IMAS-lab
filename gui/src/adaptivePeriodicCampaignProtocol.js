/**
 * E1-A M5-B: independent fixed exploratory factorial of *two different*
 * periodicity mechanisms (attacker behaviour vs intensity schedule).
 * No "attack type" is passed to the policy selector.
 *
 * 64 pulsed-behaviour scenarios (6 factors) + 16 coordinated controls
 * (4 applicable factors). Non-applicable period and duty are NOT counted
 * as distinct coordinated conditions. Separate 16-cell OOD confirmation
 * uses an unseen linear/sustained intensity condition and independent seeds.
 */
import {campaignAttackSchedule} from "./adaptiveCampaignProtocol.js";
import {validateAdaptiveOptions} from "./adaptiveDecisionEngine.js";

export const E1A_PERIODIC_VERSION="e1a-periodic-correlation-factorial-1.0.0";
export const PERIODIC_FACTORS=Object.freeze({
 period:Object.freeze([8,16]),
 dutyFraction:Object.freeze([0.25,0.5]),
 laws:Object.freeze(["constant","pulsed"]),
 schedules:Object.freeze(["single","double"]),
 correlations:Object.freeze([0,0.7]),
 byzantine:Object.freeze([6,12])
});
export const PERIODIC_MODES=Object.freeze(["adaptive","risk_aware","regime_aware_discrete"]);
export const PERIODIC_RUNS=Object.freeze({smoke:2,exploratory:20,confirmatory:80});

const key=c=>c.strategy+"__"+c.law+"__"+c.schedule+
 "__f"+c.f+"__corr"+c.correlation+
 (c.strategy==="pulsed"?"__p"+c.period+"__d"+c.dutyFraction:"");

function createCell(stage,props,ordinal,seedBase){
 const id=key(props);
 return {...props,id,stage,ordinal,runs:PERIODIC_RUNS[stage],
  seed:seedBase+ordinal*4096+317};
}

export function periodicCampaignDesign(){
 const exploratory=[];
 for(const law of PERIODIC_FACTORS.laws)
  for(const schedule of PERIODIC_FACTORS.schedules)
   for(const f of PERIODIC_FACTORS.byzantine)
    for(const correlation of PERIODIC_FACTORS.correlations){
     // Control does not use period and duty; one distinct condition only.
     exploratory.push(createCell("exploratory",{
      strategy:"coordinated",law,schedule,f,correlation,
      period:null,dutyFraction:null,attackDuty:null
     },exploratory.length,1600000000));
     for(const period of PERIODIC_FACTORS.period)
      for(const dutyFraction of PERIODIC_FACTORS.dutyFraction)
       exploratory.push(createCell("exploratory",{
        strategy:"pulsed",law,schedule,f,correlation,period,dutyFraction,
        attackDuty:Math.round(period*dutyFraction)
       },exploratory.length,1600000000));
    }
 // 16 *new* joint temporal conditions: linear/sustained was not
 // used for exploratory. Fixed before inspection, not chosen post hoc.
 const confirmatory=[];
 for(const f of PERIODIC_FACTORS.byzantine)
  for(const correlation of PERIODIC_FACTORS.correlations)
   for(const period of PERIODIC_FACTORS.period)
    for(const dutyFraction of PERIODIC_FACTORS.dutyFraction)
     confirmatory.push(createCell("confirmatory",{
      strategy:"pulsed",law:"linear",schedule:"sustained",f,correlation,
      period,dutyFraction,attackDuty:Math.round(period*dutyFraction)
     },confirmatory.length,1860000000));
 const smoke=[exploratory[0],exploratory[4],exploratory[79]].map((c,i)=>({
  ...c,stage:"smoke",ordinal:i,runs:PERIODIC_RUNS.smoke,
  seed:2070000000+i*4096+317
 }));
 const all=[...exploratory,...confirmatory,...smoke];
 if(exploratory.length!==80||confirmatory.length!==16||smoke.length!==3||
  new Set(exploratory.map(c=>c.id)).size!==80||
  new Set(confirmatory.map(c=>c.id)).size!==16||
  new Set(all.map(c=>c.seed)).size!==all.length||
  all.some(c=>c.seed>2147483647||c.seed<1))
  throw Error("M5-B frozen design is invalid");
 return {
  protocol:E1A_PERIODIC_VERSION,
  plannedBeforeResults:true,
  hypothesis:"Effect of periodic attacker strategy can interact with independent pulsed intensity law and witness correlation; test separately against historical combined E1",
  primary:"mean independent-run RMSE(regime_aware_discrete) minus RMSE(proposed_robust), negative better",
  secondary:"mean RMSE(risk_aware)-RMSE(proposed_robust); RMSE(adaptive)-RMSE(proposed_robust), conditional coverage and unconditional loss",
  practicalTolerance:0.01,
  scenarios:{N:30,T:48,k:6,network:false,sybil:0,
   evidenceModel:"correlated_witnesses",strategyControl:"coordinated",
   semantics:"pulsed behaviour and pulsed temporal law are separate factors"},
  design:{exploratoryCells:80,confirmatoryCells:16,
   exploratoryRunsPerCell:20,confirmatoryRunsPerCell:80,
   exploratoryMethodSimulations:80*20*3,confirmatoryMethodSimulations:16*80*3},
  holdout:"16 preselected pulsed-behaviour conditions with NEW linear/sustained temporal profile and disjoint fresh seeds. Do not retune using prior FKL heldout or this campaign confirmation.",
  statisticalUnit:"whole seeded simulated run; repeated time ticks are not independent. Cross-cell uncertainty is not estimated by assuming arbitrary attack distribution.",
  limitations:[
   "Synthetic threats and witness correlations, not field calibrated",
   "No demonstration of whole-system stability or distributed consensus",
   "Proxy median may be manipulated by coordinated Byzantine agents",
   "Within-cell bootstrap intervals are descriptive and unadjusted for 80 cells",
   "Only 20 independent indexed runs per exploratory cell",
   "Confirmatory outcomes may not be used to retune these frozen policies"
  ],
  modes:PERIODIC_MODES,
  stages:{smoke,exploratory,confirmatory}
 };
}
export function validatePeriodicCampaignDesign(plan){
 const fixed=periodicCampaignDesign();
 if(JSON.stringify(fixed)!==JSON.stringify(plan))
  throw Error("M5-B design mutated: create separately versioned protocol");
 return plan;
}
export function periodicCellOptions(cell,mode){
 if(!PERIODIC_MODES.includes(mode))throw Error("Unknown M5-B policy mode");
 const {strategy,period,attackDuty,correlation,f,stage,law,schedule}=cell;
 if(!["coordinated","pulsed"].includes(strategy)||
  ![...PERIODIC_FACTORS.byzantine].includes(f)||
  ![...PERIODIC_FACTORS.correlations].includes(correlation)||
  !((stage==="confirmatory"&&law==="linear"&&schedule==="sustained")||
    (stage!=="confirmatory"&&PERIODIC_FACTORS.laws.includes(law)&&
     PERIODIC_FACTORS.schedules.includes(schedule)))||
  (strategy==="pulsed"&&(!PERIODIC_FACTORS.period.includes(period)||
   !PERIODIC_FACTORS.dutyFraction.includes(cell.dutyFraction)||
   attackDuty!==Math.round(period*cell.dutyFraction)))||
  (strategy==="coordinated"&&(period!==null||attackDuty!==null)))
  throw Error("Invalid M5-B factorial cell");
 const options=validateAdaptiveOptions({
  scenario:"dynamic",comparisonMode:"estimator_only",
  alphaMode:mode==="regime_aware_discrete"?"regime_aware":mode,
  regimeSelectionMode:"discrete",runs:cell.runs,
  attackStrategy:strategy,attackPeriod:period??10,attackDuty:attackDuty??4,
  coordinatedBias:2,evidenceModel:"correlated_witnesses",
  evidenceCorrelation:correlation,evidenceTolerance:0.45,
  evidenceNoiseSigma:0.025,witnessCorruption:0.8,
  trimEachSide:6,adaptiveTrim:false,trimMode:"source_first",
  gamma:1,minWeight:0.05,maxWeight:1,warmupSteps:8,
  minimumEffectiveFraction:0.75,disagreementPenalty:1.5,
  phases:campaignAttackSchedule(law,schedule),decisionRefusalPenalty:1
 });
 const config={seed:cell.seed,n_agents:30,n_byzantine:f,n_steps:48,
  attack_start_step:schedule==="sustained"?13:9,
  trim_each_side:6,network_enabled:false,n_sybil_agents:0,
  paired_exogenous_events:true};
 return {config,options};
}
