import test from "node:test";
import assert from "node:assert/strict";
import {createRoutedDecisionChannel,validateRoutedChannelOptions} from "./adaptiveRoutedDecisionChannel.js";
import {runAdaptiveSingle} from "./adaptiveExperiment.js";

const cfg={seed:520027,n_agents:5,n_sybil_agents:0};
const complete=Array.from({length:5},(_,i)=>Array.from({length:5},(_,j)=>i!==j));
const full=[0,0,0,0,0],alive=[true,true,true,true,true];
function tick(ch,t,{labels=full,graph=complete,e1Used=0,value=null,transmit=false,capacity=10}={}){
 ch.networkStep({step:t,labels,active:alive,adjacency:graph});
 const reserved=ch.reserveDecisionBandwidth({step:t,capacity});
 ch.onProposalsDelivered({step:t,available:alive});
 if(transmit)ch.transmit({step:t,value});
 ch.afterEvidenceTransport({step:t,sharedCapacity:capacity,e1Used,reserved});
 return ch.getDiagnostic();
}
test("opportunistic scheduling rejects invalid policies and defaults to static",()=>{
 assert.equal(validateRoutedChannelOptions({}).decisionBandwidthPolicy,"static");
 assert.equal(validateRoutedChannelOptions({decisionBandwidthPolicy:"opportunistic"}).decisionBandwidthPolicy,"opportunistic");
 for(const policy of ["greedy","",null,0])
  assert.throws(()=>validateRoutedChannelOptions({decisionBandwidthPolicy:policy}),/политика/);
});
test("opportunistic mode borrows unused E1 slots at issue time; static remains exactly capped",()=>{
 const settings={decisionBandwidthFraction:.2,decisionDelaySteps:1,decisionMaxStalenessSteps:5};
 const fixed=createRoutedDecisionChannel(cfg,{...settings,decisionBandwidthPolicy:"static"},0);
 const flexible=createRoutedDecisionChannel(cfg,{...settings,decisionBandwidthPolicy:"opportunistic"},0);
 const a=tick(fixed,1,{capacity:10,e1Used:0,transmit:true,value:.6});
 const b=tick(flexible,1,{capacity:10,e1Used:0,transmit:true,value:.6});
 assert.equal(a.history[0].routingHopsThisStep,2);
 assert.equal(a.history[0].reserved,2);
 assert.equal(a.history[0].borrowedFromE1,0);
 assert.equal(b.history[0].reserved,0,"No pre-existing ready traffic to reserve for");
 assert.equal(b.history[0].routingHopsThisStep,4);
 assert.equal(b.history[0].borrowedFromE1,4);
 assert.equal(b.history[0].releasedToE1,2);
 assert.equal(b.history[0].sharedUsed,4);
 assert.equal(b.attempted,5);
 assert.equal(b.attempted,b.delivered+b.lost+b.blocked+b.expired+b.pending);
});
test("opportunistic mode releases the decision reservation to E1 when no route is available",()=>{
 const settings={decisionBandwidthFraction:.5,decisionMaxStalenessSteps:6};
 const fixed=createRoutedDecisionChannel(cfg,{...settings,decisionBandwidthPolicy:"static"},1);
 const flex=createRoutedDecisionChannel(cfg,{...settings,decisionBandwidthPolicy:"opportunistic"},1);
 // Saturated E1 at t=1 leaves all remote decisions pending.
 tick(fixed,1,{capacity:10,e1Used:5,transmit:true,value:.8});
 tick(flex,1,{capacity:10,e1Used:10,transmit:true,value:.8});
 const separated=Array.from({length:5},(_,i)=>Array.from({length:5},(_,j)=>i!==j&&i>0&&j>0));
 const groups=[0,1,1,1,1];
 const a=tick(fixed,2,{labels:groups,graph:separated,e1Used:5,capacity:10});
 const b=tick(flex,2,{labels:groups,graph:separated,e1Used:10,capacity:10});
 assert.equal(a.history[1].availableForE1,5);
 assert.equal(b.history[1].availableForE1,10);
 assert.equal(b.history[1].targetReservation,5);
 assert.equal(b.history[1].reserved,0);
 assert.equal(b.history[1].releasedToE1,5);
 assert.equal(b.history[1].routingHopsThisStep,0);
 assert.equal(b.history[1].sharedUsed,10);
});
test("strict budget is conserved when E1 saturates and idle slots vanish",()=>{
 const flex=createRoutedDecisionChannel(cfg,{
  decisionBandwidthFraction:.4,decisionBandwidthPolicy:"opportunistic"
 },0);
 for(let t=1;t<=8;t++)tick(flex,t,{
  capacity:10,e1Used:t===1?10:6,transmit:true,value:.5+t*.01
 });
 const d=flex.getDiagnostic();
 assert.ok(d.decisionBorrowedSlots>=0&&d.releasedToE1Slots>=0);
 assert.equal(d.transmittedSlots,d.hopsScheduled);
 assert.equal(d.attempted,d.delivered+d.lost+d.blocked+d.expired+d.pending);
 for(const h of d.history){
  assert.ok(h.sharedUsed<=h.sharedCapacity);
  assert.ok(h.e1Used<=h.availableForE1);
  assert.ok(h.routingHopsThisStep<=h.sharedCapacity-h.e1Used);
  assert.equal(h.sharedUnused,h.sharedCapacity-h.sharedUsed);
 }
});
test("full five-method E1 execution uses actual reclaimed resource and remains deterministic",()=>{
 const core={seed:630132,n_agents:12,n_byzantine:2,n_steps:14,trim_each_side:2,
  attack_start_step:3,network_enabled:true,network_topology:"ring",
  partition_enabled:true,partition_start_step:5,partition_end_step:10,
  partition_fraction:.4,message_delay_min_steps:0,message_delay_max_steps:1,
  bandwidth_messages_per_step:36};
 const opts={comparisonMode:"network_routed",scenario:"static_bias",runs:1,
  alphaMode:"risk_aware",evidenceModel:"behavior_linked",attackStrategy:"coordinated",
  decisionDelaySteps:1,decisionMaxStalenessSteps:6,decisionBandwidthFraction:.4,
  decisionBandwidthPolicy:"opportunistic",decisionLossProbability:.05};
 const a=runAdaptiveSingle(core,opts,0),replay=runAdaptiveSingle(core,opts,0);
 assert.deepEqual(a.trajectory,replay.trajectory);
 assert.deepEqual(a.metrics,replay.metrics);
 assert.equal(Object.keys(a.scenarioDiagnosticsByMethod).length,5);
 for(const [method,diag] of Object.entries(a.scenarioDiagnosticsByMethod)){
  const d=diag.decisionChannel;
  assert.equal(d.bandwidthPolicy,"opportunistic",method);
  assert.equal(d.history.length,core.n_steps);
  assert.equal(d.attempted,d.delivered+d.lost+d.blocked+d.expired+d.pending);
  assert.ok(d.history.every(h=>h.sharedUsed<=h.sharedCapacity&&
   h.e1Used<=h.availableForE1&&h.routingHopsThisStep<=h.sharedCapacity-h.e1Used));
  assert.equal(a.methodStates[method].length,core.n_steps);
 }
});
