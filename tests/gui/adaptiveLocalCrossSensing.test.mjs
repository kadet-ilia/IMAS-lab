import test from "node:test";
import assert from "node:assert/strict";
import {validateLocalPlantOptions} from "../../gui/src/adaptiveLocalPlant.js";
import {projectCrossReport,fuseCrossCertificates,
 createCrossSensorTransport,crossSensorPhysicalPair,auditCrossObservationGraph,CROSS_SENSOR_VERSION} from
 "../../gui/src/adaptiveLocalCrossSensing.js";

const p=validateLocalPlantOptions({plantCrossEnabled:true,plantCrossBound:.1,
 plantCrossDelay:1,plantCrossTTL:3,plantCrossLoss:0});
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-10,a+" != "+b);
const intervals=(v)=>v.map(([source,min,max])=>({source,min,max}));

test("remote sensing uses only authenticated timestamped readings and executed controls",()=>{
 assert.match(CROSS_SENSOR_VERSION,/f-hull/);
 const r=projectCrossReport({source:1,target:0,emitted:1,value:.5},
  3,[[.2,0,0,0,0,0,0,0],[-.3,0,0,0,0,0,0,0]],p);
 close(r.min,p.plantA*(p.plantA*.4+p.plantB*.2-p.plantDisturbanceBound)
  +p.plantB*(-.3)-p.plantDisturbanceBound);
 close(r.max,p.plantA*(p.plantA*.6+p.plantB*.2+p.plantDisturbanceBound)
  +p.plantB*(-.3)+p.plantDisturbanceBound);
 assert.throws(()=>projectCrossReport({source:1,target:0,emitted:3,value:.5},
  3,[],p),/отметка времени/);
 assert.throws(()=>projectCrossReport({source:1,target:0,emitted:1,value:.5},
  3,[],p),/журнал команд/);
});

test("f-contamination hull contains truth with one forged authenticated sensor",()=>{
 const data=intervals([[1,.10,.30],[2,.12,.32],[3,.08,.28],[4,1.4,1.6]]);
 const a=fuseCrossCertificates({min:-1,max:1},data,1,p);
 assert.equal(a.requiredSupport,3);
 close(a.interval.min,.12);close(a.interval.max,.28);
 assert.equal(a.refined,true);
 assert.equal(a.supported,true);
 const weakened=fuseCrossCertificates({min:-1,max:1},data,4,p);
 assert.deepEqual(weakened.interval,{min:-1,max:1});
 assert.equal(weakened.supported,false);
 assert.throws(()=>fuseCrossCertificates({min:-1,max:1},
  intervals([[1,-1.8,-1.7],[2,1.7,1.8]]),0,p),
  e=>e.code==="CERTIFICATION_LOST");
 assert.throws(()=>fuseCrossCertificates({min:-1,max:1},
  intervals([[1,.1,.2],[1,.1,.2]]),1,p),/повторный/);
});

test("Byzantine reporter cannot force an unsafe shrink under f-budget",()=>{
 const trueX=.2;
 const p0={min:-1.5,max:1.5};
 for(const forged of [[-2,-1.9],[1.8,2],[.18,.19],[-.1,.9]]){
  const reports=intervals([[1,.15,.25],[2,.1,.3],[3,.18,.22],[4,...forged]]);
  const out=fuseCrossCertificates(p0,reports,1,p);
  assert.ok(out.interval.min<=trueX&&out.interval.max>=trueX);
 }
});

test("cross channel delivers only after delay, consumes fixed quota and keeps identities",()=>{
 const ch=createCrossSensorTransport(p,2),n=p.plantAgents;
 const active=Array(n).fill(true);
 const graph=Array.from({length:n},(_,i)=>
  Array.from({length:n},(_,j)=>i!==j));
 const states=Array(n).fill(.3),faulty=Array(n).fill(false);
 ch.networkStep({time:1,active,adjacency:graph});
 assert.equal(ch.read({time:1})[0].length,0);
 ch.emit({time:1,states,active,faulty,budget:8});
 assert.equal(ch.getDiagnostic().transmitted,8);
 ch.networkStep({time:2,active,adjacency:graph});
 const packets=ch.read({time:2});
 assert.equal(packets.flat().length,8);
 assert.ok(packets.flat().every(v=>v.emitted===1&&v.arrived===2));
 ch.emit({time:2,states,active,faulty,budget:8});
 const info=ch.getDiagnostic();
 assert.equal(info.generated,info.delivered+info.lost+info.blocked+
  info.expired+info.superseded+info.pending);
 assert.ok(info.history.every(h=>h.sent<=h.budget));
});

test("dropouts, edge splits and packet loss cannot create future evidence",()=>{
 const q={...p,plantCrossLoss:1,plantCrossDelay:2,plantCrossTTL:2};
 const ch=createCrossSensorTransport(q,0),n=q.plantAgents;
 const active=Array(n).fill(true),states=Array(n).fill(.1),
  faulty=Array(n).fill(false);
 const ring=Array.from({length:n},(_,i)=>Array.from({length:n},(_,j)=>
  i!==j&&(Math.abs(i-j)===1||Math.abs(i-j)===n-1)));
 for(let time=1;time<=4;time++){
  ch.networkStep({time,active,adjacency:ring});
  assert.equal(ch.read({time}).flat().length,0);
  ch.emit({time,states,active,faulty,budget:10});
 }
 const diag=ch.getDiagnostic();
 assert.equal(diag.delivered,0);
 assert.ok(diag.lost>0);
 assert.equal(diag.generated,diag.delivered+diag.lost+diag.blocked+
  diag.expired+diag.superseded+diag.pending);
});

test("physical sensor visibility is distinct from communication links",()=>{
 const q=validateLocalPlantOptions({plantCrossEnabled:true,
  plantCrossObservationMode:"range_geometry",
  plantCrossGeometryRadius:1,plantCrossMaxRange:0.8,
  plantCrossBound:.05,plantCrossDistanceErrorSlope:.02});
 const adjacent=crossSensorPhysicalPair(0,1,q);
 const second=crossSensorPhysicalPair(0,2,q);
 const opposite=crossSensorPhysicalPair(0,4,q);
 close(adjacent.distance,2*Math.sin(Math.PI/8));
 close(second.distance,Math.SQRT2);
 close(opposite.distance,2);
 assert.equal(adjacent.eligible,true);
 assert.equal(second.eligible,false);
 assert.equal(opposite.eligible,false);
 close(adjacent.errorBound,.05+.02*adjacent.distance);
 assert.throws(()=>projectCrossReport({source:2,target:0,
  emitted:1,value:.3},2,[Array(8).fill(0)],q),
  /геометрически недоступный/);
 const r=projectCrossReport({source:1,target:0,
  emitted:1,value:.3},2,[Array(8).fill(0)],q);
 close(r.min,q.plantA*(.3-adjacent.errorBound)-q.plantDisturbanceBound);
 close(r.max,q.plantA*(.3+adjacent.errorBound)+q.plantDisturbanceBound);
});

test("dense communication without physical range emits zero remote reports",()=>{
 const q=validateLocalPlantOptions({plantCrossEnabled:true,
  plantCrossObservationMode:"range_geometry",
  plantCrossGeometryRadius:1,plantCrossMaxRange:.5,
  plantCrossBound:.08,plantCrossLoss:0});
 const n=q.plantAgents,ch=createCrossSensorTransport(q,1);
 const all=Array.from({length:n},(_,i)=>
  Array.from({length:n},(_,j)=>i!==j));
 const active=Array(n).fill(true);
 ch.networkStep({time:1,adjacency:all,active});
 assert.equal(ch.emit({time:1,states:Array(n).fill(0),
  active,faulty:Array(n).fill(false),budget:q.plantCapacity}),0);
 ch.networkStep({time:2,adjacency:all,active});
 assert.deepEqual(ch.read({time:2}),Array.from({length:n},()=>[]));
 const diag=ch.getDiagnostic();
 assert.equal(diag.generated,0);
 assert.equal(diag.transmitted,0);
 assert.equal(diag.delivered,0);
});

test("structural physical and direct-link observability requires m>f",()=>{
 const q=validateLocalPlantOptions({plantCrossEnabled:true,
  plantCrossObservationMode:"range_geometry",
  plantCrossGeometryRadius:1,plantCrossMaxRange:1.45,
  plantCrossFaultBudget:2});
 const n=q.plantAgents;
 const complete=Array.from({length:n},(_,i)=>Array.from({length:n},(_,j)=>i!==j));
 const ring=Array.from({length:n},(_,i)=>Array.from({length:n},(_,j)=>
  i!==j&&(Math.abs(i-j)===1||Math.abs(i-j)===n-1)));
 const a=auditCrossObservationGraph(complete,q);
 assert.deepEqual(a.physicalSources,Array(n).fill(4));
 assert.deepEqual(a.admissibleDirectSources,Array(n).fill(4));
 assert.equal(a.potentiallyObservableCount,n);
 const b=auditCrossObservationGraph(ring,q);
 assert.deepEqual(b.physicalSources,Array(n).fill(4));
 assert.deepEqual(b.admissibleDirectSources,Array(n).fill(2));
 assert.equal(b.potentiallyObservableCount,0,
  "Four physical sensors cannot help if only two have direct data links");
 assert.ok(b.structurallyObservable.every(x=>x===false));
 const narrow=auditCrossObservationGraph(complete,{
  ...q,plantCrossMaxRange:.8});
 assert.deepEqual(narrow.admissibleDirectSources,Array(n).fill(2));
 assert.equal(narrow.potentiallyObservableCount,0);
 assert.throws(()=>auditCrossObservationGraph(complete.map(x=>x.slice(1)),q),
  /некорректный граф/);
});
