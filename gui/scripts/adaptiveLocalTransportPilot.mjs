#!/usr/bin/env node
/**
 * E1-A preliminary causal local-neighbor delivery study.
 * Fixed 16 cells: topology × partition × E1 total C × local link loss.
 * All local packets are lower priority than E1 and routed central decisions.
 * This is a DIAGNOSTIC, NOT a new central decision estimator.
 */
import {mkdirSync,writeFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {runAdaptiveStudy} from "../src/adaptiveExperiment.js";
import {E1A_LOCAL_TRANSPORT_VERSION} from "../src/adaptiveLocalTransport.js";
const dir=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../adaptive-results");
mkdirSync(dir,{recursive:true});
const combinations=[];
for(const topology of ["complete","ring"])
 for(const partition of [false,true])
  for(const capacity of [100,250])
   for(const loss of [0,.25])
    combinations.push({topology,partition,capacity,loss});
const N=12,T=22,R=2,rows=[],details=[];
for(const [index,p] of combinations.entries()){
 const config={seed:2027030+(p.topology==="ring"?10000:0)+(p.partition?1000:0),
  n_agents:N,n_byzantine:3,n_steps:T,trim_each_side:2,attack_start_step:3,
  network_enabled:true,network_topology:p.topology,
  partition_enabled:p.partition,partition_start_step:8,
  partition_end_step:16,partition_fraction:.4,
  bandwidth_messages_per_step:p.capacity,message_delay_min_steps:0,
  message_delay_max_steps:1,message_loss_probability:.03};
 const options={scenario:"static_bias",runs:R,comparisonMode:"network_routed",
  alphaMode:"risk_aware",evidenceModel:"behavior_linked",attackStrategy:"coordinated",
  decisionBandwidthPolicy:"opportunistic",decisionBandwidthFraction:.2,
  decisionDelaySteps:1,decisionLossProbability:.03,decisionMaxStalenessSteps:5,
  localConsensusPilot:true,localConsensusRounds:2,localConsensusTrim:0,
  localConsensusRelaxation:.75,
  localTransportEnabled:true,localTransportDelaySteps:1,
  localTransportLossProbability:p.loss,localTransportMaxAgeSteps:4};
 const result=runAdaptiveStudy(config,options);
 if(result.partial||result.completedRuns!==R||
  result.models.localTransport!==E1A_LOCAL_TRANSPORT_VERSION)
  throw Error("Incomplete causal neighbor research cell "+index);
 let attempts=0,delivered=0,lost=0,blocked=0,expired=0,superseded=0,pending=0;
 let local=0,e1=0,decision=0,capacity=0,readings=0,informed=0;
 for(const run of result.runs){
  for(const [method,diag] of Object.entries(run.scenarioDiagnosticsByMethod)){
   const x=diag.localTransport;
   if(x?.modelVersion!==E1A_LOCAL_TRANSPORT_VERSION||
    x.history.length!==T||
    x.generated!==x.delivered+x.lost+x.blocked+x.expired+x.superseded+x.pending)
    throw Error("Local neighbor message conservation failed "+method);
   if(x.history.some(h=>h.totalUsed!==h.E1Used+h.decisionUsed+h.localUsed||
    h.totalUsed>h.sharedCapacity||h.localUsed<0))
    throw Error("Shared capacity violation "+method);
  }
  const d=run.scenarioDiagnosticsByMethod.adaptive_robust.localTransport;
  attempts+=d.generated;delivered+=d.delivered;lost+=d.lost;
  blocked+=d.blocked;expired+=d.expired;superseded+=d.superseded;pending+=d.pending;
  for(const h of d.history){
   local+=h.localUsed;e1+=h.E1Used;decision+=h.decisionUsed;
   capacity+=h.sharedCapacity;readings+=h.neighborReadingsThisStep;
   informed+=h.informedNodes;
  }
 }
 const primary=result.summary.find(x=>x.method==="adaptive_robust");
 const baseline=result.summary.find(x=>x.method==="proposed_robust");
 const row={cell:index+1,topology:p.topology,partition:p.partition?1:0,
  totalCapacity:p.capacity,linkLoss:p.loss,N,T,R,seed:config.seed,
  generated:attempts,delivered,lost,blocked,expired,superseded,pending,
  neighborTransmissions:local,neighborReadings:readings,
  totalSharedUtilization:(local+e1+decision)/capacity,
  neighborBandwidthFraction:local/capacity,
  meanInformedNodes:informed/(T*R),
  primaryRmse:primary.rmse.mean,
  centralBaselineRmse:baseline.rmse.mean,
  deltaPrimaryBaseline:primary.rmse.mean-baseline.rmse.mean
 };
 rows.push(row);
 details.push({row,config,options,modelVersions:result.models,
  methods:result.summary,perRun:result.runs.map(r=>({
   run:r.run,metrics:r.metrics,
   localByMethod:Object.fromEntries(Object.entries(r.scenarioDiagnosticsByMethod)
    .map(([m,d])=>[m,d.localTransport]))
  }))});
 console.log("E1-A LOCAL TRANSPORT PILOT "+JSON.stringify({
  cell:index+1,total:combinations.length,topology:p.topology,
  partition:p.partition,capacity:p.capacity,loss:p.loss,
  transmissions:local,neighborReadings:readings}));
}
const keys=Object.keys(rows[0]);
writeFileSync(path.join(dir,"adaptive-local-transport-pilot.csv"),
 keys.join(";")+"\n"+rows.map(x=>keys.map(k=>x[k]).join(";")).join("\n")+"\n");
writeFileSync(path.join(dir,"adaptive-local-transport-pilot.json"),
 JSON.stringify({status:"exploratory diagnostic, not consensus or validation",
  design:{N,T,R,cells:combinations.length,topology:["complete","ring"],
   partition:[false,true],totalCapacity:[100,250],linkLoss:[0,.25],
   localTransportPriority:"lowest residual slots only",
   caveat:"Local link estimates do not feed E1, trust, isolation or central decisions"},
  rows,details},null,2)+"\n");
const avg=key=>rows.reduce((s,x)=>s+x[key],0)/rows.length;
console.log("E1-A LOCAL TRANSPORT PILOT SUMMARY "+JSON.stringify({
 cells:rows.length,runs:rows.length*R,
 meanNeighborTransmissions:avg("neighborTransmissions"),
 meanNeighborReadings:avg("neighborReadings"),
 meanSharedUtilization:avg("totalSharedUtilization"),
 zeroTransportCells:rows.filter(x=>x.neighborTransmissions===0).length,
 warning:"all findings synthetic; no proof of decentralized consensus"
}));
