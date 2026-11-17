import test from "node:test";
import assert from "node:assert/strict";
import {validateLocalPlantOptions,simulateLocalPlant} from
 "../../gui/src/adaptiveLocalPlant.js";
import {refineCertifiedInterval,shieldCertifiedInterval,
 forecastCertifiedInterval,createCertifiedPlantObserver,
 scheduledSensorFault,SENSOR_FAULT_OBSERVER_VERSION} from
 "../../gui/src/adaptiveLocalPlantSensorFaults.js";

const p=validateLocalPlantOptions();
const close=(x,y)=>assert.ok(Math.abs(x-y)<1e-10,
 `Expected ${x} ≈ ${y}`);

test("sensor failure schedule, bounds and penalty are explicit and opt-in",()=>{
 assert.equal(p.plantSensorFaultMode,"nominal");
 assert.match(SENSOR_FAULT_OBSERVER_VERSION,/interval-observer/);
 for(const bad of [
  {plantSensorFaultMode:"spoofed_oracle"},
  {plantSensorFaultFraction:-0.01},
  {plantSensorFaultFraction:1.01},
  {plantSensorFaultStart:0},
  {plantSensorFaultEnd:501},
  {plantDegradedSensorBound:Infinity},
  {plantDegradedSensorBound:2},
  {plantCertificationPenalty:0},
  {plantSensorFaultStart:12,plantSensorFaultEnd:10},
  {plantSensorFaultMode:"dropout",plantSteps:10,plantSensorFaultEnd:12}
 ])assert.throws(()=>validateLocalPlantOptions(bad),/Локальный объект/);
 const opts=validateLocalPlantOptions({
  plantSensorFaultMode:"dropout",plantSensorFaultFraction:.34,
  plantSensorFaultStart:4,plantSensorFaultEnd:9
 });
 assert.equal(scheduledSensorFault(4,0,opts),"dropout");
 assert.equal(scheduledSensorFault(4,2,opts),"dropout");
 assert.equal(scheduledSensorFault(4,3,opts),"nominal");
 assert.equal(scheduledSensorFault(3,0,opts),"nominal");
 assert.equal(scheduledSensorFault(10,0,opts),"nominal");
 assert.equal(scheduledSensorFault(4,7,opts),"nominal");
 assert.throws(()=>scheduledSensorFault(0,1,opts),/неверный адрес/);
});

test("certified observation intersects only current, authenticated measurement",()=>{
 const prior={min:-.8,max:.9};
 const observed=refineCertifiedInterval({prior,measurement:.5,errorBound:.07},p);
 close(observed.min,.43);close(observed.max,.57);
 const missing=refineCertifiedInterval({prior,measurement:null,errorBound:null},p);
 assert.deepEqual(missing,prior);
 assert.notStrictEqual(missing,prior);
 assert.throws(()=>refineCertifiedInterval({
  prior,measurement:null,errorBound:.04},p),/пропущено/);
 assert.throws(()=>refineCertifiedInterval({
  prior,measurement:1.5,errorBound:.01},p),
  e=>e.code==="CERTIFICATION_LOST");
 assert.throws(()=>refineCertifiedInterval({
  prior,measurement:0,errorBound:-.1},p),/недостоверный/);
 const withExtra=refineCertifiedInterval({
  prior,measurement:.5,errorBound:.07,state:-2,oracle:100},p);
 assert.deepEqual(withExtra,observed);
});

test("certified barrier enforces all interval corners and every admissible disturbance",()=>{
 for(const interval of [
  {min:-1,max:-.2},{min:0,max:0},{min:.5,max:1.2},
  {min:1.95,max:2}
 ]){
  const r=shieldCertifiedInterval({interval,requested:100},p);
  assert.ok(r.control>=-p.plantControlLimit-1e-10);
  assert.ok(r.control<=p.plantControlLimit+1e-10);
  for(const x of [interval.min,interval.max])
   for(const w of [-p.plantDisturbanceBound,p.plantDisturbanceBound]){
    const next=p.plantA*x+p.plantB*r.control+w;
    assert.ok(Math.abs(next)<=p.plantSafeBound+1e-10,
     "All true states consistent with interval must be kept safe");
   }
  const projected=forecastCertifiedInterval({
   interval,control:r.control},p);
  assert.ok(projected.min>=-p.plantSafeBound-1e-10);
  assert.ok(projected.max<=p.plantSafeBound+1e-10);
 }
});

test("wide interval has no admissible control: fails closed without clipping",()=>{
 const wide={min:-2,max:2};
 assert.throws(()=>shieldCertifiedInterval({
  interval:wide,requested:0},p),e=>
   e.code==="CERTIFICATION_LOST"&&/исполнительного/.test(e.reason));
 assert.throws(()=>forecastCertifiedInterval({
  interval:{min:1.9,max:2},control:1},p),e=>
   e.code==="CERTIFICATION_LOST");
});

test("observer is causal, set-valued, and commits only complete valid transitions",()=>{
 const obs=createCertifiedPlantObserver(8,p);
 const a=obs.observe({time:1,readings:Array(8).fill(0),
  bounds:Array(8).fill(.04)});
 close(a[0].min,-.04);close(a[0].max,.04);
 assert.equal(obs.getDiagnostic().completedSteps,0,
  "Observations do not mutate state until the action has been certified");
 assert.throws(()=>obs.advance({time:1,current:a,
  controls:[...Array(7).fill(0),99]}),/неверный исполненный/);
 assert.equal(obs.getDiagnostic().completedSteps,0,
  "Failed prediction cannot partially commit another node");
 const next=obs.advance({time:1,current:a,controls:Array(8).fill(0)});
 close(next[0].min,-(.04*p.plantA+p.plantDisturbanceBound));
 close(next[0].max,.04*p.plantA+p.plantDisturbanceBound);
 assert.equal(obs.getDiagnostic().completedSteps,1);
 const lost=obs.observe({time:2,readings:Array(8).fill(null),
  bounds:Array(8).fill(null)});
 assert.deepEqual(lost,next);
 assert.throws(()=>obs.observe({time:3,readings:Array(8).fill(null),
  bounds:Array(8).fill(null)}),/последовательность/);
 assert.equal(obs.getDiagnostic().completedSteps,1);
});

test("default simulator stays on its original nominal physics and telemetry path",()=>{
 const baseline=simulateLocalPlant({plantSteps:14,plantSeed:91411},1);
 const nominal=simulateLocalPlant({
  plantSteps:14,plantSeed:91411,plantSensorFaultMode:"nominal",
  plantSensorFaultFraction:1,plantSensorFaultStart:2,
  plantSensorFaultEnd:14},1);
 assert.equal(baseline.observerVersion,null);
 assert.deepEqual(nominal.records,baseline.records);
 assert.deepEqual(nominal.final,baseline.final);
 assert.deepEqual(nominal.metrics,baseline.metrics);
 assert.deepEqual(nominal.transport,baseline.transport);
});

test("short trusted dropout uses only prediction bounds and preserves certified safety",()=>{
 const cfg={plantSeed:214551,plantSteps:18,
  plantSensorFaultMode:"dropout",plantSensorFaultFraction:.5,
  plantSensorFaultStart:5,plantSensorFaultEnd:8,
  plantCapacity:60,plantTransportLoss:0,
  plantGuardEnabled:false,plantControlMode:"local_action"};
 const one=simulateLocalPlant(cfg,0);
 assert.equal(one.status,"completed");
 assert.equal(one.completedSteps,cfg.plantSteps);
 assert.equal(one.metrics.certificationLost,0);
 assert.ok(one.metrics.honestSensorDropoutFraction>0);
 assert.ok(one.records.some(x=>x.honest&&x.sensorStatus==="dropout"));
 assert.ok(one.records.filter(x=>x.honest&&x.sensorStatus==="dropout")
  .every(x=>x.trustedSensor===null&&x.sensorBound===null&&
   x.measurementOrigin==="prediction"&&
   Math.abs(x.emittedValue-(x.certifiedInterval.min+
    x.certifiedInterval.max)/2)<1e-10));
 assert.ok(one.records.every(x=>
  x.certifiedInterval.min<=x.stateBefore+1e-10&&
  x.certifiedInterval.max>=x.stateBefore-1e-10&&
  Math.abs(x.stateAfter)<=2+1e-10));
 assert.deepEqual(simulateLocalPlant(cfg,0),one);
 close(one.metrics.fixedHorizonLoss,one.metrics.honestStateRmse**2);
});

test("authenticated degradation expands sensor bounds instead of pretending nominal V",()=>{
 const cfg={plantSeed:214551,plantSteps:18,
  plantSensorFaultMode:"degraded",plantSensorFaultFraction:.5,
  plantDegradedSensorBound:.35,
  plantSensorFaultStart:5,plantSensorFaultEnd:8,
  plantGuardEnabled:false};
 const one=simulateLocalPlant(cfg,0);
 assert.equal(one.status,"completed");
 assert.equal(one.metrics.certificationLost,0);
 assert.ok(one.metrics.honestSensorDegradedFraction>0);
 const degraded=one.records.filter(x=>x.honest&&x.sensorStatus==="degraded");
 assert.ok(degraded.length>0);
 assert.ok(degraded.every(x=>
  x.sensorBound===.35&&x.measurementOrigin==="trusted"&&
  Math.abs(x.stateBefore-x.trustedSensor)<=.35+1e-10));
 assert.ok(one.records.every(x=>x.certifiedInterval.min<=x.stateBefore+1e-10&&
  x.certifiedInterval.max>=x.stateBefore-1e-10));
});

test("long outage must report certification loss; no fabricated full-horizon RMSE",()=>{
 const s=simulateLocalPlant({
  plantSeed:1017,plantSteps:45,plantSensorFaultMode:"dropout",
  plantSensorFaultFraction:1,plantSensorFaultStart:2,
  plantSensorFaultEnd:43,plantCapacity:30,
  plantGuardEnabled:false},0);
 assert.equal(s.status,"certification_lost");
 assert.ok(s.certificateFailure);
 assert.ok(s.completedSteps<45);
 assert.equal(s.metrics.honestStateRmse,null);
 assert.equal(s.metrics.honestMeanFinalV,null);
 assert.equal(s.metrics.certificationLost,1);
 assert.equal(s.metrics.fixedHorizonLoss,s.options.plantCertificationPenalty);
 assert.ok(s.records.every(x=>Math.abs(x.stateAfter)<=s.options.plantSafeBound+1e-10));
 assert.equal(s.records.length,s.completedSteps*s.options.plantAgents);
});

test("paired exogenous disturbances are identical across policies; physical plant differs",()=>{
 const cfg={plantSeed:770028,plantSteps:18,plantSensorFaultMode:"dropout",
  plantSensorFaultFraction:.3,plantSensorFaultStart:6,
  plantSensorFaultEnd:8,plantCapacity:60,plantGuardEnabled:false};
 const action=simulateLocalPlant({...cfg,plantControlMode:"local_action"},1);
 const sensor=simulateLocalPlant({...cfg,plantControlMode:"local_sensor"},1);
 assert.equal(action.status,"completed");
 assert.equal(sensor.status,"completed");
 assert.deepEqual(action.initial,sensor.initial);
 assert.deepEqual(action.records.map(x=>x.disturbance),
  sensor.records.map(x=>x.disturbance));
 assert.deepEqual(action.records.map(x=>x.sensorStatus),
  sensor.records.map(x=>x.sensorStatus));
 assert.notDeepEqual(action.records.map(x=>x.stateAfter),
  sensor.records.map(x=>x.stateAfter));
 assert.ok(sensor.records.some(x=>x.honest&&x.sensorStatus==="dropout"&&
  x.controlSource==="prediction_fallback"));
 assert.ok(sensor.metrics.honestFallbackFraction>0);
});
