#!/usr/bin/env node
/**
 * E1-A local-neighbor consensus: strictly exploratory diagnostic experiment.
 * This DOES NOT feed the distributed estimates back to E1 trust decisions.
 * Synchronous one-hop messages are ideal; this is not a transmission model.
 */
import {mkdirSync,writeFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import path from "node:path";
import {runAdaptiveStudy} from "../src/adaptiveExperiment.js";
import {E1A_LOCAL_CONSENSUS_VERSION} from "../src/adaptiveLocalConsensus.js";

const directory=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../adaptive-results");
mkdirSync(directory,{recursive:true});
const design=[];
for(const topology of ["complete","ring"])
 for(const partition of [false,true])
  for(const rounds of [0,2,5])
   design.push({topology,partition,rounds});
const N=12,T=18,R=2,rows=[],traces=[];
for(const [index,cell] of design.entries()){
 const cfg={seed:913477+(cell.topology==="ring"?100:0)+(cell.partition?10:0),
  n_agents:N,n_byzantine:2,n_steps:T,trim_each_side:2,
  attack_start_step:3,network_enabled:true,network_topology:cell.topology,
  partition_enabled:cell.partition,partition_start_step:6,
  partition_end_step:13,partition_fraction:.5,
  message_loss_probability:0.02,message_delay_min_steps:0,
  message_delay_max_steps:1,bandwidth_messages_per_step:100};
 const opts={scenario:"static_bias",comparisonMode:"network_feedback",
  evidenceModel:"behavior_linked",attackStrategy:"coordinated",runs:R,
  alphaMode:"adaptive",localConsensusPilot:true,
  localConsensusRounds:cell.rounds,localConsensusTrim:0,
  localConsensusRelaxation:0.75};
 const study=runAdaptiveStudy(cfg,opts);
 if(study.partial||study.completedRuns!==R||study.models.localConsensus!==E1A_LOCAL_CONSENSUS_VERSION)
  throw Error("Incomplete component-local consensus cell "+(index+1));
 const series=[];
 for(const run of study.runs){
  const local=run.scenarioDiagnosticsByMethod.adaptive_robust.localConsensus;
  if(local?.history?.length!==T)throw Error("Local consensus history missing");
  for(const tick of local.history){
   if(!tick.states||tick.states.length!==N||tick.componentCount<1||
    tick.totalMessages<0||
    tick.states.some((v,i)=>v!==null&&!Number.isFinite(v)))
    throw Error("Local consensus metric or state invalid");
  }
  series.push(...local.history.map(x=>({
   step:x.step,spread:x.maxHonestSpread,componentCount:x.componentCount,
   messages:x.totalMessages,activeCount:x.activeCount
  })));
 }
 const avg=key=>{
  const valid=series.map(x=>x[key]).filter(Number.isFinite);
  return valid.length?valid.reduce((s,x)=>s+x,0)/valid.length:null;
 };
 const baseline=study.summary.find(x=>x.method==="proposed_robust");
 const adaptive=study.summary.find(x=>x.method==="adaptive_robust");
 const row={cell:index+1,topology:cell.topology,partition:cell.partition?1:0,
  rounds:cell.rounds,N,T,R,seed:cfg.seed,
  meanLocalHonestSpread:avg("spread"),
  meanActiveComponentCount:avg("componentCount"),
  meanIdealDirectedMessages:avg("messages"),
  rmseAdaptive:adaptive.rmse.mean,rmseProposedRobust:baseline.rmse.mean,
  deltaRmse:adaptive.rmse.mean-baseline.rmse.mean};
 rows.push(row);
 traces.push({row,config:cfg,options:opts,
  perRun:study.runs.map(run=>({
   run:run.run,
   localConsensus:run.scenarioDiagnosticsByMethod.adaptive_robust.localConsensus
  }))});
 console.log("E1-A LOCAL PILOT "+JSON.stringify({
  cell:index+1,topology:cell.topology,partition:cell.partition,
  rounds:cell.rounds,spread:+row.meanLocalHonestSpread.toFixed(6),
  messages:+row.meanIdealDirectedMessages.toFixed(2)
 }));
}
const keys=Object.keys(rows[0]);
writeFileSync(path.join(directory,"adaptive-local-consensus-pilot.csv"),
 keys.join(";")+"\n"+rows.map(row=>keys.map(k=>row[k]??"").join(";")).join("\n")+"\n");
writeFileSync(path.join(directory,"adaptive-local-consensus-pilot.json"),
 JSON.stringify({
  status:"exploratory diagnostic only, not physical distributed consensus",
  model:E1A_LOCAL_CONSENSUS_VERSION,
  design:{N,T,R,cells:12,topology:["complete","ring"],
   partition:[false,true],rounds:[0,2,5],
   caveat:"Each logical local round assumes ideal delivery of every neighbor's previous state. Counted local messages DO NOT consume E1 bandwidth; no per-edge loss or Byzantine agreement guarantee."},
  rows,traces
 },null,2)+"\n");
console.log("E1-A LOCAL PILOT SUMMARY "+JSON.stringify({
 cells:rows.length,runs:rows.length*R,
 meanHonestSpread:rows.reduce((s,x)=>s+x.meanLocalHonestSpread,0)/rows.length,
 meanIdealDirectedMessages:rows.reduce((s,x)=>s+x.meanIdealDirectedMessages,0)/rows.length,
 status:"exploratory, topology-local diagnostic only"
}));
