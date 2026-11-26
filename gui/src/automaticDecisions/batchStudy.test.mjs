import test from "node:test";
import assert from "node:assert/strict";
import {EXTRA_DEFAULTS,studyPlan,evaluateUnit,summarizeStudy} from "./extendedStudies.js";
import {batchPlan,batchDesign} from "./batchStudy.js";
const c={...EXTRA_DEFAULTS,groups:[2,2],u:[[.15,.2],[.85,.8]],rho:[.2,.3],m:300,reps:2,batchTarget:"exact",factor:"prior",from:.1,to:.6,factor2:"drop",from2:0,to2:.9,levels:3,levels2:4,batchN:128};
test("Full grid has distinct input configurations and unique repeat seeds",()=>{const p=studyPlan("batch",c);assert.equal(p.length,24);assert.equal(new Set(p.map(v=>JSON.stringify(v.values))).size,12);assert.equal(new Set(p.map(v=>v.seed)).size,24);assert.deepEqual(p,batchPlan(c));});
test("LHS covers each one-dimensional stratum exactly once",()=>{const z={...c,batchDesign:"lhs"},p=batchDesign(z);assert.equal(p.length,128);for(const [k,l,h] of [["prior",.1,.6],["drop",0,.9]])assert.equal(new Set(p.map(v=>Math.floor(128*(v[k]-l)/(h-l)))).size,128);assert.deepEqual(p,batchDesign(z));});
test("Batch exact uses existing model and aggregates only completed repeats",()=>{const p=studyPlan("batch",c),r=p.slice(0,3).map(u=>evaluateUnit("batch",c,u,p.length)),s=summarizeStudy("batch",c,r);assert.equal(s.rows.length,3);assert.equal(s.aux.length,2);assert.equal(s.aux[0].reps,2);assert.equal(s.aux[1].lossSD,null);assert.ok(r.every(v=>v.summary[0].coverage>=0&&v.primary.counts.length===2));assert.throws(()=>batchPlan({...c,factor2:"prior"}));});
test("Cross stress does not claim nominal assumptions",()=>{const z={...c,batchTarget:"cross",batchStress:.5},p=studyPlan("batch",z),r=evaluateUnit("batch",z,p[0],p.length);assert.equal(r.summary[0].assumptionsValid,false);assert.equal(r.primary.eta,.5);});
