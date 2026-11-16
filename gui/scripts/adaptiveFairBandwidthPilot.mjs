#!/usr/bin/env node
/**
 * E1-A predeclared EXPLORATORY shared-bandwidth comparison.
 * 2 topologies x 2 partition modes x 2 capacities x 3 policies, R=3.
 * The seed and run index are matched across policy arms; transmission outcomes
 * are intentionally NOT identical when allocation changes.
 * No claims of statistical significance, field validity or optimality.
 */
import {mkdirSync,writeFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {runAdaptiveStudy} from "../src/adaptiveExperiment.js";

const output=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../adaptive-results");
mkdirSync(output,{recursive:true});
const R=3,N=12,T=24;
const policies=["static","opportunistic","local_floor"];
const cells=[],records=[],raw=[];
for(const topology of ["complete","ring"])
 for(const partition of [false,true])
  for(const capacity of [20,50])
   for(const policy of policies)cells.push({topology,partition,capacity,policy});
const finite=Number.isFinite;
const mean=values=>{const valid=values.filter(finite);return valid.length?
 valid.reduce((s,x)=>s+x,0)/valid.length:null;};
for(const [idx,c] of cells.entries()){
 const seed=114829+(c.topology==="ring"?137:0)+(c.partition?17:0)+(c.capacity===50?7:0);
 const core={seed,n_agents:N,n_byzantine:2,n_steps:T,trim_each_side:2,
  attack_start_step:4,network_enabled:true,network_topology:c.topology,
  partition_enabled:c.partition,partition_start_step:8,partition_end_step:17,
  partition_fraction:.4,message_loss_probability:.02,
  message_delay_min_steps:0,message_delay_max_steps:1,
  bandwidth_messages_per_step:c.capacity};
 const opts={runs:R,scenario:"static_bias",comparisonMode:"network_routed",
  alphaMode:"risk_aware",attackStrategy:"coordinated",
  evidenceModel:"behavior_linked",decisionOriginAgent:0,
  decisionDelaySteps:1,decisionLossProbability:.05,
  decisionMaxStalenessSteps:6,decisionBandwidthFraction:.3,
  localTransportBandwidthFraction:.2,decisionBandwidthPolicy:c.policy,
  localConsensusPilot:true,localConsensusRounds:2,localConsensusTrim:0,
  localTransportEnabled:true,localTransportDelaySteps:1,
  localTransportLossProbability:.1,localTransportMaxAgeSteps:4};
 const study=runAdaptiveStudy(core,opts);
 if(study.partial||study.completedRuns!==R)throw Error("Incomplete cell "+idx);
 const sample=[],totals={used:0,capacity:0,routed:0,local:0,
  reservedLocal:0,e1:0,informed:0,readings:0,generated:0,delivered:0};
 for(const run of study.runs){
  for(const [method,diag] of Object.entries(run.scenarioDiagnosticsByMethod)){
   const route=diag.decisionChannel,local=diag.localTransport;
   if(!route||!local||route.bandwidthPolicy!==c.policy||
    route.history.length!==T||local.history.length!==T)
    throw Error("Missing matched provenance "+method);
   if(route.attempted!==route.delivered+route.lost+route.blocked+
    route.expired+route.pending||
    local.generated!==local.delivered+local.lost+local.blocked+
    local.expired+local.superseded+local.pending)
    throw Error("Packet conservation failed "+method);
   for(let t=0;t<T;t++){
    const d=route.history[t],l=local.history[t];
    if(l.totalUsed>c.capacity||l.totalUsed!==l.E1Used+l.decisionUsed+l.localUsed||
     l.localReserved!==d.localReserved||
     l.E1Used>c.capacity-d.reserved||
     (c.policy!=="opportunistic"&&d.routingHopsThisStep>d.decisionReserved)||
     (c.policy==="local_floor"&&l.localUsed<l.localReserved))
     throw Error("Shared budget/floor violated "+method+" step "+(t+1));
   }
  }
  const route=run.scenarioDiagnosticsByMethod.adaptive_robust.decisionChannel;
  const local=run.scenarioDiagnosticsByMethod.adaptive_robust.localTransport;
  for(let t=0;t<T;t++){
   const d=route.history[t],l=local.history[t];
   totals.used+=l.totalUsed;totals.capacity+=c.capacity;
   totals.e1+=l.E1Used;totals.routed+=l.decisionUsed;
   totals.local+=l.localUsed;totals.reservedLocal+=l.localReserved;
   totals.informed+=d.informed;totals.readings+=l.neighborReadingsThisStep;
  }
  totals.generated+=local.generated;totals.delivered+=local.delivered;
  const primary=run.metrics.find(m=>m.method==="adaptive_robust");
  sample.push({run:run.run,rmse:primary.rmse,
   decisionCoverage:primary.decision_coverage,
   utilization:local.history.reduce((sum,h)=>sum+h.totalUsed,0)/(T*c.capacity),
   localTransmissions:local.transmitted,deliveredLocal:local.delivered,
   localPending:local.pending});
 }
 const row={cell:idx+1,topology:c.topology,partition:Number(c.partition),
  capacity:c.capacity,policy:c.policy,seed,N,T,R,
  rmse:mean(sample.map(x=>x.rmse)),
  decisionCoverage:totals.informed/(N*T*R),
  resourceUtilization:totals.used/totals.capacity,
  shareE1:totals.e1/totals.capacity,
  shareDecisions:totals.routed/totals.capacity,
  shareLocal:totals.local/totals.capacity,
  localGuaranteedSlots:totals.reservedLocal,
  meanNeighborReadings:totals.readings/(T*R),
  observedLocalDeliveryFraction:totals.delivered/Math.max(1,totals.generated)};
 records.push(row);raw.push({core,opts,sample,perRunRouted:
  study.runs.map(r=>r.scenarioDiagnosticsByMethod.adaptive_robust.decisionChannel),
  perRunLocal:study.runs.map(r=>r.scenarioDiagnosticsByMethod.adaptive_robust.localTransport)});
 console.log("E1-A FAIR PILOT CELL "+JSON.stringify({index:idx+1,
  policy:c.policy,topology:c.topology,partition:c.partition,
  capacity:c.capacity,utilization:row.resourceUtilization}));
}
const comparisons=[];
for(let k=0;k<records.length;k+=3){
 const a=records[k],b=records[k+1],c=records[k+2];
 if(a.policy!=="static"||b.policy!=="opportunistic"||c.policy!=="local_floor"||
  a.seed!==b.seed||b.seed!==c.seed)throw Error("Policy pairing mismatch");
 for(const base of [a,b])comparisons.push({
  topology:c.topology,partition:c.partition,capacity:c.capacity,
  baseline:base.policy,experimental:"local_floor",
  deltaRmse:c.rmse===null||base.rmse===null?null:c.rmse-base.rmse,
  deltaCoverage:c.decisionCoverage-base.decisionCoverage,
  deltaUtilization:c.resourceUtilization-base.resourceUtilization,
  deltaLocalShare:c.shareLocal-base.shareLocal});
}
const keys=Object.keys(records[0]);
writeFileSync(path.join(output,"adaptive-fair-bandwidth-pilot.csv"),
 [keys.join(";"),...records.map(r=>keys.map(k=>r[k]??"").join(";"))].join("\n")+"\n");
writeFileSync(path.join(output,"adaptive-fair-bandwidth-pilot.json"),
 JSON.stringify({version:"e1a-local-floor-exploratory-1.0.0",
  scientificStatus:"exploratory predeclared synthetic pilot (R=3); not significance or optimality",
  design:{N,T,R,cells:records.length,conditions:"topology x partition x capacity x policy",
   policies,causalPairing:"same seed/runIndex; admission and delivery outcomes differ by policy"},
  records,comparisons,raw},null,2)+"\n");
console.log("E1-A FAIR PILOT SUMMARY "+JSON.stringify({
 cells:records.length,simulations:records.length*R*5,
 meanDeltaRmse:mean(comparisons.map(x=>x.deltaRmse)),
 meanDeltaCoverage:mean(comparisons.map(x=>x.deltaCoverage)),
 meanDeltaLocalShare:mean(comparisons.map(x=>x.deltaLocalShare)),
 warning:"synthetic pilot, 3 replicates per cell, no inference"}));
