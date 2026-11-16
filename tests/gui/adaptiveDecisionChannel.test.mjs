import test from "node:test";
import assert from "node:assert/strict";
import {createDecisionChannel,validateDecisionChannelOptions,E1A_DECISION_CHANNEL_VERSION} from "../../gui/src/adaptiveDecisionChannel.js";
import {runAdaptiveSingle,runAdaptiveStudy,validateAdaptiveStudy} from "../../gui/src/adaptiveExperiment.js";

const c={seed:45091,n_agents:5,n_sybil_agents:0};
const all=[true,true,true,true,true];
const net=(channel,step,labels=[0,0,0,1,1],active=all)=>
 channel.networkStep({step,labels,active});
const send=(channel,step,value=.6,available=all)=>{
 channel.onProposalsDelivered({step,available});
 channel.transmit({step,value});
};

test("decision-channel options bounded and reject paradoxical staleness/delay",()=>{
 assert.match(E1A_DECISION_CHANNEL_VERSION,/component-broadcast/);
 assert.throws(()=>validateDecisionChannelOptions({decisionDelaySteps:0}),/decisionDelaySteps/);
 assert.throws(()=>validateDecisionChannelOptions({decisionLossProbability:2}),/decisionLossProbability/);
 assert.throws(()=>validateDecisionChannelOptions({decisionMaxStalenessSteps:1,decisionDelaySteps:2}),/срок хранения/);
 assert.throws(()=>createDecisionChannel(c,{decisionOriginAgent:5},0),/источник/);
});
test("decision is never used before its causal arrival and never leaks between disconnected components",()=>{
 const channel=createDecisionChannel(c,{decisionDelaySteps:1,decisionMaxStalenessSteps:3},0);
 net(channel,1);
 send(channel,1,.4);
 assert.equal(channel.referenceFor(1,2),null);
 assert.equal(channel.referenceFor(3,4),null);
 net(channel,2);
 assert.equal(channel.referenceFor(1,2),.4);
 assert.equal(channel.referenceFor(3,4),null);
 assert.equal(channel.getDiagnostic().delivered,3);
 // Split the origin from a previously informed witness: no old global signal.
 net(channel,3,[0,1,1,2,2]);
 assert.equal(channel.referenceFor(1,2),null);
 assert.equal(channel.referenceFor(0,1),null);
 // A formerly received, still fresh reference may be used after reconnection.
 net(channel,4,[0,0,0,1,1]);
 assert.equal(channel.referenceFor(1,2),.4);
 net(channel,5);
 assert.equal(channel.referenceFor(1,2),null,"stale reference must expire");
});
test("packet scheduled in one graph component but separated at arrival is blocked",()=>{
 const channel=createDecisionChannel(c,{decisionDelaySteps:2,decisionMaxStalenessSteps:5},0);
 net(channel,1,[0,0,0,0,0]);
 send(channel,1,.7);
 net(channel,2,[0,1,1,1,1]);
 net(channel,3,[0,1,1,1,1]);
 assert.equal(channel.referenceFor(0,0),.7);
 assert.equal(channel.referenceFor(1,1),null);
 assert.equal(channel.getDiagnostic().blocked,4);
 assert.equal(channel.getDiagnostic().delivered,1);
 net(channel,4,[0,0,0,0,0]);
 assert.equal(channel.referenceFor(1,1),null,"blocked packet cannot reappear on reconnection");
});
test("loss, absence of originating proposal and refusal are separately accounted",()=>{
 const channel=createDecisionChannel(c,{decisionLossProbability:1,decisionDelaySteps:1},3);
 net(channel,1,[0,0,0,0,0]);
 send(channel,1,.6);
 assert.equal(channel.getDiagnostic().lost,5);
 net(channel,2,[0,0,0,0,0]);
 send(channel,2,null);
 assert.equal(channel.getDiagnostic().abstentions,1);
 net(channel,3,[0,0,0,0,0]);
 send(channel,3,.4,[false,true,true,true,true]);
 assert.equal(channel.getDiagnostic().notDispatched,1);
 assert.equal(channel.getDiagnostic().delivered,0);
 assert.equal(channel.referenceFor(3,4),null);
 assert.equal(channel.getDiagnostic().attempted,5);
});
test("fixed stochastic drops are reproducible and channel never accepts unordered steps",()=>{
 const make=()=>{
  const channel=createDecisionChannel(c,{decisionLossProbability:.4},2);
  for(let i=1;i<=6;i++){
   net(channel,i,[0,0,0,0,0]);
   send(channel,i,.2+i*.05);
  }
  return channel.getDiagnostic();
 };
 assert.deepEqual(make(),make());
 const channel=createDecisionChannel(c,{},2);
 assert.throws(()=>net(channel,2),/несогласованный такт/);
 net(channel,1);
 assert.throws(()=>send(channel,2),/нарушение порядка/);
});
test("network feedback validates actual network and independently runs every E1 estimator",()=>{
 const config={seed:25063,n_agents:11,n_byzantine:2,n_steps:14,
  attack_start_step:3,trim_each_side:2,network_enabled:true,
  network_topology:"ring",partition_enabled:true,
  partition_start_step:5,partition_end_step:10,partition_fraction:.4,
  message_delay_min_steps:0,message_delay_max_steps:1,
  message_loss_probability:.05,bandwidth_messages_per_step:300};
 const o={comparisonMode:"network_feedback",attackStrategy:"coordinated",
  evidenceModel:"behavior_linked",scenario:"static_bias",runs:2,
  decisionOriginAgent:0,decisionDelaySteps:2,
  decisionMaxStalenessSteps:5,decisionLossProbability:.12};
 assert.throws(()=>validateAdaptiveStudy({...config,network_enabled:false},o),/сетевого моделирования/);
 assert.throws(()=>validateAdaptiveStudy(config,{...o,evidenceModel:"legacy"}),/поведенческая модель/);
 assert.throws(()=>validateAdaptiveStudy(config,{...o,decisionOriginAgent:99}),/вне множества агентов/);
 const first=runAdaptiveSingle(config,o,0);
 const replay=runAdaptiveSingle(config,o,0);
 assert.deepEqual(first.trajectory,replay.trajectory);
 assert.deepEqual(first.metrics,replay.metrics);
 assert.equal(Object.keys(first.methodStates).length,5);
 for(const method of Object.keys(first.methodStates)){
  const d=first.scenarioDiagnosticsByMethod[method]?.decisionChannel;
  assert.equal(d.history.length,14);
  assert.ok(d.attempted>0);
  assert.ok(d.delivered>=0&&d.blocked>=0&&d.lost>=0);
  assert.equal(d.attempted,d.lost+d.delivered+d.blocked+d.expired+d.pending);
  assert.equal(first.methodStates[method].length,14);
  assert.ok(first.methodStates[method].some(x=>x.decision_reference_coverage!==null));
 }
 const data=runAdaptiveStudy(config,o);
 assert.equal(data.completedRuns,2);
 assert.equal(data.methodology.comparisonMode,"network_feedback");
 assert.equal(data.models.decisionChannel,E1A_DECISION_CHANNEL_VERSION);
 assert.equal(data.summary.length,5);
 assert.ok(data.summary.every(x=>x.mean_decision_reference_coverage.n===2));
});
