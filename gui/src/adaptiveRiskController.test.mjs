import test from "node:test";
import assert from "node:assert/strict";
import {createAdaptiveRiskController,validateAdaptiveRiskOptions,ADAPTIVE_RISK_MODEL_VERSION} from "./adaptiveRiskController.js";
import {estimateAdaptiveDecision,ADAPTIVE_METHOD_IDS} from "./adaptiveDecisionEngine.js";
import {runAdaptiveSingle,runAdaptiveStudy} from "./adaptiveExperiment.js";
import {simulateRun} from "./trustEngine.js";

const input={n_agents:13,n_byzantine:3,n_steps:20,trim_each_side:2,
 attack_start_step:5,seed:20261116,network_enabled:false};
const opts={alphaMode:"risk_aware",scenario:"static_bias",runs:3,riskMinimumPairs:2};
const cfg={trim_each_side:1,clip_radius:1.25,safe_action_min:-2,safe_action_max:2};
const source=(step,shift=0)=>({step,values:[-.1,0.1,0.2+shift,.3,.4,.5,2],
 reputation:[.15,.25,.4,.9,.5,.75,.05],available:[true,true,true,true,true,true,true],
 historySteps:step-1});
test("risk controller has an explicit model version and bounded hyperparameters",()=>{
 assert.match(ADAPTIVE_RISK_MODEL_VERSION,/prequential/);
 for(const [key,value] of [["riskDecay",1],["riskSensitivity",-1],["riskMinimumPairs",0],
  ["riskLossCap",0],["riskFloor",0],["riskPrior",1.1]]){
  assert.throws(()=>validateAdaptiveRiskOptions({[key]:value}),new RegExp(key));
 }
});
test("risk-aware estimator fails closed without a causal controller or ordered step",()=>{
 assert.throws(()=>estimateAdaptiveDecision(source(1),opts,cfg),/причинное состояние/);
 const c=createAdaptiveRiskController(opts);
 assert.throws(()=>estimateAdaptiveDecision({...source(1),step:undefined},opts,cfg,c),/номер/);
});
test("risk predictor learns only from prior decisions and current observable median",()=>{
 const c=createAdaptiveRiskController({riskMinimumPairs:1,riskDecay:0,riskSensitivity:12});
 const initial=c.observe({step:1,plain:0.5,weighted:0.1,reference:0.5,scale:1,support:1,readiness:1});
 assert.equal(initial.pairs,0);
 assert.equal(initial.alpha,0.5);
 const next=c.observe({step:2,plain:0.5,weighted:0.1,reference:0.15,scale:1,support:1,readiness:1});
 assert.equal(next.pairs,1);
 assert.ok(next.weightVote>0.5,"Weighted previous choice better predicts next observed median");
 assert.ok(next.alpha>0.5);
 const third=c.observe({step:3,plain:0.6,weighted:0.9,reference:0.6,scale:1,support:1,readiness:1});
 assert.ok(third.weightVote<0.5,"Plain previous choice now predicts median better");
 assert.ok(third.alpha<0.5);
 assert.equal(c.snapshot().step,3);
 assert.throws(()=>c.observe({step:3,plain:0,weighted:0,reference:0,scale:1,support:1,readiness:1}),/последовательно/);
});
test("future observations cannot influence a previous alpha or output",()=>{
 const controllers=[createAdaptiveRiskController(opts),createAdaptiveRiskController(opts)];
 const traceA=[],traceB=[];
 for(let t=1;t<=9;t++){
  const first=estimateAdaptiveDecision(source(t),opts,cfg,controllers[0]);
  const second=estimateAdaptiveDecision(source(t,t>=7?100:0),opts,cfg,controllers[1]);
  traceA.push(first);traceB.push(second);
 }
 assert.deepEqual(traceA.slice(0,6),traceB.slice(0,6));
 for(const r of traceA)assert.ok(r.diagnostics.alpha>=0&&r.diagnostics.alpha<=1);
 assert.notDeepEqual(traceA.slice(6),traceB.slice(6));
});
test("controller never reads oracle truth, attacker labels or future injected metadata",()=>{
 const one=createAdaptiveRiskController(opts),two=createAdaptiveRiskController(opts);
 for(let t=1;t<=9;t++){
  const obs=source(t),poisoned={...obs,truth:1e10,byzantine:[true],future:[1e10]};
  const a=estimateAdaptiveDecision(obs,opts,cfg,one);
  const b=estimateAdaptiveDecision(poisoned,opts,cfg,two);
  assert.deepEqual(a,b);
 }
});
test("controller skips empty observation without scoring a discontinuous prediction pair",()=>{
 const ctl=createAdaptiveRiskController({riskMinimumPairs:1});
 estimateAdaptiveDecision(source(1),opts,cfg,ctl);
 const empty={step:2,values:[NaN,NaN],reputation:[.2,.4],
  available:[false,false],historySteps:1};
 const no=estimateAdaptiveDecision(empty,opts,cfg,ctl);
 assert.equal(no.decisions.adaptive_robust,null);
 assert.equal(ctl.snapshot().step,2);
 const next=estimateAdaptiveDecision(source(3),opts,cfg,ctl);
 assert.equal(next.diagnostics.riskPairs,0);
 assert.equal(ctl.snapshot().step,3);
});
test("risk changes no legacy E1 decisions, no network transport, and no base E1 oracle separation",()=>{
 const base=simulateRun({...input,paired_exogenous_events:true},"static_bias",0,0,true);
 const withRisk=runAdaptiveSingle(input,opts,0);
 assert.equal(withRisk.trajectory.length,input.n_steps);
 assert.deepEqual(withRisk.trajectory.map(x=>x.proposed_robust),
  base.trajectory.map(x=>x.proposed_robust));
 assert.deepEqual(withRisk.trajectory.map(x=>x.trimmed_unweighted),
  base.trajectory.map(x=>x.trimmed_unweighted));
 for(const row of withRisk.trajectory){
  assert.ok(row.diagnostics.riskPairs>=0);
  assert.ok(row.diagnostics.alpha>=0&&row.diagnostics.alpha<=1);
 }
});
test("fresh controller per independent run prevents cross-run learning leakage",()=>{
 const one=runAdaptiveSingle(input,opts,0);
 runAdaptiveSingle(input,opts,1);
 const replay=runAdaptiveSingle(input,opts,0);
 assert.deepEqual(one.trajectory,replay.trajectory);
});
test("closed-loop risk maintains separate causal state per compared estimator",()=>{
 const config={...input,network_enabled:false,n_steps:12};
 const settings={...opts,runs:2,comparisonMode:"decision_feedback",evidenceModel:"behavior_linked"};
 const experiment=runAdaptiveStudy(config,settings);
 assert.equal(experiment.completedRuns,2);
 assert.equal(experiment.summary.length,ADAPTIVE_METHOD_IDS.length);
 assert.ok(experiment.runs.every(run=>Object.keys(run.methodStates).length===5));
 assert.ok(experiment.runs.every(run=>run.trajectory[0].diagnostics.riskPairs===0));
});
