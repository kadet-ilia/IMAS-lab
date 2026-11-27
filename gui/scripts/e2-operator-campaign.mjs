// E2.29 predeclared paired pilot. Each case has a distinct configuration;
// three independent stream/calibration repetitions, shared across policies.
import fs from "node:fs";
import path from "node:path";
import {EXTRA_DEFAULTS} from "../src/automaticDecisions/extendedStudies.js";
import {seedFor} from "../src/automaticDecisions/extendedModel.js";
import {random} from "../src/automaticDecisions/kernel.js";
import {heterogeneousQueue} from "../src/automaticDecisions/heterogeneousQueue.js";
const ROOT=20261127,N=128,R=3,seq=n=>Array.from({length:n},(_,i)=>i),sum=a=>a.reduce((s,v)=>s+v,0),mean=a=>a.length?sum(a)/a.length:null;
function config(i){
 const seed=seedFor(ROOT,119000+i),r=random(seedFor(seed,11)),u=(a,b)=>a+(b-a)*r(),n=(a,b)=>Math.floor(u(a,b+1));
 const groups=[3,3,3],operatorSpec=[
 {name:"Fast",rate:u(12,24),fp:u(.06,.18),fn:u(.08,.22),cost:u(.12,.28),hourly:u(.4,.9),reserve:false},
 {name:"Expert",rate:u(5,12),fp:u(.005,.05),fn:u(.01,.06),cost:u(.25,.55),hourly:u(.8,1.8),reserve:false},
 {name:"Reserve",rate:u(9,20),fp:u(.025,.10),fn:u(.03,.12),cost:u(.15,.4),hourly:u(.5,1.5),reserve:true}
 ];
 const arrival=u(25,70),peakMultiplier=u(1.5,4),reserveOn=n(1,6);
 return {...EXTRA_DEFAULTS,seed,groups,u:[groups.map(()=>u(.08,.25)),groups.map(()=>u(.75,.95))],rho:groups.map(()=>u(.05,.4)),m:n(1500,5000),prior:u(.15,.65),drop:u(.05,.4),family:"l1",stress:"none",eta:0,b:6,f:2,d:.6,c:u(.6,1.5),safetyRisk:u(.7,1.5),queueExperiment:"heterogeneous",queueHorizon:6,queueWarmup:.5,arrival,peakMultiplier,peakStart:.3,peakEnd:.65,queueCapacity:n(5,20),deadline:u(.12,.6),queueWaitCost:u(.2,2),failureCost:u(1,4),feedbackGain:u(0,3),priorityThreshold:.5,queuePriority:true,queueReps:R,operatorSpec,reserveOn,reserveOff:n(0,reserveOn-1)};
}
const keys=["loss","decisionLoss","taskCost","waitLoss","failureLoss","staffCost","coverage","failed","miss","false","operatorError","meanStaff","Wq","Lq","rho"];
function metrics(rows){
 return keys.reduce((a,k)=>({...a,[k]:mean(rows.map(v=>v[k]).filter(Number.isFinite))}),{});
}
function pair(rows,i,j,k){
 const a=rows.map(v=>[v.aggregate[i][k],v.aggregate[j][k]]).filter(v=>v.every(Number.isFinite)),d=a.map(([x,y])=>x-y);
 return {N:d.length,mean:mean(d),negative:d.filter(x=>x< -1e-10).length,zero:d.filter(x=>Math.abs(x)<=1e-10).length,positive:d.filter(x=>x>1e-10).length,min:Math.min(...d),max:Math.max(...d)};
}
function stats(rows){
 return {cases:rows.length,policies:seq(4).map(j=>({policy:rows[0].aggregate[j].policy,...metrics(rows.map(v=>v.aggregate[j]))})),
 feedbackVsConstant:Object.fromEntries(["loss","failed","coverage"].map(k=>[k,pair(rows,1,0,k)])),
 skillVsFeedback:Object.fromEntries(["loss","failed","coverage","decisionLoss","operatorError"].map(k=>[k,pair(rows,2,1,k)])),
 reserveVsFull:Object.fromEntries(["loss","failed","coverage","decisionLoss","staffCost","meanStaff","operatorError","miss","waitLoss"].map(k=>[k,pair(rows,3,2,k)])),
 reserveSavesAndNoMoreFailure:rows.filter(v=>v.aggregate[3].loss<v.aggregate[2].loss-1e-10&&v.aggregate[3].failed<=v.aggregate[2].failed+1e-10).length,
 reserveSavingsButMoreFailure:rows.filter(v=>v.aggregate[3].loss<v.aggregate[2].loss-1e-10&&v.aggregate[3].failed>v.aggregate[2].failed+1e-10).length};
}
const dir=process.argv[2]||"operator-campaign";fs.mkdirSync(dir,{recursive:true});
const rows=seq(N).map(i=>{
 const input=config(i),runs=seq(R).map(rep=>heterogeneousQueue(input,{kind:"heterogeneousQueue",rep}));
 for(const r of runs){
  const first=r.outcomes[0].events.map(v=>v.id).sort((a,b)=>a-b);
  for(const [j,o] of r.outcomes.entries()){
   const v=r.summary[j],ids=o.events.map(v=>v.id).sort((a,b)=>a-b);
   if(v.N<=0||v.unsafe||JSON.stringify(ids)!==JSON.stringify(first)||Math.abs(v.loss-v.decisionLoss-v.taskCost-v.waitLoss-v.failureLoss-v.staffCost)>1e-9||Math.abs(v.coverage+v.served+v.failed-1)>1e-9)throw Error("Invalid paired outcomes");
  }
 }
 const aggregate=seq(4).map(j=>({policy:runs[0].summary[j].policy,...metrics(runs.map(r=>r.summary[j]))}));
 // Compact primary evidence retained: counts, all run metrics, seeds,
 // calibration and per-operator counters. Detailed event logs for first case.
 return {case:i+1,input,aggregate,runs:runs.map(r=>({unit:r.unit,summary:r.summary,calibrationCounts:r.calibrationCounts,calSeed:r.calSeed,arrivalSeed:r.arrivalSeed,observationSeed:r.observationSeed,serviceSeed:r.serviceSeed,errorSeed:r.errorSeed,operatorStats:r.operatorStats,counts:r.outcomes.map(v=>v.counts),...(i===0?{outcomes:r.outcomes,trace:r.trace}:{})}))};
});
if(new Set(rows.map(v=>JSON.stringify({...v.input,seed:0}))).size!==N)throw Error("Duplicate configurations");
const summary={seed:ROOT,uniqueConfigurations:N,reps:R,all:stats(rows),confirmation:stats(rows.slice(64)),strata:{lowLoad:stats(rows.filter(v=>v.input.arrival/(v.input.operatorSpec[0].rate+v.input.operatorSpec[1].rate)<=1.5)),highLoad:stats(rows.filter(v=>v.input.arrival/(v.input.operatorSpec[0].rate+v.input.operatorSpec[1].rate)>1.5))},scope:"Synthetic paired descriptive comparisons; all-arrival intensity / base capacity strata, not utilization. Equal weight of configurations and nonempty runs. No field or population inference."};
fs.writeFileSync(path.join(dir,"cases.json"),JSON.stringify(rows));fs.writeFileSync(path.join(dir,"summary.json"),JSON.stringify(summary,null,2));console.log("OPERATOR_CAMPAIGN "+JSON.stringify(summary));
