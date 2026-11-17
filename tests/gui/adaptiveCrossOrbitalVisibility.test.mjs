import test from "node:test";
import assert from "node:assert/strict";
import {validateLocalPlantOptions} from "../../gui/src/adaptiveLocalPlant.js";
import {syntheticOrbitState,syntheticOrbitVisibility} from "../../gui/src/adaptiveCrossOrbitalVisibility.js";
import {crossSensorPhysicalPair,projectCrossReport,auditCrossObservationGraph,
 auditCrossTemporalObservationGraph,createCrossSensorTransport} from "../../gui/src/adaptiveLocalCrossSensing.js";
const p=validateLocalPlantOptions({
 plantCrossEnabled:true,plantCrossObservationMode:"orbital_visibility",
 plantCrossOrbitRadius:2,plantCrossCentralBodyRadius:1.5,
 plantCrossOrbitPlanes:2,plantCrossOrbitInclination:.9,
 plantCrossOrbitAngularRate:Math.PI/2,plantCrossMaxRange:5,
 plantCrossBound:.04,plantCrossDistanceErrorSlope:.03,plantCrossLoss:0});
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,String(a)+" != "+String(b));
const graph=Array.from({length:8},(_,i)=>Array.from({length:8},(_,j)=>i!==j));

test("three-dimensional circular geometry and unit prograde direction",()=>{
 const x=syntheticOrbitState(0,1,p),y=syntheticOrbitState(4,1,p);
 assert.deepEqual(x.position,[2,0,0]);
 near(y.position[0],-2);
 for(let t=1;t<=5;t++)for(let i=0;i<8;i++){
  const q=syntheticOrbitState(i,t,p);
  near(Math.hypot(...q.position),2);
  near(Math.hypot(...q.prograde),1);
  near(q.position.reduce((s,v,j)=>s+v*q.prograde[j],0),0);
 }
});

test("central sphere blocks actual segment at t1, releases it at t2 and blocks again at t3",()=>{
 const a=syntheticOrbitVisibility(0,4,1,p);
 const b=syntheticOrbitVisibility(0,4,2,p);
 const c=syntheticOrbitVisibility(0,4,3,p);
 assert.equal(a.occultationFree,false);
 near(a.closest,0);
 assert.equal(b.eligible,true);
 near(b.closest,2*Math.sin(.9));
 near(b.distance,4*Math.cos(.9));
 assert.equal(c.occultationFree,false);
});

test("pose and pointing uncertainties prevent optimistic visibility",()=>{
 const nominal=syntheticOrbitVisibility(0,4,2,p);
 const perturbed=syntheticOrbitVisibility(0,4,2,{
  ...p,plantCrossOrbitPositionError:.08});
 assert.equal(nominal.eligible,true);
 assert.equal(perturbed.occultationFree,false);
 near(perturbed.errorBound,
  p.plantCrossBound+p.plantCrossDistanceErrorSlope*(nominal.distance+.16));
 const narrow=syntheticOrbitVisibility(0,4,2,{
  ...p,plantCrossOrbitPositionError:.08,
  plantCrossCentralBodyRadius:.5,
  plantCrossMaxRange:nominal.distance+.1});
 assert.equal(narrow.rangeAllowed,false);
 const pointing={...p,plantCrossCentralBodyRadius:0,
  plantCrossPointingMode:"prograde",plantCrossPointingHalfAngle:Math.PI/2};
 const f=syntheticOrbitVisibility(0,1,1,pointing);
 const b=syntheticOrbitVisibility(1,0,1,pointing);
 assert.equal(f.pointingAllowed,true);
 assert.equal(b.pointingAllowed,false);
 near(f.nominalAngle,Math.PI/4);
 near(b.nominalAngle,3*Math.PI/4);
 assert.equal(syntheticOrbitVisibility(0,1,1,{
  ...pointing,plantCrossPointingHalfAngle:Math.PI/4,
  plantCrossOrbitPointingError:.01}).pointingAllowed,false);
});

test("cached authenticated report is validated against historical observation epoch",()=>{
 const tape=[Array(8).fill(0),Array(8).fill(0)];
 assert.equal(crossSensorPhysicalPair(0,4,p,2).eligible,true);
 assert.equal(crossSensorPhysicalPair(0,4,p,3).eligible,false);
 const r=projectCrossReport({source:0,target:4,emitted:2,value:.1},3,tape,p);
 const v=crossSensorPhysicalPair(0,4,p,2).errorBound;
 near(r.min,p.plantA*(.1-v)-p.plantDisturbanceBound);
 near(r.max,p.plantA*(.1+v)+p.plantDisturbanceBound);
 assert.throws(()=>projectCrossReport({source:0,target:4,emitted:1,value:.1},
  3,tape,p),/геометрически недоступный/);
});

test("time-dependent structural necessary condition and causal emission",()=>{
 const a=auditCrossObservationGraph(graph,p,1);
 const b=auditCrossObservationGraph(graph,p,2);
 assert.notDeepEqual(a.admissibleDirectSources,b.admissibleDirectSources);
 assert.throws(()=>auditCrossObservationGraph(graph,p,0),/эпоха/);
 const channel=createCrossSensorTransport(p,0);
 const active=Array(8).fill(true);
 channel.networkStep({time:1,active,adjacency:graph});
 channel.emit({time:1,states:Array(8).fill(.2),
  active,faulty:Array(8).fill(false),budget:p.plantCapacity});
 channel.networkStep({time:2,active,adjacency:graph});
 assert.ok(channel.read({time:2})[4].every(x=>x.source!==0));
 const diag=channel.getDiagnostic();
 assert.equal(diag.generated,diag.delivered+diag.lost+diag.blocked+
  diag.expired+diag.superseded+diag.pending);
 assert.equal(diag.observationMode,"orbital_visibility");
});

test("orbital parameters reject impossible geometry or unverifiable error envelope",()=>{
 for(const patch of [
  {plantCrossOrbitPlanes:3},
  {plantCrossOrbitRadius:1,plantCrossCentralBodyRadius:1},
  {plantCrossOrbitPositionError:1.1},
  {plantCrossPointingMode:"not-a-mode"},
  {plantCrossOrbitInclination:2},
  {plantCrossOrbitPointingError:4},
  {plantCrossBound:1.8,plantCrossDistanceErrorSlope:.1}
 ])assert.throws(()=>validateLocalPlantOptions({...p,...patch}),/Локальный объект/);
});


test("undisclosed bounded sensing lag uses convex outer hull of all eligible sample epochs",()=>{
 const q=validateLocalPlantOptions({...p,plantCrossSampleLagMaxSteps:1});
 const tape=[Array(8).fill(0),Array(8).fill(0),Array(8).fill(0)];
 // At physical sample epoch 2 pair 0->4 is visible, at emission
 // epoch 3 it is occulted. The buffered reading is still legitimate.
 const r=projectCrossReport({source:0,target:4,emitted:3,value:.1},4,tape,q);
 const V=crossSensorPhysicalPair(0,4,q,2).errorBound;
 let lo=.1-V,hi=.1+V;
 for(let k=2;k<4;k++){
  lo=q.plantA*lo-q.plantDisturbanceBound;
  hi=q.plantA*hi+q.plantDisturbanceBound;
 }
 near(r.min,lo);
 near(r.max,hi);
 assert.throws(()=>projectCrossReport(
  {source:0,target:4,emitted:3,value:.1},4,tape,
  {...q,plantCrossSampleLagMaxSteps:0}),
  /геометрически недоступный/);
 const history=Array.from({length:3},()=>Array(8).fill(.1));
 const ch=createCrossSensorTransport({...q,plantCapacity:100},0);
 const active=Array(8).fill(true);
 for(let step=1;step<=3;step++){
  ch.networkStep({time:step,active,adjacency:graph});
  ch.emit({time:step,states:history[step-1],historyStates:history.slice(0,step),
   active,faulty:Array(8).fill(false),budget:100});
 }
 ch.networkStep({time:4,active,adjacency:graph});
 assert.ok(ch.read({time:4})[4].some(packet=>
  packet.source===0&&packet.emitted===3));
 assert.equal(ch.getDiagnostic().packetSampleEpochDisclosure,false);
 assert.throws(()=>validateLocalPlantOptions({
  ...p,plantCrossSampleLagMaxSteps:6,plantCrossTTL:5}),
  /Локальный объект/);
});

test("cached time-expanded observation can exist despite no single-epoch m>f",()=>{
 const history=Array.from({length:44},()=>graph);
 let witnessed=false;
 for(let time=1;time<=44;time++){
  const instantaneous=auditCrossObservationGraph(graph,p,time);
  const temporal=auditCrossTemporalObservationGraph(p,time,history);
  assert.ok(temporal.possibleReporterCounts.every(x=>x>=0&&x<=7));
  if(instantaneous.potentiallyObservableCount===0&&
   temporal.potentiallyObservableCount>0)
   witnessed=true;
 }
 assert.equal(witnessed,true,
  "A temporal source union can be sufficient even when every instantaneous graph is insufficient");
 const ring=Array.from({length:8},(_,i)=>Array.from({length:8},(_,j)=>
  i!==j&&(Math.abs(i-j)===1||Math.abs(i-j)===7)));
 const ringTemporal=auditCrossTemporalObservationGraph(
  {...p,plantCrossSampleLagMaxSteps:2},20,
  Array.from({length:19},()=>ring));
 assert.equal(ringTemporal.potentiallyObservableCount,0);
 assert.ok(ringTemporal.possibleReporterCounts.every(x=>x<=2));
 assert.throws(()=>auditCrossTemporalObservationGraph(p,5,[]),
  /окно причинной доступности/);
});
