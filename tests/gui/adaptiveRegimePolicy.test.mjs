import test from "node:test";
import assert from "node:assert/strict";
import {assessAdaptiveEvidenceQuality} from "../../gui/src/adaptiveEvidenceQuality.js";
import {createAdaptiveRegimeDetector,validateRegimeDetectorOptions} from "../../gui/src/adaptiveRegimeDetector.js";
import {createAdaptivePolicySelector,validateAdaptivePolicyOptions} from "../../gui/src/adaptivePolicySelector.js";
import {validateAdaptiveOptions,estimateAdaptiveDecision,ADAPTIVE_METHOD_IDS}
 from "../../gui/src/adaptiveDecisionEngine.js";
import {runAdaptiveSingle,runAdaptiveStudy} from "../../gui/src/adaptiveExperiment.js";

const core={n_agents:11,n_byzantine:2,n_steps:14,attack_start_step:4,
 trim_each_side:2,seed:20261118,network_enabled:false};
const config={minimum_weight:0.05,trim_each_side:1,clip_radius:1.25,
 safe_action_min:-2,safe_action_max:2};
const observation=(step,offset=0)=>({step,historySteps:step-1,
 values:[-0.2+offset,0.0+offset,0.1+offset,0.2+offset,0.25+offset,0.4+offset,1.3+offset],
 reputation:[0.2,0.4,0.5,0.7,0.8,0.9,0.1],available:[true,true,true,true,true,true,true]});
const policyEntry=(step,reference=0.1)=>({step,reference,scale:1,plain:0.1,
 weighted:0.12,baseline:0.11,oldAlpha:0.4,readiness:1,support:1,
 disparity:0.02,nEffective:6,values:[0,0.1,0.2],available:[true,true,true],
 low:-2,high:2});
const near=(a,b,eps=1e-12)=>assert.ok(Math.abs(a-b)<=eps,String(a)+" != "+String(b));

test("quality score is bounded and model lag/correlation are labelled as assumptions",()=>{
 const x={values:[1,2,NaN,4],available:[true,true,true,false],nEffective:1.8,scale:1};
 const normal=assessAdaptiveEvidenceQuality(x,{evidenceModel:"behavior_linked"});
 const stale=assessAdaptiveEvidenceQuality(x,{evidenceModel:"lagged_observation",evidenceLag:4});
 const correlated=assessAdaptiveEvidenceQuality(x,{evidenceModel:"correlated_witnesses",evidenceCorrelation:.8});
 assert.equal(normal.coverage,0.5);
 assert.ok(normal.score>stale.score&&normal.score>correlated.score);
 assert.equal(stale.configuredLag,4);
 assert.equal(stale.modelAssumptionsOnly,true);
 assert.equal(assessAdaptiveEvidenceQuality({values:[],available:[]}).score,0);
 assert.throws(()=>assessAdaptiveEvidenceQuality({values:[1],available:[]}),/equal-length/);
 assert.throws(()=>assessAdaptiveEvidenceQuality(x,{evidenceModel:"lagged_observation",evidenceLag:-1}),/invalid/);
});

test("regime detector consumes monotone observations and identifies sharp changes without attacker labels",()=>{
 const d=createAdaptiveRegimeDetector({regimeMinHistory:3,regimeChangeThreshold:1,
  regimeCooldown:1,regimeMinimumQuality:.2});
 let last;
 for(let t=1;t<=4;t++)last=d.observe({step:t,reference:.2,scale:1,disparity:0,qualityScore:1});
 assert.equal(last.state,"stable_observed");
 last=d.observe({step:5,reference:4,scale:1,disparity:0,qualityScore:1});
 assert.equal(last.state,"change_detected");
 assert.equal(last.changeCount,1);
 assert.ok(!("strategy" in last)&&!("attackerLabel" in last)&&!("truth" in last));
 assert.throws(()=>d.observe({step:5,reference:4,scale:1,qualityScore:1}),/sequential/);
 d.skip(6);
 const resumed=d.observe({step:7,reference:-3,scale:1,qualityScore:1});
 assert.equal(resumed.innovation,0,"skip must remove stale previous reference");
 assert.throws(()=>validateRegimeDetectorOptions({regimeDecay:2}),/regimeDecay/);
});

test("policy starts from explicit E1 combined fallback and remains causal and bounded",()=>{
 const p=createAdaptivePolicySelector({regimeMinimumPairs:2,regimeMinHistory:3});
 for(let t=1;t<=8;t++){
  const out=p.choose(policyEntry(t,0.1));
  assert.ok(out.value>=-2&&out.value<=2);
  assert.ok(out.evidenceQuality.score>=0&&out.evidenceQuality.score<=1);
  near(Object.values(out.weights).reduce((a,b)=>a+b,0),1);
  assert.equal(out.noOracle,true);
  assert.ok(!("truth" in out)&&!("byzantine" in out));
  if(t===1)assert.equal(out.selected,"proposed_robust");
 }
 assert.equal(p.snapshot().step,8);
 assert.throws(()=>p.choose(policyEntry(8)),/sequential/);
 assert.throws(()=>validateAdaptivePolicyOptions({regimeSelectionMode:"oracle"}),/selection/);
});

test("changing future observations does not affect earlier selected outputs",()=>{
 const a=createAdaptivePolicySelector({regimeMinimumPairs:2,regimeMinHistory:3});
 const b=createAdaptivePolicySelector({regimeMinimumPairs:2,regimeMinHistory:3});
 for(let t=1;t<=7;t++){
  const x=a.choose(policyEntry(t,0.1)),y=b.choose(policyEntry(t,0.1));
  assert.deepEqual(x,y);
 }
 a.choose(policyEntry(8,50));
 b.choose(policyEntry(8,-50));
 assert.equal(a.snapshot().step,8);
 assert.equal(b.snapshot().step,8);
});

test("blend policy returns convex expert weights with stable numerical fallback",()=>{
 const p=createAdaptivePolicySelector({regimeSelectionMode:"blend",
  regimeMinimumPairs:2,regimeMinHistory:3,regimeTemperature:0.3});
 let output;
 for(let t=1;t<=10;t++)output=p.choose(policyEntry(t,0.1));
 near(Object.values(output.weights).reduce((a,b)=>a+b,0),1);
 assert.equal(output.selected,"blend");
 assert.ok(Object.values(output.weights).every(v=>v>=0&&v<=1));
 assert.ok(output.value>=0.1&&output.value<=0.12);
});

test("unavailable estimator proposals require an explicit policy skip",()=>{
 const p=createAdaptivePolicySelector();
 let result=estimateAdaptiveDecision({step:1,historySteps:0,values:[NaN,NaN],
  reputation:[0.3,0.6],available:[false,false]},
  {alphaMode:"regime_aware"},config,null,p);
 assert.equal(result.decisions.adaptive_robust,null);
 assert.equal(p.snapshot().step,1);
 result=estimateAdaptiveDecision(observation(2),{alphaMode:"regime_aware",trimEachSide:1},
  config,null,p);
 assert.ok(Number.isFinite(result.decisions.adaptive_robust));
 assert.equal(result.diagnostics.regimeState,"insufficient_data");
 assert.throws(()=>estimateAdaptiveDecision(observation(3),
  {alphaMode:"regime_aware"},config),/контроллер/);
});

test("new alpha mode preserves all original E1 and other E1-A estimator outputs in paired common-contour runs",()=>{
 const cfg={...core};
 const options={scenario:"static_bias",attackStrategy:"coordinated",
  evidenceModel:"behavior_linked",trimEachSide:2};
 const old=runAdaptiveSingle(cfg,{...options,alphaMode:"adaptive"},0);
 const modern=runAdaptiveSingle(cfg,{...options,alphaMode:"regime_aware"},0);
 assert.equal(old.trajectory.length,modern.trajectory.length);
 for(let i=0;i<old.trajectory.length;i++){
  for(const method of ADAPTIVE_METHOD_IDS.filter(id=>id!=="adaptive_robust"))
   assert.equal(old.trajectory[i][method],modern.trajectory[i][method]);
  assert.equal(old.trajectory[i].attack_intensity,modern.trajectory[i].attack_intensity);
  assert.equal(old.trajectory[i].step,modern.trajectory[i].step);
  const meta=modern.trajectory[i].diagnostics;
  assert.ok(meta.regimeState);
  assert.ok(["proposed_robust","adaptive","risk_aware","blend"].includes(meta.regimeSelected));
  assert.ok(Number.isFinite(meta.evidenceQualityScore));
 }
 assert.equal(old.metrics.length,5);
 assert.equal(modern.metrics.length,5);
});

test("regime-aware experiment integrates into summary and supplies policy traces without changing five estimator IDs",()=>{
 const r=runAdaptiveStudy(core,{runs:2,scenario:"static_bias",
  alphaMode:"regime_aware",regimeSelectionMode:"blend"});
 assert.equal(r.completedRuns,2);
 assert.equal(r.summary.length,5);
 assert.equal(r.paired.length,4);
 assert.equal(r.trace.length,core.n_steps);
 assert.equal(r.trace[0].regimeSelected,"proposed_robust");
 assert.equal(r.models.policy,"e1a-regime-policy-1.0.0");
 assert.equal(r.methodology.comparisonMode,"estimator_only");
 assert.equal(r.methodology.riskMode.includes("Experimental causal expert policy"),true);
});


test("decision-feedback uses a separate regime controller per method path",()=>{
 const options={comparisonMode:"decision_feedback",attackStrategy:"coordinated",
  evidenceModel:"behavior_linked",alphaMode:"regime_aware",scenario:"static_bias"};
 const data=runAdaptiveSingle(core,options,0);
 assert.equal(data.metrics.length,5);
 assert.equal(data.trajectory.length,core.n_steps);
 for(const row of data.trajectory){
  assert.ok(row.diagnostics.regimeSelected!==undefined);
  assert.ok(row.diagnostics.evidenceQualityScore===null||
   row.diagnostics.evidenceQualityScore>=0);
 }
 for(const method of ADAPTIVE_METHOD_IDS)
  assert.equal(data.methodStates[method].length,core.n_steps);
});

test("unconditional loss is derived per tick and must not silently discard refusals",()=>{
 const options={alphaMode:"regime_aware",scenario:"static_bias",
  decisionRefusalPenalty:3};
 const run=runAdaptiveSingle(core,options,0);
 for(const metric of run.metrics){
  const rows=run.trajectory,valid=rows.filter(r=>Number.isFinite(r[metric.method]));
  const truth=rows[0].truth;
  const expected=rows.reduce((total,row)=>
   total+(Number.isFinite(row[metric.method])?
    (row[metric.method]-truth)**2:3),0)/rows.length;
  near(metric.unconditional_decision_loss,expected,1e-10);
  assert.equal(metric.refusals,rows.length-valid.length);
  if(metric.refusals===0)near(metric.unconditional_decision_loss,metric.rmse**2,1e-10);
 }
 assert.throws(()=>validateAdaptiveOptions({decisionRefusalPenalty:-1}),/decisionRefusalPenalty/);
});
