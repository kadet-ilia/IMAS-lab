import test from "node:test";
import assert from "node:assert/strict";
import {EXTRA_DEFAULTS,studyPlan,evaluateUnit,summarizeStudy} from "./extendedStudies.js";
import {betaQuantileBracket} from "./statistics.js";
import {simplexMax} from "./probabilityBounds.js";
import {dirichletTables,chooseRiskThreshold,alternatives} from "./alternativeRisk.js";
import {fitPartialGroup,completionBounds,observationIndex} from "./partialCalibration.js";
import {validateObservations,partialExampleDataset} from "./dataValidation.js";
import {groupGeometry} from "./extendedModel.js";
const c={...EXTRA_DEFAULTS,groups:[2,2],u:[[.15,.2],[.85,.8]],rho:[.2,.2],m:500,mcN:1000,riskCalN:500,riskLevels:21,reps:2};
const close=(a,b,t=1e-9)=>assert.ok(Math.abs(a-b)<=t,JSON.stringify([a,b,t]));
test("Unequal simplex bounds and beta quantiles",()=>{
 close(simplexMax([0,2,1],[.1,.2,.1],[.6,.5,.5]),1.4);
 assert.throws(()=>simplexMax([1,2],[.6,.6],[.9,.9]));
 const b=betaQuantileBracket(1,1,.025);close(b[0],.025);close(b[1],.025);
 const d=betaQuantileBracket(2,1,.25);close(d[0],.5);
});
test("Dirichlet predictive mean and simultaneous credible box",()=>{
 const counts=[[[10,20,470],[200,100,200]],[[400,90,10],[100,200,200]]],r=dirichletTables(c,counts);
 for(let x=0;x<2;x++)for(let g=0;g<2;g++){close(r.hat[x][g].reduce((a,b)=>a+b,0),1);r.hat[x][g].forEach((v,j)=>assert.ok(v>=r.lower[x][g][j]&&v<=r.upper[x][g][j]));close(r.low[x][g][0],1);close(r.high[x][g][0],1);}
 close(r.hat[0][0][0],(10+1/3)/501);close(r.posteriorMassAtLeast,.95);
});
test("CRC finite nested thresholds with zero-risk fallback and leave-one-out bound",()=>{
 const rows=[{score:.1,autoLoss:0},{score:.2,autoLoss:1},{score:.3,autoLoss:0},{score:.4,autoLoss:1},{score:.5,autoLoss:0}];
 const thresholds=[0,.1,.2,.3,.4,.5],target=.4;
 const lossLOO=rows.map((r,i)=>{const a=chooseRiskThreshold(rows.filter((_,j)=>i!==j),thresholds,target,1,.05);return a.crc!==null&&r.score<=a.crc?r.autoLoss:0;});
 assert.ok(lossLOO.reduce((a,b)=>a+b,0)/rows.length<=target);const z=chooseRiskThreshold(rows,thresholds,0,1,.05);assert.equal(z.crc,null);assert.equal(z.pac,null);
 const p=chooseRiskThreshold(rows,thresholds,target,1,.05);assert.ok(p.curve.every((r,i)=>!i||r.autoRisk>=p.curve[i-1].autoRisk));assert.equal(p.curve.at(-1).autoRisk,.4);
});
test("Alternative methods use separate fit, risk calibration and test seeds",()=>{
 const z={...c,experiment:"alternatives"},p=studyPlan("sensitivity",z);assert.equal(p.length,2);
 const a=alternatives(z,0);assert.deepEqual(a,alternatives(z,0));assert.equal(new Set([a.calSeed,a.riskSeed,a.testSeed]).size,3);
 assert.equal(a.summary.length,5);assert.equal(a.riskRows.length,500);
 for(const r of a.summary){close(r.loss,r.autoRisk+z.c*(1-r.coverage));assert.ok(r.coverage>=0&&r.coverage<=1);}
 const records=p.map(u=>evaluateUnit("sensitivity",z,u,p.length));assert.equal(summarizeStudy("sensitivity",z,records).rows.length,10);
});
test("Complete observations recover multinomial proportions exactly",()=>{
 const hist=Array(groupGeometry(2).pairs.length).fill(0);hist[3]=20;hist[4]=30;hist[5]=50;
 const r=fitPartialGroup(2,hist);assert.deepEqual(r.p,[.2,.3,.5]);assert.ok(r.converged);assert.equal(r.complete,100);assert.ok(r.logLikelihood>=r.initialLogLikelihood);
 const bounds=completionBounds(2,hist,0);assert.deepEqual(bounds.lower,r.p);assert.deepEqual(bounds.upper,r.p);
});
test("Missing observations retain compatible counts, nonidentification explicit",()=>{
 const hist=[10,20,30,0,0,0],r=fitPartialGroup(2,hist),b=completionBounds(2,hist,0);
 assert.equal(r.identifiability,"design_rank_deficient");assert.equal(r.complete,0);close(r.p.reduce((a,b)=>a+b,0),1);assert.ok(r.logLikelihood>=r.initialLogLikelihood);
 assert.deepEqual(b.forced,[0,0,0]);assert.deepEqual(b.possible,[30,60,40]);assert.deepEqual(b.upper,[.5,1,2/3]);
 assert.equal(observationIndex([1,null,0]),4);
 const empty=fitPartialGroup(2,[20,0,0,0,0,0]);assert.deepEqual(empty.p,[1/3,1/3,1/3]);assert.equal(empty.logLikelihood,0);
});
test("Partial dataset calibration has no future-label leakage and no false certification",()=>{
 const f=partialExampleDataset(300,42),z={...EXTRA_DEFAULTS,calibrationMode:"partial",iidTest:true,trainFraction:.6},a=validateObservations(f,z);
 assert.equal(a.summary.length,2);assert.equal(a.split.trainN,180);assert.equal(a.split.testN,120);assert.equal(a.certified,false);assert.equal(a.synthetic,true);
 const other={...f,rows:f.rows.map((r,i)=>i<180?r:{...r,x:1-r.x})},b=validateObservations(other,z);
 assert.deepEqual(a.partial.fit,b.partial.fit);assert.deepEqual(a.trace.map(r=>r.action),b.trace.map(r=>r.action));
 assert.throws(()=>validateObservations(f,{...z,discoverGroups:true}));assert.throws(()=>validateObservations(f,{...z,calibrationMode:"complete"}));
});
