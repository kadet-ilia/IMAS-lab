import test from "node:test";
import assert from "node:assert/strict";
import {fklDesign,validateFklDesign,fklCellConfiguration,fklModeOptions,
 E1A_FKL_F,E1A_FKL_K,E1A_FKL_LAG,E1A_FKL_MODES}
 from "../../gui/src/adaptiveFklProtocol.js";
import {runAdaptiveSingle} from "../../gui/src/adaptiveExperiment.js";

const fields=["trimmed_unweighted","proposed_robust",
 "adaptive_unweighted","adaptive_weighted"];
test("FKL design freezes 4x5x4=80 cells plus 16 new-strategy confirmation cells",()=>{
 const d=fklDesign();
 assert.equal(d.stages.exploratory.length,80);
 assert.equal(d.stages.confirmatory.length,16);
 assert.equal(d.stages.smoke.length,3);
 assert.equal(E1A_FKL_F.length*E1A_FKL_K.length*E1A_FKL_LAG.length,80);
 assert.deepEqual(d.modes,E1A_FKL_MODES);
 for(const stage of ["exploratory","confirmatory","smoke"]){
  assert.equal(new Set(d.stages[stage].map(x=>x.id)).size,d.stages[stage].length);
  const seeds=new Map();
  for(const c of d.stages[stage]){
   if(seeds.has(c.f))assert.equal(c.seed,seeds.get(c.f));
   else seeds.set(c.f,c.seed);
  }
 }
 const stages=Object.values(d.stages).flat();
 for(const a of stages)for(const b of stages){
  if(a.stage!==b.stage)assert.notEqual(a.seed,b.seed);
 }
 assert.deepEqual(validateFklDesign(d),d);
 const tampered=structuredClone(d);
 tampered.stages.exploratory[2].lag=17;
 assert.throws(()=>validateFklDesign(tampered),/frozen design mismatch/);
});

test("FKL configurations vary f, k, lag and preserve period law versus behavior distinction",()=>{
 const d=fklDesign(),first=d.stages.exploratory[0],last=d.stages.exploratory.at(-1);
 const c0=fklCellConfiguration(first),c1=fklCellConfiguration(last);
 assert.equal(c0.config.n_byzantine,3);
 assert.equal(c0.config.trim_each_side,0);
 assert.equal(c0.options.evidenceLag,0);
 assert.equal(c1.config.n_byzantine,12);
 assert.equal(c1.config.trim_each_side,12);
 assert.equal(c1.options.evidenceLag,4);
 assert.equal(c0.options.evidenceModel,"lagged_observation");
 assert.equal(c0.options.attackStrategy,"coordinated");
 assert.equal(c0.options.scenario,"dynamic");
 assert.equal(c0.options.comparisonMode,"estimator_only");
 assert.equal(c0.options.phases[0].start,1);
 assert.equal(c0.options.phases[1].start,13);
 const confirm=d.stages.confirmatory[0],cw=fklCellConfiguration(confirm);
 assert.equal(cw.options.attackStrategy,"pulsed");
 assert.equal(confirm.temporalLaw,"hyperbolic");
 assert.equal(confirm.temporalSchedule,"double");
 assert.equal(cw.config.seed,confirm.seed);
 assert.equal(cw.options.runs,100);
});

test("FKL experiments use four explicit policy modes without changing trimming or scenario parameters",()=>{
 const c=fklCellConfiguration(fklDesign().stages.smoke[0]);
 const choices=E1A_FKL_MODES.map(mode=>fklModeOptions(c.options,mode));
 assert.deepEqual(choices.map(o=>o.alphaMode),[
  "adaptive","risk_aware","regime_aware","regime_aware"]);
 assert.equal(choices[2].regimeSelectionMode,"discrete");
 assert.equal(choices[3].regimeSelectionMode,"blend");
 for(const o of choices){
  assert.equal(o.trimEachSide,c.config.trim_each_side);
  assert.equal(o.evidenceLag,c.options.evidenceLag);
  assert.deepEqual(o.phases,c.options.phases);
  assert.equal(o.decisionRefusalPenalty,1);
 }
 assert.throws(()=>fklModeOptions(c.options,"oracle"),/unknown fixed policy/);
});

test("FKL common exogenous stream preserves all historical controls per run",()=>{
 const c=fklCellConfiguration(fklDesign().stages.smoke[0]);
 const r=E1A_FKL_MODES.map(mode=>runAdaptiveSingle(c.config,fklModeOptions(c.options,mode),0));
 for(let j=1;j<r.length;j++){
  for(let t=0;t<c.config.n_steps;t++){
   for(const field of fields)
    assert.equal(r[0].trajectory[t][field],r[j].trajectory[t][field],
     "mode-specific synthetic baseline changed: "+field+" at "+t);
   assert.equal(r[0].trajectory[t].attack_intensity,r[j].trajectory[t].attack_intensity);
  }
 }
 for(let j=0;j<r.length;j++){
  const m=r[j].metrics.find(x=>x.method==="adaptive_robust");
  assert.ok(Number.isFinite(m.rmse));
  assert.ok(Number.isFinite(m.unconditional_decision_loss));
 }
});
