import test from "node:test";
import assert from "node:assert/strict";
import {petriReference} from "./petriOracle.js";
import {runPetri,validateStudy} from "./research2027.js";

test("UP-23 independent time-frontier oracle matches BFS over 128 bounded Petri cases",()=>{
 let checked=0;
 for(const isolationPolicy of [0,1])
 for(const steps of [1,2,3,4])
 for(const detectionDelay of [0,1,3,5])
 for(const criticalCount of [2,3,5,7]){
  const params={steps,detectionDelay,criticalCount,isolationPolicy};
  const reference=petriReference(params);
  const actual=runPetri(validateStudy("petri",{...params,stateLimit:50000}));
  assert.notEqual(actual.verdict,"inconclusive",JSON.stringify(params));
  assert.equal(actual.verdict,reference.verdict,JSON.stringify(params));
  if(actual.verdict==="reachable"){
   assert.equal(actual.witness[0],"t=0: скомпрометирован A1");
   assert.ok(actual.witness.length-1<=steps);
   assert.equal(actual.witness.length-1,reference.firstReachableTick);
  }
  checked++;
 }
 assert.equal(checked,128);
});
test("UP-23 truncated BFS is never allowed to claim bounded safety",()=>{
 const params={steps:5,criticalCount:7,isolationPolicy:0,detectionDelay:10};
 const complete=runPetri(validateStudy("petri",{...params,stateLimit:50000}));
 const reference=petriReference({...params,detectionDelay:10});
 assert.equal(complete.verdict,reference.verdict);
 const cut=runPetri({...validateStudy("petri",{...params,stateLimit:100}),stateLimit:5}); // Probe internal BFS limit, below public UI minimum.
 assert.equal(cut.verdict,"inconclusive");
 assert.ok(cut.enqueued>cut.processed);
 assert.equal(cut.witness.length,0);
});
test("UP-23 oracle rejects unsupported horizons and policy values",()=>{
 assert.throws(()=>petriReference({steps:13,criticalCount:2,detectionDelay:0,isolationPolicy:0}));
 assert.throws(()=>petriReference({steps:1,criticalCount:8,detectionDelay:0,isolationPolicy:0}));
 assert.throws(()=>petriReference({steps:1,criticalCount:2,detectionDelay:0,isolationPolicy:2}));
});
