import test from "node:test";
import assert from "node:assert/strict";
import {createAdaptivePolicySelectorV2,validateAdaptiveV2Options,
 ADAPTIVE_V2_DEFAULTS,ADAPTIVE_V2_VERSION}
 from "../../gui/src/adaptivePolicySelectorV2.js";
import {ADAPTIVE_METHOD_IDS,validateAdaptiveOptions,
 estimateAdaptiveDecision} from "../../gui/src/adaptiveDecisionEngine.js";
import {runAdaptiveSingle,runAdaptiveStudy} from "../../gui/src/adaptiveExperiment.js";

const core={n_agents:13,n_byzantine:3,n_steps:20,seed:183771,
 trim_each_side:3,attack_start_step:7,network_enabled:false};
const options={scenario:"static_bias",attackStrategy:"coordinated",
 evidenceModel:"behavior_linked",trimEachSide:3};
const entry=(step,base=0.7,plain=0,weighted=0)=>({
 step,reference:0,scale:1,plain,weighted,baseline:base,
 oldAlpha:0.5,readiness:1,support:1,disparity:Math.abs(plain-weighted),
 nEffective:4,values:[-0.1,0,0.1,0.03],available:[true,true,true,true],
 low:-2,high:2
});
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-12,String(a)+" != "+String(b));

test("v2 validation is separate from v1 and rejects unsupported options",()=>{
 assert.equal(ADAPTIVE_V2_DEFAULTS.v2ChoiceMode,"discrete");
 assert.equal(validateAdaptiveOptions({alphaMode:"regime_aware_v2"}).alphaMode,
  "regime_aware_v2");
 assert.throws(()=>validateAdaptiveV2Options({v2ChoiceMode:"oracle"}),/selection mode/);
 assert.throws(()=>validateAdaptiveV2Options({v2BaselineFloor:1.1}),/v2BaselineFloor/);
 assert.throws(()=>validateAdaptiveV2Options({v2Confidence:-1}),/v2Confidence/);
 assert.throws(()=>validateAdaptiveV2Options({v2MinimumPairs:2.5}),/v2MinimumPairs/);
});

test("v2 can choose a better causal PROXY specialist on controlled observable evidence",()=>{
 const controller=createAdaptivePolicySelectorV2({v2MinimumPairs:2,
  v2MinEvidence:0,v2LossDecay:0,v2Confidence:0,v2ImprovementMargin:0,
  v2SwitchCost:0,v2HoldSteps:0,regimeChangeThreshold:100});
 let value;
 for(let t=1;t<=7;t++){
  value=controller.choose(entry(t,0.7,0,0));
  assert.ok(value.value>=-2&&value.value<=2);
  close(Object.values(value.weights).reduce((a,b)=>a+b,0),1);
  assert.equal(value.noOracle,true);
  assert.equal(value.modelVersion,ADAPTIVE_V2_VERSION);
 }
 assert.notEqual(value.selected,"proposed_robust");
 assert.ok(value.switches>0);
 assert.ok(value.regret.adaptive<0);
 assert.throws(()=>controller.choose(entry(7)),/sequential/);
});

test("v2 convex blend keeps explicit combined E1 floor",()=>{
 const policy=createAdaptivePolicySelectorV2({v2ChoiceMode:"blend",
  v2MinimumPairs:2,v2MinEvidence:0,v2BaselineFloor:0.7,
  regimeChangeThreshold:100});
 let out;
 for(let t=1;t<=7;t++)out=policy.choose(entry(t,1,0,0.2));
 assert.equal(out.selected,"blend");
 assert.ok(out.weights.proposed_robust>=0.7);
 assert.ok(Object.values(out.weights).every(v=>v>=0&&v<=1));
 close(Object.values(out.weights).reduce((s,v)=>s+v,0),1);
 assert.ok(out.value>=-2&&out.value<=2);
});

test("v2 previous outputs are unaffected by future counterfactual observations",()=>{
 const a=createAdaptivePolicySelectorV2({v2MinimumPairs:2,v2MinEvidence:0});
 const b=createAdaptivePolicySelectorV2({v2MinimumPairs:2,v2MinEvidence:0});
 for(let t=1;t<=9;t++)assert.deepEqual(a.choose(entry(t)),b.choose(entry(t)));
 a.choose({...entry(10),values:[1,1,1,1],reference:1});
 b.choose({...entry(10),values:[-1,-1,-1,-1],reference:-1});
 assert.equal(a.snapshot().step,10);
 assert.equal(b.snapshot().step,10);
});

test("v2 explicit skipped observations prohibit stale next-tick comparison",()=>{
 const p=createAdaptivePolicySelectorV2({v2MinimumPairs:2,v2MinEvidence:0});
 p.choose(entry(1));p.skip(2);
 assert.equal(p.snapshot().step,2);
 assert.equal(p.snapshot().completePairs,0);
 const out=p.choose(entry(3));
 assert.equal(out.completePairs,0);
 assert.equal(out.selected,"proposed_robust");
 assert.throws(()=>p.skip(5),/sequential/);
});

test("v2 preserves original E1 and four pre-existing E1-A estimates",()=>{
 const baseline=runAdaptiveSingle(core,{...options,alphaMode:"adaptive"},0);
 for(const mode of ["regime_aware","regime_aware_v2"]){
  const v=runAdaptiveSingle(core,{...options,alphaMode:mode},0);
  for(let i=0;i<core.n_steps;i++){
   const a=baseline.trajectory[i],b=v.trajectory[i];
   for(const id of ADAPTIVE_METHOD_IDS.filter(x=>x!=="adaptive_robust"))
    assert.equal(a[id],b[id],mode+":"+id);
   assert.equal(a.attack_intensity,b.attack_intensity);
   if(mode==="regime_aware_v2"){
    assert.ok(b.diagnostics.regimeSelected!==null);
    assert.ok(Number.isFinite(b.diagnostics.v2EffectivePairs));
    assert.ok(Number.isFinite(b.diagnostics.v2RegretAdaptive));
   }
  }
  assert.equal(v.metrics.length,5);
 }
});

test("v2 state is isolated per feedback path and research study",()=>{
 const r=runAdaptiveStudy({...core,n_agents:11,n_byzantine:2,trim_each_side:2},
  {...options,runs:2,comparisonMode:"decision_feedback",
   alphaMode:"regime_aware_v2",v2ChoiceMode:"blend"});
 assert.equal(r.completedRuns,2);
 assert.equal(r.summary.length,5);
 assert.equal(r.paired.length,4);
 assert.equal(r.models.policyV2,ADAPTIVE_V2_VERSION);
 assert.ok(r.methodology.riskMode.includes("Experimental v2"));
 for(const x of r.runs)assert.equal(x.methodStates.adaptive_robust.length,core.n_steps);
});

test("v2 skipped ticks and extra inaccessible oracle properties",()=>{
 const cfg={trim_each_side:1,clip_radius:1.25,minimum_weight:0.05,
 safe_action_min:-2,safe_action_max:2};
 const p=createAdaptivePolicySelectorV2();
 const missing=estimateAdaptiveDecision({
  step:1,historySteps:0,values:[NaN,NaN],reputation:[0.4,0.5],
  available:[false,false]},{alphaMode:"regime_aware_v2"},cfg,null,p);
 assert.equal(missing.decisions.adaptive_robust,null);
 assert.equal(p.snapshot().step,1);
 assert.throws(()=>estimateAdaptiveDecision({
  step:2,historySteps:1,values:[0.1],reputation:[0.5],
  available:[true]},{alphaMode:"regime_aware_v2"},cfg),/контроллер/);
 const q=p.choose({...entry(2),truth:999,byzantine:[true,true,true]});
 assert.equal(q.noOracle,true);
 assert.equal(q.completePairs,0);
});
