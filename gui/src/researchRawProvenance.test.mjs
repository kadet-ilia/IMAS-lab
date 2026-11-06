import test from "node:test";
import assert from "node:assert/strict";
import {executeStudy,executeStudyChunk,validateStudy} from "./research2027.js";
import {auditResultMetrics} from "./metricPassport.js";

const settings={
 uncertainty:{agents:11,runs:12,seed:260006,signalNoise:.32,loss:.22,corruption:.16,
  threshold:.18,record_source_runs:1,source_run_limit:12},
 misinformation:{agents:7,runs:12,seed:260007,spread:.45,noise:.3,attackBias:2.4,
  threshold:.12,costWrong:2,costRefuse:.4,record_source_runs:1,source_run_limit:12}
};
const comparable=value=>{const out=structuredClone(value);delete out.elapsedMs;return out;};
for(const [id,config] of Object.entries(settings)){
 test("NZ-15 complete first-party raw source run journal "+id,()=>{
  const full=executeStudy(id,config);
  assert.ok(full.metricIntegrity.valid);
  const archive=full.sourceRunJournal;
  assert.equal(archive.schemaVersion,1);
  assert.equal(archive.studyId,id);
  assert.equal(archive.complete,true);
  assert.equal(archive.entries.length,48);
  assert.deepEqual(archive.entries.map(e=>[e.scenarioIndex??e.compromised,e.run]),
   Array.from({length:4},(_,s)=>Array.from({length:12},(_,run)=>[s,run])).flat());
  for(const entry of archive.entries){
   assert.ok(entry.truth===1||entry.truth===-1);
   assert.equal(entry.methodEstimates.length,3);
   if(id==="uncertainty"){
    assert.equal(entry.messages.length,11);
    assert.equal(entry.observedCount,entry.messages.filter(m=>!m.missing).length);
   }else{
    assert.equal(entry.observations.length,7);
    assert.equal(entry.eventTapes.length,3);
    assert.ok(entry.eventTapes.every(t=>t.length===9));
    assert.equal(entry.trimEstimates[3],entry.methodEstimates[2]);
   }
  }
  assert.ok(auditResultMetrics(id,full).valid);
  const rawOff=executeStudy(id,{...config,record_source_runs:0});
  assert.equal(rawOff.sourceRunJournal,undefined);
  assert.deepEqual(full.rows,rawOff.rows,"raw logging must not consume RNG or alter outputs");
  if(id==="uncertainty")assert.deepEqual(full.oracleBenchmark,rawOff.oracleBenchmark);
  else{
   assert.deepEqual(full.scenarioMetrics,rawOff.scenarioMetrics);
   assert.deepEqual(full.robustnessSensitivity,rawOff.robustnessSensitivity);
  }
 });
 test("NZ-15 raw full-run checkpoints resume without duplication "+id,()=>{
  const reference=executeStudy(id,config);
  let state=null,result;
  for(let iteration=0;iteration<6;iteration++){
   const part=executeStudyChunk(id,config,state);
   if(part.done){result=part.result;break;}
   state=JSON.parse(JSON.stringify(part.state));
   assert.equal(state.sourceRuns.length,part.completedUnits*config.runs);
  }
  assert.ok(result,"expected finished result");
  assert.equal(result.sourceRunJournal.entries.length,config.runs*4);
  assert.deepEqual(comparable(result),comparable(reference));
 });
 test("NZ-15 incomplete source record is rejected "+id,()=>{
  const full=executeStudy(id,config),altered=structuredClone(full);
  altered.sourceRunJournal.entries.pop();
  assert.equal(auditResultMetrics(id,altered).valid,false);
  const shifted=structuredClone(full);
  shifted.sourceRunJournal.entries[0].methodEstimates[0]*=-1;
  assert.equal(auditResultMetrics(id,shifted).valid,false);
 });
}
test("NZ-15 source archives fail closed rather than silently sampling runs",()=>{
 for(const id of ["uncertainty","misinformation"]){
  const config=settings[id];
  assert.throws(()=>validateStudy(id,{...config,runs:13}),/R превышает лимит/);
  assert.throws(()=>validateStudy(id,{...config,source_run_limit:1001}),/целое число/);
  assert.throws(()=>validateStudy(id,{...config,record_source_runs:1,source_run_limit:1000,runs:1000,agents:21}),
   /предел 50000|фиксирован/);
 }
});
