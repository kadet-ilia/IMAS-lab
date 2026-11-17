#!/usr/bin/env node
/**
 * Predeclared SEARCH pilot, not confirmation:
 * 2 topologies × 2 fault kinds × 2 outage lengths × 3 control policies
 * × 3 paired seeds = 72 runs; fixed evaluation horizon T=44.
 *
 * A failed certificate MUST NOT be compared via successful-only RMSE.
 * Instead compare status separately and an explicit full-episode loss:
 * L = mean(x^2) over all 44*honest agent ticks if completed, else lambda.
 * lambda=10 (strictly larger than S^2=4), scenario-dependent assumption.
 */
import {mkdirSync,writeFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import path from "node:path";
import {simulateLocalPlant,LOCAL_PLANT_VERSION} from "../src/adaptiveLocalPlant.js";
import {SENSOR_FAULT_OBSERVER_VERSION} from "../src/adaptiveLocalPlantSensorFaults.js";

const outDir=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../adaptive-results");
mkdirSync(outDir,{recursive:true});
const modes=["local_action","local_decision","local_sensor"];
const topologies=["ring","complete"];
const faultKinds=["dropout","degraded"];
const durations=["short","long"];
const R=3,lambda=10;
const mean=x=>x.reduce((s,v)=>s+v,0)/x.length;
const round=x=>x===null?null:Number(x.toFixed(12));
const cells=[],runs=[],pairs=[];
for(const topology of topologies)
 for(const fault of faultKinds)
  for(const duration of durations){
   const options={
    plantSeed:20261117+(topology==="complete"?1700:0)+
     (fault==="degraded"?270:0)+(duration==="long"?31:0),
    plantSteps:44,plantAgents:8,plantByzantine:2,
    plantTopology:topology,plantCapacity:32,
    plantTransportLoss:0.04,plantTransportDelay:1,
    plantTransportTTL:5,plantGuardEnabled:false,
    plantSensorFaultMode:fault,plantSensorFaultFraction:0.5,
    plantSensorFaultStart:duration==="short"?8:4,
    plantSensorFaultEnd:duration==="short"?11:39,
    plantDegradedSensorBound:0.3,
    plantCertificationPenalty:lambda
   };
   const byMode=new Map();
   for(const mode of modes){
    const rep=[];
    for(let i=0;i<R;i++){
     const result=simulateLocalPlant({...options,plantControlMode:mode},i);
     if(result.metrics.safetyViolations!==0||
      result.metrics.issViolations!==0||
      result.transport.generated!==result.transport.delivered+
       result.transport.lost+result.transport.blocked+
       result.transport.expired+result.transport.superseded+
       result.transport.pending||
      result.transport.history.some(h=>h.totalUsed>h.sharedCapacity)||
      result.records.some(row=>Math.abs(row.stateAfter)>
       result.options.plantSafeBound+1e-10))
      throw Error("Fault pilot: internal safety, ISS or packet audit violation");
     if(result.status==="completed"&&
      result.records.length!==options.plantSteps*options.plantAgents)
      throw Error("Fault pilot: incomplete horizon reported as complete");
     const metric=result.metrics;
     const row={topology,fault,duration,mode,run:i,
      seed:options.plantSeed,complete:result.status==="completed",
      completedSteps:result.completedSteps,failedStep:result.certificateFailure?.step??null,
      failedNode:result.certificateFailure?.node??null,
      failurePhase:result.certificateFailure?.phase??null,
      honestStateRmse:metric.honestStateRmse,
      fixedHorizonLoss:metric.fixedHorizonLoss,
      honestCoverage:metric.honestCoverage,
      honestLocalControlFraction:metric.honestLocalControlFraction,
      honestFallbackFraction:metric.honestFallbackFraction,
      honestSensorDropoutFraction:metric.honestSensorDropoutFraction,
      honestSensorDegradedFraction:metric.honestSensorDegradedFraction,
      barrierOverrideFraction:metric.honestBarrierOverrideFraction,
      initial:result.initial,
      completedDisturbances:result.records.map(x=>x.disturbance)};
     runs.push(row);rep.push(row);
    }
    byMode.set(mode,rep);
    const cell={topology,fault,duration,mode,R,
     completionRate:round(mean(rep.map(x=>Number(x.complete)))),
     meanCompletedSteps:round(mean(rep.map(x=>x.completedSteps))),
     meanFixedHorizonLoss:round(mean(rep.map(x=>x.fixedHorizonLoss))),
     meanCompletedRmse:rep.some(x=>x.complete)?
      round(mean(rep.filter(x=>x.complete).map(x=>x.honestStateRmse))):null,
     nominalAccuracyClaims:false,
     failurePenalty:lambda};
    cells.push(cell);console.log("E1-A SENSOR CELL "+JSON.stringify(cell));
   }
   const actions=byMode.get("local_action");
   for(const otherName of ["local_decision","local_sensor"]){
    const others=byMode.get(otherName),deltas=[];
    for(let i=0;i<R;i++){
     if(JSON.stringify(actions[i].initial)!==JSON.stringify(others[i].initial))
      throw Error("Paired fault runs started from different states");
     const da=actions[i].completedDisturbances,
      db=others[i].completedDisturbances;
     const common=Math.min(da.length,db.length);
     for(let j=0;j<common;j++)if(da[j]!==db[j])
      throw Error("Different exogenous disturbances in paired prefix");
     deltas.push({run:i,deltaLoss:round(actions[i].fixedHorizonLoss-
      others[i].fixedHorizonLoss),
      actionComplete:actions[i].complete,comparisonComplete:others[i].complete});
    }
    pairs.push({topology,fault,duration,comparison:"local_action minus "+otherName,
     meanDeltaLoss:round(mean(deltas.map(x=>x.deltaLoss))),
     bothComplete:deltas.filter(x=>x.actionComplete&&x.comparisonComplete).length,
     deltas});
   }
  }
const cols=["topology","fault","duration","mode","run","seed","complete",
 "completedSteps","failedStep","failedNode","failurePhase",
 "honestStateRmse","fixedHorizonLoss","honestCoverage",
 "honestLocalControlFraction","honestFallbackFraction",
 "honestSensorDropoutFraction","honestSensorDegradedFraction",
 "barrierOverrideFraction"];
writeFileSync(path.join(outDir,"adaptive-local-sensor-fault-pilot.csv"),
 [cols.join(";"),...runs.map(x=>cols.map(k=>x[k]??"").join(";"))].join("\n")+"\n");
writeFileSync(path.join(outDir,"adaptive-local-sensor-fault-pilot.json"),
 JSON.stringify({plantModel:LOCAL_PLANT_VERSION,
  observerModel:SENSOR_FAULT_OBSERVER_VERSION,
  status:"exploratory synthetic, R=3; not statistically confirmatory",
  design:"2 topology x 2 sensor fault x 2 durations x 3 controllers x 3 paired seeds",
  fixedHorizon:44,penalty:lambda,units:"full honest agent-steps",
  censoring:"Never score incomplete runs using success-only RMSE",
  cells,runs,pairs},null,2)+"\n");
const agg=modes.map(mode=>({mode,completionRate:round(mean(
 runs.filter(x=>x.mode===mode).map(x=>Number(x.complete)))),
 meanFixedHorizonLoss:round(mean(runs.filter(x=>x.mode===mode)
  .map(x=>x.fixedHorizonLoss)))}));
console.log("E1-A SENSOR SUMMARY "+JSON.stringify({cells:cells.length,
 runs:runs.length,certificationLost:runs.filter(x=>!x.complete).length,
 aggregation:agg,pairedCells:pairs.length,scientificStatus:"synthetic exploratory; no independent calibration"}));
