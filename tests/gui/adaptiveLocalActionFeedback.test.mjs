import test from "node:test";
import assert from "node:assert/strict";
import {createLocalAutonomy,validateLocalAutonomyOptions} from "../../gui/src/adaptiveLocalAutonomy.js";
import {createLocalTransport,validateLocalTransportOptions} from "../../gui/src/adaptiveLocalTransport.js";
import {runAdaptiveSingle,validateAdaptiveStudy} from "../../gui/src/adaptiveExperiment.js";

const base={
 localTransportMaxAgeSteps:5,localConsensusTrim:0,
 localConsensusRelaxation:1,localConsensusMinWeight:0.05,
 localAutonomyEnabled:true,localAutonomyMinNeighbors:1,
 localAutonomyEvidenceTolerance:0.5,localAutonomyDecay:0.9,
 localAutonomyActionFeedbackEnabled:true,
 localAutonomyActionGain:1,localAutonomyActionMaxStep:0.1,
 localAutonomyActionRefusalPolicy:"hold"
};
const message=(source,value,emitted,arrived)=>({source,value,emitted,arrived});
const noMessages=()=>[[],[]];
test("local action feedback is opt-in and parameters and prerequisites fail closed",()=>{
 assert.equal(validateLocalAutonomyOptions({}).localAutonomyActionFeedbackEnabled,false);
 for(const invalid of [
  {localAutonomyActionFeedbackEnabled:1},{localAutonomyActionGain:-0.1},
  {localAutonomyActionGain:1.01},{localAutonomyActionMaxStep:0},
  {localAutonomyActionMaxStep:101},{localAutonomyActionRefusalPolicy:"oracle"},
  {localAutonomyRefusalPenalty:-1},{localAutonomyRefusalPenalty:Infinity}
 ]){
  assert.throws(()=>validateLocalAutonomyOptions(invalid),/недопустимые параметры/);
 }
 assert.throws(()=>validateLocalTransportOptions({
  localAutonomyActionFeedbackEnabled:true,localAutonomyEnabled:false}),
  /требует автономного оценивателя/);
 const core={seed:7,n_agents:8,n_byzantine:1,n_steps:10,trim_each_side:2,
  attack_start_step:3,network_enabled:true,network_topology:"ring"};
 assert.throws(()=>validateAdaptiveStudy(core,{
  comparisonMode:"network_routed",evidenceModel:"behavior_linked",
  localConsensusPilot:true,localTransportEnabled:true,
  localAutonomyActionFeedbackEnabled:true
 }),/Локальный контур действий требует автономного оценивателя/);
});
test("state update is bounded, causal, and distinguishes accepted action from refusal",()=>{
 const channel=createLocalAutonomy(2,-2,2,base);
 const t1=channel.tick({step:1,own:[0,2],active:[true,true],messages:noMessages()});
 assert.deepEqual(t1.decisions,[null,null]);
 assert.deepEqual(t1.actions,[0,2],"t=1 cold-start action must be own observation");
 assert.equal(t1.actionUpdates,0);
 assert.equal(t1.actionRefusals,2);
 const t2=channel.tick({step:2,own:[0,2],active:[true,true],
  messages:[[message(1,2,1,2)],[message(0,0,1,2)]]});
 assert.ok(t2.decisions[0]>t2.actions[0]);
 assert.ok(t2.decisions[1]<t2.actions[1]);
 assert.ok(Math.abs(t2.actions[0]-0.1)<1e-12);
 assert.ok(Math.abs(t2.actions[1]-1.9)<1e-12);
 assert.equal(t2.actionUpdates,2);
 assert.equal(t2.actionRefusals,0);
 const t3=channel.tick({step:3,own:[1,0],active:[true,true],messages:noMessages()});
 assert.deepEqual(t3.decisions,[null,null]);
 assert.deepEqual(t3.actions,t2.actions,"hold is a local action, not an accepted decision");
 assert.equal(t3.actionRefusals,2);
 assert.equal(t3.updates,0);
 assert.equal(channel.getDiagnostic().actionUpdates,2);
 assert.equal(channel.getDiagnostic().actionRefusals,4);
});
test("refusal policy observe and reactivation reset state without replaying stale action",()=>{
 const channel=createLocalAutonomy(2,-2,2,{
  ...base,localAutonomyActionRefusalPolicy:"observe"
 });
 channel.tick({step:1,own:[0,2],active:[true,true],messages:noMessages()});
 const t2=channel.tick({step:2,own:[1,0],active:[true,true],messages:noMessages()});
 assert.deepEqual(t2.actions,[1,0]);
 const t3=channel.tick({step:3,own:[1,0],active:[false,true],messages:noMessages()});
 assert.equal(t3.actions[0],null);
 assert.equal(t3.actionResets,1);
 const t4=channel.tick({step:4,own:[-1,0],active:[true,true],messages:noMessages()});
 assert.deepEqual(t4.actions,[-1,0]);
 assert.equal(channel.getDiagnostic().actionResets,1);
});
const network=[[false,true],[true,false]];
function transportRun(actionFeedback){
 const ch=createLocalTransport({
  seed:331,n_agents:2,n_sybil_agents:0,
  safe_action_min:-2,safe_action_max:2
 },{
  ...base,localAutonomyActionFeedbackEnabled:actionFeedback,
  localTransportDelaySteps:1,localTransportLossProbability:0
 },0);
 const decisions=[];
 for(let step=1;step<=4;step++){
  ch.networkStep({step,active:[true,true],labels:[0,0],adjacency:network});
  decisions.push(ch.onProposals({step,values:[0,2],
   reputation:[0.15,0.9],active:[true,true],faulty:[false,false]}));
  ch.afterEvidenceTransport({step,sharedCapacity:20,e1Used:0,decisionUsed:0});
 }
 return {decisions,diagnostics:ch.getDiagnostic()};
}
test("accepted actions travel as next-tick packets, changing ONLY local network feedback",()=>{
 const loop=transportRun(true),baseline=transportRun(false);
 const h=loop.diagnostics.history;
 assert.equal(h[0].receivedThisStep,0);
 assert.equal(h[1].receivedThisStep,2);
 assert.deepEqual(h[0].autonomousDecisions,[null,null]);
 assert.deepEqual(h[0].autonomousActions,[0,2]);
 assert.ok(h[1].autonomousActions[0]!==loop.decisions[1][0],
  "Broadcast applied action must differ from unbounded instantaneous estimate");
 assert.ok(Math.abs(h[1].autonomousActions[0]-h[0].autonomousActions[0])<=0.1+1e-12);
 assert.notDeepEqual(loop.decisions[2],baseline.decisions[2],
  "Only previous tick action broadcasts should perturb later local estimates");
 assert.equal(loop.diagnostics.generated,
  loop.diagnostics.delivered+loop.diagnostics.lost+loop.diagnostics.blocked+
  loop.diagnostics.expired+loop.diagnostics.superseded+loop.diagnostics.pending);
 assert.ok(h.every(row=>row.totalUsed<=row.sharedCapacity));
 assert.deepEqual(transportRun(true),loop,"Fixed seed must give bitwise deterministic local action loop");
});
const studyCore={seed:994031,n_agents:10,n_byzantine:2,n_steps:14,
 trim_each_side:2,attack_start_step:4,
 network_enabled:true,network_topology:"ring",
 partition_enabled:true,partition_start_step:6,partition_end_step:10,
 partition_fraction:.4,bandwidth_messages_per_step:45};
const studyOpt={runs:1,comparisonMode:"network_routed",scenario:"static_bias",
 evidenceModel:"behavior_linked",attackStrategy:"coordinated",
 decisionBandwidthPolicy:"local_floor",decisionBandwidthFraction:.25,
 localTransportBandwidthFraction:.25,
 localConsensusPilot:true,localConsensusTrim:0,
 localTransportEnabled:true,localTransportMaxAgeSteps:5,
 localAutonomyEnabled:true,localAutonomyMinNeighbors:1,
 localAutonomyGuardEnabled:true,localAutonomyGuardMinEvidence:2};
test("all-honest-units unconditional loss reconciles and refusal cost has no algorithmic effect",()=>{
 const a=runAdaptiveSingle(studyCore,{...studyOpt,localAutonomyRefusalPenalty:0.5},0);
 const b=runAdaptiveSingle(studyCore,{...studyOpt,localAutonomyRefusalPenalty:4},0);
 assert.deepEqual(a.trajectory,b.trajectory);
 for(const method of a.metrics){
  const other=b.metrics.find(x=>x.method===method.method);
  const hist=a.scenarioDiagnosticsByMethod[method.method].localTransport.history;
  assert.deepEqual(hist,b.scenarioDiagnosticsByMethod[method.method].localTransport.history);
  // Reference is the actual validated simulation configuration, not an
  // assumed default or an oracle supplied to the online estimator.
  const target=validateAdaptiveStudy(studyCore,studyOpt).core.desired_action;
  const precise=hist.flatMap(h=>h.autonomousDecisions.flatMap((v,i)=>
   h.autonomousHonestMask[i]?[Number.isFinite(v)?
    (v-target)**2:0.5]:[]));
  const actual=precise.reduce((sum,v)=>sum+v,0)/precise.length;
  assert.ok(Math.abs(actual-method.mean_local_autonomous_honest_unconditional_loss)<1e-12);
  const refused=hist.reduce((sum,h)=>sum+h.autonomousDecisions.filter((v,i)=>
   h.autonomousHonestMask[i]&&!Number.isFinite(v)).length,0);
  const penaltyDelta=3.5*refused/precise.length;
  assert.ok(Math.abs((other.mean_local_autonomous_honest_unconditional_loss-
   method.mean_local_autonomous_honest_unconditional_loss)-penaltyDelta)<1e-12);
  assert.equal(method.rmse,other.rmse);
 }
});
test("closed local action state preserves central E1 and has separate bounded action metrics",()=>{
 const opts={...studyOpt,localAutonomyActionFeedbackEnabled:true,
  localAutonomyActionGain:0.75,localAutonomyActionMaxStep:0.15};
 const a=runAdaptiveSingle(studyCore,opts,0);
 const b=runAdaptiveSingle(studyCore,{...studyOpt,localAutonomyActionFeedbackEnabled:false},0);
 assert.deepEqual(a.trajectory,b.trajectory);
 assert.deepEqual(a.metrics.map(x=>[x.method,x.rmse,x.probability_correct]),
  b.metrics.map(x=>[x.method,x.rmse,x.probability_correct]));
 let changed=false;
 for(const metric of a.metrics){
  const chan=a.scenarioDiagnosticsByMethod[metric.method].localTransport;
  const other=b.scenarioDiagnosticsByMethod[metric.method].localTransport;
  assert.equal(chan.history.length,studyCore.n_steps);
  assert.ok(chan.history.every(h=>h.autonomousActions?.length===studyCore.n_agents));
  assert.ok(chan.history.every(h=>h.autonomousActions.every(v=>
   v===null||v>=-2&&v<=2)));
  assert.ok(metric.mean_local_autonomous_honest_action_mse>=0);
  assert.ok(metric.mean_local_autonomous_action_updates>0);
  assert.equal(b.metrics.find(x=>x.method===metric.method).
   mean_local_autonomous_honest_action_mse,null);
  if(JSON.stringify(chan.history.map(h=>h.autonomousDecisions))!==
   JSON.stringify(other.history.map(h=>h.autonomousDecisions)))changed=true;
 }
 assert.ok(changed,"New local loop must affect future local decisions in at least one case");
});
