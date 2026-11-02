import test from "node:test";
import assert from "node:assert/strict";
import {executeStudy,STUDY_DEFS,toCsv,validateStudy} from "./research2027.js";

const small={
 uncertainty:{runs:20,agents:21},
 probgraph:{runs:20,agents:30,steps:3},
 petri:{runs:1,agents:7,steps:4,stateLimit:5000},
 cascade:{runs:20,agents:8},
 misinformation:{runs:20,agents:7}
};
for(const study of STUDY_DEFS){
 test("runs, returns data, and reproduces: "+study.id,()=>{
  const a=executeStudy(study.id,small[study.id]),b=executeStudy(study.id,small[study.id]);
  assert.equal(a.rows.length>0,true);
  assert.deepEqual(a.rows,b.rows);
  assert.deepEqual(a.config,b.config);
  assert.equal(a.model,"synthetic-experimental");
  assert.ok(toCsv(a.rows).startsWith("\ufeff"));
 });
}
test("no propagation means no cascaded damage",()=>{
 const x=executeStudy("cascade",{runs:30,spread:0});
 for(const row of x.rows)assert.ok(Math.abs(row.expectedDamage-row.directDamage)<1e-9);
});
test("zero spread and high threshold prevent a critical graph state",()=>{
 const x=executeStudy("probgraph",{runs:25,spread:0,criticalFraction:.9});
 for(const row of x.rows)assert.equal(row.dangerProbability,0);
});
test("formal reachability provides a witness when threshold reachable",()=>{
 const x=executeStudy("petri",{criticalCount:3,steps:4,detectionDelay:10});
 assert.equal(x.rows[0].value,"Да");
 assert.ok(x.witness.length>1);
});
test("formal model can prove a bounded non-reachability",()=>{
 const x=executeStudy("petri",{criticalCount:7,steps:1,stateLimit:5000});
 assert.equal(x.rows[0].value,"Нет");
 assert.equal(x.rows.at(-1).value,"Нет");
});
test("zero noise and no compromise yields no wrong collective decisions",()=>{
 const x=executeStudy("misinformation",{runs:50,noise:0,spread:0});
 for(const row of x.rows.filter(r=>r.compromised===0))assert.equal(row.wrongProbability,0);
});
test("validation rejects nonphysical configuration",()=>{
 assert.throws(()=>validateStudy("probgraph",{spread:1.2}));
 assert.throws(()=>validateStudy("cascade",{agents:9}));
 assert.throws(()=>validateStudy("petri",{stateLimit:5}));
});
