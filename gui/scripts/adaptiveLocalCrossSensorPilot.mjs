#!/usr/bin/env node
/**
 * Exploratory paired CROSS remote sensing (NOT confirmatory):
 * 2 topologies × 2 dropout lengths × 2 cross-channel states ×
 * 3 actuator policies × 3 seeds = 72 synthetic complete-or-abort episodes.
 * No selected-only RMSE on censored episodes and no hidden extra bandwidth.
 */
import {mkdirSync,writeFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import path from "node:path";
import {simulateLocalPlant,LOCAL_PLANT_VERSION} from "../src/adaptiveLocalPlant.js";
import {CROSS_SENSOR_VERSION} from "../src/adaptiveLocalCrossSensing.js";

const destination=path.resolve(path.dirname(fileURLToPath(import.meta.url)),
 "../adaptive-results");
mkdirSync(destination,{recursive:true});
const R=3,T=44,lambda=10;
const modes=["local_action","local_decision","local_sensor"];
const average=x=>x.reduce((s,v)=>s+v,0)/x.length;
const fmt=x=>x===null?null:Number(x.toFixed(12));
const cells=[],cases=[],paired=[];
for(const topology of ["ring","complete"])
 for(const duration of ["short","long"])
  for(const mode of modes){
   const alternatives=[];
   const seed=20261117+(topology==="complete"?1001:0)+
    (duration==="long"?113:0);
   for(const enabled of [false,true]){
    const reps=[];
    for(let run=0;run<R;run++){
     const config={plantSeed:seed,plantSteps:T,plantAgents:8,
      plantByzantine:2,plantSensorFaultMode:"dropout",
      plantSensorFaultFraction:.5,plantSensorFaultStart:4,
      plantSensorFaultEnd:duration==="short"?11:39,
      plantTopology:topology,plantControlMode:mode,
      plantGuardEnabled:false,plantCapacity:48,
      plantTransportLoss:.04,plantTransportDelay:1,
      plantCrossEnabled:enabled,plantCrossFaultBudget:2,
      plantCrossBound:.08,plantCrossDelay:1,plantCrossTTL:5,
      plantCrossLoss:.04,plantCrossBandwidthFraction:.65,
      plantCertificationPenalty:lambda};
     const result=simulateLocalPlant(config,run);
     const local=result.transport,cross=result.crossTransport;
     if(result.metrics.safetyViolations||result.metrics.issViolations||
      local.generated!==local.delivered+local.lost+local.blocked+
       local.expired+local.superseded+local.pending||
      result.rows.some(h=>h.slotsUsed>h.slotsAvailable)||
      result.records.some(r=>Math.abs(r.stateAfter)>result.options.plantSafeBound+1e-9))
      throw Error("Cross pilot broke safety/ISS/shared resource accounting");
     if(enabled&&(!cross||
      cross.generated!==cross.delivered+cross.lost+cross.blocked+
       cross.expired+cross.superseded+cross.pending))
      throw Error("Cross pilot: failed causal remote transport ledger");
     if(!enabled&&cross)throw Error("Cross pilot altered disabled historical path");
     if(result.status!=="completed"&&result.metrics.honestStateRmse!==null)
      throw Error("Cross pilot censored a failed safety episode");
     const r={topology,duration,mode,enabled,seed,run,
      completed:result.status==="completed",
      completedSteps:result.completedSteps,
      failedStep:result.certificateFailure?.step??null,
      failurePhase:result.certificateFailure?.phase??null,
      fixedHorizonLoss:result.metrics.fixedHorizonLoss,
      honestStateRmse:result.metrics.honestStateRmse,
      remoteSupported:result.metrics.honestCrossSupportedFraction??null,
      remoteRefined:result.metrics.honestCrossRefinementFraction??null,
      remoteReporters:result.metrics.meanCrossReportersPerHonestStep??null,
      transmittedCross:cross?.transmitted??0,
      initial:result.initial,
      disturbanceTrace:result.records.map(x=>x.disturbance)};
     cases.push(r);reps.push(r);
    }
    alternatives.push(reps);
    const row={topology,duration,mode,enabled,R,
     completionRate:fmt(average(reps.map(r=>Number(r.completed)))),
     meanFixedHorizonLoss:fmt(average(reps.map(r=>r.fixedHorizonLoss))),
     completedRmse:reps.some(r=>r.completed)?
      fmt(average(reps.filter(r=>r.completed).map(r=>r.honestStateRmse))):null,
     meanRemoteSupported:enabled?fmt(average(reps.map(r=>r.remoteSupported))):null,
     meanRemoteRefined:enabled?fmt(average(reps.map(r=>r.remoteRefined))):null};
    cells.push(row);console.log("E1-A CROSS SENSOR CELL "+JSON.stringify(row));
   }
   const [off,on]=alternatives,diff=[];
   for(let i=0;i<R;i++){
    if(JSON.stringify(off[i].initial)!==JSON.stringify(on[i].initial))
     throw Error("Cross pilot: unpaired initial states");
    const a=off[i].disturbanceTrace,b=on[i].disturbanceTrace;
    for(let j=0;j<Math.min(a.length,b.length);j++)
     if(a[j]!==b[j])throw Error("Cross pilot: exogenous disturbance mismatch");
    diff.push({run:i,
     deltaLoss:fmt(on[i].fixedHorizonLoss-off[i].fixedHorizonLoss),
     offComplete:off[i].completed,onComplete:on[i].completed});
   }
   paired.push({topology,duration,mode,
    meanDeltaLoss:fmt(average(diff.map(r=>r.deltaLoss))),
    deltaCompletion:fmt(average(diff.map(r=>Number(r.onComplete)-
     Number(r.offComplete)))),diff});
  }
const penaltySensitivity=[4.01,10,25,100].map(penalty=>{
 const scores=cases.map(r=>({...r,score:r.completed?
  r.honestStateRmse**2:penalty}));
 return {penalty,groups:Object.fromEntries([false,true].map(enabled=>[
  String(enabled),fmt(average(scores.filter(r=>r.enabled===enabled)
   .map(r=>r.score)))]))};
});
const columns=["topology","duration","mode","enabled","seed","run",
 "completed","completedSteps","failedStep","failurePhase",
 "fixedHorizonLoss","honestStateRmse","remoteSupported","remoteRefined",
 "remoteReporters","transmittedCross"];
writeFileSync(path.join(destination,"adaptive-local-cross-sensor-pilot.csv"),
 [columns.join(";"),...cases.map(r=>columns.map(k=>r[k]??"").join(";"))].join("\n")+"\n");
writeFileSync(path.join(destination,"adaptive-local-cross-sensor-pilot.json"),
 JSON.stringify({version:"e1a-remote-certified-sensor-search-1.0.0",
  plantModel:LOCAL_PLANT_VERSION,crossModel:CROSS_SENSOR_VERSION,
  design:{R,T,lambda,seedScheme:"same exogenous keys within on/off paired runs",
   note:"Exploratory; certified faults f<=2; no external independent calibration"},
  cases,cells,paired,penaltySensitivity},null,2)+"\n");
const summarize=enabled=>cases.filter(r=>r.enabled===enabled);
console.log("E1-A CROSS SENSOR SUMMARY "+JSON.stringify({
 episodes:cases.length,cells:cells.length,
 completionOff:summarize(false).filter(x=>x.completed).length,
 completionOn:summarize(true).filter(x=>x.completed).length,
 meanLossOff:fmt(average(summarize(false).map(x=>x.fixedHorizonLoss))),
 meanLossOn:fmt(average(summarize(true).map(x=>x.fixedHorizonLoss))),
 pairedCells:paired.length,penaltySensitivity,
 researchStatus:"SEARCH ONLY, not evidence of general Byzantine protection"}));
