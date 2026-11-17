#!/usr/bin/env node
/**
 * Predeclared SEARCH geometry stress pilot, no external calibration:
 * 2 communication graphs × 4 sensor ranges × 2 outage durations ×
 * 2 remote-sensing states × 3 paired seeds = 96 synthetic episodes.
 * local_sensor is held fixed to isolate physical observation coverage.
 */
import {mkdirSync,writeFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import path from "node:path";
import {simulateLocalPlant,LOCAL_PLANT_VERSION} from "../src/adaptiveLocalPlant.js";
import {CROSS_SENSOR_VERSION,crossSensorPhysicalPair}
 from "../src/adaptiveLocalCrossSensing.js";

const directory=path.resolve(path.dirname(fileURLToPath(import.meta.url)),
 "../adaptive-results");
mkdirSync(directory,{recursive:true});
const R=3,T=44,lambda=10;
const ranges=[0.5,0.8,1.45,2.05],topologies=["ring","complete"];
const durations=["short","long"];
const cases=[],contrasts=[];
const mean=arr=>arr.reduce((s,v)=>s+v,0)/arr.length;
const round=x=>x===null?null:Number(x.toFixed(12));
for(const topology of topologies)
 for(const duration of durations)
  for(const sensingRange of ranges){
   const seed=20261211+(topology==="complete"?991:0)+
    (duration==="long"?107:0);
   const paired=[];
   for(let k=0;k<R;k++){
    const runs=[];
    for(const enabled of [false,true]){
     const config={
      plantSeed:seed,plantAgents:8,plantByzantine:2,
      plantSteps:T,plantSensorFaultMode:"dropout",
      plantSensorFaultFraction:.5,plantSensorFaultStart:4,
      plantSensorFaultEnd:duration==="long"?39:11,
      plantTopology:topology,plantControlMode:"local_sensor",
      plantGuardEnabled:false,plantCapacity:48,
      plantTransportLoss:.04,
      plantCrossEnabled:enabled,plantCrossFaultBudget:2,
      plantCrossObservationMode:"range_geometry",
      plantCrossGeometryRadius:1,plantCrossMaxRange:sensingRange,
      plantCrossDistanceErrorSlope:.04,
      plantCrossBound:.04,plantCrossDelay:1,plantCrossTTL:5,
      plantCrossLoss:.04,plantCrossBandwidthFraction:.65,
      plantCertificationPenalty:lambda};
     const result=simulateLocalPlant(config,k);
     const cross=result.crossTransport;
     const m=result.metrics;
     if(m.safetyViolations!==0||m.issViolations!==0||
      result.records.some(r=>Math.abs(r.stateAfter)>config.plantSafeBound+1e-9)||
      result.rows.some(r=>r.slotsUsed>r.slotsAvailable)||
      (enabled&&(!cross||cross.generated!==cross.delivered+
       cross.lost+cross.blocked+cross.expired+cross.superseded+cross.pending))||
      (!enabled&&cross))
      throw Error("Physical geometry pilot: safety or network accounting failure");
     if(!enabled&&result.records.some(r=>"crossReports" in r))
      throw Error("Opt-in geometry leaked into the disabled baseline");
     if(result.status!=="completed"&&m.honestStateRmse!==null)
      throw Error("Censored run passed as full-horizon success");
     const availableSources=Array.from({length:config.plantAgents},(_,i)=>
      Array.from({length:config.plantAgents},(_,j)=>i!==j&&
       crossSensorPhysicalPair(j,i,result.options).eligible).filter(Boolean).length);
     const row={topology,duration,sensingRange,enabled,seed,run:k,
      possiblePhysicalSources:availableSources[0],
      completed:result.status==="completed",
      completedSteps:result.completedSteps,
      failedStep:result.certificateFailure?.step??null,
      loss:m.fixedHorizonLoss,
      coverage:m.honestCrossSupportedFraction??null,
      refinement:m.honestCrossRefinementFraction??null,
      certifiedSources:m.meanCrossReportersPerHonestStep??null,
      sent:cross?.transmitted??0,
      initial:result.initial,
      disturbances:result.records.map(r=>r.disturbance)};
     cases.push(row);runs.push(row);
    }
    if(JSON.stringify(runs[0].initial)!==JSON.stringify(runs[1].initial))
     throw Error("Geometry pilot: unpaired initial state");
    for(let j=0;j<Math.min(runs[0].disturbances.length,
      runs[1].disturbances.length);j++)
     if(runs[0].disturbances[j]!==runs[1].disturbances[j])
      throw Error("Geometry pilot: paired exogenous mismatch");
    paired.push({run:k,deltaLoss:round(runs[1].loss-runs[0].loss),
     deltaCompletion:Number(runs[1].completed)-Number(runs[0].completed)});
   }
   const off=cases.filter(c=>c.topology===topology&&
    c.duration===duration&&c.sensingRange===sensingRange&&!c.enabled);
   const on=cases.filter(c=>c.topology===topology&&
    c.duration===duration&&c.sensingRange===sensingRange&&c.enabled);
   const row={topology,duration,sensingRange,
    possiblePhysicalSources:on[0].possiblePhysicalSources,
    completionOff:off.filter(x=>x.completed).length,
    completionOn:on.filter(x=>x.completed).length,
    meanLossOff:round(mean(off.map(x=>x.loss))),
    meanLossOn:round(mean(on.map(x=>x.loss))),
    deltaLoss:round(mean(paired.map(x=>x.deltaLoss))),
    deltaCompletion:round(mean(paired.map(x=>x.deltaCompletion))),
    remoteSupported:round(mean(on.map(x=>x.coverage))),
    remoteRefined:round(mean(on.map(x=>x.refinement)))};
   contrasts.push({row,paired});
   console.log("E1-A CROSS GEOMETRY CELL "+JSON.stringify(row));
  }
const columns=["topology","duration","sensingRange","enabled","seed","run",
 "possiblePhysicalSources","completed","completedSteps","failedStep",
 "loss","coverage","refinement","certifiedSources","sent"];
writeFileSync(path.join(directory,"adaptive-local-cross-geometry-pilot.csv"),
 [columns.join(";"),...cases.map(r=>columns.map(k=>r[k]??"").join(";"))].join("\n")+"\n");
writeFileSync(path.join(directory,"adaptive-local-cross-geometry-pilot.json"),
 JSON.stringify({version:"e1a-physical-geometry-pilot-1.0.0",
  plantModel:LOCAL_PLANT_VERSION,crossModel:CROSS_SENSOR_VERSION,
  status:"EXPLORATORY synthetic geometry, no hardware calibration",
  design:{R,T,lambda,ranges,topologies,durations,
   model:"static equally spaced circular sensors with bounded V0+beta*d"},
  cases,contrasts},null,2)+"\n");
console.log("E1-A CROSS GEOMETRY SUMMARY "+JSON.stringify({
 cells:contrasts.length,episodes:cases.length,
 aggregateCompletionOff:cases.filter(x=>!x.enabled&&x.completed).length,
 aggregateCompletionOn:cases.filter(x=>x.enabled&&x.completed).length,
 meanLossOff:round(mean(cases.filter(x=>!x.enabled).map(x=>x.loss))),
 meanLossOn:round(mean(cases.filter(x=>x.enabled).map(x=>x.loss))),
 researchStatus:"Exploratory simulated geometry; no transfer to real hardware"}));
