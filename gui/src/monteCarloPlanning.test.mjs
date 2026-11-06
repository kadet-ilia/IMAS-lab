import test from "node:test";
import assert from "node:assert/strict";
import {planMonteCarlo} from "./monteCarloPlanning.js";
import {wilson95} from "./statistics2027.js";

test("MC planner: all five stochastic experiments, no false application to formal E4",()=>{
 for(const studyId of ["trust","uncertainty","probgraph","cascade","misinformation"]){
  const data=planMonteCarlo({runs:500,studyId});
  assert.ok(data.requiredRunsForPrecision>=2);
  assert.ok(data.requiredPairsForComparison>=2);
  assert.equal(data.runs,500);
  assert.equal(data.studyId,studyId);
  assert.match(data.assumptions,/модельной ошибки|модельной/);
 }
 assert.throws(()=>planMonteCarlo({runs:1,studyId:"petri"}),/Формальная/);
});
test("MC planner: precision recommendation matches exact Wilson worst-case",()=>{
 for(const width of [.1,.05,.03,.02,.01]){
  const data=planMonteCarlo({runs:100,targetHalfWidth:width});
  const n=data.requiredRunsForPrecision;
  const interval=wilson95(Math.floor(n/2),n);
  assert.ok((interval.upper-interval.lower)/2<=width+1e-12);
  if(n>1){
   const previous=wilson95(Math.floor((n-1)/2),n-1);
   assert.ok((previous.upper-previous.lower)/2>width-1e-12);
  }
 }
});
test("MC planner: paired effect is prospective and stronger assumptions increase required R",()=>{
 const strong=planMonteCarlo({runs:1000,minimumEffect:.04,discordance:.3});
 const weak=planMonteCarlo({runs:1000,minimumEffect:.08,discordance:.3});
 assert.ok(strong.requiredPairsForComparison>weak.requiredPairsForComparison);
 assert.throws(()=>planMonteCarlo({runs:500,minimumEffect:.2,discordance:.1}),/Δ/);
});
test("MC planner: ES95 warns for fewer than ten tail equivalents",()=>{
 assert.equal(planMonteCarlo({studyId:"cascade",runs:100}).tailUnderTen,true);
 assert.equal(planMonteCarlo({studyId:"cascade",runs:200}).tailUnderTen,false);
 assert.equal(planMonteCarlo({studyId:"uncertainty",runs:100}).expectedTailEquivalents,null);
});
