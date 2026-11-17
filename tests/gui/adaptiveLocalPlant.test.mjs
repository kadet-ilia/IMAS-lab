import test from "node:test";
import assert from "node:assert/strict";
import {LOCAL_PLANT_VERSION,validateLocalPlantOptions,
 computeRobustSafetyControl,advanceScalarPlant,localPlantAdjacency,
 simulateLocalPlant} from "../../gui/src/adaptiveLocalPlant.js";
import {runAdaptiveSingle} from "../../gui/src/adaptiveExperiment.js";

const near=(x,y,tol=1e-10)=>assert.ok(Math.abs(x-y)<=tol,`Expected ${x} ≈ ${y}`);
const defaults=validateLocalPlantOptions();

test("scalar plant has a separate version and rejects invalid or nonviable settings",()=>{
 assert.match(LOCAL_PLANT_VERSION,/scalar/);
 for(const bad of [
  {plantA:NaN},{plantB:0},{plantSafeBound:0},
  {plantControlLimit:0},{plantDisturbanceBound:2},
  {plantSensorBound:2},{plantByzantine:4},
  {plantControlMode:"oracle"},{plantFallbackPolicy:"hidden_truth"},
  {plantPartition:"yes"},{plantTopology:"star"},
  {plantTransportTTL:1,plantTransportDelay:2},
  {plantPartition:true,plantPartitionEnd:40},
  {plantGuardThreshold:0.95,plantGuardHysteresis:.2},
  {plantA:1.5,plantControlLimit:0.1},
  {plantSensorBound:1.9,plantA:1.2}
 ]){
  assert.throws(()=>validateLocalPlantOptions(bad),/Локальный объект/);
 }
 assert.throws(()=>simulateLocalPlant({},-1),/индекс реализации/);
});

test("measurement-only robust barrier has an exact interval and blocks unsafe zero fallback",()=>{
 const p=validateLocalPlantOptions();
 const x=computeRobustSafetyControl({
  measurement:2,accepted:false},p);
 near(x.xMax,2);
 near(x.xMin,2-p.plantSensorBound);
 near(x.hi,(p.plantSafeBound-p.plantDisturbanceBound-
  p.plantA*2)/p.plantB);
 assert.ok(x.hi<0);
 near(x.requested,0);
 near(x.control,x.hi);
 assert.equal(x.acceptedLocal,false);
 assert.equal(x.refused,true);
 assert.equal(x.overridden,true);
 near(advanceScalarPlant({
  state:2,control:x.control,disturbance:p.plantDisturbanceBound},p),2);
 const withFakeTruth=computeRobustSafetyControl({
  measurement:2,accepted:false,state:-100,truth:999,oracle:1},p);
 assert.deepEqual(x,withFakeTruth,"Controller must have no true-state or oracle branch");
});

test("nominal contraction is exact in the unprojected, noise-free interior",()=>{
 const p=validateLocalPlantOptions({plantSensorBound:0,plantDisturbanceBound:0});
 const x=0.5;
 const c=computeRobustSafetyControl({
  measurement:x,estimate:x,accepted:true},p);
 near(c.control,-p.plantK*x);
 assert.equal(c.overridden,false);
 const next=advanceScalarPlant({state:x,control:c.control,disturbance:0},p);
 near(next,(p.plantA-p.plantB*p.plantK)*x);
 assert.ok(Math.abs(p.plantA-p.plantB*p.plantK)<1);
});

test("robust control guarantees invariant states at all envelope corners",()=>{
 const p=validateLocalPlantOptions();
 const S=p.plantSafeBound,V=p.plantSensorBound,W=p.plantDisturbanceBound;
 for(const x of [-S,-1.5,-0.1,0,0.1,1.5,S]){
  for(const sensorNoise of [-V,0,V]){
   const y=Math.max(-S,Math.min(S,x+sensorNoise));
   for(const accepted of [true,false]){
    const c=computeRobustSafetyControl({
     measurement:y,estimate:0,accepted},p);
    for(const w of [-W,W]){
     const next=advanceScalarPlant({
      state:x,control:c.control,disturbance:w},p);
     assert.ok(Math.abs(next)<=S+1e-10);
    }
    assert.ok(c.control<=p.plantControlLimit+1e-10);
    assert.ok(c.control>=-p.plantControlLimit-1e-10);
   }
  }
 }
});

test("partitions remove physical edges and rejoin on recovery without fictional delivery",()=>{
 const split=localPlantAdjacency(8,"ring",true);
 const joined=localPlantAdjacency(8,"ring",false);
 assert.equal(split.labels[0],0);
 assert.equal(split.labels[7],1);
 assert.equal(split.adjacency[0][7],false);
 assert.equal(joined.adjacency[0][7],true);
 assert.ok(split.adjacency.every((row,i)=>row.every((edge,j)=>
  !edge||split.labels[i]===split.labels[j])));
});

test("simulated physical loop is deterministic and conserves network messages",()=>{
 const p={plantSeed:20261117,plantSteps:18,plantCapacity:32,
  plantControlMode:"local_action",plantPartition:true,
  plantPartitionStart:5,plantPartitionEnd:11};
 const one=simulateLocalPlant(p,0),two=simulateLocalPlant(p,0);
 assert.deepEqual(one,two);
 assert.equal(one.records.length,p.plantSteps*defaults.plantAgents);
 assert.ok(one.metrics.honestStateRmse>=0);
 assert.ok(one.metrics.maxAbsoluteState<=defaults.plantSafeBound+1e-10);
 assert.equal(one.metrics.safetyViolations,0);
 assert.equal(one.metrics.issViolations,0);
 assert.ok(one.rows.some(r=>r.partition));
 assert.ok(one.rows.some(r=>!r.partition));
 assert.ok(one.rows.every(r=>r.slotsUsed<=r.slotsAvailable));
 const d=one.transport;
 assert.equal(d.generated,d.delivered+d.lost+d.blocked+d.expired+
  d.superseded+d.pending);
 assert.ok(one.records.every(r=>Math.abs(r.stateAfter)<=defaults.plantSafeBound+1e-10&&
  Math.abs(r.stateAfter)<=r.issOneStepBound+1e-10&&
  Math.abs(r.stateAfter)<=r.issRecursiveBound+1e-10));
});

test("zero bandwidth forces explicit fallback, but physical safety remains certified",()=>{
 const p={plantCapacity:0,plantSteps:20,plantDisturbanceBound:0.04,
  plantInitialMagnitude:1.99,plantControlMode:"local_action",
  plantFallbackPolicy:"barrier_zero"};
 const sim=simulateLocalPlant(p,0);
 assert.equal(sim.metrics.honestCoverage,0);
 assert.equal(sim.metrics.honestFallbackFraction,1);
 assert.ok(sim.metrics.honestBarrierOverrideFraction>0);
 assert.ok(sim.rows.every(r=>r.transmitted===0));
 assert.equal(sim.metrics.safetyViolations,0);
 assert.equal(sim.metrics.issViolations,0);
});

test("network loss causes safe refusals, and new delivery may restore decisions",()=>{
 const base={plantSteps:18,plantCapacity:30,plantTransportLoss:1,
  plantControlMode:"local_decision",plantGuardEnabled:false};
 const lost=simulateLocalPlant(base,0);
 assert.equal(lost.metrics.honestCoverage,0);
 const delivered=simulateLocalPlant({...base,plantTransportLoss:0},0);
 assert.ok(delivered.metrics.honestCoverage>0);
 assert.equal(lost.metrics.safetyViolations,0);
 assert.equal(delivered.metrics.safetyViolations,0);
});

test("telemetry attacks in a separated component cannot affect the other physical loop",()=>{
 const p={plantAgents:8,plantByzantine:2,plantSteps:18,
  plantSeed:117,plantTopology:"complete",plantPartition:true,
  plantPartitionStart:1,plantPartitionEnd:18,
  plantCapacity:100,plantTransportLoss:0,
  plantAttackStart:3,plantGuardEnabled:false,plantControlMode:"local_action"};
 const a=simulateLocalPlant({...p,plantAttackBias:0},0);
 const b=simulateLocalPlant({...p,plantAttackBias:1.9},0);
 const first=sim=>sim.records.filter(r=>r.node<4).map(r=>[
  r.step,r.node,r.stateBefore,r.trustedSensor,r.localDecision,
  r.localAction,r.control,r.stateAfter
 ]);
 assert.deepEqual(first(a),first(b));
 // The attacked component's emitted proposals do differ in its own records.
 assert.notDeepEqual(a.records.filter(r=>r.node>=6).map(r=>r.emittedValue),
  b.records.filter(r=>r.node>=6).map(r=>r.emittedValue));
});

test("same exogenous random tape is used across controller policies",()=>{
 const p={plantSteps:18,plantCapacity:32,plantSeed:811001};
 const a=simulateLocalPlant({...p,plantControlMode:"local_action"},2);
 const b=simulateLocalPlant({...p,plantControlMode:"local_decision"},2);
 const c=simulateLocalPlant({...p,plantControlMode:"local_sensor"},2);
 assert.deepEqual(a.initial,b.initial);
 assert.deepEqual(a.initial,c.initial);
 assert.deepEqual(a.records.map(r=>r.disturbance),
  b.records.map(r=>r.disturbance));
 assert.deepEqual(a.records.map(r=>r.disturbance),
  c.records.map(r=>r.disturbance));
 assert.ok([a,b,c].every(s=>s.metrics.safetyViolations===0));
 assert.notDeepEqual(a.records.map(r=>r.stateAfter),
  c.records.map(r=>r.stateAfter),
  "The separate physical plant must react to applied action policy");
});

test("the scalar plant is a sidecar, not a silent mutation of original E1",()=>{
 const cfg={seed:44001,n_agents:10,n_byzantine:2,n_steps:12,
  trim_each_side:2,attack_start_step:3,network_enabled:true,
  network_topology:"ring",bandwidth_messages_per_step:24};
 const opts={comparisonMode:"network_routed",scenario:"static_bias",runs:1,
  evidenceModel:"behavior_linked",attackStrategy:"coordinated",
  localConsensusPilot:true,localTransportEnabled:true,
  localAutonomyEnabled:true};
 const original=runAdaptiveSingle(cfg,opts,0);
 simulateLocalPlant({plantSeed:44001,plantSteps:14},0);
 const after=runAdaptiveSingle(cfg,opts,0);
 assert.deepEqual(original.trajectory,after.trajectory);
 assert.deepEqual(original.metrics,after.metrics);
 assert.deepEqual(original.methodStates,after.methodStates);
});

test("physical-control attribution distinguishes diagnostic availability from accepted actuation",()=>{
 const setup={plantSteps:16,plantCapacity:30,plantGuardEnabled:false,
  plantTransportLoss:0,plantSeed:44561};
 const sensor=simulateLocalPlant({...setup,plantControlMode:"local_sensor"},0);
 assert.ok(sensor.metrics.honestCoverage>0,
  "The auxiliary local estimator still runs");
 assert.equal(sensor.metrics.honestLocalControlFraction,0,
  "Sensor baseline never uses collective control");
 assert.equal(sensor.metrics.honestFallbackFraction,0,
  "Own-sensor controller is not a fallback after refusal");
 assert.ok(sensor.records.filter(x=>x.honest).every(x=>
  x.controlSource==="trusted_sensor"&&!x.refused));
 for(const mode of ["local_action","local_decision"]){
  const r=simulateLocalPlant({...setup,plantControlMode:mode},0);
  assert.ok(r.metrics.honestCoverage>0);
  assert.ok(Math.abs(r.metrics.honestLocalControlFraction+
   r.metrics.honestFallbackFraction-1)<1e-12);
  assert.ok(Math.abs(r.metrics.honestLocalControlFraction-
   r.metrics.honestCoverage)<1e-12);
  assert.ok(r.records.some(x=>x.honest&&x.controlSource==="local"));
 }
});
