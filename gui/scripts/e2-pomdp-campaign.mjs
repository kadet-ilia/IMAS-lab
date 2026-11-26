// Two predeclared synthetic domains, 128 configurations each.
import fs from "node:fs";
import path from "node:path";
import {EXTRA_DEFAULTS} from "../src/automaticDecisions/extendedStudies.js";
import {seedFor} from "../src/automaticDecisions/extendedModel.js";
import {random} from "../src/automaticDecisions/kernel.js";
import {dynamicPomdp} from "../src/automaticDecisions/dynamicPomdp.js";
const ROOT=20261201,N=128,seq=n=>Array.from({length:n},(_,i)=>i),sum=a=>a.reduce((s,v)=>s+v,0),mean=a=>sum(a)/a.length;
function config(i,domain){
 const seed=seedFor(ROOT,10000*domain+i),r=random(seed),u=(a,b)=>a+(b-a)*r(),n=(a,b)=>Math.floor(u(a,b+1));
 return {...EXTRA_DEFAULTS,seed,experiment:"pomdp",prior:u(.2,.8),b:u(1,6),f:u(1,4),d:0,c:u(.45,1.3),safetyRisk:u(.55,1.5),waitCost:u(.005,.08),pomdpHorizon:n(2,4),p01:domain===1?u(0,.25):u(0,.08),p10:domain===1?u(0,.25):u(0,.08),transitionRadius:domain===1?u(.005,.1):u(0,.025),
 pomdpAgents:seq(4).map(j=>({name:"A"+(j+1),u0:u(.025,.3),u1:u(.7,.975),availability:domain===2?u(.45,1):u(.85,1),delay:domain===2?n(1,3):n(1,2),cost:domain===2?u(.005,.18):u(.005,.05),radius:u(0,.04)}))};
}
function pair(rows,i,j,k){const v=rows.map(r=>r.summary[i][k]-r.summary[j][k]);return {mean:mean(v),negative:v.filter(x=>x< -1e-9).length,positive:v.filter(x=>x>1e-9).length,zero:v.filter(x=>Math.abs(x)<=1e-9).length,min:Math.min(...v),max:Math.max(...v)};}
function stats(rows){
 return {cases:rows.length,policies:rows[0].summary.map((v,i)=>({policy:v.policy,loss:mean(rows.map(r=>r.summary[i].loss)),stressLoss:mean(rows.map(r=>r.summary[i].stressLoss)),upperRisk:mean(rows.map(r=>r.summary[i].upperRisk)),coverage:mean(rows.map(r=>r.summary[i].coverage)),stressCoverage:mean(rows.map(r=>r.summary[i].stressCoverage)),queries:mean(rows.map(r=>r.summary[i].queries)),delay:mean(rows.map(r=>r.summary[i].delay)),unsafe:Math.max(...rows.map(r=>r.summary[i].unsafe)),stressUnsafe:Math.max(...rows.map(r=>r.summary[i].stressUnsafe))})),robustVsNominal:{nominal:pair(rows,5,4,"loss"),stress:pair(rows,5,4,"stressLoss"),upper:pair(rows,5,4,"upperRisk")},robustVsGreedy:{upper:pair(rows,5,3,"upperRisk")},nominalVsCyclic:{nominal:pair(rows,4,2,"loss")},meanGap:mean(rows.map(r=>r.optimalityGap)),differentFirst:rows.filter(r=>r.summary[4].firstAction!==r.summary[5].firstAction).length,activeFirstNotFirstAgent:rows.filter(r=>r.input.pomdpAgents.slice(1).some(a=>a.name===r.summary[5].firstAction)).length,meanStates:mean(rows.map(r=>r.states))};
}
const dir=process.argv[2]||"pomdp-campaign";fs.mkdirSync(dir,{recursive:true});
const all=[];
for(const domain of [1,2]){
 const rows=seq(N).map(i=>{const input=config(i,domain),r=dynamicPomdp(input);return {case:i+1,input,...r};});
 if(new Set(rows.map(r=>JSON.stringify({...r.input,seed:0}))).size!==N)throw Error("Duplicate configuration");
 const report={domain:domain===1?"dynamic":"heterogeneous",all:stats(rows),confirmation:stats(rows.slice(64))};
 fs.writeFileSync(path.join(dir,report.domain+".json"),JSON.stringify(rows));all.push(report);console.log("POMDP_CAMPAIGN "+JSON.stringify(report));
}
fs.writeFileSync(path.join(dir,"summary.json"),JSON.stringify({seed:ROOT,uniqueConfigurations:2*N,results:all},null,2));
