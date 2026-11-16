/**
 * E1-A scientific campaign protocol (no execution and no data-dependent design).
 * Source-locked protocol: 72 exploratory cells and 12 mechanically preselected
 * fresh-seed validation cells. Conditions never depend on observed RMSE.
 */
import {validateAttackPhases,attackIntensityAt} from "./attackProfiles.js";
import {ADAPTIVE_MODEL_VERSION,validateAdaptiveOptions} from "./adaptiveDecisionEngine.js";
import {ADAPTIVE_SCENARIO_VERSION} from "./adaptiveScenario.js";
import {ADAPTIVE_STUDY_VERSION} from "./adaptiveExperiment.js";
import {TRUST_MODEL_VERSION} from "./trustEngine.js";
import {STATISTICS_VERSION} from "./statistics2027.js";

export const E1A_CAMPAIGN_VERSION="e1a-campaign-1.0.0";
export const E1A_CAMPAIGN_LAWS=Object.freeze([
 "constant","linear","exponential","parabolic","hyperbolic","pulsed"
]);
export const E1A_CAMPAIGN_SCHEDULES=Object.freeze(["single","sustained","double"]);
export const E1A_CAMPAIGN_F=Object.freeze([3,6,9,12]);
export const E1A_CAMPAIGN_STAGES=Object.freeze({
 exploratory:30,confirmatory:100,smoke:2
});
const T=48;
const windows=Object.freeze({
 single:Object.freeze([[9,24]]),
 sustained:Object.freeze([[13,48]]),
 double:Object.freeze([[9,16],[25,32]])
});
const windowsFor=schedule=>{
 if(!Object.hasOwn(windows,schedule))throw Error("Unknown campaign schedule "+schedule);
 return windows[schedule].map(w=>[...w]);
};
export function campaignCellId(law,schedule,f){
 if(!E1A_CAMPAIGN_LAWS.includes(law)||!E1A_CAMPAIGN_SCHEDULES.includes(schedule)||
  !E1A_CAMPAIGN_F.includes(f))throw Error("Invalid E1-A factorial cell");
 return law+"__"+schedule+"__f"+f;
}
function intensityLaw(law,start){
 if(law==="constant")return {start,intensity:2,profile:"constant"};
 return {start,intensity:0.2,endIntensity:3,profile:law};
}
export function campaignAttackSchedule(law,schedule){
 if(!E1A_CAMPAIGN_LAWS.includes(law))throw Error("Unknown intensity law "+law);
 const selected=windowsFor(schedule),raw=[{start:1,intensity:0,profile:"constant"}];
 if(law==="pulsed"){
  // 2 attack ticks / 2 rest ticks, reset to attack at each window start.
  for(const [start,end] of selected){
   for(let t=start;t<=end;t+=2)raw.push({
    start:t,intensity:((t-start)/2)%2===0?2:0,profile:"constant"
   });
   if(end<T)raw.push({start:end+1,intensity:0,profile:"constant"});
  }
 }else{
  for(const [start,end] of selected){
   raw.push(intensityLaw(law,start));
   if(end<T)raw.push({start:end+1,intensity:0,profile:"constant"});
  }
 }
 // Preserve all distinct phase boundaries, reject mistakes rather than silently
 // merging a non-monotonic or overlapping schedule.
 return validateAttackPhases(raw,T);
}
export function campaignStageForStep(step,schedule,law){
 if(!Number.isInteger(step)||step<1||step>T)throw Error("Campaign step outside horizon");
 const starts=windowsFor(schedule),first=starts[0][0],last=starts.at(-1)[1];
 if(step<first)return "pre";
 if(step>last)return "recovery";
 return attackIntensityAt(step,campaignAttackSchedule(law,schedule),T)>0?"active":"intermission";
}
export function campaignDesign(){
 const discovery=[];
 for(const [lawIndex,law] of E1A_CAMPAIGN_LAWS.entries())
  for(const [scheduleIndex,schedule] of E1A_CAMPAIGN_SCHEDULES.entries())
   for(const [fIndex,f] of E1A_CAMPAIGN_F.entries()){
    const ordinal=((lawIndex*E1A_CAMPAIGN_SCHEDULES.length)+scheduleIndex)*E1A_CAMPAIGN_F.length+fIndex;
    const id=campaignCellId(law,schedule,f);
    discovery.push({
     id,law,schedule,f,ordinal,stage:"exploratory",
     runs:E1A_CAMPAIGN_STAGES.exploratory,seed:1100000000+ordinal*4096+271
    });
   }
 const confirmation=[];
 // Rule fixed by law index, not by exploratory observations:
 // two cells per law, covering all 3 schedules and several Byzantine fractions.
 // Cell A cycles f=3,6,9,12 and schedule=single,sustained,double;
 // cell B takes f=12 and the next schedule. No duplicate within a law.
 for(const [lawIndex,law] of E1A_CAMPAIGN_LAWS.entries()){
  for(const [offset,scheduleIndex] of [lawIndex%3,(lawIndex+1)%3].entries()){
   const schedule=E1A_CAMPAIGN_SCHEDULES[scheduleIndex];
   const f=offset===0?E1A_CAMPAIGN_F[lawIndex%4]:12;
   const ordinal=confirmation.length;
   confirmation.push({
    id:campaignCellId(law,schedule,f),law,schedule,f,ordinal,
    stage:"confirmatory",runs:E1A_CAMPAIGN_STAGES.confirmatory,
    seed:1800000000+ordinal*4096+947
   });
  }
 }
 const smokeIndices=[0,38,71];
 const smoke=smokeIndices.map((index,ordinal)=>({
  ...discovery[index],stage:"smoke",runs:E1A_CAMPAIGN_STAGES.smoke,
  seed:2000000000+ordinal*4096+117,ordinal
 }));
 const design={
  protocol:E1A_CAMPAIGN_VERSION,
  frozenBefore:"No estimator parameters are selected or tuned from this campaign's results",
  hypotheses:{
   primary:"mean run-level RMSE(adaptive_robust) - RMSE(trimmed_unweighted), lower is better",
   decision:"Preselected tolerance for practical importance is abs(delta RMSE)>=0.01; report confidence intervals independently of this threshold.",
   confirmatory:"twelve fixed cells; same two estimators, newly keyed independent random streams; Holm controls the family of 12 sign-flip tests under sign exchangeability",
   caution:"Selection uses a deterministic factorial rule, not the new discovery results; normal/bootstrap intervals are not multiplicity-adjusted."
  },
  design:{N:30,T,trimEachSide:6,fValues:E1A_CAMPAIGN_F,
   intensityLaws:E1A_CAMPAIGN_LAWS,temporalSchedules:E1A_CAMPAIGN_SCHEDULES,
   totalExploratory:72,totalConfirmatory:12,
   RExploratory:E1A_CAMPAIGN_STAGES.exploratory,
   RConfirmatory:E1A_CAMPAIGN_STAGES.confirmatory},
  algorithms:{base:TRUST_MODEL_VERSION,adaptive:ADAPTIVE_MODEL_VERSION,
   study:ADAPTIVE_STUDY_VERSION,scenario:ADAPTIVE_SCENARIO_VERSION,statistics:STATISTICS_VERSION},
  randomization:"Different signed-32-bit base seeds for stages and factorial cells; per-run index seeded in E1 with keyed exogenous events, shared across competing estimators.",
  evidence:"legacy E1 trust evidence, estimator_only, unrestricted communication, no Sybil, same base trust and isolation across methods",
  limitations:[
   "Synthetic static ground truth, not real adversarial operational traces.",
   "Paired sign-flip requires sign exchangeability; common seeds do not guarantee it.",
   "Fixed 12-cell coverage only; cannot generalize to all possible attacks.",
   "No formal multivariate IMAS stability proof; scalar auxiliary ISS only."
  ],
  cells:{exploratory:discovery,confirmatory:confirmation,smoke}
 };
 if(discovery.length!==72||confirmation.length!==12||
  new Set(confirmation.map(x=>x.id)).size!==12||
  new Set([...discovery,...confirmation,...smoke].map(x=>x.seed)).size!==87)
  throw Error("E1-A protocol design invalid");
 return design;
}
export function campaignConfiguration(cell){
 if(!cell||!E1A_CAMPAIGN_LAWS.includes(cell.law))throw Error("Invalid campaign cell");
 const phases=campaignAttackSchedule(cell.law,cell.schedule);
 const config={seed:cell.seed,n_agents:30,n_byzantine:cell.f,n_steps:T,
  attack_start_step:9,trim_each_side:6,network_enabled:false,
  paired_exogenous_events:true,n_sybil_agents:0};
 const options=validateAdaptiveOptions({
  scenario:"dynamic",comparisonMode:"estimator_only",phases,runs:cell.runs,
  attackStrategy:"legacy",evidenceModel:"legacy",
  alphaMode:"adaptive",trimMode:"source_first",adaptiveTrim:false,
  trimEachSide:6,gamma:1,minWeight:0.05,maxWeight:1,warmupSteps:8,
  minimumEffectiveFraction:0.75,disagreementPenalty:1.5,
  feedbackGain:0.5,feedbackInitialError:1
 });
 return {config,options};
}
export function validateCampaignDesign(design){
 if(!design||design.protocol!==E1A_CAMPAIGN_VERSION)throw Error("Campaign protocol version mismatch");
 const fixed=campaignDesign();
 for(const phase of ["exploratory","confirmatory","smoke"]){
  const expected=fixed.cells[phase],found=design.cells?.[phase];
  if(!Array.isArray(found)||JSON.stringify(found)!==JSON.stringify(expected))
   throw Error("Tampered or non-preregistered campaign design: "+phase);
 }
 if(JSON.stringify(design.algorithms)!==JSON.stringify(fixed.algorithms)||
  JSON.stringify(design.hypotheses)!==JSON.stringify(fixed.hypotheses))
  throw Error("Campaign cannot continue under different algorithms or hypotheses");
 return design;
}
