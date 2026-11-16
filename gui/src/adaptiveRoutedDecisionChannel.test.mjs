import test from "node:test";
import assert from "node:assert/strict";
import {nextHopOnActiveGraph,createRoutedDecisionChannel,
 validateRoutedChannelOptions,E1A_ROUTED_CHANNEL_VERSION} from "./adaptiveRoutedDecisionChannel.js";
import {runAdaptiveSingle,runAdaptiveStudy,validateAdaptiveStudy} from "./adaptiveExperiment.js";

const config={n_agents:4,n_sybil_agents:0,seed:6453};
const links=(n,edges)=>Array.from({length:n},(_,i)=>Array.from({length:n},(_,j)=>
 edges.some(([a,b])=>a===i&&b===j||a===j&&b===i)));
const path=links(4,[[0,1],[1,2],[2,3]]);
const labels=[0,0,0,0],active=[true,true,true,true];
function step(channel,t,{adjacency=path,groups=labels,alive=active,capacity=6,used=2,
 value=null,send=false}={}){
 channel.networkStep({step:t,labels:groups,active:alive,adjacency});
 const reserved=channel.reserveDecisionBandwidth({step:t,capacity});
 channel.onProposalsDelivered({step:t,available:alive});
 if(send)channel.transmit({step:t,value});
 channel.afterEvidenceTransport({step:t,sharedCapacity:capacity,
  e1Used:Math.min(used,capacity-reserved),reserved});
 return channel.getDiagnostic();
}
test("routed mode validates strict shared bandwidth reservation",()=>{
 assert.match(E1A_ROUTED_CHANNEL_VERSION,/shortest-path/);
 for(const x of [-.01,1.01,NaN,Infinity,".25"])
  assert.throws(()=>validateRoutedChannelOptions({decisionBandwidthFraction:x}),/доля резервирования/);
 assert.throws(()=>createRoutedDecisionChannel(config,{decisionOriginAgent:4}),/источник/);
});
test("deterministic shortest path follows exact graph edges and respects dynamic partitions",()=>{
 assert.equal(nextHopOnActiveGraph(path,labels,active,0,3),1);
 assert.equal(nextHopOnActiveGraph(path,labels,active,2,0),1);
 assert.equal(nextHopOnActiveGraph(path,[0,0,1,1],active,0,3),null);
 assert.equal(nextHopOnActiveGraph(path,labels,[true,false,true,true],0,3),null);
 const diamond=links(4,[[0,1],[1,3],[0,2],[2,3]]);
 assert.equal(nextHopOnActiveGraph(diamond,labels,active,0,3),1,
  "Tie must choose smaller node id, not depend on edge array insertion order");
});
test("one decision traverses 3 hops in 3 ticks, never appears at an undelivered witness",()=>{
 const channel=createRoutedDecisionChannel(config,{
  decisionBandwidthFraction:.5,decisionDelaySteps:1,decisionMaxStalenessSteps:6
 },0);
 let x=step(channel,1,{send:true,value:.7});
 assert.equal(x.attempted,4);
 assert.equal(x.delivered,0);
 assert.equal(x.hopsScheduled,3);
 assert.equal(channel.referenceFor(2,2),null);
 x=step(channel,2);
 assert.equal(channel.referenceFor(0,0),.7);
 assert.equal(channel.referenceFor(1,2),.7);
 assert.equal(channel.referenceFor(2,2),null);
 assert.equal(x.hopsArrived,3);
 x=step(channel,3);
 assert.equal(channel.referenceFor(2,2),.7);
 assert.equal(channel.referenceFor(3,3),null);
 x=step(channel,4);
 assert.equal(channel.referenceFor(3,3),.7);
 assert.equal(x.delivered,4);
 assert.equal(x.hopsScheduled,6);
 assert.equal(x.hopsArrived,6);
 assert.equal(x.pending,0);
 assert.equal(x.balance,0);
 for(const row of x.history){
  assert.ok(row.sharedUsed<=row.sharedCapacity);
  assert.ok(row.routingHopsThisStep<=row.reserved);
  assert.ok(row.e1Used<=row.availableForE1);
 }
});
test("no routing slots cannot carry remote packets; TTL expires without false delivery",()=>{
 const channel=createRoutedDecisionChannel(config,{
  decisionBandwidthFraction:0,decisionMaxStalenessSteps:2
 },1);
 for(let t=1;t<=5;t++)step(channel,t,{send:t===1,value:.4,capacity:10,used:8});
 const x=channel.getDiagnostic();
 assert.equal(x.delivered,1);
 assert.equal(x.expired,3);
 assert.equal(x.hopsScheduled,0);
 assert.equal(x.balance,0);
 assert.equal(channel.referenceFor(3,3),null);
});
test("a changed link at physical arrival blocks the packet instead of teleporting",()=>{
 const channel=createRoutedDecisionChannel(config,{
  decisionBandwidthFraction:1,decisionMaxStalenessSteps:6
 },0);
 step(channel,1,{send:true,value:.6});
 const split=links(4,[[1,2],[2,3]]);
 const g=[0,1,1,1];
 step(channel,2,{adjacency:split,groups:g});
 const x=channel.getDiagnostic();
 assert.equal(x.delivered,1,"Only locally published decision can arrive");
 assert.equal(x.blocked,3,"Remote packets on broken 0->1 link must be removed");
 assert.equal(x.pending,0);
 assert.equal(x.balance,0);
 assert.equal(channel.referenceFor(1,1),null);
});
test("recompute route at the intermediate hop if a link changes",()=>{
 const ch=createRoutedDecisionChannel(config,{
  decisionBandwidthFraction:1,decisionDelaySteps:1,decisionMaxStalenessSteps:7
 },0);
 const initial=links(4,[[0,1],[1,3],[1,2]]);
 const later=links(4,[[0,1],[1,2],[2,3]]);
 step(ch,1,{adjacency:initial,send:true,value:.55});
 step(ch,2,{adjacency:later});
 assert.equal(ch.referenceFor(3,3),null);
 step(ch,3,{adjacency:later});
 assert.equal(ch.referenceFor(3,3),null);
 step(ch,4,{adjacency:later});
 assert.equal(ch.referenceFor(3,3),.55);
 assert.equal(ch.getDiagnostic().balance,0);
});
test("waiting intermediate packet recovers when a graph partition heals before TTL",()=>{
 const ch=createRoutedDecisionChannel(config,{
  decisionBandwidthFraction:1,decisionDelaySteps:1,decisionMaxStalenessSteps:8
 },2);
 step(ch,1,{send:true,value:.65});
 const two=links(4,[[0,1],[2,3]]);
 step(ch,2,{adjacency:two,groups:[0,0,1,1]});
 assert.equal(ch.referenceFor(3,3),null);
 assert.ok(ch.getDiagnostic().routeDeferrals>0);
 step(ch,3);
 step(ch,4);
 step(ch,5);
 assert.equal(ch.referenceFor(3,3),.65);
 assert.equal(ch.getDiagnostic().balance,0);
});
test("reserving a common-budget share materially reduces E1 transmission capacity",()=>{
 const base={seed:18913,n_agents:12,n_byzantine:2,n_steps:12,
  trim_each_side:2,attack_start_step:3,network_enabled:true,
  network_topology:"complete",partition_enabled:false,
  message_loss_probability:0,message_delay_min_steps:0,
  message_delay_max_steps:0,bandwidth_messages_per_step:8};
 const cfg={comparisonMode:"network_routed",scenario:"static_bias",runs:1,
  evidenceModel:"behavior_linked",attackStrategy:"coordinated",
  decisionDelaySteps:1,decisionMaxStalenessSteps:5,decisionLossProbability:0};
 const noShare=runAdaptiveSingle(base,{...cfg,decisionBandwidthFraction:0},0);
 const shared=runAdaptiveSingle(base,{...cfg,decisionBandwidthFraction:.75},0);
 const first=noShare.scenarioDiagnosticsByMethod.adaptive_robust.decisionChannel;
 const next=shared.scenarioDiagnosticsByMethod.adaptive_robust.decisionChannel;
 assert.equal(first.reservedSlots,0);
 assert.equal(first.hopsScheduled,0);
 assert.ok(next.reservedSlots>0);
 assert.ok(next.hopsScheduled>0);
 assert.ok(first.e1UsedSlots>next.e1UsedSlots,
  "E1 proposal/evidence delivery must actually lose slots to decision routing");
 assert.ok(next.history.every(h=>h.e1Used<=h.availableForE1));
 assert.ok(next.history.every(h=>h.e1Used+h.routingHopsThisStep<=h.sharedCapacity));
});
test("100% hop loss, disabled origin and abstention have disjoint accounting",()=>{
 const ch=createRoutedDecisionChannel(config,{
  decisionBandwidthFraction:1,decisionLossProbability:1
 },0);
 step(ch,1,{send:true,value:.9});
 step(ch,2,{send:true,value:null});
 step(ch,3,{send:true,value:.5,alive:[false,true,true,true]});
 const d=ch.getDiagnostic();
 assert.equal(d.attempted,4);
 assert.equal(d.lost,3);
 assert.equal(d.delivered,1);
 assert.equal(d.abstentions,1);
 assert.equal(d.notDispatched,1);
 assert.equal(d.hopsScheduled,3);
 assert.equal(d.hopsLost,3);
 assert.equal(d.balance,0);
});
test("routed random per-hop losses and full replay are deterministic",()=>{
 const run=()=>{
  const ch=createRoutedDecisionChannel(config,{
   decisionBandwidthFraction:.5,decisionLossProbability:.37,decisionDelaySteps:1,
   decisionMaxStalenessSteps:5
  },4);
  for(let t=1;t<=10;t++)step(ch,t,{send:t<=5,value:.3+t*.01});
  return ch.getDiagnostic();
 };
 assert.deepEqual(run(),run());
});
test("routed shared capacity modifies E1 evidence budget but never violates link/packet balance",()=>{
 const core={seed:31247,n_agents:12,n_byzantine:3,n_steps:18,
  trim_each_side:2,attack_start_step:4,network_enabled:true,
  network_topology:"ring",partition_enabled:true,
  partition_start_step:7,partition_end_step:12,partition_fraction:.4,
  message_loss_probability:.04,message_delay_min_steps:0,
  message_delay_max_steps:1,bandwidth_messages_per_step:45};
 const opts={runs:2,scenario:"static_bias",comparisonMode:"network_routed",
  alphaMode:"risk_aware",evidenceModel:"behavior_linked",
  attackStrategy:"coordinated",decisionOriginAgent:0,
  decisionBandwidthFraction:.4,decisionDelaySteps:1,decisionLossProbability:.1,
  decisionMaxStalenessSteps:5};
 assert.throws(()=>validateAdaptiveStudy({...core,network_enabled:false},opts),/сетевого моделирования/);
 assert.throws(()=>validateAdaptiveStudy(core,{...opts,evidenceModel:"legacy"}),/поведенческая модель/);
 const x=runAdaptiveSingle(core,opts,0),y=runAdaptiveSingle(core,opts,0);
 assert.deepEqual(x.trajectory,y.trajectory);
 assert.deepEqual(x.metrics,y.metrics);
 for(const method of ["trimmed_unweighted","proposed_robust","adaptive_unweighted",
  "adaptive_weighted","adaptive_robust"]){
  const d=x.scenarioDiagnosticsByMethod[method].decisionChannel;
  assert.equal(d.modelVersion,E1A_ROUTED_CHANNEL_VERSION);
  assert.equal(d.history.length,18);
  assert.ok(d.attempted>0);
  assert.ok(d.hopsScheduled>0);
  assert.equal(d.attempted,d.delivered+d.lost+d.blocked+d.expired+d.pending);
  assert.ok(d.history.every(h=>h.e1Used+h.routingHopsThisStep<=h.sharedCapacity));
  assert.ok(d.history.every(h=>h.routingHopsThisStep<=h.reserved));
  assert.ok(d.history.every(h=>h.e1Used<=h.availableForE1));
  assert.equal(x.methodStates[method].length,18);
 }
 const study=runAdaptiveStudy(core,opts);
 assert.equal(study.completedRuns,2);
 assert.equal(study.models.routedDecisionChannel,E1A_ROUTED_CHANNEL_VERSION);
 assert.ok(study.summary.every(m=>m.mean_shared_utilization.n===2));
});
