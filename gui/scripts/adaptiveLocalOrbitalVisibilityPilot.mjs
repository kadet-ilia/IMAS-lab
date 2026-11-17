#!/usr/bin/env node
/**
 * E1-A stage-15 exploratory physical-visibility pilot: 120 synthetic
 * episodes. No satellite ephemeris, measured metrology, hardware keys,
 * or independent hardware validation.
 */
import {mkdirSync,writeFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {simulateLocalPlant,localPlantAdjacency} from "../src/adaptiveLocalPlant.js";
import {auditCrossObservationGraph,crossSensorPhysicalPair}
 from "../src/adaptiveLocalCrossSensing.js";

const directory=path.resolve(path.dirname(fileURLToPath(import.meta.url)),
 "../adaptive-results");
mkdirSync(directory,{recursive:true});
const T=44,R=3,lambda=10;
const topologies=["ring","complete"],durations=["short","long"];
const profiles=[
 {name:"clear_omni",body:0,pointing:"omnidirectional",halfAngle:Math.PI,
  positionError:0,attitudeError:0},
 {name:"body_occlusion",body:1.5,pointing:"omnidirectional",halfAngle:Math.PI,
  positionError:0,attitudeError:0},
 {name:"prograde_field",body:0,pointing:"prograde",halfAngle:Math.PI/2,
  positionError:0,attitudeError:0},
 {name:"bounded_pose",body:1.5,pointing:"prograde",halfAngle:2.6,
  positionError:.06,attitudeError:.08},
 {name:"buffered_sample_lag2",body:1.5,pointing:"omnidirectional",
  halfAngle:Math.PI,positionError:0,attitudeError:0,sampleLag:2}
];
const episodes=[],cells=[];
const mean=x=>x.reduce((s,v)=>s+v,0)/x.length;
const round=x=>Number(x.toFixed(12));
for(const topology of topologies)
 for(const duration of durations)
  for(const profile of profiles){
   const paired=[];
   for(let run=0;run<R;run++){
    const seed=20261129+run*719+
     (topology==="complete"?10001:0)+(duration==="long"?231:0);
    const options={
     plantSeed:seed,plantSteps:T,plantAgents:8,plantByzantine:2,
     plantTopology:topology,plantControlMode:"local_sensor",
     plantSensorFaultMode:"dropout",plantSensorFaultFraction:.5,
     plantSensorFaultStart:4,
     plantSensorFaultEnd:duration==="short"?11:39,
     plantGuardEnabled:false,plantCapacity:48,plantTransportLoss:.04,
     plantCrossObservationMode:"orbital_visibility",
     plantCrossOrbitRadius:2,plantCrossCentralBodyRadius:profile.body,
     plantCrossOrbitPlanes:2,plantCrossOrbitInclination:.9,
     plantCrossOrbitAngularRate:.23,plantCrossMaxRange:5,
     plantCrossPointingMode:profile.pointing,
     plantCrossPointingHalfAngle:profile.halfAngle,
     plantCrossOrbitPositionError:profile.positionError,
     plantCrossOrbitPointingError:profile.attitudeError,
     plantCrossSampleLagMaxSteps:profile.sampleLag??0,
     plantCrossBound:.04,plantCrossDistanceErrorSlope:.02,
     plantCrossFaultBudget:2,plantCrossDelay:1,plantCrossTTL:5,
     plantCrossLoss:.04,plantCrossBandwidthFraction:.65,
     plantCertificationPenalty:lambda
    };
    const adjacency=localPlantAdjacency(options.plantAgents,topology).adjacency;
    const epochs=Array.from({length:T},(_,k)=>auditCrossObservationGraph(
     adjacency,options,k+1).potentiallyObservableCount);
    const compared=[];
    for(const enabled of [false,true]){
     const r=simulateLocalPlant({...options,plantCrossEnabled:enabled},0);
     const ch=r.crossTransport;
     if(r.metrics.safetyViolations!==0||r.metrics.issViolations!==0||
      r.rows.some(x=>x.slotsUsed>r.options.plantCapacity)||
      r.records.some(x=>Math.abs(x.stateAfter)>r.options.plantSafeBound+1e-9)||
      enabled&&(!ch||ch.generated!==ch.delivered+ch.lost+ch.blocked+
       ch.expired+ch.superseded+ch.pending)||
      !enabled&&ch)
      throw Error("Stage 15: unsafe transition or invalid shared quota");
     if(enabled)for(const record of r.records)
      for(const msg of record.crossReports){
       const possiblySampled=Array.from({
        length:Math.min(r.options.plantCrossSampleLagMaxSteps+1,msg.emitted)
       },(_,offset)=>msg.emitted-offset).some(sampleTime=>
        crossSensorPhysicalPair(msg.source,msg.target,r.options,
         sampleTime).eligible);
       if(!possiblySampled)
        throw Error("Stage 15: no admissible physical sampling epoch");
      }
     if(enabled&&topology==="ring"&&
      r.records.some(x=>x.crossSupported||x.crossRefined))
      throw Error("Stage 15: ring fabricated m>f remote evidence");
     compared.push(r);
     episodes.push({
      topology,duration,profile:profile.name,enabled,seed,run,
      completed:r.status==="completed",
      completedSteps:r.completedSteps,
      fixedHorizonLoss:r.metrics.fixedHorizonLoss,
      supported:r.metrics.honestCrossSupportedFraction??0,
      refined:r.metrics.honestCrossRefinementFraction??0,
      possibleEpochs:epochs.filter(x=>x>0).length,
      possibleMeanNodes:round(mean(epochs)),
      crossTransmitted:ch?.transmitted??0
     });
    }
    if(JSON.stringify(compared[0].initial)!==
     JSON.stringify(compared[1].initial))
     throw Error("Stage 15: mismatched initial states in pair");
    for(let i=0;i<Math.min(compared[0].records.length,
     compared[1].records.length);i++)
     if(compared[0].records[i].disturbance!==
      compared[1].records[i].disturbance)
      throw Error("Stage 15: mismatched exogenous disturbances");
    if(topology==="ring"&&(
     compared[0].status!==compared[1].status||
     compared[0].completedSteps!==compared[1].completedSteps||
     JSON.stringify(compared[0].records.map(x=>x.stateAfter))!==
     JSON.stringify(compared[1].records.map(x=>x.stateAfter))))
     throw Error("Stage 15: impossible support must not affect ring control");
    paired.push(compared.map(x=>x.status==="completed"));
   }
   const group=episodes.filter(x=>x.topology===topology&&
    x.duration===duration&&x.profile===profile.name);
   const off=group.filter(x=>!x.enabled),on=group.filter(x=>x.enabled);
   const row={topology,duration,profile:profile.name,
    possibleEpochs:on[0].possibleEpochs,
    possibleMeanNodes:on[0].possibleMeanNodes,
    completionOff:off.filter(x=>x.completed).length,
    completionOn:on.filter(x=>x.completed).length,
    lossOff:round(mean(off.map(x=>x.fixedHorizonLoss))),
    lossOn:round(mean(on.map(x=>x.fixedHorizonLoss))),
    supported:round(mean(on.map(x=>x.supported))),
    refined:round(mean(on.map(x=>x.refined)))};
   cells.push(row);
   console.log("E1-A ORBITAL VISIBILITY CELL "+JSON.stringify(row));
  }
const columns=["topology","duration","profile","enabled","seed","run",
 "completed","completedSteps","fixedHorizonLoss","supported","refined",
 "possibleEpochs","possibleMeanNodes","crossTransmitted"];
writeFileSync(path.join(directory,"adaptive-local-orbital-visibility-pilot.csv"),
 [columns.join(";"),...episodes.map(r=>
  columns.map(k=>r[k]??"").join(";"))].join("\n")+"\n");
writeFileSync(path.join(directory,"adaptive-local-orbital-visibility-pilot.json"),
 JSON.stringify({version:"e1a-synthetic-orbital-visibility-search-1.0.0",
  researchStatus:"EXPLORATORY, not calibrated by real orbit or sensor data",
  design:{T,R,lambda,topologies,durations,profiles},episodes,cells},null,2)+"\n");
console.log("E1-A ORBITAL VISIBILITY SUMMARY "+JSON.stringify({
 episodes:episodes.length,cells:cells.length,
 sampleLagExperimental:true,
 offCompleted:episodes.filter(x=>!x.enabled&&x.completed).length,
 onCompleted:episodes.filter(x=>x.enabled&&x.completed).length,
 meanLossOff:round(mean(episodes.filter(x=>!x.enabled)
  .map(x=>x.fixedHorizonLoss))),
 meanLossOn:round(mean(episodes.filter(x=>x.enabled)
  .map(x=>x.fixedHorizonLoss))),
 label:"SYNTHETIC ONLY"}));
