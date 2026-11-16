import test from "node:test";
import assert from "node:assert/strict";
import {createLocalAutonomy,validateLocalAutonomyOptions,
 E1A_LOCAL_AUTONOMY_VERSION} from "./adaptiveLocalAutonomy.js";
import {createLocalTransport} from "./adaptiveLocalTransport.js";
import {runAdaptiveSingle,runAdaptiveStudy,validateAdaptiveStudy} from "./adaptiveExperiment.js";

const opt={localTransportMaxAgeSteps:5,localConsensusTrim:0,
 localConsensusRelaxation:1,localConsensusMinWeight:0.05,
 localAutonomyEvidenceTolerance:0.5,localAutonomyDecay:0.5,
 localAutonomyMinNeighbors:1};
const own=[0,1,0],active=[true,true,true];
const empty=()=>[[],[],[]];
const sample=(source,value,emitted,arrived)=>({source,value,emitted,arrived});
test("local autonomy options are bounded and reject inconsistent prerequisites",()=>{
 assert.match(E1A_LOCAL_AUTONOMY_VERSION,/beta/);
 for(const x of [{localAutonomyEnabled:1},
  {localAutonomyEvidenceTolerance:0},{localAutonomyDecay:1.1},
  {localAutonomyMinNeighbors:-1}])
  assert.throws(()=>validateLocalAutonomyOptions(x),/недопустимые параметры/);
 const c={seed:613,n_agents:10,n_byzantine:1,n_steps:12,
  trim_each_side:2,attack_start_step:3,network_enabled:true,
  network_topology:"ring"};
 assert.throws(()=>validateAdaptiveStudy(c,{comparisonMode:"network_routed",
  evidenceModel:"behavior_linked",localAutonomyEnabled:true}),/причинного локального транспорта/);
});
test("private directed Beta trust updates once on arrival, uses emission-time own observation",()=>{
 const a=createLocalAutonomy(3,-2,2,opt);
 let r=a.tick({step:1,own,active,messages:empty()});
 assert.deepEqual(r.decisions,[null,null,null]);
 assert.equal(r.refusals,3);
 assert.equal(r.updates,0);
 r=a.tick({step:2,own:[0.7,-0.5,0],active,
  messages:[[sample(1,1,1,2)],[sample(0,0,1,2)],[]]});
 assert.equal(r.updates,2);
 assert.equal(r.readings,2);
 assert.equal(r.refusals,1);
 assert.ok(r.decisions[0]>0.7,"Current own value is combined only with previous delivered packet");
 const q=1/(1+Math.pow(1/0.5,2));
 const expected=(1+q)/3;
 assert.ok(Math.abs(r.trustByNode[0][0].trust-expected)<1e-12);
 r=a.tick({step:3,own:[0,1,0],active,
  messages:[[sample(1,1,1,2)],[sample(0,0,1,2)],[]]});
 assert.equal(r.updates,0,"same delivered packet cannot create a second trust update");
 assert.ok(r.trustByNode[0][0].trust>expected,
  "With decay, historical soft evidence reverts toward the neutral prior");
 assert.equal(a.getDiagnostic().updates,2);
});
test("local autonomy rejects time travel, repeat source, expired and future deliveries",()=>{
 const broken=(message)=>{
  const a=createLocalAutonomy(3,-2,2,opt);
  a.tick({step:1,own,active,messages:empty()});
  assert.throws(()=>a.tick({step:2,own,active,
   messages:[[message],[],[]]}),/недоставленное или повторное/);
 };
 broken(sample(1,0,2,2));
 broken(sample(1,0,1,3));
 broken(sample(1,0,0,2));
 broken(sample(1,9,1,2));
 const a=createLocalAutonomy(3,-2,2,opt);
 a.tick({step:1,own,active,messages:empty()});
 assert.throws(()=>a.tick({step:2,own,active,
  messages:[[sample(1,0,1,2),sample(1,0,1,2)],[],[]]}),
 /недоставленное или повторное/);
});
const graph=(n,edges)=>Array.from({length:n},(_,i)=>Array.from({length:n},(_,j)=>
 edges.some(([a,b])=>a===i&&b===j||a===j&&b===i)));
const network=graph(4,[[0,1],[1,2],[2,3]]);
const core={seed:7711,n_agents:4,n_sybil_agents:0,safe_action_min:-2,safe_action_max:2};
function runLocal(reputation=[.6,.6,.6,.6],split=false,others=[.4,1]){
 const ch=createLocalTransport(core,{...opt,localAutonomyEnabled:true,
  localTransportDelaySteps:1,localTransportLossProbability:0},0);
 const states=[],faulty=[false,false,false,false];
 for(let t=1;t<=4;t++){
  const edges=split?graph(4,[[0,1],[2,3]]):network;
  const labels=split?[0,0,1,1]:[0,0,0,0];
  ch.networkStep({step:t,adjacency:edges,labels,
   active:[true,true,true,true]});
  states.push(ch.onProposals({step:t,values:[0,.2,...others],
   reputation,active:[true,true,true,true],faulty}));
  ch.afterEvidenceTransport({step:t,sharedCapacity:20,e1Used:2,decisionUsed:1});
 }
 return {states,diagnostic:ch.getDiagnostic()};
}
test("independent local decision does not read global E1 reputation",()=>{
 const first=runLocal([.1,.2,.3,.4]);
 const second=runLocal([.99,.88,.77,.66]);
 assert.deepEqual(first.states,second.states);
 assert.deepEqual(first.diagnostic.autonomy,second.diagnostic.autonomy);
 assert.deepEqual(first.diagnostic.history.map(h=>h.autonomousTrust),
  second.diagnostic.history.map(h=>h.autonomousTrust));
 assert.ok(first.states[0].every(x=>x===null),"No collective decision until neighbor evidence arrives");
 assert.ok(first.diagnostic.transmitted>0,"Raw bootstrap proposals must still be transmitted");
 assert.ok(first.states[1].some(Number.isFinite),"Delivered neighbors enable local decisions");
 assert.ok(first.diagnostic.autonomy.updates>0);
 assert.equal(first.diagnostic.generated,
  first.diagnostic.delivered+first.diagnostic.lost+first.diagnostic.blocked+
  first.diagnostic.expired+first.diagnostic.superseded+first.diagnostic.pending);
});
test("partitioned graph blocks cross-component dependence and all autonomy results stay safe",()=>{
 const x=runLocal([.1,.9,.2,.8],true);
 assert.ok(x.diagnostic.history.every(h=>h.localValues.every(v=>
  v===null||v>=-2&&v<=2)));
 assert.equal(x.diagnostic.history[0].receivedThisStep,0);
 assert.ok(x.diagnostic.history.some(h=>h.autonomousCoverage>0));
 assert.ok(x.diagnostic.history.every(h=>h.totalUsed<=h.sharedCapacity));
 const y=runLocal([.99,.1,.2,.8],true,[-2,2]);
 assert.deepEqual(x.states.map(v=>v.slice(0,2)),
  y.states.map(v=>v.slice(0,2)),
  "Changing all observations in the other component must not affect local decisions");
 assert.deepEqual(x.diagnostic.history.map(h=>h.autonomousTrust.slice(0,2)),
  y.diagnostic.history.map(h=>h.autonomousTrust.slice(0,2)),
  "The first component must not inherit directed trust from disconnected nodes");
});
test("autonomy study has separately labelled metrics without changing central E1 results",()=>{
 const cfg={seed:9943,n_agents:10,n_byzantine:2,n_steps:12,
  trim_each_side:2,attack_start_step:4,
  network_enabled:true,network_topology:"ring",
  partition_enabled:true,partition_start_step:5,partition_end_step:9,
  partition_fraction:.4,bandwidth_messages_per_step:30};
 const o={comparisonMode:"network_routed",scenario:"static_bias",runs:2,
  alphaMode:"risk_aware",evidenceModel:"behavior_linked",
  attackStrategy:"coordinated",decisionBandwidthPolicy:"local_floor",
  decisionBandwidthFraction:.3,localTransportBandwidthFraction:.2,
  localConsensusPilot:true,localTransportEnabled:true,localAutonomyEnabled:true};
 const a=runAdaptiveSingle(cfg,o,0),b=runAdaptiveSingle(cfg,o,0);
 assert.deepEqual(a.trajectory,b.trajectory);
 assert.deepEqual(a.methodStates,b.methodStates);
 for(const [method,diag] of Object.entries(a.scenarioDiagnosticsByMethod)){
  const link=diag.localTransport;
  assert.ok(link.autonomy?.modelVersion===E1A_LOCAL_AUTONOMY_VERSION);
  assert.equal(link.history.length,12);
  assert.ok(link.history.every(h=>h.localReserved<=h.localUsed));
  assert.ok(link.history.every(h=>h.autonomousDecisions?.length===10));
  const metric=a.metrics.find(x=>x.method===method);
  assert.ok(metric.mean_local_autonomous_coverage>0);
  assert.ok(metric.mean_local_autonomous_coverage<=1);
  assert.ok(metric.mean_local_autonomous_rmse>=0);
  assert.ok(metric.mean_local_autonomous_honest_rmse>=0);
  assert.ok(metric.mean_local_autonomous_honest_coverage>=0&&
   metric.mean_local_autonomous_honest_coverage<=1);
  assert.ok(link.history.every(h=>h.autonomousHonestMask?.length===10));
 }
 const without=runAdaptiveSingle(cfg,{...o,localAutonomyEnabled:false},0);
 assert.deepEqual(a.trajectory,without.trajectory);
 assert.deepEqual(a.metrics.map(r=>[r.method,r.rmse,r.probability_correct]),
  without.metrics.map(r=>[r.method,r.rmse,r.probability_correct]));
 const study=runAdaptiveStudy(cfg,o);
 assert.ok(study.summary.every(r=>r.mean_local_autonomous_rmse.n===2));
 assert.ok(study.summary.every(r=>r.mean_local_autonomous_honest_rmse.n===2));
 assert.equal(study.models.localAutonomy,E1A_LOCAL_AUTONOMY_VERSION);
 assert.match(study.methodology.localAutonomy,/SHADOW/);
});
