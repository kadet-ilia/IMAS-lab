#!/usr/bin/env node
/**
 * Internal protocol-locked SYNTHETIC holdout. Does not imply real-world
 * reproducibility or external physical calibration. Uses new seeds that
 * were not used by the exploratory stage-13 and stage-14 pilots.
 */
import {readFileSync,mkdirSync,writeFileSync} from "node:fs";
import {createHash} from "node:crypto";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {simulateLocalPlant} from "../src/adaptiveLocalPlant.js";
import {auditCrossObservationGraph} from "../src/adaptiveLocalCrossSensing.js";
import {exactMcNemarTwoSided} from "../src/adaptiveCrossHoldoutStatistics.js";
import {localPlantAdjacency} from "../src/adaptiveLocalPlant.js";

const directory=path.resolve(path.dirname(fileURLToPath(import.meta.url)),
 "../adaptive-results");
const protocolPath=path.resolve(directory,
 "../docs/adaptive-local-cross-geometry-holdout-protocol.json");
const bytes=readFileSync(protocolPath);
const sha256=createHash("sha256").update(bytes).digest("hex");
const p=JSON.parse(bytes.toString("utf8"));
if(p.schemaVersion!==1||p.protocolId!=="e1a-physical-range-internal-holdout-1.0.0"||
 p.nPaired!==32||p.alpha!==0.05||p.seedBase!==20300101||
 p.seedStride!==7919||p.selectedPrimary.plantCrossObservationMode!=="range_geometry"||
 p.selectedPrimary.plantControlMode!=="local_sensor"||
 p.selectedPrimary.topology!=="complete"||
 p.selectedPrimary.maximumRange!==2.05||
 p.selectedPrimary.plantCertificationPenalty!==10||
 p.negativeControlRuns!==8)
 throw Error("Locked physical holdout protocol was changed: inspect version and preregister again");

const results=[];
function pair(seed,topology,maxRange,label){
 const opts={...p.selectedPrimary,plantSeed:seed,
  plantTopology:topology,
  plantCrossMaxRange:maxRange};
 delete opts.topology;delete opts.maximumRange;
 const out=[];
 for(const enabled of [false,true]){
  const r=simulateLocalPlant({...opts,plantCrossEnabled:enabled},0);
  const ch=r.crossTransport;
  if(r.records.some(x=>Math.abs(x.stateAfter)>r.options.plantSafeBound+1e-9)||
   r.rows.some(x=>x.slotsUsed>r.options.plantCapacity)||
   (enabled&&(!ch||ch.generated!==ch.delivered+ch.lost+ch.blocked+
    ch.expired+ch.superseded+ch.pending))||
   (r.status!=="completed"&&r.metrics.honestStateRmse!==null))
   throw Error("Holdout violated safety, censoring, or shared message ledger");
  out.push(r);
 }
 if(JSON.stringify(out[0].initial)!==JSON.stringify(out[1].initial))
  throw Error("Holdout simulator changed paired exogenous initial state");
 const A=out[0].records,B=out[1].records;
 for(let j=0;j<Math.min(A.length,B.length);j++)
  if(A[j].disturbance!==B[j].disturbance)
   throw Error("Holdout simulator changed paired exogenous disturbance");
 const audit=auditCrossObservationGraph(
  localPlantAdjacency(opts.plantAgents,topology).adjacency,out[1].options);
 if(audit.potentiallyObservableCount===0&&out[1].records.some(x=>x.crossSupported))
  throw Error("Impossible remote certification without enough direct physical sources");
 const record={label,seed,topology,maxRange,
  possiblePhysicalSources:audit.physicalSources[0],
  possibleDirectSources:audit.admissibleDirectSources[0],
  off:out[0].status==="completed",on:out[1].status==="completed",
  offSteps:out[0].completedSteps,onSteps:out[1].completedSteps,
  offLoss:out[0].metrics.fixedHorizonLoss,
  onLoss:out[1].metrics.fixedHorizonLoss,
  offFailure:out[0].certificateFailure,
  onFailure:out[1].certificateFailure,
  supportFraction:out[1].metrics.honestCrossSupportedFraction,
  refinementFraction:out[1].metrics.honestCrossRefinementFraction};
 return {record,off:out[0],on:out[1],audit};
}
for(let k=0;k<p.nPaired;k++){
 const seed=p.seedBase+k*p.seedStride;
 results.push(pair(seed,p.selectedPrimary.topology,
  p.selectedPrimary.maximumRange,"primary").record);
}
const primary=results.filter(x=>x.label==="primary");
const mcnemar=exactMcNemarTwoSided(primary);
const delta=primary.map(x=>x.onLoss-x.offLoss);
const mean=arr=>arr.reduce((s,v)=>s+v,0)/arr.length;
const variance=mean(delta.map(x=>(x-mean(delta))**2))*delta.length/(delta.length-1);
const secondary={meanPairedLossDelta:mean(delta),
 samplePairedLossSD:Math.sqrt(variance),
 descriptiveNormalCI95HalfWidth:1.96*Math.sqrt(variance/delta.length)};
const negativeControls=[];
for(const control of p.negativeControls){
 const arr=[];
 for(let k=0;k<p.negativeControlRuns;k++){
  const seed=p.seedBase+900001+k*p.seedStride+
   (control.name==="no_physical_range"?0:811);
  const run=pair(seed,control.topology,control.maximumRange,control.name);
  if(run.audit.potentiallyObservableCount!==0||
   run.record.off!==run.record.on||
   run.record.offLoss!==run.record.onLoss||
   run.off.completedSteps!==run.on.completedSteps||
   JSON.stringify(run.off.records.map(x=>x.stateAfter))!==
   JSON.stringify(run.on.records.map(x=>x.stateAfter)))
   throw Error("Negative physical-observability control failed: "+control.name);
  arr.push(run.record);results.push(run.record);
 }
 negativeControls.push({name:control.name,episodes:arr.length,
  offCompleted:arr.filter(x=>x.off).length,
  onCompleted:arr.filter(x=>x.on).length,
  equivalentPhysics:true});
}
const penaltySensitivity=p.secondaryPenaltySensitivity.map(lambda=>{
 const score=(completed,loss)=>completed?loss:lambda;
 return {lambda,meanDelta:mean(primary.map(x=>
  score(x.on,x.onLoss)-score(x.off,x.offLoss)))};
});
// Note: for an incomplete run "loss" is the baseline lambda=10;
// these entries must be replaced with any newly specified lambda above.
const output={protocolId:p.protocolId,protocolSha256:sha256,
 version:"e1a-geometry-heldout-execution-1.0.0",
 baseline:"internal synthetic numeric holdout; not hardware validation",
 independentSeeds:p.nPaired,primary:mcnemar,
 primaryDecisionAtAlpha05:mcnemar.pValue<p.alpha?"reject paired marginal equality":"not rejected",
 secondary,penaltySensitivity,negativeControls,results,
 caveat:"No external calibration, and repeating CI with identical seeds does not create independent evidence"};
mkdirSync(directory,{recursive:true});
writeFileSync(path.join(directory,"adaptive-local-cross-geometry-holdout.json"),
 JSON.stringify(output,null,2)+"\n");
const fields=["label","seed","topology","maxRange","off","on",
 "offSteps","onSteps","offLoss","onLoss","possiblePhysicalSources",
 "possibleDirectSources","supportFraction","refinementFraction"];
writeFileSync(path.join(directory,"adaptive-local-cross-geometry-holdout.csv"),
 [fields.join(";"),...results.map(r=>fields.map(k=>r[k]??"").join(";"))].join("\n")+"\n");
console.log("E1-A CROSS GEOMETRY HOLDOUT SUMMARY "+JSON.stringify({
 protocolId:p.protocolId,protocolSha256:sha256,paired:p.nPaired,
 primary:mcnemar,secondary,penaltySensitivity,negativeControls,
 status:"INTERNAL_SYNTHETIC_ONLY_NOT_EXTERNALLY_CALIBRATED"}));
