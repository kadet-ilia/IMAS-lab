#!/usr/bin/env node
/**
 * Predeclared synthetic E1-A pilot of directed local quarantine with
 * hysteretic recovery. All conditions paired by (topology,partition,C,seed).
 * 2 topologies x 2 partition statuses x 2 capacities x 2 guards; R=3.
 * NOT a deployment suitability or Byzantine-consensus claim.
 */
import {mkdirSync,writeFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {runAdaptiveStudy} from "../src/adaptiveExperiment.js";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../adaptive-results");
mkdirSync(root,{recursive:true});
const cells=[],rows=[],details=[],N=12,T=24,R=3;
for(const topology of ["complete","ring"])
 for(const partition of [false,true])
  for(const capacity of [24,72])
   for(const guard of [false,true])cells.push({topology,partition,capacity,guard});
const mean=x=>{const a=x.filter(Number.isFinite);return a.length?
 a.reduce((s,v)=>s+v,0)/a.length:null;};
for(const [index,cell] of cells.entries()){
 const seed=730109+(cell.topology==="ring"?109:0)+
  (cell.partition?19:0)+(cell.capacity===72?7:0);
 const core={seed,n_agents:N,n_byzantine:2,n_steps:T,
  trim_each_side:2,attack_start_step:4,network_enabled:true,
  network_topology:cell.topology,partition_enabled:cell.partition,
  partition_start_step:8,partition_end_step:17,partition_fraction:.4,
  bandwidth_messages_per_step:cell.capacity,
  message_delay_min_steps:0,message_delay_max_steps:1,
  message_loss_probability:.03};
 const options={runs:R,scenario:"static_bias",
  comparisonMode:"network_routed",alphaMode:"risk_aware",
  attackStrategy:"coordinated",evidenceModel:"behavior_linked",
  decisionBandwidthPolicy:"local_floor",
  decisionBandwidthFraction:.25,localTransportBandwidthFraction:.25,
  localConsensusPilot:true,localConsensusTrim:0,
  localConsensusRelaxation:.75,localTransportEnabled:true,
  localTransportDelaySteps:1,localTransportLossProbability:.05,
  localTransportMaxAgeSteps:5,localAutonomyEnabled:true,
  localAutonomyMinNeighbors:1,localAutonomyEvidenceTolerance:.3,
  localAutonomyDecay:.95,
  localAutonomyGuardEnabled:cell.guard,
  localAutonomyGuardThreshold:.45,localAutonomyGuardHysteresis:.1,
  localAutonomyGuardMinEvidence:2};
 const study=runAdaptiveStudy(core,options);
 if(study.partial||study.completedRuns!==R)
  throw Error("Incomplete guard pilot cell "+(index+1));
 const individual=[];
 for(const run of study.runs){
  const m=run.metrics.find(x=>x.method==="adaptive_robust");
  for(const diag of Object.values(run.scenarioDiagnosticsByMethod)){
   const local=diag.localTransport;
   if(local.generated!==local.delivered+local.lost+local.blocked+
    local.expired+local.superseded+local.pending||
    local.history.some(h=>h.totalUsed>h.sharedCapacity||
     h.autonomousExcluded<0||h.autonomousHonestExcluded>h.autonomousExcluded))
    throw Error("Local guard violates packet conservation or posthoc strata");
  }
  individual.push({run:run.run,centralRmse:m.rmse,
   honestRmse:m.mean_local_autonomous_honest_rmse,
   honestCoverage:m.mean_local_autonomous_honest_coverage,
   honestUnconditionalLoss:m.mean_local_autonomous_honest_unconditional_loss,
   honestAcceptedSquaredContribution:m.mean_local_autonomous_honest_accepted_squared_contribution,
   allCoverage:m.mean_local_autonomous_coverage,
   exclusions:m.mean_local_autonomous_guard_exclusions,
   honestExclusions:m.mean_local_autonomous_guard_honest_exclusions,
   activations:m.mean_local_autonomous_guard_activations});
 }
 const row={index:index+1,...cell,seed,N,T,R,
  centralRmse:mean(individual.map(r=>r.centralRmse)),
  honestRmse:mean(individual.map(r=>r.honestRmse)),
  honestCoverage:mean(individual.map(r=>r.honestCoverage)),
  honestUnconditionalLoss:mean(individual.map(r=>r.honestUnconditionalLoss)),
  honestAcceptedSquaredContribution:mean(individual.map(r=>r.honestAcceptedSquaredContribution)),
  allCoverage:mean(individual.map(r=>r.allCoverage)),
  exclusions:mean(individual.map(r=>r.exclusions)),
  honestExclusions:mean(individual.map(r=>r.honestExclusions)),
  activations:mean(individual.map(r=>r.activations))};
 rows.push(row);details.push({row,core,options,individual});
 console.log("E1-A LOCAL GUARD CELL "+JSON.stringify(row));
}
const paired=[];
for(let i=0;i<rows.length;i+=2){
 const off=rows[i],on=rows[i+1];
 if(off.guard||!on.guard||off.seed!==on.seed)
  throw Error("Guard policies not paired");
 if(Math.abs(off.centralRmse-on.centralRmse)>1e-12)
  throw Error("Guard changed central E1 solution");
 paired.push({topology:on.topology,partition:on.partition,
  capacity:on.capacity,deltaHonestRmse:on.honestRmse-off.honestRmse,
  deltaHonestCoverage:on.honestCoverage-off.honestCoverage,
  deltaHonestUnconditionalLoss:on.honestUnconditionalLoss-off.honestUnconditionalLoss,
  sensitivity:[0,.25,1,4].map(penalty=>({
   penalty,deltaLoss:on.honestAcceptedSquaredContribution-
    off.honestAcceptedSquaredContribution+
    penalty*(off.honestCoverage-on.honestCoverage)
  })),
  excluded:on.exclusions,honestExcluded:on.honestExclusions,
  activations:on.activations});
}
const cols=Object.keys(rows[0]);
writeFileSync(path.join(root,"adaptive-local-guard-pilot.csv"),
 [cols.join(";"),...rows.map(row=>cols.map(k=>row[k]??"").join(";"))].join("\n")+"\n");
writeFileSync(path.join(root,"adaptive-local-guard-pilot.json"),
 JSON.stringify({version:"e1a-local-directed-guard-shadow-1.0.0",
  scientificStatus:"exploratory synthetic only (R=3), NOT a defence guarantee",
  design:{N,T,R,cells:rows.length,methods:5,
   controls:"topology,partition,C and common exogenous seed"},
  rows,paired,details},null,2)+"\n");
console.log("E1-A LOCAL GUARD SUMMARY "+JSON.stringify({
 cells:rows.length,methodRuns:rows.length*R*5,
 meanDeltaHonestRmse:mean(paired.map(p=>p.deltaHonestRmse)),
 meanDeltaHonestCoverage:mean(paired.map(p=>p.deltaHonestCoverage)),
 meanDeltaHonestUnconditionalLoss:mean(paired.map(p=>p.deltaHonestUnconditionalLoss)),
 meanExcluded:mean(paired.map(p=>p.excluded)),
 meanHonestExcluded:mean(paired.map(p=>p.honestExcluded)),
 status:"Exploratory; no validated Byzantine or field safety claims"}));
