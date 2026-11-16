/**
 * E1-A synthetic network feedback pilot. Not an optimization or proof of
 * connectivity, consensus, physical routing, or full-system ISS.
 *
 * Fully factorial 2 topologies x 2 partition conditions x 2 fixed feedback
 * delays x 2 feedback-loss probabilities, with 3 seeded runs per cell.
 * Outputs the separate decision-channel ledger and method-specific error,
 * trust, isolation and reference availability.
 */
import {mkdirSync,writeFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {runAdaptiveStudy} from "../src/adaptiveExperiment.js";
import {E1A_DECISION_CHANNEL_VERSION} from "../src/adaptiveDecisionChannel.js";

const dest=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../adaptive-results");
mkdirSync(dest,{recursive:true});
const params=[],R=3,N=20,T=36;
for(const topology of ["complete","ring"])
 for(const partition of [false,true])
  for(const delay of [1,3])
   for(const loss of [0,.25])
    params.push({topology,partition,delay,loss});
const details=[],rows=[];
for(const [index,p] of params.entries()){
 const config={seed:705031+(p.topology==="ring"?100:0)+(p.partition?10:0),
  n_agents:N,n_byzantine:4,n_steps:T,trim_each_side:4,
  attack_start_step:5,network_enabled:true,
  network_topology:p.topology,partition_enabled:p.partition,
  partition_start_step:12,partition_end_step:25,partition_fraction:.4,
  message_delay_min_steps:0,message_delay_max_steps:1,
  message_loss_probability:.02,bandwidth_messages_per_step:500};
 const options={runs:R,scenario:"static_bias",comparisonMode:"network_feedback",
  attackStrategy:"coordinated",evidenceModel:"behavior_linked",
  decisionOriginAgent:0,decisionDelaySteps:p.delay,
  decisionLossProbability:p.loss,decisionMaxStalenessSteps:6,
  evidenceNoiseSigma:.02,witnessCorruption:.6,
  alphaMode:"risk_aware"};
 const result=runAdaptiveStudy(config,options);
 if(result.completedRuns!==R||result.partial||result.models.decisionChannel!==E1A_DECISION_CHANNEL_VERSION)
  throw Error("Incomplete synthetic network-feedback research cell "+index);
 let aggregatePackets={attempted:0,delivered:0,lost:0,blocked:0,expired:0,pending:0,notDispatched:0};
 let sumReach=0,sumInformed=0,numSteps=0;
 for(const run of result.runs){
  for(const method of result.methods){
   const channel=run.scenarioDiagnosticsByMethod[method.id]?.decisionChannel;
   if(!channel||channel.history.length!==T)
    throw Error("Missing network provenance for "+method.id);
   if(channel.attempted!==channel.delivered+channel.lost+channel.blocked+channel.expired+channel.pending)
    throw Error("Failed decision-channel conservation for "+method.id);
  }
  const d=run.scenarioDiagnosticsByMethod.adaptive_robust.decisionChannel;
  for(const key of Object.keys(aggregatePackets))aggregatePackets[key]+=d[key]||0;
  for(const h of d.history){
   if(h.informed>h.reachable||h.reachable>N||h.informed<0)
    throw Error("Impossible reachable decision reference");
   sumReach+=h.reachable;sumInformed+=h.informed;numSteps++;
  }
 }
 const find=method=>result.summary.find(x=>x.method===method);
 const newMethod=find("adaptive_robust"),plain=find("trimmed_unweighted"),legacy=find("proposed_robust");
 const entry={id:index+1,topology:p.topology,partition:p.partition?"partitioned":"connected",
  lag:p.delay,loss:p.loss,runs:R,seed:config.seed,
  rmseAdaptive:newMethod.rmse.mean,rmseLegacy:legacy.rmse.mean,rmsePlain:plain.rmse.mean,
  adaptiveMinusLegacy:newMethod.rmse.mean-legacy.rmse.mean,
  referenceCoverageReachable:newMethod.mean_decision_reference_coverage.mean,
  referenceCoverageAllNodes:sumInformed/(numSteps*N),
  reachableFraction:sumReach/(numSteps*N),
  ...Object.fromEntries(Object.entries(aggregatePackets).map(([k,v])=>["decision_"+k,v]))};
 rows.push(entry);
 details.push({entry,config,options,models:result.models,methodology:result.methodology,
  metrics:result.summary,
  perRun:result.runs.map(r=>({run:r.run,metrics:r.metrics,
   channelByMethod:Object.fromEntries(Object.entries(r.scenarioDiagnosticsByMethod)
    .map(([method,diag])=>[method,diag.decisionChannel]))}))});
 console.log("E1-A NETWORK PILOT "+JSON.stringify({
  cell:index+1,total:params.length,topology:p.topology,partition:p.partition,
  lag:p.delay,loss:p.loss,coverage:+entry.referenceCoverageAllNodes.toFixed(4),
  meanRmse:+entry.rmseAdaptive.toFixed(5)}));
}
const keys=Object.keys(rows[0]);
const csv=[keys.join(";"),...rows.map(row=>keys.map(k=>row[k]??"").join(";"))].join("\n")+"\n";
const out={
 experiment:"E1-A synthetic component broadcast pilot",
 status:"exploratory network research; not confirmatory",
 design:{N,T,R,cells:rows.length,topologies:["complete","ring"],
  partitionModes:[false,true],delay:[1,3],loss:[0,.25],
  comment:"Fixed scenario with independent five-method trust loops. Decision publication only from origin 0 via separate component-constrained channel; no path-level routing or shared bandwidth."},
 rows,details
};
writeFileSync(path.join(dest,"adaptive-network-pilot.csv"),csv,"utf8");
writeFileSync(path.join(dest,"adaptive-network-pilot.json"),JSON.stringify(out,null,2)+"\n","utf8");
console.log("E1-A NETWORK PILOT SUMMARY "+JSON.stringify({
 cells:rows.length,pairedRuns:rows.length*R,
 meanReferenceCoverageAllNodes:rows.reduce((a,b)=>a+b.referenceCoverageAllNodes,0)/rows.length,
 meanDeltaAdaptiveLegacy:rows.reduce((a,b)=>a+b.adaptiveMinusLegacy,0)/rows.length,
 disclaimer:"no proof of full IMAS connectivity or stability"
}));
