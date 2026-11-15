import test from "node:test";
import assert from "node:assert/strict";
import {TRUST_METHOD_IDS,TRUST_METHOD_DEFINITIONS,assertAllTrustMethods} from "./trustMethods.js";
import {METHODS,STABILITY_METHODS,aggregateProposals,trimmedWeightedMean,validateConfig,simulateRun,runActionSync} from "./trustEngine.js";

test("all trust experiment modes use the same four immutable IDs",()=>{
 assert.deepEqual(METHODS,TRUST_METHOD_IDS);
 assert.equal(STABILITY_METHODS,METHODS);
 assert.equal(new Set(TRUST_METHOD_DEFINITIONS.map(m=>m.label)).size,4);
 assert.equal(TRUST_METHOD_DEFINITIONS.length,4);
});
test("each of the four mathematical estimator definitions is independently reproducible",()=>{
 const c=validateConfig({n_agents:5,n_byzantine:0,trim_each_side:1,clip_radius:100,
  safe_action_min:-100,safe_action_max:100,minimum_weight:0});
 const x=[0,1,2,3,100],w=[1,2,3,4,5];
 const values=aggregateProposals(x,w,[true,true,true,true,true],c);
 const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-12,`${a} != ${b}`);
 near(values.arithmetic_mean,106/5);
 near(values.trust_weighted_mean,520/15);
 near(values.trimmed_unweighted,2);
 near(values.proposed_robust,20/9);
 assert.equal(assertAllTrustMethods(METHODS.map(method=>({method}))),true);
});
test("common trimming, safe projection, and missing observations have explicit rules",()=>{
 const c=validateConfig({n_agents:5,n_byzantine:0,trim_each_side:1,clip_radius:1,
  safe_action_min:-2,safe_action_max:2});
 const x=[1,1,1,1,100];
 const weighted=aggregateProposals(x,[1,1,1,1,1],[true,true,true,true,false],c);
 assert.equal(weighted.trimmed_unweighted,1);
 assert.equal(weighted.proposed_robust,1);
 const none=aggregateProposals(x,[1,1,1,1,1],[false,false,false,false,false],c);
 assert.deepEqual(Object.keys(none),METHODS);
 assert.ok(METHODS.every(id=>none[id]===null));
 assert.throws(()=>trimmedWeightedMean([1,2],[1],0),/одинаковой длины/);
 assert.throws(()=>trimmedWeightedMean([1,2],[1,NaN],0),/конечных/);
 assert.throws(()=>trimmedWeightedMean([1,2],[1,1],-1),/неотрицательным/);
});
test("no-adversary detection is undefined, not the false numerical assertion zero",()=>{
 const result=simulateRun({n_agents:7,n_byzantine:0,n_steps:12,attack_start_step:2,
  trim_each_side:1,seed:815},"static_bias",0,0,true);
 assert.equal(result.result.summary.first_attack_step,2);
 assert.equal(result.result.summary.detection_rate,null);
 assert.equal(result.result.summary.mean_detection_time,null);
 assert.ok(result.rows.every(r=>r.detection_rate===null));
});
test("dynamic attack detection uses actual onset rather than sidebar phase gap",()=>{
 const config={n_agents:7,n_byzantine:1,n_steps:12,attack_start_step:2,
  trim_each_side:1,seed:915,attack_schedule:[
   {start:1,intensity:0,profile:"constant"},
   {start:7,intensity:1,profile:"constant"}]};
 const result=simulateRun(config,"dynamic",0,0,true);
 assert.equal(result.result.summary.first_attack_step,7);
 assert.ok(result.result.series.slice(0,6).every(t=>t.attack_intensity===0));
 const silent=simulateRun({...config,attack_schedule:[{start:1,intensity:0}]},"dynamic",0,0,true);
 assert.equal(silent.result.summary.first_attack_step,null);
 assert.equal(silent.result.summary.detection_rate,null);
});
test("Monte Carlo, single run, sensitivity and factorial all expose four methods",()=>{
 const c={n_agents:7,n_byzantine:1,n_steps:8,attack_start_step:2,trim_each_side:1,
  n_runs:2,n_sensitivity_runs:1,factorial_runs_per_point:1,bootstrap_samples:100,seed:999};
 const trace=runActionSync({action:"trace",config:c});
 assertAllTrustMethods(trace.metrics);
 const mc=runActionSync({action:"monte_carlo",config:c});
 assertAllTrustMethods(mc.summary);
 assert.equal(mc.runs.length,2*4);
 assert.equal(mc.distributions.filter(x=>x.metric==="rmse_to_truth").length,4);
 assert.equal(mc.bootstrap_comparisons.length,12);
 const one=runActionSync({action:"sensitivity",sensitivity_mode:"one_factor",config:c,f_values:[0,1]});
 assertAllTrustMethods(one.sensitivity.filter(x=>x.n_byzantine===1));
 const ablation=runActionSync({action:"sensitivity",sensitivity_mode:"ablation",config:c});
 assert.equal(ablation.ablation_rows.length,4*4);
 const factorial=runActionSync({action:"sensitivity",sensitivity_mode:"factorial",config:c});
 assert.equal(factorial.factorialUncertainty.expectedMainEffects,4*6*4);
 assert.equal(factorial.main_effects.length,4*6*4);
 assert.equal(factorial.interaction_effects.length,4*15*4);
 assertAllTrustMethods(factorial.main_effects.filter(x=>x.metric==="probability_correct"&&x.factorIndex===0));
});
