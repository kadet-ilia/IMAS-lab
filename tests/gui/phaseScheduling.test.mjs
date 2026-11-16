import test from "node:test";
import assert from "node:assert/strict";
import {addAttackPhase,expandedHorizon,validatePhaseGaps,MAX_STABILITY_STEPS} from "../../gui/src/phaseScheduling.js";
import {defaultAttackPhases,validateAttackPhases} from "../../gui/src/attackProfiles.js";

test("adding phases advances their boundaries by the configured attack interval",()=>{
 const gap=20,base=defaultAttackPhases(200,gap);
 assert.equal(base.length,5);
 assert.deepEqual(base.map(p=>p.start),[1,21,41,61,81]);
 validatePhaseGaps(base,gap);
 let phases=base;
 for(let count=6;count<=14;count++){
  const next=addAttackPhase(phases,gap);
  assert.equal(next.phases.at(-1).start,phases.at(-1).start+gap);
  assert.equal(next.steps,(count+1)*gap);
  assert.equal(next.phases.length,count);
  validatePhaseGaps(next.phases,gap);
  validateAttackPhases(next.phases,next.steps);
  phases=next.phases;
 }
 assert.equal(expandedHorizon(14,20),300);
 assert.equal(phases.at(-1).start,261);
});

test("automatic T depends on phase count and interval, not on manually entered T",()=>{
 const p=defaultAttackPhases(200,20);
 assert.equal(addAttackPhase(p,20).steps,140);
 assert.equal(expandedHorizon(7,20),160);
 assert.equal(expandedHorizon(7,5),40);
 assert.equal(expandedHorizon(14,20),300);
});
test("manual boundary editing is checked against configured phase gap",()=>{
 assert.throws(()=>validatePhaseGaps([{start:1},{start:5}],5),/не менее/);
 assert.doesNotThrow(()=>validatePhaseGaps([{start:1},{start:6}],5));
 assert.throws(()=>addAttackPhase([{start:1},{start:100}],20),/превышает/);
});
test("overflow and nonintegral phase duration fail before a job starts",()=>{
 assert.throws(()=>expandedHorizon(200,MAX_STABILITY_STEPS),/предел/);
 assert.throws(()=>expandedHorizon(14,2.5),/положительным целым/);
 assert.throws(()=>expandedHorizon(14,0),/положительным целым/);
 assert.throws(()=>addAttackPhase([{start:1}],MAX_STABILITY_STEPS),/предел/);
});
