// Pilot: 128 static + 128 dynamic distinct input configurations.
import fs from "node:fs";
import path from "node:path";
import {EXTRA_DEFAULTS} from "../src/automaticDecisions/extendedStudies.js";
import {seedFor} from "../src/automaticDecisions/extendedModel.js";
import {random} from "../src/automaticDecisions/kernel.js";
import {structureStudy,dynamicStructure} from "../src/automaticDecisions/structureOptimization.js";
const ROOT=20261130,N=128,seq=n=>Array.from({length:n},(_,i)=>i),sum=a=>a.reduce((s,v)=>s+v,0),mean=a=>sum(a)/a.length;
function config(i,dynamic){
 const seed=seedFor(ROOT,(dynamic?20000:10000)+i),r=random(seedFor(seed,11)),u=(a,b)=>a+(b-a)*r(),n=(a,b)=>Math.floor(u(a,b+1)),groups=i%2?[2,2,2]:[3,3],u0=u(.05,.3),u1=u(.7,.95),rho=u(.25,.95);
 return {...EXTRA_DEFAULTS,seed,groups,u:[groups.map(()=>u0),groups.map(()=>u1)],rho:groups.map(()=>rho),prior:u(.3,.65),drop:u(.05,.45),c:u(.7,1.8),b:6,f:2,d:.6,structSearch:dynamic?"graph":"exact",structMax:4,structBlock:n(160,400),structTest:1000,structReps:1,structRiskWeight:1,structCoverageWeight:u(.05,.4),structDependenceWeight:u(.1,1.5),structCostWeight:u(.01,.15),structPeriod:n(3,5)*100,structDwell:n(1,2)*300,structReconf:u(0,20),structHysteresis:u(0,.02),steps:n(1800,3000),delay:n(5,30),changeAt:u(.25,.45),family:"l1",stress:"none",eta:0,alpha:.05};
}
function paired(a,b,k){const v=a.map((r,i)=>r[k]-b[i][k]);return {mean:mean(v),negative:v.filter(x=>x< -1e-10).length,positive:v.filter(x=>x>1e-10).length,zero:v.filter(x=>Math.abs(x)<=1e-10).length,min:Math.min(...v),max:Math.max(...v)};}
function staticStats(a){
 const v=j=>a.map(r=>r.summary[j]);
 return {cases:a.length,meanCandidates:mean(a.map(r=>r.candidates.length)),meanPareto:mean(a.map(r=>r.candidates.filter(v=>v.pareto).length)),multiVsCMI:{loss:paired(v(2),v(1),"loss"),coverage:paired(v(2),v(1),"coverage"),dependence:paired(v(2),v(1),"dependence")},multiVsOriginal:{loss:paired(v(2),v(0),"loss"),coverage:paired(v(2),v(0),"coverage")},cmiVsOriginal:{loss:paired(v(1),v(0),"loss"),coverage:paired(v(1),v(0),"coverage"),dependence:paired(v(1),v(0),"dependence")},sameChoice:a.filter(r=>r.chosen[1]===r.chosen[2]).length};
}
function dynamicStats(a){
 const v=(shift,j)=>a.map(r=>r[shift].summary[j]),one=shift=>({dynamicVsRefit:{loss:paired(v(shift,2),v(shift,1),"loss"),decisionLoss:paired(v(shift,2),v(shift,1),"decisionLoss"),coverage:paired(v(shift,2),v(shift,1),"coverage")},dynamicVsFixed:{loss:paired(v(shift,2),v(shift,0),"loss"),coverage:paired(v(shift,2),v(shift,0),"coverage")},changes:mean(v(shift,2).map(r=>r.changes)),changedCases:v(shift,2).filter(r=>r.changes>0).length,reconfCost:mean(v(shift,2).map(r=>r.reconfCost))});
 return {cases:a.length,null:one("null"),shift:one("shift")};
}
const dir=process.argv[2]||"structure-campaign";fs.mkdirSync(dir,{recursive:true});
const st=seq(N).map(i=>{const input=config(i,false),r=structureStudy(input,{kind:"structure",rep:0});return {input,...r};});
const dy=seq(N).map(i=>{const input=config(i,true),a=dynamicStructure(input,{kind:"regroup",rep:0,shift:0}),b=dynamicStructure(input,{kind:"regroup",rep:0,shift:1});if(a.initialPartition!==b.initialPartition)throw Error("Unpaired initial structure");for(const r of [a,b]){if(r.events.some(v=>v.fitLast>=v.t))throw Error("Future calibration");const changed=r.updates.filter(v=>v.changed);if(changed.some((v,j)=>v.t-(j?changed[j-1].t:0)<input.structDwell))throw Error("Dwell violation");}
 return {input,null:a,shift:b};});
for(const a of [st,dy])if(new Set(a.map(r=>JSON.stringify(r.input))).size!==N)throw Error("Duplicated configurations");
const summary={seed:ROOT,uniqueConfigurations:2*N,static:{all:staticStats(st),confirmation:staticStats(st.slice(64))},dynamic:{all:dynamicStats(dy),confirmation:dynamicStats(dy.slice(64))}};
fs.writeFileSync(path.join(dir,"static.json"),JSON.stringify(st));fs.writeFileSync(path.join(dir,"dynamic.json"),JSON.stringify(dy));fs.writeFileSync(path.join(dir,"summary.json"),JSON.stringify(summary,null,2));console.log("STRUCTURE_CAMPAIGN "+JSON.stringify(summary));
