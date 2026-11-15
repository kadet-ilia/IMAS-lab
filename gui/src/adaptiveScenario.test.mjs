import test from "node:test";
import assert from "node:assert/strict";
import {
 ADAPTIVE_SCENARIO_VERSION,createAdaptiveScenarioAdapter,validateAdaptiveScenarioOptions
} from "./adaptiveScenario.js";
import {simulateRun} from "./trustEngine.js";
import {runAdaptiveSingle,runAdaptiveStudy} from "./adaptiveExperiment.js";

const core={seed:80421,n_agents:9,n_byzantine:2,n_steps:14,attack_start_step:3,
 trim_each_side:1,network_enabled:false,desired_action:0.6,attack_direction:-1,
 honest_noise_sigma:0.12,static_bias:3};
const near=(a,b,epsilon=1e-12)=>assert.ok(Math.abs(a-b)<epsilon,
 "Expected "+a+" ~ "+b);
const proposal={step:7,values:[0.55,0.6,0.65,0.61,0.58],
 byzantine:[false,true,false,true,false],
 sybil:[false,false,false,false,false],intensity:1};
const delivered=()=>({step:1,values:[0.6,0.62,-2,0.58,0.63],
 available:[true,true,true,true,true]});
const evidenceCtx=(observer,target,step=1)=>({
 step,observer,target,values:[0.6,0.62,-2,0.58,0.63],
 available:[true,true,true,true,true],
 byzantine:[false,false,true,false,false],intensity:1
});
test("E1-A synthetic generators have strict parameter bounds and explicit versions",()=>{
 assert.match(ADAPTIVE_SCENARIO_VERSION,/e1a-/);
 assert.throws(()=>validateAdaptiveScenarioOptions({evidenceModel:"omniscient"}),/модель свидетельств/i);
 assert.throws(()=>validateAdaptiveScenarioOptions({attackStrategy:"unknown"}),/стратегия/i);
 assert.throws(()=>validateAdaptiveScenarioOptions({attackPeriod:4,attackDuty:5}),/период/i);
 assert.throws(()=>validateAdaptiveScenarioOptions({evidenceTolerance:0}),/evidenceTolerance/i);
 assert.throws(()=>validateAdaptiveScenarioOptions({witnessCorruption:2}),/witnessCorruption/i);
 assert.equal(createAdaptiveScenarioAdapter(core,{},0),null);
});
test("independent temporal attack shape and strategy preserve honest agent proposals",()=>{
 const opts={attackStrategy:"coordinated",evidenceModel:"legacy",coordinatedBias:2,
  attackNoiseSigma:0};
 const gen=createAdaptiveScenarioAdapter(core,opts,0);
 const a=gen.transformProposals(proposal);
 assert.equal(a[0],proposal.values[0]);assert.equal(a[2],proposal.values[2]);
 near(a[1],-1.4);near(a[3],-1.4);
 assert.equal(gen.transformProposals({...proposal,intensity:0})[1],proposal.values[1]);
 assert.deepEqual(a,gen.transformProposals(proposal));
});
test("pulsed attacker toggles in prescribed steps",()=>{
 const gen=createAdaptiveScenarioAdapter(core,{attackStrategy:"pulsed",attackPeriod:4,
  attackDuty:2,attackNoiseSigma:0},0);
 const enabled=gen.transformProposals({...proposal,step:5});
 const disabled=gen.transformProposals({...proposal,step:7});
 assert.ok(enabled[1]<0);
 assert.equal(disabled[1],proposal.values[1]);
});
test("reputation-building phase emits nearly honest decisions then attacks",()=>{
 const gen=createAdaptiveScenarioAdapter(core,{
  attackStrategy:"reputation_boost",evidenceModel:"behavior_linked",
  reputationWarmup:7,coordinatedBias:2,attackNoiseSigma:0
 },0);
 const before=gen.transformProposals({...proposal,step:6});
 const after=gen.transformProposals({...proposal,step:8});
 assert.ok(Math.abs(before[1]-core.desired_action)<1);
 assert.ok(after[1]<0);
});
test("behavior-linked honest testimony is based on peer proposals, not oracle labels",()=>{
 const gen=createAdaptiveScenarioAdapter(core,{
  evidenceModel:"behavior_linked",evidenceNoiseSigma:0,witnessCorruption:0
 },0);
 gen.onProposalsDelivered(delivered());
 const nearPeer=gen.evidenceValue(evidenceCtx(0,1));
 const farPeer=gen.evidenceValue(evidenceCtx(0,2));
 assert.ok(nearPeer>farPeer);
 assert.ok(farPeer<0.05);
 assert.equal(gen.getDiagnostic().behaviorEvidenceGenerated,2);
});
test("correlated-witness mode shares a non-oracle shock across honest witnesses",()=>{
 const gen=createAdaptiveScenarioAdapter(core,{
  evidenceModel:"correlated_witnesses",evidenceCorrelation:1,
  evidenceNoiseSigma:0.1,witnessCorruption:0
 },1);
 gen.onProposalsDelivered(delivered());
 near(gen.evidenceValue(evidenceCtx(0,1)),gen.evidenceValue(evidenceCtx(3,1)));
});
test("malicious witnesses may coordinate false testimony without leaking labels to estimator",()=>{
 const gen=createAdaptiveScenarioAdapter(core,{
  evidenceModel:"behavior_linked",evidenceNoiseSigma:0,witnessCorruption:1
 },0);
 gen.onProposalsDelivered(delivered());
 const goodTarget=gen.evidenceValue(evidenceCtx(2,0));
 const badTarget=gen.evidenceValue(evidenceCtx(2,2));
 assert.equal(goodTarget,0);
 assert.equal(badTarget,1);
 assert.equal(gen.getDiagnostic().maliciousWitnessed,2);
});
test("lagged-observation model uses earlier delivered proposals, not future data",()=>{
 const gen=createAdaptiveScenarioAdapter(core,{
  evidenceModel:"lagged_observation",evidenceLag:2,evidenceNoiseSigma:0,witnessCorruption:0
 },0);
 gen.onProposalsDelivered(delivered());
 assert.equal(gen.evidenceValue(evidenceCtx(0,2,1)),0.5);
 gen.onProposalsDelivered({step:2,values:[0.6,0.61,0.6,0.58,0.6],
  available:[true,true,true,true,true]});
 assert.equal(gen.evidenceValue(evidenceCtx(0,2,2)),0.5);
 gen.onProposalsDelivered({step:3,values:[0.6,0.6,0.6,0.6,0.6],
  available:[true,true,true,true,true]});
 const lagged=gen.evidenceValue(evidenceCtx(0,2,3));
 assert.ok(lagged<0.05,"A gross outlier from step 1 must still be judged at step 3");
 assert.equal(gen.getDiagnostic().uninformativeEvidence,2);
});
test("legacy generator is bit-for-bit equivalent to core E1 for the same run",()=>{
 const old=simulateRun({...core,paired_exogenous_events:true},"static_bias",0,0,true);
 const adaptive=runAdaptiveSingle(core,{runs:1,scenario:"static_bias"},0);
 assert.deepEqual(adaptive.trajectory.map(r=>r.proposed_robust),
  old.trajectory.map(r=>r.proposed_robust));
 assert.deepEqual(adaptive.trajectory.map(r=>r.trimmed_unweighted),
  old.trajectory.map(r=>r.trimmed_unweighted));
 assert.equal(adaptive.scenarioDiagnostics,null);
});
test("behavior-linked mode affects E1 reputation and decisions while retaining deterministic replay",()=>{
 const opts={runs:1,scenario:"static_bias",attackStrategy:"coordinated",
  evidenceModel:"behavior_linked",coordinatedBias:2,evidenceNoiseSigma:0};
 const one=runAdaptiveSingle(core,opts,0);
 const again=runAdaptiveSingle(core,opts,0);
 assert.deepEqual(one.trajectory,again.trajectory);
 assert.ok(one.scenarioDiagnostics.behaviorEvidenceGenerated>0);
 assert.ok(one.scenarioDiagnostics.generatedAttackProposals>0);
 const old=runAdaptiveSingle(core,{runs:1,scenario:"static_bias"},0);
 assert.notDeepEqual(one.trajectory.map(x=>x.proposed_robust),
  old.trajectory.map(x=>x.proposed_robust));
});
test("network transport ledger remains balanced with behavior-linked evidence generation",()=>{
 const config={...core,network_enabled:true,network_topology:"complete",
  bandwidth_messages_per_step:200,message_delay_min_steps:0,
  message_delay_max_steps:1,message_loss_probability:0.1,
  record_source_events:false};
 const opts={attackStrategy:"stealth",evidenceModel:"lagged_observation",evidenceLag:2};
 const gen=createAdaptiveScenarioAdapter(config,opts,0);
 const trace=[];
 const out=simulateRun({...config,paired_exogenous_events:true},"static_bias",0,0,true,
  null,obs=>trace.push(obs),gen);
 assert.equal(out.result.summary.message_balance,0);
 assert.ok(out.result.message_ledger.every(x=>x.total.balance===0));
 assert.equal(trace.length,config.n_steps);
 assert.ok(trace.every(x=>!("byzantine" in x)&&!("truth" in x)));
});
test("whole E1-A study exports generator model and per-run diagnostics",()=>{
 const data=runAdaptiveStudy(core,{runs:2,scenario:"static_bias",
  evidenceModel:"behavior_linked",attackStrategy:"reputation_boost",reputationWarmup:3});
 assert.equal(data.completedRuns,2);
 assert.ok(data.models.scenario===ADAPTIVE_SCENARIO_VERSION);
 assert.equal(data.runs.length,2);
 assert.ok(data.runs.every(x=>x.scenarioDiagnostics?.behaviorEvidenceGenerated>0));
 assert.equal(data.summary.length,5);
});

test("decision-feedback mode rejects legacy testimony and an undistributed network",async()=>{
 const {validateAdaptiveStudy}=await import("./adaptiveExperiment.js");
 assert.throws(()=>validateAdaptiveStudy(core,{
  comparisonMode:"decision_feedback",evidenceModel:"legacy"
 }),/поведенческая модель/i);
 assert.throws(()=>validateAdaptiveStudy({...core,network_enabled:true},{
  comparisonMode:"decision_feedback",evidenceModel:"behavior_linked"
 }),/сетевых ограничениях/i);
});
test("feedback witness uses only the method's current output, not the true action",()=>{
 const gen=createAdaptiveScenarioAdapter(core,{
  comparisonMode:"decision_feedback",evidenceModel:"behavior_linked",
  evidenceNoiseSigma:0,witnessCorruption:0
 },0);
 gen.onProposalsDelivered(delivered());
 gen.onFeedbackDecision({step:1,value:0.6});
 const nearTruth=gen.evidenceValue(evidenceCtx(0,0));
 gen.onFeedbackDecision({step:1,value:-2});
 const farTruth=gen.evidenceValue(evidenceCtx(0,0));
 assert.ok(nearTruth>farTruth);
 assert.ok(gen.getDiagnostic().feedbackDecisionUsed===2);
});
test("independent feedback contours are reproducible and record each method's own trust trajectory",()=>{
 const settings={runs:2,scenario:"static_bias",attackStrategy:"coordinated",
  evidenceModel:"behavior_linked",comparisonMode:"decision_feedback",
  evidenceNoiseSigma:0,witnessCorruption:0.6,coordinatedBias:2.5};
 const first=runAdaptiveSingle(core,settings,0),again=runAdaptiveSingle(core,settings,0);
 // Execution wall times from E1 are measurements, not deterministic science.
 for(const key of ["metrics","trajectory","feedback","methodStates","scenarioDiagnosticsByMethod"])
  assert.deepEqual(first[key],again[key],key+" should be reproducible");
 assert.equal(Object.keys(first.methodStates).length,5);
 assert.equal(Object.keys(first.scenarioDiagnosticsByMethod).length,5);
 assert.equal(first.methodStates.adaptive_robust.length,core.n_steps);
 assert.ok(first.scenarioDiagnosticsByMethod.adaptive_robust.feedbackDecisionUsed>0);
 const base=first.methodStates.trimmed_unweighted;
 const adapted=first.methodStates.adaptive_robust;
 assert.ok(base.every(x=>Number.isFinite(x.mean_reputation)));
 assert.ok(adapted.every(x=>Number.isFinite(x.mean_reputation)));
 const data=runAdaptiveStudy(core,settings);
 assert.equal(data.methodology.comparisonMode,"decision_feedback");
 assert.equal(data.completedRuns,2);
 assert.equal(data.summary.length,5);
 assert.equal(data.trace.length,core.n_steps);
 assert.ok(data.summary.every(x=>x.mean_reputation.n===2));
});
