import test from "node:test";
import assert from "node:assert/strict";
import {METRIC_PASSPORTS,passportForStudy,auditResultMetrics} from "./metricPassport.js";
import {STUDY_DEFS,executeStudy} from "./research2027.js";
import {runActionSync} from "./trustEngine.js";
const ids=["trust",...STUDY_DEFS.map(s=>s.id)];
test("UP-04 all six studies have unique formal metric descriptions, source and null policy",()=>{
 assert.equal(ids.length,6);
 for(const id of ids){
  const passports=passportForStudy(id);
  assert.ok(passports.length>=4,id);
  assert.equal(new Set(passports.map(p=>p.code)).size,passports.length);
  for(const p of passports){
   for(const k of ["code","title","unit","formula","denominator","missing","source","scope"])
    assert.ok(typeof p[k]==="string"&&p[k].trim(),id+" "+p.code+"."+k);
  }
 }
 assert.throws(()=>passportForStudy("unknown"));
 assert.equal(Object.keys(METRIC_PASSPORTS).length,6);
});
test("UP-04 synthetic study outputs satisfy published accounting invariants",()=>{
 const configs={
  uncertainty:{runs:25},probgraph:{runs:25,agents:9},petri:{steps:3,criticalCount:4},
  cascade:{runs:25},misinformation:{runs:25}
 };
 for(const id of STUDY_DEFS.map(s=>s.id)){
  const result=executeStudy(id,configs[id]);
  const check=auditResultMetrics(id,result);
  assert.equal(check.valid,true,id+": "+check.issues.join(";"));
  assert.equal(result.metricIntegrity.valid,true);
  assert.ok(result.metricPassport.length>=4);
  assert.equal(result.metricPassportVersion,check.version);
 }
});
test("UP-04 regression: malformed accounting is rejected instead of exported unmarked",()=>{
 const correct=executeStudy("misinformation",{runs:20});
 const changed={...correct,rows:correct.rows.map(r=>({...r}))};
 changed.rows[0].abstentionProbability+=.1;
 const validation=auditResultMetrics("misinformation",changed);
 assert.equal(validation.valid,false);
 assert.match(validation.issues.join(" " ),/outcome partition/);
 const trust=runActionSync({action:"trace",config:{n_agents:11,n_byzantine:2,n_steps:10,trim_each_side:2}});
 assert.equal(auditResultMetrics("trust",trust).valid,true);
 assert.ok(trust.metricPassport.length>=4);
 assert.ok(trust.metricIntegrity.valid);
});
