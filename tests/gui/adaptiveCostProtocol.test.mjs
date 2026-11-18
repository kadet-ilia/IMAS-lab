import test from "node:test";
import assert from "node:assert/strict";
import {costStudyDesign,costStudyParameters,E1A_COST_CASES,
 E1A_COST_MODES,E1A_COST_STAGES,E1A_COST_VERSION}
 from "../../gui/src/adaptiveCostProtocol.js";
import {runAdaptiveSingle} from "../../gui/src/adaptiveExperiment.js";

const p=costStudyDesign();
test("M7 fixed computational-cost study declares separate feedback and common conditions",()=>{
 assert.equal(p.protocol,E1A_COST_VERSION);
 assert.deepEqual(E1A_COST_STAGES.smoke,{warmup:2,measured:2});
 assert.equal(E1A_COST_CASES.length,2);
 assert.equal(E1A_COST_MODES.length,4);
 assert.equal(new Set(E1A_COST_MODES).size,4);
 assert.ok(p.measurement.includes("End-to-end"));
 assert.ok(p.scientificLimits.some(x=>x.includes("not isolate")));
});
test("M7 parameter scheme is immutable and retains E1 and E1-A model constraints",()=>{
 for(const c of E1A_COST_CASES)for(const mode of E1A_COST_MODES){
  const {core,options}=costStudyParameters(p,"smoke",mode,c);
  assert.equal(core.n_agents,30);
  assert.equal(core.n_byzantine,9);
  assert.equal(core.n_steps,48);
  assert.equal(core.trim_each_side,6);
  assert.equal(core.network_enabled,false);
  assert.equal(options.comparisonMode,c.comparisonMode);
  assert.equal(options.evidenceModel,"behavior_linked");
  assert.equal(options.decisionRefusalPenalty,1);
  assert.equal(options.regimeSelectionMode,mode==="regime_aware_blend"?"blend":"discrete");
 }
 const bad=structuredClone(p);
 bad.fixedParameters.k=99;
 assert.throws(()=>costStudyParameters(bad,"smoke","adaptive",E1A_COST_CASES[0]),/modified/);
 assert.throws(()=>costStudyParameters(p,"oracle","adaptive",E1A_COST_CASES[0]),/outside/);
 assert.throws(()=>costStudyParameters(p,"smoke","oracle",E1A_COST_CASES[0]),/outside/);
});
test("M7 paired policies leave historical E1 decisions invariant in both workloads",()=>{
 for(const c of E1A_COST_CASES){
  const outputs=E1A_COST_MODES.map(mode=>{
   const {core,options}=costStudyParameters(p,"smoke",mode,c);
   return runAdaptiveSingle(core,options,0);
  });
  for(let i=1;i<outputs.length;i++){
   assert.equal(outputs[i].trajectory.length,48);
   for(let t=0;t<48;t++){
    const x=outputs[0].trajectory[t],y=outputs[i].trajectory[t];
    for(const key of ["step","truth","attack_intensity",
     "trimmed_unweighted","proposed_robust"])
     assert.ok(Object.is(x[key],y[key]),
      c.id+" "+E1A_COST_MODES[i]+" E1 drift at "+t+" key="+key);
   }
  }
 }
});
