import test from "node:test";
import assert from "node:assert/strict";
import {executeStudy,STUDY_DEFS,toCsv,validateStudy,rng,chooseUniqueNodes,spreadOneTick,expectedShortfall,propagate,runPetri,estimateReliabilityFromObservations,RESEARCH_MODEL_VERSION} from "./research2027.js";

const small={
 uncertainty:{runs:20,agents:21},
 probgraph:{runs:20,agents:30,steps:3},
 petri:{runs:1,agents:7,steps:4,stateLimit:5000},
 cascade:{runs:20,agents:8},
 misinformation:{runs:20,agents:7}
};
for(const study of STUDY_DEFS){
 test("runs, returns data, and reproduces: "+study.id,()=>{
  const a=executeStudy(study.id,small[study.id]),b=executeStudy(study.id,small[study.id]);
  assert.equal(a.rows.length>0,true);
  assert.deepEqual(a.rows,b.rows);
  assert.deepEqual(a.config,b.config);
  assert.equal(a.model,"synthetic-experimental");
  assert.ok(toCsv(a.rows).startsWith("\ufeff"));
 });
}
test("no propagation means no cascaded damage",()=>{
 const x=executeStudy("cascade",{runs:30,spread:0});
 for(const row of x.rows)assert.ok(Math.abs(row.expectedDamage-row.directDamage)<1e-9);
});
test("zero spread and high threshold prevent a critical graph state",()=>{
 const x=executeStudy("probgraph",{runs:25,spread:0,criticalFraction:.9});
 for(const row of x.rows)assert.equal(row.dangerProbability,0);
});
test("formal reachability provides a witness when threshold reachable",()=>{
 const x=executeStudy("petri",{criticalCount:3,steps:4,detectionDelay:10});
 assert.equal(x.rows[0].value,"Да");
 assert.ok(x.witness.length>1);
});
test("formal model can prove a bounded non-reachability",()=>{
 const x=executeStudy("petri",{criticalCount:7,steps:1,stateLimit:5000});
 assert.equal(x.rows[0].value,"Нет");
 assert.equal(x.rows.at(-1).value,"Нет");
});
test("zero noise and no compromise yields no wrong collective decisions",()=>{
 const x=executeStudy("misinformation",{runs:50,noise:0,spread:0});
 for(const row of x.rows.filter(r=>r.compromised===0))assert.equal(row.wrongProbability,0);
});
test("validation rejects nonphysical configuration",()=>{
 assert.throws(()=>validateStudy("probgraph",{spread:1.2}));
 assert.throws(()=>validateStudy("cascade",{agents:9}));
 assert.throws(()=>validateStudy("petri",{stateLimit:5}));
});


test("all research modules provide reproducible directed graphs and stepped replays",()=>{
 for(const study of STUDY_DEFS){
  const cfg=small[study.id],a=executeStudy(study.id,cfg),b=executeStudy(study.id,cfg),replay=a.replay;
  assert.ok(Array.isArray(replay.vertices)&&replay.vertices.length===a.config.agents,study.id+" vertices");
  assert.ok(Array.isArray(replay.edges)&&replay.edges.length>0,study.id+" edges");
  assert.ok(Array.isArray(replay.frames)&&replay.frames.length>=2,study.id+" frames");
  assert.deepEqual(replay,b.replay,study.id+" replay seed determinism");
  for(let i=0;i<replay.frames.length;i++){
   const frame=replay.frames[i];
   assert.equal(frame.status.length,a.config.agents,study.id+" status coverage");
   if(i)assert.ok(frame.step>replay.frames[i-1].step,study.id+" frame ordering");
   for(const [u,v] of frame.activeEdges)assert.ok(replay.edges.some(([x,y])=>x===u&&y===v),study.id+" activity must follow edge");
  }
 }
});
test("replay respects zero-propagation and simulated state transitions",()=>{
 const p=executeStudy("probgraph",{runs:8,spread:0,steps:5});
 assert.ok(p.replay.frames.every(f=>f.status.filter(x=>x==="compromised").length===1));
 const c=executeStudy("cascade",{runs:8,spread:0});
 assert.ok(c.replay.frames.every(f=>f.status.filter(x=>x==="affected").length===1));
 const m=executeStudy("misinformation",{runs:8,spread:0});
 assert.ok(m.replay.frames.every(f=>f.status.filter(x=>x==="misled").length===0));
 const n=executeStudy("petri",{criticalCount:3,steps:4,detectionDelay:10});
 assert.ok(n.replay.frames.at(-1).status.filter(s=>s==="compromised").length>=3);
});


test("UP-03/21 strict fixed Petri graph and integral marking thresholds",()=>{
 for(const agents of [6,8,20,100])assert.throws(()=>validateStudy("petri",{agents}),/N=7/);
 for(const [key,value] of [["criticalCount",3.5],["detectionDelay",1.5],["stateLimit",999.5],["steps",2.2],["runs",2]])
   assert.throws(()=>validateStudy("petri",{[key]:value}),new RegExp(key));
 const result=executeStudy("petri",{agents:7,criticalCount:7,steps:1});
 assert.equal(result.config.agents,7);assert.equal(result.replay.vertices.length,7);
 assert.equal(result.modelVersion,RESEARCH_MODEL_VERSION);
});
test("UP-15/17 all decision methods use the same threshold and absent decisions mean null accuracy",()=>{
 const none=executeStudy("uncertainty",{runs:40,threshold:2,loss:0,corruption:0,signalNoise:0});
 for(const row of none.rows){
  assert.equal(row.coverage,0);
  assert.equal(row.accuracy,null);
 }
 const same=executeStudy("uncertainty",{runs:40,threshold:1.2,loss:0,corruption:0,signalNoise:0});
 assert.ok(same.rows.every(row=>row.coverage===0),"Method-dependent 0.75δ is forbidden");
});
test("UP-18 initial outbreak agents are sampled without replacement",()=>{
 for(const n of [3,7,30])for(const k of [0,1,n]){
  const v=chooseUniqueNodes(rng(99),n,k);
  assert.equal(v.length,k);assert.equal(new Set(v).size,k);
  assert.ok(v.every(i=>i>=0&&i<n));
 }
 assert.throws(()=>chooseUniqueNodes(rng(1),3,4),/K/);
});
test("UP-24/25 meaningful loss scale and exact discrete expected shortfall",()=>{
 assert.throws(()=>validateStudy("cascade",{lossScale:0}),/lossScale/);
 const values=[...Array(990).fill(1),...Array(4).fill(2.1),...Array(6).fill(2.2)];
 assert.ok(Math.abs(expectedShortfall(values,.95)-1.232)<1e-12);
 assert.equal(expectedShortfall([3,3,3],.95),3);
 const zero=executeStudy("cascade",{spread:0,runs:10});
 for(const row of zero.rows)assert.equal(row.excessDamage,0);
});
test("UP-27 misinformation spread uses the source snapshot each tick",()=>{
 const edges=[[0,1],[1,2]],uniforms=[0,0];
 const first=spreadOneTick(new Set([0]),edges,uniforms,1);
 assert.deepEqual([...first.next].sort(),[0,1]);
 const second=spreadOneTick(first.next,edges,uniforms,1);
 assert.deepEqual([...second.next].sort(),[0,1,2]);
 assert.deepEqual(first.activeEdges,[[0,1]]);
 assert.deepEqual(second.activeEdges,[[1,2]]);
});


test("UP-18/19 each paired graph run keeps unique initial agents and common conditions",()=>{
 const c={agents:3,runs:14,edgeProbability:0,spread:0,steps:2,criticalFraction:1};
 const run=executeStudy("probgraph",c);
 assert.equal(run.pairedRuns.length,4*c.runs);
 for(const trial of run.pairedRuns){
  assert.equal(new Set(trial.initialNodes).size,trial.initialCount);
  assert.ok(trial.initialCount>=1&&trial.initialCount<=3);
  assert.equal(trial.methods.length,3);
  assert.ok(trial.methods.every(x=>x.finalFraction===trial.initialCount/3));
  assert.ok(trial.methods.every(x=>x.danger===(trial.initialCount===3?1:0)));
 }
 const three=run.rows.filter(x=>x.scenario==="Согласованная атака");
 assert.ok(three.every(x=>x.dangerProbability===1));
 assert.deepEqual(run.pairedRuns,executeStudy("probgraph",c).pairedRuns);
 const edges=[[0,1],[1,2]],tape=[[.1,.2],[.3,.4]];
 assert.deepEqual(
  propagate(3,edges,[0],rng(1),1,2,0,tape).history,
  propagate(3,edges,[0],rng(999),1,2,0,tape).history
 );
});


test("UP-16/28 applied method weights do not depend on hidden attacker labels",()=>{
 const visible=[{x:-.2,d:1},{x:1.3,d:2},{x:.8,d:3},{x:1,d:1}];
 const before=estimateReliabilityFromObservations(visible,.2);
 const hidden=visible.map((x,i)=>({...x,attacked:i%2===0,stale:i%3===0,groundTruth:-1,oracleWeight:1000}));
 const after=estimateReliabilityFromObservations(hidden,.2);
 assert.deepEqual(after,before);
 assert.ok(after.every(x=>Number.isFinite(x)&&x>=.01&&x<=1));
});
test("UP-16 benchmark with true labels is excluded from three applied E2 methods",()=>{
 const result=executeStudy("uncertainty",{runs:25});
 assert.equal(result.oracleBenchmark.length,4);
 assert.equal(result.rows.length,12);
 assert.ok(result.rows.every(row=>!row.method.toLowerCase().includes("оракул")));
 assert.ok(result.oracleBenchmark.every(row=>row.oracle===true));
});
test("UP-28 predefined trim for seven agents withstands three extreme outliers in no-spread case",()=>{
 const run=executeStudy("misinformation",{runs:80,spread:0,noise:0,attackBias:10});
 const robust=run.rows.find(row=>row.compromised===3&&row.method.includes("fmax=3"));
 assert.ok(robust);
 assert.equal(robust.wrongProbability,0);
 assert.equal(robust.abstentionProbability,0);
});


test("UP-23 Petri BFS exact exhaustion is complete, unfinished frontier is inconclusive",()=>{
 const config=validateStudy("petri",{steps:1,criticalCount:7,detectionDelay:10});
 const complete=runPetri({...config,stateLimit:100});
 const exact=runPetri({...config,stateLimit:complete.processed});
 assert.equal(complete.verdict,"unreachable_within_bound");
 assert.equal(exact.verdict,"unreachable_within_bound");
 assert.equal(exact.processed,complete.processed);
 const limited=runPetri({...config,stateLimit:Math.max(1,complete.processed-1)});
 assert.equal(limited.verdict,"inconclusive");
 assert.ok(limited.enqueued>limited.processed);
});


test("UP-30 Monte-Carlo research probabilities carry Wilson intervals and event denominators",()=>{
 const p=executeStudy("probgraph",{agents:6,runs:40,spread:0,criticalFraction:1});
 for(const row of p.rows){
  assert.equal(row.dangerProbability,0);
  assert.equal(row.dangerEvents,0);
  assert.ok(row.dangerCI95High>0,"Zero observed events cannot establish zero probability");
  assert.equal(row.dangerCI95Low,0);
  assert.ok(row.expectedFractionCI95Low<=row.expectedFraction&&row.expectedFractionCI95High>=row.expectedFraction);
 }
 assert.equal(p.pairedEffects.length,8);
 for(const effect of p.pairedEffects){
  assert.equal(effect.reductionDanger,0);
  assert.equal(effect.reductionCI95Low,0);
  assert.equal(effect.reductionCI95High,0);
  assert.equal(effect.runs,40);
  assert.equal(effect.paired,true);
 }
});
test("UP-30 ES95 is an exact upper-tail point estimate with finite bootstrap bounds",()=>{
 const x=executeStudy("cascade",{runs:35,spread:0});
 for(const row of x.rows){
  assert.ok(Math.abs(row.es95-row.directDamage)<1e-10);
  assert.equal(row.excessDamage,0);
  assert.ok(Math.abs(row.es95CI95Low-row.directDamage)<1e-10);
  assert.ok(Math.abs(row.es95CI95High-row.directDamage)<1e-10);
  assert.ok(row.dangerCI95Low<=row.dangerProbability);
  assert.ok(row.dangerCI95High>=row.dangerProbability);
  assert.equal(row.tailSamples,1.75);
  assert.match(row.tailWarning,/Менее 10/);
  assert.equal(Object.hasOwn(row,"cvar95"),false);
 }
});
test("UP-29 wrong-decision and refusal costs are independent and avoid duplicated exposure",()=>{
 const baseline=executeStudy("misinformation",{runs:40,noise:0,spread:0,attackBias:0,threshold:2,costWrong:1,costRefuse:0});
 const penalty=executeStudy("misinformation",{runs:40,noise:0,spread:0,attackBias:0,threshold:2,costWrong:1,costRefuse:7});
 assert.equal(baseline.scenarioMetrics.length,4);
 for(let i=0;i<baseline.rows.length;i++){
  assert.equal(baseline.rows[i].wrongProbability,0);
  assert.equal(baseline.rows[i].abstentionProbability,1);
  assert.equal(baseline.rows[i].risk,0);
  assert.equal(penalty.rows[i].risk,7);
  assert.ok(!Object.hasOwn(baseline.rows[i],"meanExposedFraction"),"Exposure belongs to scenario, not algorithm");
 }
 assert.deepEqual(baseline.scenarioMetrics,penalty.scenarioMetrics);
 assert.throws(()=>validateStudy("misinformation",{costRefuse:-1}),/costRefuse/);
});
test("UP-30 E2 selective accuracy uses accepted sample size, null if no accepted decisions",()=>{
 const x=executeStudy("uncertainty",{runs:30,threshold:2,loss:0,signalNoise:0,corruption:0});
 for(const row of x.rows){
  assert.equal(row.accuracy,null);
  assert.equal(row.accuracyCI95Low,null);
  assert.equal(row.accuracyCI95High,null);
  assert.ok(row.coverageCI95High>0);
  assert.ok(row.coverageCI95High<1);
 }
});


test("UP-26/30 cascade paired comparisons have identical outcomes when η=0",()=>{
 const x=executeStudy("cascade",{runs:60,spread:.53,defenseFactor:0,seed:149});
 assert.equal(x.pairedRuns.length,8*60);
 assert.equal(x.pairedEffects.length,8);
 for(const run of x.pairedRuns){
  assert.equal(run.methods.length,2);
  assert.deepEqual(
   [run.methods[0].loss,run.methods[0].danger,run.methods[0].affectedCount],
   [run.methods[1].loss,run.methods[1].danger,run.methods[1].affectedCount]
  );
 }
 for(const difference of x.pairedEffects){
  assert.equal(difference.reductionDanger,0);
  assert.equal(difference.reductionDamage,0);
  assert.equal(difference.reductionDamageCI95Low,0);
  assert.equal(difference.reductionDamageCI95High,0);
 }
 assert.deepEqual(x.pairedRuns,executeStudy("cascade",{runs:60,spread:.53,defenseFactor:0,seed:149}).pairedRuns);
});


test("UP-17 displayed observation age is not mislabeled end-to-end latency",()=>{
 const x=executeStudy("uncertainty",{runs:30,loss:0,corruption:0,signalNoise:0,threshold:0});
 for(const row of x.rows){
  assert.equal(Object.hasOwn(row,"latency"),false);
  assert.ok(row.meanObservationAge>=1&&row.meanObservationAge<=3);
 }
 const none=executeStudy("uncertainty",{runs:30,loss:0,signalNoise:0,corruption:0,threshold:2});
 assert.ok(none.rows.every(row=>row.meanObservationAge===null));
});


test("UP-22 optional isolation cannot guarantee EF safety simply by decreasing τ",()=>{
 const settings={steps:1,criticalCount:2,detectionDelay:0,isolationPolicy:0};
 const optional=executeStudy("petri",settings);
 assert.equal(optional.verdict,"reachable");
 assert.ok(optional.witness.some(s=>s.includes("передача")));
 assert.equal(optional.policyName,"optional_nondeterministic");
 const delayed=executeStudy("petri",{...settings,detectionDelay:2});
 assert.equal(delayed.verdict,"reachable");
});
test("UP-22 declared ideal priority controller prevents propagation from known infected agents",()=>{
 const base={steps:1,criticalCount:2,isolationPolicy:1};
 const early=executeStudy("petri",{...base,detectionDelay:1});
 assert.equal(early.verdict,"unreachable_within_bound");
 assert.equal(early.policyName,"ideal_mandatory_priority");
 assert.equal(early.witness.length,0);
 const late=executeStudy("petri",{...base,detectionDelay:2});
 assert.equal(late.verdict,"reachable");
 assert.ok(late.witness.some(s=>s.includes("передача")));
 assert.ok(early.rows.some(r=>r.criterion==="Стратегия изоляции"));
 assert.throws(()=>validateStudy("petri",{isolationPolicy:2}),/isolationPolicy/);
 assert.throws(()=>validateStudy("petri",{isolationPolicy:.5}),/isolationPolicy/);
});


test("UP-22/31 mandatory Petri policy is faithfully shown by the replay, not arbitrary waiting",()=>{
 const a=executeStudy("petri",{steps:2,criticalCount:7,detectionDelay:1,isolationPolicy:1});
 assert.equal(a.verdict,"unreachable_within_bound");
 assert.equal(a.replay.frames[1].status[0],"isolated");
 assert.match(a.replay.frames[1].info,/обязательная изоляция A1/);
 const b=executeStudy("petri",{steps:2,criticalCount:7,detectionDelay:1,isolationPolicy:0});
 assert.equal(b.replay.frames[1].status[0],"compromised");
 assert.match(a.replay.notes,/Фронт BFS исчерпан/);
});


test("UP-30 E3 controls familywise error across eight paired protection contrasts",()=>{
 const a=executeStudy("probgraph",{runs:40,seed:99,spread:.52});
 assert.equal(a.multipleTesting.planned,8);
 assert.equal(a.multipleTesting.tested,8);
 assert.equal(a.pairedEffects.length,8);
 for(const effect of a.pairedEffects){
  assert.ok(effect.pRaw>=0&&effect.pRaw<=1);
  assert.ok(effect.pHolm>=effect.pRaw&&effect.pHolm<=1);
  assert.equal(effect.holmReject05,effect.pHolm<.05);
 }
 const singleton=executeStudy("probgraph",{runs:1,seed:99});
 assert.equal(singleton.multipleTesting.tested,0);
 assert.ok(singleton.pairedEffects.every(x=>x.pRaw===null&&x.pHolm===null));
});
test("UP-30 E5 controls a combined 16-comparison family for damage and danger",()=>{
 const a=executeStudy("cascade",{runs:35,seed:990,spread:.6});
 assert.equal(a.multipleTesting.planned,16);
 assert.equal(a.multipleTesting.tested,16);
 for(const effect of a.pairedEffects){
  for(const suffix of ["Damage","Danger"]){
   assert.ok(effect["pRaw"+suffix]>=0&&effect["pRaw"+suffix]<=1);
   assert.ok(effect["pHolm"+suffix]>=effect["pRaw"+suffix]);
   assert.equal(effect["holmReject"+suffix+"05"],effect["pHolm"+suffix]<.05);
  }
 }
 const repeated=executeStudy("cascade",{runs:35,seed:990,spread:.6});
 assert.deepEqual(a.pairedEffects,repeated.pairedEffects);
});

test("MC E6 risk confidence intervals derive from individual decision costs",()=>{
 const config={agents:7,runs:101,seed:20261206,spread:.5,noise:.35,attackBias:2.2,
  threshold:.16,costWrong:3,costRefuse:.7,record_source_runs:1,source_run_limit:101};
 const result=executeStudy("misinformation",config);
 assert.equal(result.pairedEffects.length,8);
 assert.equal(result.statisticsAudit.holmFamilyChecked,8);
 assert.equal(result.multipleTesting.tested,8);
 assert.ok(result.statisticsAudit.valid);
 for(const effect of result.pairedEffects){
  assert.equal(effect.paired,true);
  assert.ok(effect.pHolm>=effect.pRaw&&effect.pHolm<=1);
  assert.equal(effect.holmReject05,effect.pHolm<.05);
 }
 for(const row of result.rows){
  const source=result.sourceRunJournal.entries.filter(e=>e.compromised===row.compromised);
  const j=["Обычное среднее","Взвешивание по наблюдаемым признакам","Усечённое среднее (fmax=3)"].indexOf(row.method);
  assert.ok(j>=0);
  const samples=source.map(e=>{
   const estimate=e.methodEstimates[j];
   if(Math.abs(estimate)<config.threshold)return config.costRefuse;
   return Math.sign(estimate)===e.truth?0:config.costWrong;
  });
  const expectedMean=samples.reduce((a,b)=>a+b,0)/samples.length;
  const variance=samples.reduce((a,b)=>a+(b-expectedMean)**2,0)/(samples.length-1);
  const halfWidth=1.959963984540054*Math.sqrt(variance/samples.length);
  assert.ok(Math.abs(row.risk-expectedMean)<1e-10);
  assert.ok(Math.abs(row.riskCI95Low-(expectedMean-halfWidth))<1e-10);
  assert.ok(Math.abs(row.riskCI95High-(expectedMean+halfWidth))<1e-10);
 }
 const repeated=executeStudy("misinformation",config);
 assert.deepEqual(result.pairedEffects,repeated.pairedEffects);
});
