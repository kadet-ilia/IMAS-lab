import test from "node:test";
import assert from "node:assert/strict";
import {executeStudy,executeStudyChunk,validateStudy,researchCheckpointUnits,
 RESEARCH_MODEL_VERSION,RESEARCH_CHECKPOINT_SCHEMA} from "./research2027.js";

const configs={
 uncertainty:{runs:23,agents:21,seed:20261106},
 probgraph:{runs:23,agents:18,steps:4,seed:20261107},
 petri:{agents:7,runs:1,steps:4,stateLimit:5000,seed:20261108},
 cascade:{runs:23,seed:20261109},
 misinformation:{runs:23,seed:20261110}
};
const comparable=value=>{const copy=structuredClone(value);delete copy.elapsedMs;return copy;};
for(const [id,config] of Object.entries(configs)){
 test("NZ-14 checkpoint fidelity matches uninterrupted computation: "+id,()=>{
  const expected=executeStudy(id,config),validated=validateStudy(id,config);
  let state=null,last=0,checkpoints=0,part;
  do{
   part=executeStudyChunk(id,config,state);
   assert.equal(part.totalUnits,researchCheckpointUnits(id,validated));
   assert.equal(part.completedUnits,last+1);
   if(!part.done){
    assert.equal(part.state.schemaVersion,RESEARCH_CHECKPOINT_SCHEMA);
    assert.equal(part.state.modelVersion,RESEARCH_MODEL_VERSION);
    assert.equal(part.state.configSignature,JSON.stringify(validated));
    state=JSON.parse(JSON.stringify(part.state));
    checkpoints++;
   }
   last=part.completedUnits;
  }while(!part.done);
  assert.equal(last,part.totalUnits);
  assert.equal(checkpoints,id==="petri"?0:part.totalUnits-1);
  assert.deepEqual(comparable(part.result),comparable(expected));
  if(state){
   assert.throws(()=>executeStudyChunk(id,{...config,seed:config.seed+1},state),/иной модели или конфигурации/);
   assert.throws(()=>executeStudyChunk(id,config,{...state,modelVersion:"stale"}),/иной модели или конфигурации/);
   assert.throws(()=>executeStudyChunk(id,config,{...state,nextScenario:part.totalUnits}),/индекс/);
  }
 });
}
test("NZ-14 corrupted RNG snapshot and incomplete arrays are rejected",()=>{
 const c=configs.uncertainty,first=executeStudyChunk("uncertainty",c);
 assert.equal(first.done,false);
 assert.throws(()=>executeStudyChunk("uncertainty",c,{...first.state,randomState:0}),/ГПСЧ/);
 assert.throws(()=>executeStudyChunk("uncertainty",c,{...first.state,rows:[]}),/rows/);
});
