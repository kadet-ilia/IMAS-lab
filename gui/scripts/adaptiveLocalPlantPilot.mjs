#!/usr/bin/env node
/**
 * E1-A physical/logical plant experiment, separate from legacy E1.
 * 2 graph types × 2 partition statuses × 2 capacities × 3 controllers,
 * three paired seeds: 24 cells, 72 plant runs. Scientific pilot only.
 */
import {mkdirSync,writeFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {simulateLocalPlant,LOCAL_PLANT_VERSION} from "../src/adaptiveLocalPlant.js";
const dest=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../adaptive-results");
mkdirSync(dest,{recursive:true});
const topologies=["ring","complete"],modes=["local_action","local_decision","local_sensor"];
const rows=[],individual=[],paired=[];
const mean=xs=>xs.reduce((a,x)=>a+x,0)/xs.length;
const round=x=>Number(x.toFixed(12));
for(const topology of topologies)
 for(const partition of [false,true])
  for(const capacity of [8,32]){
   const seed=20261117+(topology==="complete"?103:0)+(partition?17:0)+
    (capacity===32?5:0);
   const reference={plantSeed:seed,plantAgents:8,plantByzantine:2,
    plantSteps:24,plantTopology:topology,plantPartition:partition,
    plantPartitionStart:8,plantPartitionEnd:16,
    plantCapacity:capacity,plantTransportLoss:0.05,
    plantTransportDelay:1,plantTransportTTL:5,
    plantAttackStart:4,plantAttackBias:0.9,
    plantGuardEnabled:true,plantFallbackPolicy:"barrier_zero",
    plantSensorBound:0.04,plantDisturbanceBound:0.04};
   const runsByMode=new Map();
   for(const mode of modes){
    const runs=[];
    for(let i=0;i<3;i++){
     const out=simulateLocalPlant({...reference,plantControlMode:mode},i);
     const m=out.metrics;
     if(m.safetyViolations||m.issViolations||
      !m.nominalContractive||m.maxAbsoluteState>out.options.plantSafeBound+1e-10||
      out.transport.generated!==out.transport.delivered+out.transport.lost+
       out.transport.blocked+out.transport.expired+out.transport.superseded+
       out.transport.pending||
      out.transport.history.some(x=>x.totalUsed>x.sharedCapacity))
      throw Error("Local plant safety, ISS or packet accounting violated");
     runs.push({run:i,...m,
      finalState:out.final,disturbances:out.records.map(x=>x.disturbance),
      initial:out.initial});
    }
    runsByMode.set(mode,runs);
    const numeric=["honestStateRmse","honestMeanFinalV","honestCoverage",
     "honestFallbackFraction","honestBarrierOverrideFraction","maxAbsoluteState"];
    const row={topology,partition,capacity,mode,seed,R:3,N:8,T:24};
    for(const key of numeric)row[key]=round(mean(runs.map(r=>r[key])));
    rows.push(row);
    individual.push({row,runs});
    console.log("E1-A PLANT CELL "+JSON.stringify(row));
   }
   const action=runsByMode.get("local_action");
   for(const comparison of ["local_decision","local_sensor"]){
    const other=runsByMode.get(comparison),deltas=[];
    for(let i=0;i<3;i++){
     if(JSON.stringify(action[i].initial)!==JSON.stringify(other[i].initial)||
      JSON.stringify(action[i].disturbances)!==
       JSON.stringify(other[i].disturbances))
      throw Error("Paired plant events are not identical");
     deltas.push({run:i,deltaHonestStateRmse:action[i].honestStateRmse-
      other[i].honestStateRmse,
      deltaHonestFinalV:action[i].honestMeanFinalV-
       other[i].honestMeanFinalV,
      deltaHonestCoverage:action[i].honestCoverage-
       other[i].honestCoverage,
      deltaOverrideRate:action[i].honestBarrierOverrideFraction-
       other[i].honestBarrierOverrideFraction});
    }
    paired.push({topology,partition,capacity,comparison:"local_action minus "+comparison,
     meanDeltaRmse:round(mean(deltas.map(d=>d.deltaHonestStateRmse))),
     meanDeltaFinalV:round(mean(deltas.map(d=>d.deltaHonestFinalV))),
     meanDeltaCoverage:round(mean(deltas.map(d=>d.deltaHonestCoverage))),
     meanDeltaBarrierOverrides:round(mean(deltas.map(d=>d.deltaOverrideRate))),
     deltas});
   }
  }
const cols=Object.keys(rows[0]);
writeFileSync(path.join(dest,"adaptive-local-plant-pilot.csv"),
 [cols.join(";"),...rows.map(r=>cols.map(k=>r[k]).join(";"))].join("\n")+"\n");
writeFileSync(path.join(dest,"adaptive-local-plant-pilot.json"),JSON.stringify({
 model:LOCAL_PLANT_VERSION,scientificStatus:"synthetic exploratory, R=3; not externally calibrated",
 design:"2 topology × 2 partition × 2 capacity × 3 controller × 3 seed",
 rows,individual,paired},null,2)+"\n");
const byComp=name=>paired.filter(x=>x.comparison.endsWith(name));
console.log("E1-A PLANT SUMMARY "+JSON.stringify({
 cells:rows.length,plantRuns:individual.reduce((s,x)=>s+x.runs.length,0),
 nominalContractive:true,zeroSafetyViolations:true,zeroIssViolations:true,
 actionVsDirectMeanDeltaRmse:round(mean(byComp("local_decision").map(x=>x.meanDeltaRmse))),
 actionVsSensorMeanDeltaRmse:round(mean(byComp("local_sensor").map(x=>x.meanDeltaRmse))),
 actionVsSensorBetterCells:byComp("local_sensor").filter(x=>x.meanDeltaRmse<0).length,
 status:"exploratory measured-plant closed loop; no Byzantine guarantees"}));
