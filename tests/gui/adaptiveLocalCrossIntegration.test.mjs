import test from "node:test";
import assert from "node:assert/strict";
import {simulateLocalPlant,validateLocalPlantOptions,LOCAL_PLANT_VERSION} from
 "../../gui/src/adaptiveLocalPlant.js";
import {CROSS_SENSOR_VERSION} from "../../gui/src/adaptiveLocalCrossSensing.js";

const cfg={plantSteps:40,plantSeed:23011,plantSensorFaultMode:"dropout",
 plantSensorFaultFraction:0.5,plantSensorFaultStart:4,
 plantSensorFaultEnd:36,plantGuardEnabled:false,
 plantControlMode:"local_sensor",plantCrossLoss:0,
 plantCrossEnabled:true,plantCrossBound:.08,
 plantCrossBandwidthFraction:.65,plantCapacity:48};

test("cross sensing is opt-in and validates certified bounds and same-tick quota",()=>{
 assert.match(LOCAL_PLANT_VERSION,/cross-sensing/);
 assert.match(CROSS_SENSOR_VERSION,/f-hull/);
 const defaults=validateLocalPlantOptions();
 assert.equal(defaults.plantCrossEnabled,false);
 for(const bad of [
  {plantCrossEnabled:1},{plantCrossBound:2},{plantCrossDelay:0},
  {plantCrossTTL:0},{plantCrossDelay:5,plantCrossTTL:2},
  {plantCrossLoss:1.5},{plantCrossBandwidthFraction:1.5},
  {plantCrossEnabled:true,plantCrossBandwidthFraction:0}
 ])assert.throws(()=>validateLocalPlantOptions(bad),/Локальный объект/);
 const ordinary=simulateLocalPlant({plantSteps:12,plantSeed:83});
 const optOff=simulateLocalPlant({plantSteps:12,plantSeed:83,
  plantCrossEnabled:false},0);
 assert.deepEqual(ordinary,optOff);
 assert.equal(ordinary.crossSensorVersion,null);
 assert.equal(ordinary.crossTransport,undefined);
});

test("severe dropouts admit physical remote evidence only after causal delivery",()=>{
 const result=simulateLocalPlant({...cfg,plantTopology:"complete"},0);
 const again=simulateLocalPlant({...cfg,plantTopology:"complete"},0);
 assert.deepEqual(result,again);
 assert.equal(result.crossSensorVersion,CROSS_SENSOR_VERSION);
 const h=result.records.filter(r=>r.honest&&r.sensorStatus==="dropout");
 assert.ok(h.length>0);
 assert.ok(h.some(r=>r.crossSupported&&r.crossRefined),
  "A dense authenticated sensing graph with m>f must refine some blackouts");
 assert.ok(h.every(r=>r.trustedSensor===null&&r.measurementOrigin==="prediction"));
 assert.ok(result.records.every(r=>
  r.certifiedInterval.min<=r.stateBefore+1e-9&&
  r.certifiedInterval.max>=r.stateBefore-1e-9&&
  Math.abs(r.stateAfter)<=result.options.plantSafeBound+1e-9));
 const ch=result.crossTransport;
 assert.equal(ch.generated,ch.delivered+ch.lost+ch.blocked+
  ch.expired+ch.superseded+ch.pending);
 assert.ok(ch.history.every(x=>x.sent<=x.budget||x.budget===null));
 assert.ok(result.rows.every(row=>
  row.slotsUsed<=row.slotsAvailable&&
  row.crossSent<=row.crossBudget&&
  row.crossSent+row.transmitted<=row.slotsAvailable));
 assert.ok(result.records.every(r=>r.crossReports.every(packet=>
  packet.emitted<r.step&&packet.arrived<=r.step)));
});

test("ring cannot certify cross measurements when degree does not exceed f",()=>{
 const connected=simulateLocalPlant({...cfg,plantTopology:"ring"},0);
 const ordinary=simulateLocalPlant({...cfg,plantTopology:"ring",
  plantCrossEnabled:false},0);
 assert.ok(connected.records.every(r=>!r.crossSupported&&!r.crossRefined));
 assert.deepEqual(connected.records.map(r=>r.stateAfter),
  ordinary.records.map(r=>r.stateAfter));
 assert.equal(connected.status,ordinary.status);
 assert.equal(connected.completedSteps,ordinary.completedSteps);
});

test("cross-sensor channel does not change legacy E1 or invent full-horizon success",()=>{
 const highLoss=simulateLocalPlant({...cfg,plantTopology:"complete",
  plantCrossLoss:1},1);
 const baseline=simulateLocalPlant({...cfg,plantTopology:"complete",
  plantCrossEnabled:false},1);
 assert.ok(highLoss.records.every(r=>!r.crossSupported));
 assert.deepEqual(highLoss.records.map(r=>r.stateAfter),
  baseline.records.map(r=>r.stateAfter));
 for(const run of [highLoss,baseline]){
  if(run.status!=="completed"){
   assert.equal(run.metrics.honestStateRmse,null);
   assert.equal(run.metrics.fixedHorizonLoss,run.options.plantCertificationPenalty);
  }
 }
});
