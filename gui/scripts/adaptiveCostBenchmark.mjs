#!/usr/bin/env node
/**
 * M7: reproducible wall/CPU benchmark, NOT isolated alpha cost or a
 * real-time guarantee. Runs in one pinned GitHub Actions job; host
 * metadata and source fingerprints are recorded for audit.
 * Usage: node gui/scripts/adaptiveCostBenchmark.mjs --stage=smoke|reference
 */
import {createHash} from "node:crypto";
import {mkdirSync,readFileSync,writeFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import path from "node:path";
import os from "node:os";
import {performance} from "node:perf_hooks";
import {runAdaptiveSingle} from "../src/adaptiveExperiment.js";
import {costStudyDesign,costStudyParameters,E1A_COST_MODES,E1A_COST_CASES,
 E1A_COST_VERSION} from "../src/adaptiveCostProtocol.js";

const args=process.argv.slice(2);
if(args.length>1||args.some(a=>!/^--stage=(design|smoke|reference)$/.test(a)))
 throw Error("Only --stage=design|smoke|reference is supported");
const stage=args[0]?.slice(8)??"smoke",design=costStudyDesign();
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const files=[
 "src/trustEngine.js","src/trustMethods.js","src/attackProfiles.js",
 "src/adaptiveDecisionEngine.js","src/adaptiveExperiment.js",
 "src/adaptiveScenario.js","src/adaptiveRiskController.js",
 "src/adaptiveRegimeDetector.js","src/adaptiveEvidenceQuality.js",
 "src/adaptivePolicySelector.js","src/adaptiveCostProtocol.js",
 "scripts/adaptiveCostBenchmark.mjs"
];
const hash=createHash("sha256");
for(const f of files)hash.update(f+"\0").update(readFileSync(path.join(root,f))).update("\0");
const sourceSha256=hash.digest("hex");
const json=x=>JSON.stringify(x,null,2)+"\n";
const planSha256=createHash("sha256").update(json(design)).digest("hex");
const resultDir=path.join(root,"adaptive-results","cost",sourceSha256.slice(0,16));
mkdirSync(resultDir,{recursive:true});
if(stage==="design"){
 console.log(json({design,sourceSha256,planSha256}));
 process.exit(0);
}
const median=a=>{
 const b=[...a].sort((x,y)=>x-y),i=(b.length-1)/2;
 return (b[Math.floor(i)]+b[Math.ceil(i)])/2;
};
const quantile=(a,p)=>{
 const b=[...a].sort((x,y)=>x-y),pos=p*(b.length-1),i=Math.floor(pos);
 return b[i]+(b[Math.min(i+1,b.length-1)]-b[i])*(pos-i);
};
const finite=Number.isFinite;
function testBaseline(reference,other){
 if(reference.trajectory.length!==other.trajectory.length)
  throw Error("M7 baseline trajectory length changed");
 for(let i=0;i<reference.trajectory.length;i++){
  const a=reference.trajectory[i],b=other.trajectory[i];
  for(const key of ["step","truth","attack_intensity","trimmed_unweighted","proposed_robust"]){
   if(!Object.is(a[key],b[key]))throw Error("M7 E1 baseline changed: "+key+" step "+i);
  }
 }
}
const data=[],stagePlan=design.stages[stage];
for(const [caseIndex,c] of E1A_COST_CASES.entries()){
 for(let index=-stagePlan.warmup;index<stagePlan.measured;index++){
  const sampleIndex=index<0?10000+index:index;
  // Rotate order to reduce, not eliminate, JIT and scheduling bias.
  const offset=(index+stagePlan.warmup)%E1A_COST_MODES.length;
  const modes=[...E1A_COST_MODES.slice(offset),...E1A_COST_MODES.slice(0,offset)];
  let anchor=null;
  for(const mode of modes){
   const {core,options}=costStudyParameters(design,stage,mode,c);
   const startCpu=process.cpuUsage(),startWall=performance.now();
   const heapStart=process.memoryUsage().heapUsed;
   const output=runAdaptiveSingle(core,options,sampleIndex);
   const elapsed=performance.now()-startWall;
   const cpu=process.cpuUsage(startCpu);
   const heapDelta=process.memoryUsage().heapUsed-heapStart;
   if(!anchor)anchor=output;
   else testBaseline(anchor,output);
   if(index<0)continue;
   if(!finite(elapsed)||elapsed<0||cpu.user<0||cpu.system<0)
    throw Error("Invalid measured M7 cost");
   const metric=output.metrics.find(m=>m.method==="adaptive_robust");
   data.push({
    workload:c.id,comparisonMode:c.comparisonMode,
    mode,run:index,seed:core.seed,steps:core.n_steps,
    wallMs:elapsed,cpuMs:(cpu.user+cpu.system)/1000,
    heapDeltaBytes:heapDelta,
    rmse:metric.rmse,coverage:metric.decision_coverage,
    controlRmse:output.metrics.find(m=>m.method==="proposed_robust").rmse
   });
  }
 }
 console.log("M7 completed workload "+(caseIndex+1)+"/"+E1A_COST_CASES.length);
}
const expected=E1A_COST_CASES.length*E1A_COST_MODES.length*stagePlan.measured;
if(data.length!==expected||new Set(data.map(x=>
 x.workload+"|"+x.mode+"|"+x.run)).size!==expected)
 throw Error("M7 incomplete or duplicated measurements");
const groups=[];
for(const c of E1A_COST_CASES)
 for(const mode of E1A_COST_MODES){
  const rows=data.filter(r=>r.workload===c.id&&r.mode===mode);
  groups.push({
   workload:c.id,mode,runs:rows.length,
   wallMedianMs:median(rows.map(x=>x.wallMs)),
   wallQ25Ms:quantile(rows.map(x=>x.wallMs),0.25),
   wallQ75Ms:quantile(rows.map(x=>x.wallMs),0.75),
   cpuMedianMs:median(rows.map(x=>x.cpuMs)),
   meanRmse:rows.reduce((s,x)=>s+x.rmse,0)/rows.length
  });
 }
const diagnostics={
 status:"end_to_end_cost_diagnostic_not_algorithm_proof",
 stage,protocol:E1A_COST_VERSION,planSha256,sourceSha256,
 commit:process.env.GITHUB_SHA??null,
 host:{node:process.version,v8:process.versions.v8,
  platform:process.platform,arch:process.arch,
  cpuModel:os.cpus()[0]?.model??null,logicalCpus:os.cpus().length,
  totalMemoryBytes:os.totalmem(),ci:process.env.CI==="true"},
 measurements:expected,warmupPerModePerWorkload:stagePlan.warmup,
 observationsPerModePerWorkload:stagePlan.measured,
 sourceFiles:files,design,
 limitation:"Full simulation+E1+E1-A per-run timing. Not isolated alpha cost, controlled CPU benchmarking, clock determinism, or proof of real-time execution.",
 warning:"RSS and heap deltas are process-wide, affected by GC/JIT and do not provide per-mode peak memory.",
 groups
};
const csvFieldList=["workload","comparisonMode","mode","run","seed","steps",
 "wallMs","cpuMs","heapDeltaBytes","rmse","coverage","controlRmse"];
const csv=csvFieldList.join(";")+"\n"+data.map(row=>
 csvFieldList.map(k=>row[k]).join(";")).join("\n")+"\n";
writeFileSync(path.join(resultDir,stage+"-summary.json"),json(diagnostics));
writeFileSync(path.join(resultDir,stage+"-per-run.csv"),csv);
console.log("M7 COST RESULT "+JSON.stringify({
 stage,measurements:expected,groups,sourceSha256,planSha256,
 note:diagnostics.limitation
}));
