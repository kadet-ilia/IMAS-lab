import test from "node:test";
import assert from "node:assert/strict";
import {createLocalTransport,validateLocalTransportOptions,
 E1A_LOCAL_TRANSPORT_VERSION} from "../../gui/src/adaptiveLocalTransport.js";
import {runAdaptiveSingle,runAdaptiveStudy,validateAdaptiveStudy} from "../../gui/src/adaptiveExperiment.js";

const c={seed:11482,n_agents:4,n_sybil_agents:0,
 safe_action_min:-2,safe_action_max:2};
const graph=(n,edges)=>Array.from({length:n},(_,i)=>Array.from({length:n},(_,j)=>
 edges.some(([a,b])=>a===i&&b===j||a===j&&b===i)));
const chain=graph(4,[[0,1],[1,2],[2,3]]);
const active=Array(4).fill(true),labels=Array(4).fill(0),rep=Array(4).fill(.6);
const tick=(ch,t,{adjacency=chain,groups=labels,alive=active,
 values=[0,0,0,1],faulty=Array(4).fill(false),capacity=12,
 e1=2,decisions=1}={})=>{
 ch.networkStep({step:t,adjacency,labels:groups,active:alive});
 const v=ch.onProposals({step:t,values,reputation:rep,
  active:alive,faulty});
 ch.afterEvidenceTransport({step:t,sharedCapacity:capacity,
  e1Used:e1,decisionUsed:decisions});
 return {v,diag:ch.getDiagnostic()};
};
test("local communication parameters bounded, delay cannot exceed TTL",()=>{
 assert.match(E1A_LOCAL_TRANSPORT_VERSION,/causal/);
 for(const [key,val] of [["localTransportDelaySteps",0],
  ["localTransportLossProbability",2],["localTransportMaxAgeSteps",0]]){
  assert.throws(()=>validateLocalTransportOptions({[key]:val}),new RegExp(key));
 }
 assert.throws(()=>validateLocalTransportOptions({
  localTransportDelaySteps:4,localTransportMaxAgeSteps:2}),/срок актуальности/);
 assert.throws(()=>validateLocalTransportOptions({localTransportEnabled:"yes"}),/логическим/);
});
test("one hop per tick: a remote value cannot reach a two-hop node early",()=>{
 const ch=createLocalTransport(c,{localTransportDelaySteps:1,
  localTransportMaxAgeSteps:5,localConsensusTrim:0,localConsensusRelaxation:1},0);
 let a=tick(ch,1,{values:[0,0,0,2]});
 assert.equal(a.v[0],0);assert.equal(a.v[1],0);
 assert.equal(a.diag.delivered,0);
 a=tick(ch,2,{values:[0,0,0,2]});
 assert.equal(a.v[0],0);
 assert.equal(a.v[1],0);
 assert.ok(a.v[2]>0);
 a=tick(ch,3,{values:[0,0,0,2]});
 assert.equal(a.v[0],0);
 assert.ok(a.v[1]>0);
 // New value generated at node 3 needs >=3 physical ticks to reach node 0.
 assert.ok(a.v.every(v=>v>=-2&&v<=2));
});
test("finite loss and local bandwidth are accounted independently of routed/E1 slots",()=>{
 const ch=createLocalTransport(c,{localTransportLossProbability:1,
  localTransportDelaySteps:1,localTransportMaxAgeSteps:3},2);
 const a=tick(ch,1,{capacity:8,e1:3,decisions:2});
 assert.equal(a.diag.generated,6);
 assert.equal(a.diag.transmitted,3);
 assert.equal(a.diag.lost,3);
 assert.equal(a.diag.pending,3);
 assert.equal(a.diag.history[0].totalUsed,8);
 assert.equal(a.diag.history[0].localUsed,3);
 assert.equal(a.diag.history[0].sharedUtilization,1);
 assert.equal(a.diag.generated,a.diag.lost+a.diag.pending);
 const b=tick(ch,2,{capacity:8,e1:3,decisions:2});
 assert.equal(b.diag.slotsE1+b.diag.slotsDecisions+b.diag.slotsLocal,
  b.diag.history.reduce((s,h)=>s+h.totalUsed,0));
 assert.equal(b.diag.generated,
  b.diag.delivered+b.diag.lost+b.diag.blocked+b.diag.expired+
  b.diag.superseded+b.diag.pending);
});
test("no idle capacity does not transmit local packets or alter honest estimates",()=>{
 const ch=createLocalTransport(c,{localTransportMaxAgeSteps:2},1);
 const one=tick(ch,1,{capacity:5,e1:4,decisions:1});
 assert.equal(one.diag.transmitted,0);
 assert.equal(one.diag.history[0].localUsed,0);
 const two=tick(ch,2,{capacity:5,e1:4,decisions:1});
 assert.equal(two.diag.transmitted,0);
 assert.deepEqual(one.v,two.v);
 assert.ok(two.diag.superseded>0);
 assert.equal(two.diag.generated,
  two.diag.superseded+two.diag.pending);
});
test("link loss at physical arrival blocks the packet without teleportation",()=>{
 const ch=createLocalTransport(c,{localTransportDelaySteps:1,
  localTransportMaxAgeSteps:5},0);
 tick(ch,1,{values:[0,0,0,2]});
 const split=graph(4,[[0,1],[2,3]]);
 const b=tick(ch,2,{adjacency:split,groups:[0,0,1,1],
  values:[0,0,0,2]});
 assert.ok(b.diag.blocked>=2);
 assert.equal(b.v[1],0,"Disconnected node 2 cannot influence node 1");
 assert.ok(b.diag.history.every(h=>h.totalUsed<=h.sharedCapacity));
});
test("one-hop neighbor information remains partition-local and causal",()=>{
 const split=graph(4,[[0,1],[2,3]]);
 const opts={localTransportDelaySteps:1,localTransportMaxAgeSteps:4,
  localConsensusTrim:0,localConsensusRelaxation:1};
 const one=createLocalTransport(c,opts,0),two=createLocalTransport(c,opts,0);
 for(let t=1;t<=4;t++){
  const base=[0,1,0,0.1];
  const changed=[0,1,50,-2];
  const a=tick(one,t,{adjacency:split,groups:[0,0,1,1],values:base});
  const b=tick(two,t,{adjacency:split,groups:[0,0,1,1],values:changed});
  assert.deepEqual(a.v.slice(0,2),b.v.slice(0,2));
  assert.notDeepEqual(a.v.slice(2),b.v.slice(2));
 }
});
test("local channel replay is exactly deterministic under independent link losses",()=>{
 const run=()=>{
  const ch=createLocalTransport(c,{
   localTransportLossProbability:.38,localTransportMaxAgeSteps:5
  },7);
  for(let t=1;t<=8;t++)tick(ch,t,{values:[0,.2,.4,t*.1]});
  return ch.getDiagnostic();
 };
 assert.deepEqual(run(),run());
});
test("opt-in is rejected without E1 network and pre-existing local diagnostic",()=>{
 const core={seed:431,n_agents:9,n_byzantine:2,n_steps:9,
  trim_each_side:1,attack_start_step:3,network_enabled:true};
 const opts={comparisonMode:"network_routed",scenario:"static_bias",
  runs:1,evidenceModel:"behavior_linked",localTransportEnabled:true};
 assert.throws(()=>validateAdaptiveStudy(core,opts),/диагностики локального/);
 assert.throws(()=>validateAdaptiveStudy({...core,network_enabled:false},
  {...opts,localConsensusPilot:true}),/сетевого моделирования/);
});
test("live E1 routed+local audit counts shared slots and never changes E1 decisions",()=>{
 const core={seed:3517,n_agents:10,n_byzantine:2,n_steps:14,
  trim_each_side:2,network_enabled:true,network_topology:"ring",
  partition_enabled:true,partition_start_step:5,partition_end_step:9,
  partition_fraction:.4,attack_start_step:3,
  bandwidth_messages_per_step:22,message_loss_probability:.04,
  message_delay_min_steps:0,message_delay_max_steps:1};
 const cfg={runs:2,scenario:"static_bias",comparisonMode:"network_routed",
  alphaMode:"risk_aware",evidenceModel:"behavior_linked",
  attackStrategy:"coordinated",decisionBandwidthPolicy:"opportunistic",
  decisionBandwidthFraction:.3,localConsensusPilot:true,
  localConsensusTrim:0,localConsensusRounds:2,localConsensusRelaxation:.6,
  localTransportEnabled:true,localTransportDelaySteps:1,
  localTransportLossProbability:.2,localTransportMaxAgeSteps:4};
 const run=runAdaptiveSingle(core,cfg,0);
 const replay=runAdaptiveSingle(core,cfg,0);
 assert.deepEqual(run.trajectory,replay.trajectory);
 assert.equal(Object.keys(run.scenarioDiagnosticsByMethod).length,5);
 for(const [method,d] of Object.entries(run.scenarioDiagnosticsByMethod)){
  const link=d.localTransport;
  assert.equal(link.modelVersion,E1A_LOCAL_TRANSPORT_VERSION);
  assert.equal(link.history.length,14);
  assert.equal(link.generated,
   link.delivered+link.lost+link.blocked+link.expired+link.superseded+link.pending);
  assert.ok(link.history.some(h=>h.localUsed>0));
  for(const h of link.history){
   assert.ok(h.totalUsed<=h.sharedCapacity);
   assert.equal(h.totalUsed,h.E1Used+h.decisionUsed+h.localUsed);
   assert.ok(h.localUsed>=0);
   assert.ok(h.localValues.every((v,i)=>v===null||(v>=-2&&v<=2)));
  }
  assert.equal(run.methodStates[method].length,14);
 }
 const baseline=runAdaptiveSingle(core,{...cfg,localTransportEnabled:false},0);
 assert.deepEqual(run.trajectory,baseline.trajectory);
 assert.deepEqual(run.metrics.map(x=>[x.method,x.rmse,x.probability_correct]),
  baseline.metrics.map(x=>[x.method,x.rmse,x.probability_correct]));
 const summary=runAdaptiveStudy(core,cfg);
 assert.equal(summary.completedRuns,2);
 assert.equal(summary.models.localTransport,E1A_LOCAL_TRANSPORT_VERSION);
 assert.ok(summary.summary.every(x=>x.mean_local_link_transmissions.n===2));
});
