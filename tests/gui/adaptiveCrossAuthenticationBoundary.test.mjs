import test from "node:test";
import assert from "node:assert/strict";
import {createHmac,timingSafeEqual} from "node:crypto";
import {simulateLocalPlant,validateLocalPlantOptions} from
 "../../gui/src/adaptiveLocalPlant.js";
import {createCrossSensorTransport} from
 "../../gui/src/adaptiveLocalCrossSensing.js";

// This is a Node reference adapter using real HMAC-SHA256. Production
// credential provisioning, clock attestation and hardware binding remain
// OUTSIDE the synthetic model and must not be asserted as implemented.
const credentials=Array.from({length:8},(_,i)=>
 Buffer.from("imas-e1a-unique-reference-secret-for-source-"+i,"utf8"));
const mac=(source,message)=>
 createHmac("sha256",credentials[source]).update(message,"utf8").digest("hex");
const hmacAdapter={
 sign:mac,
 verify:(source,message,sig)=>{
  if(!Number.isInteger(source)||source<0||source>=credentials.length||
   typeof sig!=="string"||!/^[0-9a-f]{64}$/.test(sig))return false;
  const expected=Buffer.from(mac(source,message),"hex");
  return timingSafeEqual(expected,Buffer.from(sig,"hex"));
 }
};
const p=validateLocalPlantOptions({
 plantCrossEnabled:true,plantCrossAuthMode:"verified_envelope",
 plantCrossLoss:0,plantCrossDelay:1,plantCapacity:100});
const graph=Array.from({length:8},(_,i)=>Array.from({length:8},(_,j)=>i!==j));
const active=Array(8).fill(true),faulty=Array(8).fill(false);

test("no key-verification adapter means no certified verified-envelope run",()=>{
 assert.throws(()=>createCrossSensorTransport(p,0),
  /требует внешний криптографический адаптер/);
 assert.throws(()=>simulateLocalPlant({
  plantCrossEnabled:true,plantCrossAuthMode:"verified_envelope"},0),
  /требует внешний криптографический адаптер/);
 assert.throws(()=>validateLocalPlantOptions({
  plantCrossAuthMode:"trust_anyone"}),/режим удостоверения/);
});

test("source, target, emission epoch and value are HMAC-bound before accepting a packet",()=>{
 const tr=createCrossSensorTransport(p,0,hmacAdapter);
 tr.networkStep({time:1,active,adjacency:graph});
 assert.equal(tr.emit({time:1,active,states:Array(8).fill(.3),
  faulty,budget:100}),56);
 tr.networkStep({time:2,active,adjacency:graph});
 const arrived=tr.read({time:2}).flat();
 assert.equal(arrived.length,56);
 assert.ok(arrived.every(r=>hmacAdapter.verify(r.source,
  JSON.stringify(["e1a-cross-sensor-envelope-v1",r.source,
   r.target,r.emitted,r.value]),r.signature)));
 assert.equal(tr.getDiagnostic().authenticationRejected,0);
 const report=arrived[0];
 assert.equal(hmacAdapter.verify(report.source,
  JSON.stringify(["e1a-cross-sensor-envelope-v1",report.source,
   report.target,report.emitted,report.value+.1]),report.signature),false);
 assert.equal(hmacAdapter.verify(report.source,
  JSON.stringify(["e1a-cross-sensor-envelope-v1",report.source,
   report.target,report.emitted+1,report.value]),report.signature),false);
});

test("signature mismatch drops invalid sources without producing certified evidence",()=>{
 const compromised={
  sign:(source,bytes)=>mac(source,source===0?bytes+"-tampered":bytes),
  verify:hmacAdapter.verify
 };
 const tr=createCrossSensorTransport(p,0,compromised);
 tr.networkStep({time:1,active,adjacency:graph});
 tr.emit({time:1,states:Array(8).fill(.1),active,faulty,budget:100});
 tr.networkStep({time:2,active,adjacency:graph});
 assert.ok(tr.read({time:2}).every(x=>x.every(packet=>packet.source!==0)));
 const d=tr.getDiagnostic();
 assert.equal(d.authenticationRejected,7);
 assert.equal(d.delivered,49);
 assert.equal(d.blocked,7);
 assert.equal(d.generated,d.delivered+d.lost+d.blocked+
  d.expired+d.superseded+d.pending);
});

test("verified HMAC reference adapter preserves the successful synthetic measurement path",()=>{
 const config={plantSteps:20,plantTopology:"complete",
  plantCrossEnabled:true,plantCrossObservationMode:"orbital_visibility",
  plantCrossOrbitRadius:2,plantCrossCentralBodyRadius:1,
  plantCrossMaxRange:5,plantCrossOrbitInclination:.9,
  plantCrossOrbitPlanes:2,plantCrossOrbitAngularRate:.2,
  plantSensorFaultMode:"dropout",plantSensorFaultFraction:.5,
  plantSensorFaultStart:4,plantSensorFaultEnd:17,
  plantGuardEnabled:false,plantControlMode:"local_sensor",
  plantCrossSampleLagMaxSteps:2,plantCapacity:100};
 const verified=simulateLocalPlant({
  ...config,plantCrossAuthMode:"verified_envelope"},0,hmacAdapter);
 const assumed=simulateLocalPlant({
  ...config,plantCrossAuthMode:"assumed_origin"},0);
 assert.deepEqual(verified.records,assumed.records);
 assert.equal(verified.status,assumed.status);
 assert.deepEqual(verified.final,assumed.final);
 assert.equal(verified.crossTransport.authenticationRejected,0);
 assert.equal(verified.crossTransport.authenticationMode,"verified_envelope");
 assert.ok(verified.records.every(r=>r.crossReports.every(q=>
  !("signature" in q))),"No raw key/signed envelope leaks in plant records");
});
