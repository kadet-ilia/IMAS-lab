import test from "node:test";
import assert from "node:assert/strict";
import {addAttackPhase,expandedHorizon,validatePhaseGaps,MAX_STABILITY_STEPS} from "./phaseScheduling.js";
import {defaultAttackPhases,validateAttackPhases} from "./attackProfiles.js";
test("new phase starts at least one configured attack-start interval later",()=>{
 const phases=defaultAttackPhases(200,20);
 assert.equal(phases.length,5);
 validatePhaseGaps(phases,20);
 const a=addAttackPhase(phases,20,200);
 assert.equal(a.phases.length,6);
 assert.equal(a.phases[5].start,phases[4].start+20);
 assert.equal(a.steps,6*200+1);
 assert.equal(validateAttackPhases(a.phases,a.steps).length,6);
 validatePhaseGaps(a.phases,20);
 const b=addAttackPhase(a.phases,20,200);
 assert.equal(b.steps,7*200+1); // basis stays 200, no 7*1201 recursion
 assert.equal(b.phases[6].start,a.phases[5].start+20);
});
test("editing the basis T changes the next auto-calculated horizon",()=>{
 const p=defaultAttackPhases(30,2);
 assert.equal(addAttackPhase(p,2,30).steps,(p.length+1)*30+1);
 assert.equal(addAttackPhase(p,2,40).steps,(p.length+1)*40+1);
});
test("manual boundary editing is checked against selected attack-step gap",()=>{
 assert.throws(()=>validatePhaseGaps([{start:1},{start:5}],5),/не менее/);
 assert.doesNotThrow(()=>validatePhaseGaps([{start:1},{start:6}],5));
});
test("overflow beyond practical computational horizon reports a validation error",()=>{
 assert.throws(()=>expandedHorizon(200,MAX_STABILITY_STEPS),/предел/);
 assert.throws(()=>addAttackPhase([{start:1}],20,MAX_STABILITY_STEPS),/предел/);
});
