import test from "node:test";
import assert from "node:assert/strict";
import {validateAdaptiveOptions,estimateAdaptiveDecision,ADAPTIVE_METHOD_IDS} from "./adaptiveDecisionEngine.js";
import {runAdaptiveSingle,runAdaptiveStudy,summarizeAdaptiveRuns,validateAdaptiveStudy} from "./adaptiveExperiment.js";
import {simulateRun} from "./trustEngine.js";

const near=(a,b,eps=1e-12)=>assert.ok(Math.abs(a-b)<eps,String(a)+" != "+String(b));
const core={
 n_agents:11,n_byzantine:2,n_steps:16,attack_start_step:3,trim_each_side:2,
 honest_noise_sigma:0.15,seed:58129,network_enabled:false,
 safe_action_min:-2,safe_action_max:2
};
const cfg={minimum_weight:0.05,trim_each_side:2,clip_radius:1.25,safe_action_min:-2,safe_action_max:2};
const observations=(values,weights=values.map(()=>0.5),historySteps=12)=>({
 values,reputation:weights,available:values.map(()=>true),historySteps,population:values.length
});
test("E1-A keeps five distinct estimator IDs without modifying original E1 registry",async()=>{
 const {TRUST_METHOD_IDS}=await import("./trustMethods.js");
 assert.equal(TRUST_METHOD_IDS.length,4);
 assert.equal(ADAPTIVE_METHOD_IDS.length,5);
 assert.deepEqual(ADAPTIVE_METHOD_IDS.slice(0,2),["trimmed_unweighted","proposed_robust"]);
 assert.ok(ADAPTIVE_METHOD_IDS.includes("adaptive_robust"));
});
test("adaptive alpha=0/1 reduces exactly to its own unweighted/weighted branch",()=>{
 const x=observations([0,0.1,0.2,0.21,0.3,0.33,2.1],[0.2,0.4,0.3,0.9,0.8,0.7,0.05]);
 const off=estimateAdaptiveDecision(x,{alphaMode:"off",trimEachSide:1},cfg);
 const fully=estimateAdaptiveDecision(x,{alphaMode:"fixed",fixedAlpha:1,trimEachSide:1},cfg);
 near(off.decisions.adaptive_robust,off.decisions.adaptive_unweighted);
 near(fully.decisions.adaptive_robust,fully.decisions.adaptive_weighted);
 near(fully.diagnostics.alpha,1);
 near(off.diagnostics.alpha,0);
 assert.ok(Number.isFinite(off.diagnostics.nEffective));
});
test("source-first weighted trimming remains invariant to reordering tied observations",()=>{
 const values=[-2,-2,-2,0.1,0.2,0.3,0.4,1.5,1.5,1.5];
 const weights=[.1,.8,.3,.2,.7,.9,.5,.95,.1,.6];
 const first=estimateAdaptiveDecision(observations(values,weights),{trimEachSide:2,trimMode:"source_first"},cfg);
 const reversed=estimateAdaptiveDecision(observations([...values].reverse(),[...weights].reverse()),
  {trimEachSide:2,trimMode:"source_first"},cfg);
 for(const method of ["adaptive_unweighted","adaptive_weighted","adaptive_robust"])
  near(first.decisions[method],reversed.decisions[method]);
 near(first.diagnostics.alpha,reversed.diagnostics.alpha);
});
test("adaptive trimming uses only observable extremes and respects retained-sample limit",()=>{
 const x=observations([0.1,0.2,0.3,0.4,0.5,0.6,0.7,5,6,7]);
 const v=estimateAdaptiveDecision(x,{adaptiveTrim:true,maxAdaptiveTrim:10,minRetained:6,
  outlierThreshold:1.5,trimEachSide:1},cfg);
 assert.ok(v.diagnostics.k<=2);
 assert.ok(v.diagnostics.k<=v.diagnostics.outlierCount);
 assert.ok(v.diagnostics.retained>=6);
 assert.ok(v.diagnostics.alpha>=0&&v.diagnostics.alpha<=1);
});
test("missing proposals give explicit refusal and invalid reputation is rejected",()=>{
 const no=estimateAdaptiveDecision({values:[NaN,NaN],available:[false,false],
  reputation:[.1,.9],historySteps:0}, {},cfg);
 for(const id of ADAPTIVE_METHOD_IDS)assert.equal(no.decisions[id],null);
 assert.equal(no.diagnostics.alpha,null);
 assert.throws(()=>estimateAdaptiveDecision(observations([0,1],[NaN,1]),{},cfg),/репутац/i);
});
test("invalid adaptation parameters and inconsistent configuration fail closed",()=>{
 assert.throws(()=>validateAdaptiveOptions({fixedAlpha:1.1}),/fixedAlpha/);
 assert.throws(()=>validateAdaptiveOptions({alphaMode:"oracle"}),/alpha/);
 assert.throws(()=>validateAdaptiveOptions({minWeight:1,maxWeight:0.5}),/Ограничения/);
 assert.throws(()=>validateAdaptiveOptions({runs:0}),/runs/);
 assert.throws(()=>validateAdaptiveStudy(core,{scenario:"dynamic",phases:[
  {start:2,intensity:1,profile:"linear",endIntensity:2}]}),/перв.*фаза/i);
});
test("opt-in observation hook exposes only past and current observable inputs",()=>{
 const seen=[];
 const base=simulateRun(core,"static_bias",0,0,true);
 const withHook=simulateRun(core,"static_bias",0,0,true,null,item=>seen.push(item));
 assert.equal(seen.length,core.n_steps);
 assert.equal(seen[0].historySteps,0);
 assert.ok(Object.isFrozen(seen[0])&&Object.isFrozen(seen[0].values));
 assert.ok(!("truth" in seen[0])&&!("byzantine" in seen[0])&&!("labels" in seen[0]));
 assert.deepEqual(withHook.trajectory,base.trajectory);
 assert.deepEqual(withHook.result.reputation,base.result.reputation);
 assert.deepEqual(withHook.result.states,base.result.states);
 assert.deepEqual(withHook.result.events,base.result.events);
});
test("adaptive study produces paired results, valid metrics and bounded scalar ISS trajectories",()=>{
 const phases=[
  {start:1,intensity:0,profile:"constant"},
  {start:5,intensity:1,profile:"constant"},
  {start:10,intensity:1,profile:"exponential",endIntensity:3}
 ];
 const data=runAdaptiveStudy(core,{runs:3,phases,scenario:"dynamic",trimEachSide:2});
 assert.equal(data.summary.length,5);
 assert.equal(data.runs.length,3);
 assert.equal(data.trace.length,core.n_steps);
 assert.equal(data.paired.length,4);
 assert.equal(data.partial,false);
 for(const run of data.runs){
  assert.equal(run.trajectory.length,core.n_steps);
  for(const method of ADAPTIVE_METHOD_IDS){
   const points=run.feedback[method];
   assert.equal(points.length,core.n_steps+1);
   assert.ok(points.every(p=>Math.abs(p.e)<=p.iss_bound+1e-9));
  }
  for(const row of run.trajectory){
   assert.ok(row.diagnostics.alpha===null||
    (row.diagnostics.alpha>=0&&row.diagnostics.alpha<=1));
   assert.ok(row.diagnostics.k===null||Number.isInteger(row.diagnostics.k));
  }
 }
 assert.deepEqual(data.trace.map(x=>x.step),Array.from({length:core.n_steps},(_,i)=>i+1));
});
test("partial runs are flagged, and incompatible run index sequences are rejected",()=>{
 const opts={runs:3,scenario:"static_bias"};
 const first=runAdaptiveSingle(core,opts,0),partial=summarizeAdaptiveRuns([first],core,opts);
 assert.equal(partial.partial,true);assert.equal(partial.completedRuns,1);
 assert.throws(()=>summarizeAdaptiveRuns([{...first,run:1}],core,opts),/порядок/);
});

test("E1-A default-size scenario runs to completion without missing or inconsistent estimates",()=>{
 const cfg={n_agents:50,n_byzantine:10,n_steps:200,attack_start_step:20,
  trim_each_side:10,seed:20260716};
 const data=runAdaptiveStudy(cfg,{runs:2});
 assert.equal(data.completedRuns,2);
 assert.equal(data.trace.length,200);
 assert.ok(data.summary.every(x=>x.rmse.n===2));
 assert.ok(data.trace.every(x=>Number.isFinite(x.adaptive_robust)));
});
