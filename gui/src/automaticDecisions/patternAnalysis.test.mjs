import test from "node:test";
import assert from "node:assert/strict";
import {pairedCases,splitCases,discoverRules,evaluateRules,binomialTail,holm,analyzeBatch} from "./patternAnalysis.js";
const axes=["rhoScale","drop"],rows=Array.from({length:80},(_,i)=>({id:i,factors:{rhoScale:i/80,drop:(i*17%80)/80},gain:i>30?.2:-.1,reps:2,seeds:[i+1,i+101]}));
const settings={metric:"loss",candidate:"B",baseline:"A",direction:"lower",margin:.01,minN:5,target:.7,maxRules:5,seed:123};
test("Whole configurations, paired repetitions and complete-plan checks",()=>{
 const plan=rows.flatMap(r=>[0,1].map(rep=>({case:r.id,rep,values:r.factors,seed:r.seeds[rep]}))),records=plan.map(u=>({unit:u,summary:[{policy:"A",loss:1},{policy:"B",loss:1-rows[u.case].gain}]}));
 const x=pairedCases(records,plan,settings);assert.equal(x.length,80);assert.ok(Math.abs(x[31].gain-.2)<1e-12);assert.throws(()=>pairedCases(records.slice(1),plan,settings));assert.throws(()=>pairedCases([...records,records[0]],plan,settings));
 const r=analyzeBatch(records,plan,axes,settings);assert.equal(r.discoveryN,40);assert.equal(r.confirmationN,40);assert.equal(new Set([...r.split.discovery,...r.split.confirmation]).size,80);assert.ok(r.rules.every(v=>v.p===null&&v.significant===null));
});
test("Discovery rules fixed independently of confirmation outcomes",()=>{
 const {discovery,confirmation}=splitCases(rows,123),f=discoverRules(discovery,axes,settings);assert.ok(f.rules.length>0);
 const a=evaluateRules(f,confirmation),b=evaluateRules(f,confirmation.map(r=>({...r,gain:-.5})));assert.deepEqual(a.rules.map(r=>r.conditions),b.rules.map(r=>r.conditions));assert.ok(b.rules.every(r=>r.confirmation.success===0&&r.exceptions.length===r.confirmation.n));assert.ok(b.rules.some(r=>r.status==="not_reproduced"));
});
test("Exact binomial tails and Holm correction",()=>{
 assert.ok(Math.abs(binomialTail(4,3,.5)-5/16)<1e-12);assert.equal(binomialTail(5,0,.8),1);assert.ok(Math.abs(binomialTail(10,10,.75)-.75**10)<1e-12);assert.deepEqual(holm([.01,.04,.03]),[.03,.06,.06]);
 const f=discoverRules(rows,axes,settings),a=evaluateRules(f,rows,{iidFresh:true});assert.ok(a.rules.every(r=>r.pHolm>=r.p));assert.throws(()=>discoverRules([...rows,rows[0]],axes,settings));
});
