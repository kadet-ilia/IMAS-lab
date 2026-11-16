#!/usr/bin/env node
/**
 * E1-A exploratory local autonomous trust pilot (NOT a confirmatory study).
 * Full pairing: ring/complete x split/no-split x C=24/72 x shadow disabled/enabled.
 * Each policy arm uses the SAME exogenous seed/run-index, while the neighbor
 * values and trust updates differ by opt-in autonomous behavior.
 */
import {mkdirSync,writeFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {runAdaptiveStudy} from "../src/adaptiveExperiment.js";
const output=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../adaptive-results");
mkdirSync(output,{recursive:true});
const N=12,T=20,R=3,cells=[],rows=[],details=[];
for(const topology of ["complete","ring"])
 for(const partition of [false,true])
  for(const capacity of [24,72])
   for(const autonomy of [false,true])
    cells.push({topology,partition,capacity,autonomy});
const mean=a=>a.reduce((sum,x)=>sum+x,0)/a.length;
for(const [i,cell] of cells.entries()){
 const seed=821019+(cell.topology==="ring"?101:0)+(cell.partition?17:0)+(cell.capacity===72?5:0);
 const core={seed,n_agents:N,n_byzantine:2,n_steps:T,trim_each_side:2,
  attack_start_step:4,network_enabled:true,network_topology:cell.topology,
  partition_enabled:cell.partition,partition_start_step:8,partition_end_step:14,
  partition_fraction:.42,bandwidth_messages_per_step:cell.capacity,
  message_delay_min_steps:0,message_delay_max_steps:1,
  message_loss_probability:.03};
 const options={runs:R,scenario:"static_bias",alphaMode:"risk_aware",
  attackStrategy:"coordinated",evidenceModel:"behavior_linked",
  comparisonMode:"network_routed",decisionOriginAgent:0,
  decisionBandwidthPolicy:"local_floor",decisionBandwidthFraction:.25,
  localTransportBandwidthFraction:.25,
  localConsensusPilot:true,localConsensusTrim:0,localConsensusRelaxation:.75,
  localTransportEnabled:true,localTransportDelaySteps:1,
  localTransportLossProbability:.05,localTransportMaxAgeSteps:5,
  localAutonomyEnabled:cell.autonomy,localAutonomyMinNeighbors:1,
  localAutonomyEvidenceTolerance:.45,localAutonomyDecay:.95};
 const result=runAdaptiveStudy(core,options);
 if(result.partial||result.completedRuns!==R)throw Error("Incomplete local autonomy cell "+i);
 const individual=[];
 for(const run of result.runs){
  const m=run.metrics.find(v=>v.method==="adaptive_robust");
  const chan=run.scenarioDiagnosticsByMethod.adaptive_robust.localTransport;
  if(!chan||chan.history.length!==T||
   chan.generated!==chan.delivered+chan.lost+chan.blocked+chan.expired+
    chan.superseded+chan.pending||!chan.history.every(h=>
     h.totalUsed<=h.sharedCapacity&&h.totalUsed===h.E1Used+h.decisionUsed+h.localUsed))
   throw Error("Causal packet/bandwidth invariant violated");
  if(cell.autonomy&&(!chan.autonomy||!chan.history.every(h=>
   h.autonomousDecisions?.length===N&&
   h.autonomousDecisions.every(v=>v===null||v>=-2&&v<=2))))
   throw Error("Local autonomy shadow incomplete or unsafe");
  if(!cell.autonomy&&chan.autonomy)throw Error("Disabled pilot unexpectedly active");
  individual.push({run:run.run,centralRmse:m.rmse,
   autonomousRmse:m.mean_local_autonomous_rmse,
   autonomousCoverage:m.mean_local_autonomous_coverage,
   honestRmse:m.mean_local_autonomous_honest_rmse,
   honestCoverage:m.mean_local_autonomous_honest_coverage,
   trustUpdates:m.mean_local_autonomous_trust_updates});
 }
 const row={cell:i+1,...cell,seed,N,T,R,
  centralRmse:mean(individual.map(x=>x.centralRmse)),
  autonomousRmse:cell.autonomy?mean(individual.map(x=>x.autonomousRmse)):null,
  autonomousCoverage:cell.autonomy?mean(individual.map(x=>x.autonomousCoverage)):null,
  honestRmse:cell.autonomy?mean(individual.map(x=>x.honestRmse)):null,
  honestCoverage:cell.autonomy?mean(individual.map(x=>x.honestCoverage)):null,
  trustUpdates:cell.autonomy?mean(individual.map(x=>x.trustUpdates)):null};
 rows.push(row);details.push({row,core,options,individual});
 console.log("E1-A AUTONOMY PILOT CELL "+JSON.stringify(row));
}
const comparisons=[];
for(let i=0;i<rows.length;i+=2){
 const off=rows[i],on=rows[i+1];
 if(off.autonomy||!on.autonomy||off.seed!==on.seed)
  throw Error("Unmatched local autonomy comparison");
 // Central E1 remains CONTROL; using local shadow must not change central E1.
 if(Math.abs(off.centralRmse-on.centralRmse)>1e-12)
  throw Error("Autonomous local shadow changed original E1 collective estimator");
 comparisons.push({topology:on.topology,partition:on.partition,capacity:on.capacity,
  centralRmseDifference:on.centralRmse-off.centralRmse,
  autonomousRmse:on.autonomousRmse,autonomousCoverage:on.autonomousCoverage,
  honestRmse:on.honestRmse,honestCoverage:on.honestCoverage,
  directedTrustUpdates:on.trustUpdates});
}
const keys=Object.keys(rows[0]);
writeFileSync(path.join(output,"adaptive-local-autonomy-pilot.csv"),
 [keys.join(";"),...rows.map(r=>keys.map(k=>r[k]??"").join(";"))].join("\n")+"\n");
writeFileSync(path.join(output,"adaptive-local-autonomy-pilot.json"),
 JSON.stringify({model:"independent-directed-soft-beta-local-estimate-shadow",
  study:"exploratory synthetic paired pilot; no decentralised closed-loop claims",
  design:{N,T,R,cells:rows.length,policies:["disabled","enabled"],
   warning:"Three seeds per cell; no power analysis, field calibration or confirmatory inference"},
  rows,comparisons,details},null,2)+"\n");
console.log("E1-A AUTONOMY PILOT SUMMARY "+JSON.stringify({
 cells:rows.length,methodExecutions:rows.length*R*5,
 meanAutonomousCoverage:mean(comparisons.map(x=>x.autonomousCoverage)),
 meanAutonomousRmse:mean(comparisons.map(x=>x.autonomousRmse)),
 meanHonestRmse:mean(comparisons.map(x=>x.honestRmse)),
 meanHonestCoverage:mean(comparisons.map(x=>x.honestCoverage)),
 meanTrustUpdates:mean(comparisons.map(x=>x.directedTrustUpdates)),
 centralRmseUnaffected:comparisons.every(x=>x.centralRmseDifference===0),
 status:"synthetic exploratory shadow only"}));
