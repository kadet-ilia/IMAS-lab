// Independent Python reference; deterministic test inputs, no shared JS formulas.
import fs from "node:fs";
import {spawnSync} from "node:child_process";
import {EXTRA_DEFAULTS} from "../src/automaticDecisions/extendedStudies.js";
import {dependenceTables,dependencePoint} from "../src/automaticDecisions/dependenceRobust.js";
import {identifiedBounds} from "../src/automaticDecisions/identifiedBounds.js";
import {dynamicPomdp} from "../src/automaticDecisions/dynamicPomdp.js";
import {binomialTail,holm} from "../src/automaticDecisions/patternAnalysis.js";
import {random} from "../src/automaticDecisions/kernel.js";
const rnd=random(20261127),u=(a,b)=>a+(b-a)*rnd(),n=(a,b)=>Math.floor(u(a,b+1)),seq=k=>Array.from({length:k},(_,i)=>i),cases=[];
const base={...EXTRA_DEFAULTS,groups:[2,2],u:[[.15,.2],[.85,.8]],rho:[.2,.3],family:"l1",stress:"none",eta:0,b:6,f:2,d:.6,c:1.25,prior:.35,m:1000,reps:1};
for(let i=0;i<128;i++){
 const c={...base,prior:u(.1,.9),m:n(200,10000)},counts=[0,1].map(x=>c.groups.map(g=>{const a=seq(g+1).map(()=>n(1,100)),s=a.reduce((a,b)=>a+b,0),b=a.map(v=>Math.floor(c.m*v/s));b[0]+=c.m-b.reduce((a,b)=>a+b,0);return b;})),bound=u(0,.5),D=dependenceTables(c,counts,bound),ix=D.T.G.map(g=>n(0,g.pairs.length-1));
 cases.push({kind:"tv",id:i,input:{groups:c.groups,counts,alpha:c.alpha,bound,prior:c.prior,ix},actual:dependencePoint(c,D,ix)});
}
for(let i=0;i<128;i++){
 const N=1000,forced=seq(4).map(()=>n(0,200)),h=u(.01,.08),gamma=u(1,8),completion={forced,lower:forced.map(v=>Math.max(0,v/N-h)),upper:forced.map(v=>Math.min(1,(v+N-forced.reduce((a,b)=>a+b,0))/N+h))};
 const a=identifiedBounds(completion,N,h,gamma);
 cases.push({kind:"identification",id:i,input:{completion,N,h,gamma},actual:[...a.lower,...a.upper,+a.compatible]});
}
for(let i=0;i<128;i++){
 const c={...base,prior:n(1,9)/10,b:3,f:2,d:.2,c:n(4,15)/10,safetyRisk:n(5,15)/10,waitCost:n(0,5)/100,p01:n(0,3)/10,p10:n(0,3)/10,transitionRadius:0,pomdpHorizon:n(1,3),pomdpAgents:seq(2).map(j=>({name:"A"+j,u0:n(1,4)/10,u1:n(6,9)/10,availability:n(5,10)/10,delay:n(1,2),cost:n(0,8)/100,radius:0}))};
 const a=dynamicPomdp(c);
 cases.push({kind:"pomdp",id:i,input:{prior:c.prior,b:c.b,f:c.f,d:c.d,c:c.c,safetyRisk:c.safetyRisk,waitCost:c.waitCost,p01:c.p01,p10:c.p10,pomdpHorizon:c.pomdpHorizon,pomdpAgents:c.pomdpAgents},actual:[a.lowerBound,a.upperBound]});
}
for(let i=0;i<128;i++){
 const N=n(5,1000),k=n(0,N),p=u(.01,.99),ps=seq(n(1,12)).map(()=>u(0,1));
 cases.push({kind:"statistics",id:i,input:{N,k,p,ps},actual:[binomialTail(N,k,p),...holm(ps)]});
}
const p=spawnSync("python",["../research/automatic-decisions/reference/late_reference.py"],{input:JSON.stringify(cases),encoding:"utf8",maxBuffer:16*1024*1024});
if(p.status!==0)throw Error(p.stderr||p.error||"Independent reference failed");
const result=JSON.parse(p.stdout);
if(result.cases!==cases.length||result.failures.length)throw Error(JSON.stringify(result));
fs.writeFileSync(process.argv[2]||"e2-late-verification.json",JSON.stringify(result,null,2));console.log("E2_LATE_REFERENCE "+JSON.stringify(result));
