import test from "node:test";
import assert from "node:assert/strict";
import {executeStudy,executeStudyChunk,validateStudy} from "./research2027.js";
import {auditResultMetrics} from "./metricPassport.js";

const configs={
 probgraph:{agents:10,runs:7,seed:20271101,edgeProbability:.35,spread:.28,
  steps:5,criticalFraction:.3,record_source_runs:1,source_run_limit:7,source_event_limit:20000},
 cascade:{agents:8,runs:7,seed:20271102,spread:.38,lossScale:1.3,
  defenseFactor:.55,record_source_runs:1,source_run_limit:7,source_event_limit:20000}
};
const comparable=result=>{const x=structuredClone(result);delete x.elapsedMs;return x;};
for(const [id,config] of Object.entries(configs)){
 test("NZ-15 full E3/E5 source runs and propagation audit: "+id,()=>{
  const output=executeStudy(id,config),journal=output.sourceRunJournal;
  assert.equal(output.metricIntegrity.valid,true);
  assert.equal(journal.schemaVersion,2);
  assert.equal(journal.complete,true);
  assert.equal(journal.entries.length,(id==="probgraph"?4:8)*config.runs);
  let eventCount=0;
  const ids=new Set();
  for(const entry of journal.entries){
   const index=id==="probgraph"?entry.scenarioIndex:entry.source;
   const key=index+":"+entry.run;
   assert.ok(!ids.has(key));ids.add(key);
   assert.ok(entry.edges.every(e=>e.length===2));
   assert.ok(entry.eventTape.every(t=>t.length===entry.edges.length));
   assert.ok(entry.eventTape.every(t=>t.every(v=>v>=0&&v<1)));
   assert.equal(entry.methodDefenses.length,id==="probgraph"?3:2);
   eventCount+=entry.edges.length*entry.eventTape.length;
  }
  assert.equal(eventCount,journal.edgeEventCount);
  assert.equal(auditResultMetrics(id,output).valid,true);
  const noArchive=executeStudy(id,{...config,record_source_runs:0});
  assert.equal(noArchive.sourceRunJournal,undefined);
  assert.deepEqual(output.rows,noArchive.rows,"source logging changed scientific estimates");
  assert.deepEqual(output.pairedRuns,noArchive.pairedRuns);
  assert.deepEqual(output.pairedEffects,noArchive.pairedEffects);
 });
 test("NZ-14 full archive resumed from each scenario checkpoint: "+id,()=>{
  const expected=executeStudy(id,config);let state=null,output=null;
  for(let i=0;i<10;i++){
   const part=executeStudyChunk(id,config,state);
   if(part.done){output=part.result;break;}
   assert.equal(part.state.sourceRuns.length,part.completedUnits*config.runs);
   state=JSON.parse(JSON.stringify(part.state));
  }
  assert.ok(output);
  assert.deepEqual(comparable(output),comparable(expected));
 });
 test("NZ-15 incomplete or fabricated source tapes are rejected: "+id,()=>{
  const correct=executeStudy(id,config);
  const missing=structuredClone(correct);
  missing.sourceRunJournal.entries.pop();
  assert.equal(auditResultMetrics(id,missing).valid,false);
  const wrongArm=structuredClone(correct);
  wrongArm.sourceRunJournal.entries[0].methodDefenses[0].defense=.91;
  assert.equal(auditResultMetrics(id,wrongArm).valid,false);
 });
}
const petri={agents:7,runs:1,seed:20271103,steps:9,criticalCount:7,
 detectionDelay:4,isolationPolicy:0,stateLimit:3000,record_marking_log:1,marking_log_limit:3000};
test("NZ-15 E4 complete bounded marking and transition journal",()=>{
 const result=executeStudy("petri",petri),journal=result.markingJournal;
 assert.equal(result.metricIntegrity.valid,true);
 assert.equal(journal.complete,true);
 assert.equal(journal.boundedByStateLimit,true);
 assert.equal(journal.records.length,result.processed);
 assert.equal(journal.records[0].index,0);
 assert.deepEqual(journal.initialMarking,{mask:1,isolated:0,t:0});
 assert.equal(journal.frontier.length,result.enqueued-result.processed);
 assert.ok(journal.records.every((state,i)=>state.index===i&&Array.isArray(state.successors)));
 assert.equal(auditResultMetrics("petri",result).valid,true);
 const without=executeStudy("petri",{...petri,record_marking_log:0});
 assert.equal(without.markingJournal,undefined);
 assert.deepEqual(result.rows,without.rows);
 assert.equal(result.verdict,without.verdict);
 assert.equal(result.enqueued,without.enqueued);
 const tampered=structuredClone(result);
 tampered.markingJournal.records.pop();
 assert.equal(auditResultMetrics("petri",tampered).valid,false);
});
test("NZ-14 E4 retained markings survive JSON checkpoint roundtrips",()=>{
 const expected=executeStudy("petri",petri);let state=null,result=null;
 for(let i=0;i<40;i++){
  const out=executeStudyChunk("petri",petri,state);
  if(out.done){result=out.result;break;}
  state=JSON.parse(JSON.stringify(out.state));
  assert.equal(state.markingLog.length,state.bfs.index);
 }
 assert.ok(result);
 assert.deepEqual(comparable(result),comparable(expected));
});
test("NZ-15 oversize archives reject, do not export truncated datasets",()=>{
 assert.throws(()=>validateStudy("probgraph",{...configs.probgraph,runs:8}),/R превышает лимит/);
 assert.throws(()=>validateStudy("cascade",{...configs.cascade,source_event_limit:0}),/целое число/);
 assert.throws(()=>executeStudy("cascade",{...configs.cascade,source_event_limit:100}),/лимит исходных событий/);
 assert.throws(()=>executeStudy("petri",{...petri,marking_log_limit:100}),/лимит обработанных маркировок/);
});
