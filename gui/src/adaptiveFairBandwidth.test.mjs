import test from "node:test";
import assert from "node:assert/strict";
import {createRoutedDecisionChannel,validateRoutedChannelOptions} from "./adaptiveRoutedDecisionChannel.js";
import {runAdaptiveSingle,validateAdaptiveStudy} from "./adaptiveExperiment.js";

const graph=(n,edges)=>Array.from({length:n},(_,i)=>Array.from({length:n},(_,j)=>
 edges.some(([a,b])=>(a===i&&b===j)||(a===j&&b===i))));
const net=graph(4,[[0,1],[1,2],[2,3]]),active=Array(4).fill(true),labels=Array(4).fill(0);
test("local floor validates fractions and requires causal neighbor transport",()=>{
 assert.throws(()=>validateRoutedChannelOptions({
  decisionBandwidthPolicy:"local_floor",decisionBandwidthFraction:.8,
  localTransportBandwidthFraction:.3}),/сумма гарантированных долей/);
 assert.throws(()=>validateRoutedChannelOptions({
  localTransportBandwidthFraction:NaN}),/доля локального транспорта/);
 const core={seed:444,n_agents:8,n_steps:6,network_enabled:true};
 assert.throws(()=>validateAdaptiveStudy(core,{comparisonMode:"network_routed",
  evidenceModel:"behavior_linked",decisionBandwidthPolicy:"local_floor"}),/локального транспорта/);
});
test("local reservation is demand-capped and does not create retroactive capacity",()=>{
 const ch=createRoutedDecisionChannel({seed:31,n_agents:4,n_sybil_agents:0},{
  decisionBandwidthPolicy:"local_floor",decisionBandwidthFraction:.25,
  localTransportBandwidthFraction:.25},0);
 ch.networkStep({step:1,labels,active,adjacency:net});
 const reserved=ch.reserveDecisionBandwidth({step:1,capacity:12,localDemand:2});
 assert.equal(reserved,5);
 ch.onProposalsDelivered({step:1,available:active});
 ch.transmit({step:1,value:.4});
 const usage=ch.afterEvidenceTransport({step:1,sharedCapacity:12,e1Used:7,reserved});
 assert.equal(usage.localReserved,2);
 assert.equal(usage.decisionReserved,3);
 assert.equal(usage.routingHops,3);
 assert.equal(ch.getDiagnostic().history[0].sharedUsed,10);
 const ch2=createRoutedDecisionChannel({seed:31,n_agents:4,n_sybil_agents:0},{
  decisionBandwidthPolicy:"local_floor",decisionBandwidthFraction:.25,
  localTransportBandwidthFraction:.25},0);
 ch2.networkStep({step:1,labels,active,adjacency:net});
 assert.equal(ch2.reserveDecisionBandwidth({step:1,capacity:12,localDemand:0}),3,
  "Unused local guarantee must be returned to baseline E1 BEFORE scheduling");
});
test("opt-in local floor preserves causal budget and deterministic full replay",()=>{
 const core={seed:3517,n_agents:10,n_byzantine:2,n_steps:12,
  trim_each_side:2,network_enabled:true,network_topology:"ring",
  partition_enabled:true,partition_start_step:5,partition_end_step:9,
  partition_fraction:.4,attack_start_step:3,bandwidth_messages_per_step:22,
  message_loss_probability:.04,message_delay_min_steps:0,message_delay_max_steps:1};
 const cfg={runs:1,scenario:"static_bias",comparisonMode:"network_routed",
  alphaMode:"risk_aware",evidenceModel:"behavior_linked",
  attackStrategy:"coordinated",decisionBandwidthPolicy:"local_floor",
  decisionBandwidthFraction:.3,localTransportBandwidthFraction:.2,
  localConsensusPilot:true,localConsensusTrim:0,localConsensusRounds:2,
  localTransportEnabled:true,localTransportDelaySteps:1,
  localTransportLossProbability:.2,localTransportMaxAgeSteps:4};
 const a=runAdaptiveSingle(core,cfg,0),b=runAdaptiveSingle(core,cfg,0);
 assert.deepEqual(a.trajectory,b.trajectory);
 assert.deepEqual(a.metrics,b.metrics);
 for(const d of Object.values(a.scenarioDiagnosticsByMethod)){
  const local=d.localTransport,route=d.decisionChannel;
  assert.equal(local.policy,"DEMAND_CAPPED_LOCAL_GUARANTEE");
  assert.ok(route.history.some(h=>h.localReserved>0));
  assert.equal(local.localGuaranteedSlots,route.localGuaranteedSlots);
  for(let i=0;i<local.history.length;i++){
   const h=local.history[i],r=route.history[i];
   assert.equal(h.localReserved,r.localReserved);
   assert.ok(h.localUsed>=r.localReserved,
    "Routable quota must be transmitted before the tick ends");
   assert.ok(h.totalUsed<=h.sharedCapacity);
   assert.ok(h.E1Used<=h.sharedCapacity-r.reserved);
   assert.ok(r.routingHopsThisStep<=r.decisionReserved);
   assert.equal(h.totalUsed,h.E1Used+h.decisionUsed+h.localUsed);
  }
  assert.equal(local.generated,
   local.delivered+local.lost+local.blocked+local.expired+
   local.superseded+local.pending);
  assert.equal(route.attempted,route.delivered+route.lost+
   route.blocked+route.expired+route.pending);
 }
});
test("historical static remains unchanged by irrelevant local-floor setting",()=>{
 const core={seed:484,n_agents:8,n_byzantine:1,n_steps:8,
  attack_start_step:3,trim_each_side:1,network_enabled:true,
  network_topology:"ring",bandwidth_messages_per_step:20};
 const opts={runs:1,scenario:"static_bias",comparisonMode:"network_routed",
  evidenceModel:"behavior_linked",decisionBandwidthFraction:.3,
  decisionBandwidthPolicy:"static"};
 const a=runAdaptiveSingle(core,opts,0);
 const b=runAdaptiveSingle(core,{...opts,localTransportBandwidthFraction:.7},0);
 assert.deepEqual(a.trajectory,b.trajectory);
 assert.deepEqual(a.metrics,b.metrics);
});
