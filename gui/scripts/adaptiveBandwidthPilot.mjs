#!/usr/bin/env node
/**
 * E1-A exploratory paired policy pilot. Factorial:
 * complete/ring x partition yes/no x C=24/64 x static/opportunistic.
 *
 * The same seed and run index are used across POLICY pairs.
 * The resulting delivered events are not identical because capacity changes;
 * exogenous draws are keyed by initial seed/run. This is a causal simulator
 * intervention, NOT a calibrated field network, nor a fully blind test.
 */
import {mkdirSync,writeFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {runAdaptiveStudy} from "../src/adaptiveExperiment.js";
const dir=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../adaptive-results");
mkdirSync(dir,{recursive:true});
const cells=[],rows=[],details=[],R=3,N=14,T=28;
for(const topology of ["complete","ring"])
 for(const partition of [false,true])
  for(const capacity of [24,64])
   for(const policy of ["static","opportunistic"])
    cells.push({topology,partition,capacity,policy});
for(const [index,c] of cells.entries()){
 const seed=930211+(c.topology==="ring"?103:0)+(c.partition?13:0);
 const core={seed,n_agents:N,n_byzantine:3,n_steps:T,trim_each_side:3,
  attack_start_step:4,network_enabled:true,network_topology:c.topology,
  partition_enabled:c.partition,partition_start_step:10,partition_end_step:19,
  partition_fraction:.43,message_loss_probability:.02,
  message_delay_min_steps:0,message_delay_max_steps:1,
  bandwidth_messages_per_step:c.capacity};
 const opt={runs:R,scenario:"static_bias",comparisonMode:"network_routed",
  alphaMode:"risk_aware",attackStrategy:"coordinated",
  evidenceModel:"behavior_linked",decisionOriginAgent:0,
  decisionDelaySteps:1,decisionLossProbability:.05,
  decisionMaxStalenessSteps:6,decisionBandwidthFraction:.3,
  decisionBandwidthPolicy:c.policy,witnessCorruption:.6};
 const study=runAdaptiveStudy(core,opt);
 if(study.completedRuns!==R||study.partial)throw Error("Scheduling incomplete cell "+index);
 const byRun=[],counts={e1:0,hops:0,capacity:0,borrowed:0,released:0,informed:0};
 for(const run of study.runs){
  const chan=run.scenarioDiagnosticsByMethod.adaptive_robust.decisionChannel;
  if(chan.bandwidthPolicy!==c.policy||chan.history.length!==T)
   throw Error("Scheduling missing exact policy provenance");
  for(const [method,diag] of Object.entries(run.scenarioDiagnosticsByMethod)){
   const d=diag.decisionChannel;
   if(d.attempted!==d.delivered+d.lost+d.blocked+d.expired+d.pending)
    throw Error("Scheduling packet conservation "+method);
   if(d.history.some(h=>h.sharedUsed>h.sharedCapacity||
    h.e1Used>h.availableForE1||h.sharedUnused!==h.sharedCapacity-h.sharedUsed||
    (c.policy==="static"&&h.routingHopsThisStep>h.reserved)))
    throw Error("Scheduling shared capacity violation "+method);
  }
  for(const h of chan.history){
   counts.e1+=h.e1Used;counts.hops+=h.routingHopsThisStep;
   counts.capacity+=h.sharedCapacity;counts.borrowed+=h.borrowedFromE1;
   counts.released+=h.releasedToE1;counts.informed+=h.informed;
  }
  const metric=run.metrics.find(m=>m.method==="adaptive_robust");
  byRun.push({run:run.run,rmse:metric.rmse,coverage:metric.decision_coverage});
 }
 const primary=study.summary.find(x=>x.method==="adaptive_robust");
 const baseline=study.summary.find(x=>x.method==="proposed_robust");
 const row={
  cell:index+1,topology:c.topology,partition:Number(c.partition),
  capacity:c.capacity,policy:c.policy,seed,R,N,T,
  rmseRisk:primary.rmse.mean,rmseCombined:baseline.rmse.mean,
  deltaRiskCombined:primary.rmse.mean-baseline.rmse.mean,
  decisionCoverage:counts.informed/(N*T*R),
  totalUtilization:(counts.e1+counts.hops)/counts.capacity,
  e1Utilization:counts.e1/counts.capacity,
  routedUtilization:counts.hops/counts.capacity,
  releasedToE1:counts.released,borrowedByRouting:counts.borrowed
 };
 rows.push(row);details.push({row,core,opt,byRun,summary:study.summary,
  perRunChannel:study.runs.map(r=>r.scenarioDiagnosticsByMethod.adaptive_robust.decisionChannel)});
 console.log("E1-A SCHEDULER CELL "+JSON.stringify({cell:index+1,
  policy:c.policy,topology:c.topology,partition:c.partition,capacity:c.capacity,
  rmse:+row.rmseRisk.toFixed(5),coverage:+row.decisionCoverage.toFixed(4),
  utilization:+row.totalUtilization.toFixed(4)}));
}
const comparison=[];
for(let k=0;k<cells.length;k+=2){
 const fixed=rows[k],flex=rows[k+1];
 if(fixed.topology!==flex.topology||fixed.partition!==flex.partition||
  fixed.capacity!==flex.capacity||fixed.seed!==flex.seed)
  throw Error("Scheduling paired conditions changed");
 comparison.push({
  topology:fixed.topology,partition:fixed.partition,capacity:fixed.capacity,
  deltaCoverage:flex.decisionCoverage-fixed.decisionCoverage,
  deltaRmse:flex.rmseRisk-fixed.rmseRisk,
  deltaUtilization:flex.totalUtilization-fixed.totalUtilization,
  fixedRmse:fixed.rmseRisk,opportunisticRmse:flex.rmseRisk
 });
}
const keys=Object.keys(rows[0]);const csv=[keys.join(";"),
 ...rows.map(r=>keys.map(k=>r[k]??"").join(";"))].join("\n")+"\n";
writeFileSync(path.join(dir,"adaptive-scheduler-pilot.csv"),csv);
writeFileSync(path.join(dir,"adaptive-scheduler-pilot.json"),
 JSON.stringify({study:"E1-A sequential bidirectional bandwidth borrowing",
  status:"Exploratory work-conserving scheduler; not a claim of optimality",
  design:{N,T,R,conditions:16,pairedPolicyComparisons:8,
   warning:"Paired exogenous seed, but different admission outcomes and method-specific trust feedback"},
  rows,comparison,details},null,2)+"\n");
const avg=(rows,key)=>rows.reduce((a,r)=>a+r[key],0)/rows.length;
const staticRows=rows.filter(r=>r.policy==="static");
const flexibleRows=rows.filter(r=>r.policy==="opportunistic");
console.log("E1-A SCHEDULER SUMMARY "+JSON.stringify({
 cells:rows.length,methodRuns:rows.length*R*5,
 fixedMeanCoverage:avg(staticRows,"decisionCoverage"),
 dynamicMeanCoverage:avg(flexibleRows,"decisionCoverage"),
 fixedMeanRmse:avg(staticRows,"rmseRisk"),
 dynamicMeanRmse:avg(flexibleRows,"rmseRisk"),
 fixedMeanUtilization:avg(staticRows,"totalUtilization"),
 dynamicMeanUtilization:avg(flexibleRows,"totalUtilization"),
 meanPairedRmseDifference:avg(comparison,"deltaRmse"),
 meanPairedCoverageDifference:avg(comparison,"deltaCoverage"),
 warning:"synthetic internal experiment; only 3 seeds per cell"
}));
