import test from "node:test";
import assert from "node:assert/strict";
import {executeStudy,executeStudyChunk,validateStudy} from "./research2027.js";

test("UP-36 E2 complete message loss produces explicit refusal, never fabricated accuracy",()=>{
 const output=executeStudy("uncertainty",{agents:11,runs:29,seed:721,loss:1,
  threshold:.1,record_source_runs:1,source_run_limit:29});
 const scenario=output.rows.filter(r=>r.scenario==="Неполнота данных");
 assert.equal(scenario.length,3);
 for(const row of scenario){
  assert.equal(row.effectiveMissingProbability,1);
  assert.equal(row.coverage,0);
  assert.equal(row.errorRate,0);
  assert.equal(row.correctUnconditional,0);
  assert.equal(row.accuracy,null);
 }
 assert.equal(output.metricIntegrity.valid,true);
 assert.equal(output.sourceRunJournal.entries.filter(x=>x.scenarioIndex===1)
  .every(run=>run.messages.every(message=>message.missing===true)),true);
});
test("UP-36 E3 zero propagation and empty graph preserve initial exposure, no magical infection",()=>{
 for(const config of [
  {edgeProbability:0,spread:1},
  {edgeProbability:1,spread:0}
 ]){
  const output=executeStudy("probgraph",{agents:11,runs:17,steps:6,seed:722,
   criticalFraction:.4,...config});
  for(const row of output.rows){
   assert.ok(Math.abs(row.expectedFraction-row.initialCount/11)<1e-12);
   assert.equal(row.dangerProbability,0);
   assert.equal(row.p95Fraction,row.initialCount/11);
  }
  assert.equal(output.metricIntegrity.valid,true);
 }
});
test("UP-36 E5 full suppression cannot propagate beyond initial node",()=>{
 const output=executeStudy("cascade",{runs:21,seed:723,defenseFactor:1,spread:.8});
 for(const row of output.rows.filter(r=>r.method==="Защитные меры")){
  assert.ok(Math.abs(row.expectedDamage-row.directDamage)<1e-12);
  assert.ok(Math.abs(row.es95-row.directDamage)<1e-12);
  assert.equal(row.affectedAgents,1);
 }
 assert.ok(output.pairedRuns.every(p=>p.methods[1].affectedCount===1));
});
test("UP-36 E4 ideal priority isolation prevents compromise spread when τ=1",()=>{
 const data=executeStudy("petri",{agents:7,runs:1,steps:10,criticalCount:2,
  detectionDelay:1,isolationPolicy:1,stateLimit:500,
  record_marking_log:1,marking_log_limit:500});
 assert.equal(data.verdict,"unreachable_within_bound");
 assert.equal(data.markingJournal.complete,true);
 assert.ok(data.markingJournal.records.every(x=>Number.isInteger(x.mask)));
});
test("UP-36 E6 zero decision/refusal costs yield zero risk even with high abstentions",()=>{
 const out=executeStudy("misinformation",{runs:21,seed:725,threshold:100,
  costWrong:0,costRefuse:0});
 assert.equal(out.metricIntegrity.valid,true);
 assert.ok(out.rows.every(row=>row.risk===0&&row.abstentionProbability===1));
 assert.ok(out.robustnessSensitivity.every(row=>row.risk===0));
});
test("UP-36 all five studies reject nonfinite and invalid scientific controls",()=>{
 for(const study of ["uncertainty","probgraph","petri","cascade","misinformation"]){
  assert.throws(()=>validateStudy(study,{seed:NaN}),/конечное число/);
  assert.throws(()=>validateStudy(study,{runs:0}),/целое число/);
 }
});
