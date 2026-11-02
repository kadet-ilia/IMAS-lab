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


test("all research modules provide reproducible directed graphs and stepped replays",()=>{
 for(const study of STUDY_DEFS){
  const cfg=small[study.id],a=executeStudy(study.id,cfg),b=executeStudy(study.id,cfg),replay=a.replay;
  assert.ok(Array.isArray(replay.vertices)&&replay.vertices.length===a.config.agents,study.id+" vertices");
  assert.ok(Array.isArray(replay.edges)&&replay.edges.length>0,study.id+" edges");
  assert.ok(Array.isArray(replay.frames)&&replay.frames.length>=2,study.id+" frames");
  assert.deepEqual(replay,b.replay,study.id+" replay seed determinism");
  for(let i=0;i<replay.frames.length;i++){
   const frame=replay.frames[i];
   assert.equal(frame.status.length,a.config.agents,study.id+" status coverage");
   if(i)assert.ok(frame.step>replay.frames[i-1].step,study.id+" frame ordering");
   for(const [u,v] of frame.activeEdges)assert.ok(replay.edges.some(([x,y])=>x===u&&y===v),study.id+" activity must follow edge");
  }
 }
});
test("replay respects zero-propagation and simulated state transitions",()=>{
 const p=executeStudy("probgraph",{runs:8,spread:0,steps:5});
 assert.ok(p.replay.frames.every(f=>f.status.filter(x=>x==="compromised").length===1));
 const c=executeStudy("cascade",{runs:8,spread:0});
 assert.ok(c.replay.frames.every(f=>f.status.filter(x=>x==="affected").length===1));
 const m=executeStudy("misinformation",{runs:8,spread:0});
 assert.ok(m.replay.frames.every(f=>f.status.filter(x=>x==="misled").length===0));
 const n=executeStudy("petri",{criticalCount:3,steps:4,detectionDelay:10});
 assert.ok(n.replay.frames.at(-1).status.filter(s=>s==="compromised").length>=3);
});
