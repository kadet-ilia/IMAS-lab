#!/usr/bin/env node
/**
 * E1-A routed decision-feedback exploratory factorial:
 * topology (complete/ring) x partition (off/on) x shared message capacity
 * (30/90) x strict reserved decision fraction (0.15/0.40).
 *
 * The first-stage test asserts the packet and capacity invariants per tick,
 * and exports raw cell/run diagnostics. It is not scientific confirmation.
 */
import {mkdirSync,writeFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {runAdaptiveStudy} from "../src/adaptiveExperiment.js";
import {E1A_ROUTED_CHANNEL_VERSION} from "../src/adaptiveRoutedDecisionChannel.js";
const dir=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../adaptive-results");
mkdirSync(dir,{recursive:true});
const design=[];
for(const topology of ["complete","ring"])
 for(const partition of [false,true])
  for(const capacity of [30,90])
   for(const reservation of [0.15,0.4])
    design.push({topology,partition,capacity,reservation});
const N=16,T=30,R=3,rows=[],details=[];
for(const [index,p] of design.entries()){
 const config={seed:840381+(p.topology==="ring"?100:0)+(p.partition?10:0),
  n_agents:N,n_byzantine:4,n_steps:T,trim_each_side:3,
  attack_start_step:4,network_enabled:true,network_topology:p.topology,
  partition_enabled:p.partition,partition_start_step:11,
  partition_end_step:21,partition_fraction:.375,
  message_loss_probability:.02,message_delay_min_steps:0,
  message_delay_max_steps:1,bandwidth_messages_per_step:p.capacity};
 const options={runs:R,scenario:"static_bias",comparisonMode:"network_routed",
  alphaMode:"risk_aware",attackStrategy:"coordinated",
  evidenceModel:"behavior_linked",decisionOriginAgent:0,
  decisionDelaySteps:1,decisionLossProbability:.05,
  decisionMaxStalenessSteps:6,decisionBandwidthFraction:p.reservation,
  witnessCorruption:.6,evidenceNoiseSigma:.02};
 const result=runAdaptiveStudy(config,options);
 if(result.partial||result.completedRuns!==R||result.models.routedDecisionChannel!==E1A_ROUTED_CHANNEL_VERSION)
  throw Error("Incomplete routed study cell "+(index+1));
 let totalInformed=0,totalSlots=0,totalCapacity=0,totalHops=0,totalE1=0;
 let totalAttempts=0,totalDelivered=0,totalLost=0,totalBlocked=0,totalExpired=0,totalPending=0;
 for(const run of result.runs){
  for(const [method,diag] of Object.entries(run.scenarioDiagnosticsByMethod)){
   const d=diag.decisionChannel;
   if(d?.modelVersion!==E1A_ROUTED_CHANNEL_VERSION||d.history.length!==T)
    throw Error("Missing routed channel trace for "+method);
   if(d.attempted!==d.delivered+d.lost+d.blocked+d.expired+d.pending)
    throw Error("Routed packet balance failed for "+method);
   if(d.history.some(h=>h.sharedUsed>h.sharedCapacity||
    h.routingHopsThisStep>h.reserved||h.e1Used>h.availableForE1))
    throw Error("Routed shared budget violated by "+method);
  }
  const d=run.scenarioDiagnosticsByMethod.adaptive_robust.decisionChannel;
  totalAttempts+=d.attempted;totalDelivered+=d.delivered;totalLost+=d.lost;
  totalBlocked+=d.blocked;totalExpired+=d.expired;totalPending+=d.pending;
  for(const h of d.history){
   totalInformed+=h.informed;totalSlots+=h.sharedUsed;totalCapacity+=h.sharedCapacity;
   totalHops+=h.routingHopsThisStep;totalE1+=h.e1Used;
  }
 }
 const pick=id=>result.summary.find(x=>x.method===id);
 const primary=pick("adaptive_robust"),original=pick("proposed_robust");
 const row={
  cell:index+1,topology:p.topology,partition:p.partition?1:0,
  capacity:p.capacity,reservation:p.reservation,R,N,T,seed:config.seed,
  rmseRisk:primary.rmse.mean,rmseOriginal:original.rmse.mean,
  deltaRmseRiskOriginal:primary.rmse.mean-original.rmse.mean,
  meanReferenceCoverageAllNodes:totalInformed/(N*T*R),
  sharedUtilization:totalSlots/totalCapacity,
  e1Usage:totalE1/totalCapacity,
  decisionHopUsage:totalHops/totalCapacity,
  attempted:totalAttempts,delivered:totalDelivered,
  lost:totalLost,blocked:totalBlocked,expired:totalExpired,pending:totalPending
 };
 rows.push(row);
 details.push({row,config,options,models:result.models,
  results:result.summary,
  runs:result.runs.map(r=>({
   index:r.run,metrics:r.metrics,
   scenarioDiagnosticsByMethod:r.scenarioDiagnosticsByMethod
  }))});
 console.log("E1-A ROUTED PILOT "+JSON.stringify({cell:index+1,total:design.length,
  topology:p.topology,partition:p.partition,capacity:p.capacity,
  reservation:p.reservation,coverage:+row.meanReferenceCoverageAllNodes.toFixed(4),
  usage:+row.sharedUtilization.toFixed(4),rmse:+row.rmseRisk.toFixed(6)}));
}
const keys=Object.keys(rows[0]);
writeFileSync(path.join(dir,"adaptive-routed-pilot.csv"),
 keys.join(";")+"\n"+rows.map(r=>keys.map(k=>r[k]).join(";")).join("\n")+"\n");
writeFileSync(path.join(dir,"adaptive-routed-pilot.json"),JSON.stringify({
 study:"E1-A routed hop-by-hop feedback with strict shared E1 bandwidth",
 status:"Exploratory implementation pilot; no external calibration",
 design:{N,T,R,cells:16,topology:["complete","ring"],partition:[false,true],
  capacity:[30,90],decisionBandwidthFraction:[.15,.4],
  caveat:"Each unicast hop uses one message slot; static E1/reserved split is not work-conserving; no decentralized computation or per-link parallel capacities"},
 rows,details
},null,2)+"\n");
const average=key=>rows.reduce((s,r)=>s+r[key],0)/rows.length;
console.log("E1-A ROUTED PILOT SUMMARY "+JSON.stringify({
 cells:rows.length,runs:rows.length*R,
 meanCoverageAllNodes:average("meanReferenceCoverageAllNodes"),
 meanSharedUtilization:average("sharedUtilization"),
 meanDeltaRiskOriginal:average("deltaRmseRiskOriginal"),
 verdict:"synthetic, exploratory, not a proof of IMAS stability"
}));
