/**
 * UP-34: deterministic and event-tape-driven bridge for independent Python
 * scientific verification. This is not an adapter for the legacy Python RNG.
 * Input: {"cases":[{"type":"...", ...}]}, one JSON document on stdin.
 */
import fs from "node:fs";
import {betaTrust,eigenTrust,trimmedWeightedMean,transport,validateConfig,
 buildAdjacency,createRng,accountCommunicationStep} from "./trustEngine.js";
import {propagate,spreadOneTick,expectedShortfall,
 estimateReliabilityFromObservations} from "./research2027.js";

function evaluate(testCase){
 const v=testCase;
 switch(v.type){
 case "beta":{
  const n=v.history[0].length;
  const c=validateConfig({n_agents:n,n_byzantine:0,trim_each_side:0,
   initial_trust:v.prior,trust_prior_strength:v.strength,forgetting_factor:v.forgetting});
  return betaTrust(v.history.map(m=>m.map(row=>row.map(x=>x===null?NaN:x))),c,n);
 }
 case "eigen":return eigenTrust(v.matrix,v.active,v.damping);
 case "trim":return trimmedWeightedMean(v.values,v.weights,v.k);
 case "weights":return estimateReliabilityFromObservations(v.observations,v.noise);
 case "shortfall":return expectedShortfall(v.values,v.alpha);
 case "spread":{
  const run=propagate(v.n,v.edges,v.initial,{random(){throw Error("Event tape required");}},
   v.p,v.tapes.length,v.defense,v.tapes);
  return {infected:[...run.infected].sort((a,b)=>a-b),history:run.history};
 }
 case "graph_zero":{
  const c=validateConfig({n_agents:v.n,n_byzantine:0,trim_each_side:0,
   network_enabled:true,network_topology:"random",network_edge_probability:0});
  return buildAdjacency(c,createRng(123),Array(c.n_agents).fill(false));
 }
 case "transport":{
  const c=validateConfig({n_agents:v.n,n_byzantine:0,trim_each_side:0,
   network_enabled:v.networkEnabled,message_loss_probability:v.loss,
   message_delay_min_steps:0,message_delay_max_steps:5,
   bandwidth_messages_per_step:v.bandwidth,
   max_message_staleness_steps:v.staleness});
  const queue=[],lastValues=Array(v.n).fill(NaN),lastSteps=Array(v.n).fill(-1e9);
  let ledger=null;
  return v.steps.map((stage,t)=>{
   let cursor=0,accepted=0;
   const fakeRng={
    random(){
     if(cursor>=stage.events.length)throw Error("Insufficient event tape at step "+t);
     return stage.events[cursor++].lossDraw;
    },
    integer(min,max){
     const event=stage.events[cursor-1];
     if(!event||!Number.isInteger(event.delay)||event.delay<min||event.delay>max)
      throw Error("Invalid delay event at step "+t);
     accepted++;return event.delay;
    }
   };
   const result=transport(t,stage.proposals,stage.active,stage.comps,queue,
    lastValues,lastSteps,c,fakeRng,0);
   if(v.networkEnabled&&cursor!==stage.events.length)
    throw Error("Unconsumed event tape at step "+t);
   ledger=accountCommunicationStep(ledger,result.stats,
    {attempted:0,delivered:0,lost:0,bandwidth_dropped:0},queue.length,t+1);
   return {values:result.values.map(x=>Number.isFinite(x)?x:null),
    available:result.available,remainingBudget:result.budget,
    stats:result.stats,queue:queue.map(q=>({...q})),
    ledger:ledger.proposal};
  });
 }
 default:throw Error("Unknown UP-34 operation: "+v.type);
 }
}
try{
 const input=JSON.parse(fs.readFileSync(0,"utf8"));
 if(!Array.isArray(input.cases))throw Error("Expected cases array");
 process.stdout.write(JSON.stringify({schema:"up34-parity-v2",results:input.cases.map(evaluate)}));
}catch(error){
 process.stderr.write(String(error?.stack||error)+"\n");
 process.exitCode=1;
}
