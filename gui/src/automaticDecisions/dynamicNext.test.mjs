import test from "node:test";
import assert from "node:assert/strict";
import {EXTRA_DEFAULTS,studyPlan,evaluateUnit,summarizeStudy} from "./extendedStudies.js";
import {weightedLaw,weightedTables,adaptiveNext} from "./adaptiveNext.js";
import {stoppingPolicy,optimalStopping} from "./optimalStopping.js";
import {groupGeometry} from "./extendedModel.js";
import {processQueue,closedQueue,jointPlan,jointSummary} from "./closedLoopQueue.js";
const close=(a,b,e=1e-10)=>assert.ok(Math.abs(a-b)<=e,JSON.stringify([a,b,e]));
const base={...EXTRA_DEFAULTS,groups:[2,2],u:[[.15,.2],[.85,.8]],rho:[.2,.2],m:500,steps:100,window:50,shortWindow:20,delay:10,updateEvery:20,adaptiveReps:2,queryBudget:3,queueHorizon:1,queueWarmup:0,arrival:30,queueReps:2,operators:2,operatorMin:1,operatorMax:2,priceLevels:1,gainLevels:1,queueCapacity:2,deadline:.1};
test("Exponential weights preserve normalization and reduce effective sample size",()=>{
 const h=[[0],[1]],w=weightedLaw(h,1,0,2,.5);close(w.p[0],1/3);close(w.p[1],2/3);close(w.effectiveN,1.8);close(weightedLaw(h,1,0,2).effectiveN,2);
 const history=[Array.from({length:50},()=>[0,1]),Array.from({length:50},()=>[2,1])],a=weightedTables(base,history,50,1,.001),b=weightedTables(base,history,50,.98,.001);assert.ok(b.radii[0][0]>=a.radii[0][0]);
});
test("Adaptive model uses delayed labels, paired regimes and complete summaries",()=>{
 const c={...base,experiment:"weighted"},p=studyPlan("dynamics",c);assert.equal(p.length,4);
 const a=adaptiveNext(c,p[0]);assert.deepEqual(a,adaptiveNext(c,p[0]));assert.equal(a.released,90);assert.equal(a.summary.length,4);assert.equal(a.stationaryGuarantee,true);assert.ok(a.finalHistory.every(r=>r.length===50));assert.equal(a.trace.at(-1).t,100);
 const records=p.map(u=>evaluateUnit("dynamics",c,u,p.length)),s=summarizeStudy("dynamics",c,records);assert.equal(s.rows.length,8);assert.ok(s.rows.every(r=>r.reps===2));assert.equal(records[1].stationaryGuarantee,false);
});
test("DP chooses the informative group rather than the cyclic first group",()=>{
 const c={...base,groups:[1,1],prior:.35,c:1.25,b:6,f:2,d:.6,safetyRisk:1.5,queryBudget:1,queryCost:.1};
 const G=c.groups.map(groupGeometry),hat=[[[.5,.5],[1,0]],[[.5,.5],[0,1]]],p=hat.map(row=>row.map((v,g)=>G[g].H.map(h=>h.reduce((s,w,j)=>s+w*v[j],0)))),T={G,hat,low:p,high:p};
 const active=stoppingPolicy(c,T,true),cyclic=stoppingPolicy(c,T,false);
 assert.equal(active.root.query,1);close(active.root.value,.1+.35*.6);close(cyclic.root.value,1.25);assert.ok(active.root.value<=cyclic.root.value);
 assert.equal(stoppingPolicy({...c,queryBudget:0},T,true).root.action,2);
});
test("Active stopping is nominally optimal among restricted policies and never violates safety gate",()=>{
 const c={...base,experiment:"optimal"},r=optimalStopping(c);assert.equal(r.summary.length,3);assert.ok(r.summary[2].nominalValue<=r.summary[1].nominalValue+1e-10);assert.ok(r.summary[1].nominalValue<=r.summary[0].nominalValue+1e-10);assert.ok(r.summary.every(v=>v.unsafe===0&&v.delay<=c.queryBudget));assert.equal(studyPlan("dynamics",c)[0].kind,"optimal");
});
const item=(id,t,lo=0,hi=1,service=1,x=0)=>({id,t,x,lo,hi,service});
test("Queue balances overflow, timeout and successful service with known losses",()=>{
 const c={...base,operators:1,queueHorizon:3,queueWarmup:0,queueCapacity:1,deadline:.5,queueOperatorLoss:1,queueWaitCost:2,failureCost:3,safetyRisk:0,c:1};
 const r=processQueue(c,[item(0,0),item(1,.1),item(2,.2),item(3,1.1)],false);
 assert.equal(r.counts.served,2);assert.equal(r.counts.timeout,1);assert.equal(r.counts.rejected,1);assert.equal(r.N,4);close(r.loss,(2+3+1+3)/4);close(r.Lq,.5/3);close(r.rho,2/3);assert.equal(r.unsafe,0);
});
test("Priority is nonpreemptive and respects arrival and deadline",()=>{
 const c={...base,operators:1,queueHorizon:4,queueWarmup:0,queueCapacity:3,deadline:3,queuePriority:true,priorityThreshold:.8,safetyRisk:0};
 const stream=[item(0,0),item(1,.1,0,.7),item(2,.2,0,1)];
 const r=processQueue(c,stream,false),e=r.events.filter(a=>a.outcome==="served");assert.deepEqual(e.map(a=>a.id),[0,2,1]);assert.equal(r.counts.served,3);assert.ok(e.every(a=>a.wait>=0&&a.wait<c.deadline));close(e[1].wait,.8);
});
test("Large feedback price never relaxes the independent safety bound",()=>{
 const c={...base,operators:1,queueHorizon:2,queueWarmup:0,c:.01,safetyRisk:.1,feedbackGain:1000,deadline:.5,queueCapacity:2};
 const stream=[item(0,0),item(1,.01,0,.2),item(2,.02,0,.001)],r=processQueue(c,stream,true);
 assert.equal(r.unsafe,0);assert.equal(r.counts.auto,1);assert.equal(r.events.find(v=>v.id===1).action,2);assert.equal(r.events.find(v=>v.id===2).action,0);
});
test("Common random streams and separate economic cost in joint design",()=>{
 const c={...base,queueExperiment:"closed",feedbackGain:0},r=closedQueue(c,{kind:"closedQueue",rep:0});const a=r.summary[0],b=r.summary[1];for(const k of ["coverage","loss","failed","Wq","Lq","rho"])assert.equal(a[k],b[k]);assert.ok(a.N>0);assert.equal(a.unsafe,0);
 const j={...c,queueExperiment:"joint",requiredCoverage:0,riskLimit:1000,failureLimit:1},p=jointPlan(j),records=p.map(u=>evaluateUnit("queue",j,u,p.length)),s=jointSummary(j,records);assert.equal(p.length,4);assert.equal(s.rows.length,2);assert.ok(s.rows.every(v=>v.reps===2&&v.unsafe===0&&v.status==="simulation_bound"));assert.ok(s.aux.length>=1);assert.equal(records[0].arrivalSeed,records[2].arrivalSeed);
});
