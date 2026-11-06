import test from "node:test";
import assert from "node:assert/strict";
import {
 DEFAULTS, createRng, validateConfig, observations, simulateRun, makePlan,
 TRUST_MODEL_VERSION
} from "./trustEngine.js";
import {executeStudy, RESEARCH_MODEL_VERSION} from "./research2027.js";

test("NZ-01: offline evidence excludes isolated and dormant identities",()=>{
 const c=validateConfig({...DEFAULTS,n_agents:7,n_byzantine:1,n_sybil_agents:2,trim_each_side:1,
  n_steps:12,attack_start_step:8,sybil_activation_step:5,network_enabled:false});
 const bad=[false,true,false,false,false,true,true];
 const active=[true,false,true,false,true,false,false];
 const labels=[0,-1,0,-1,0,-1,-1];
 const got=observations(0,"static_bias",c,bad,active,labels,createRng(12),100);
 assert.equal(got.stats.attempted,9);
 assert.equal(got.stats.delivered,9);
 for(let i=0;i<7;i++)for(let j=0;j<7;j++)
  assert.equal(Number.isFinite(got.matrix[i][j]),active[i]&&active[j], "witness "+i+" -> "+j);
 const run=simulateRun(c,"static_bias",0,0,true);
 for(let step=1;step<5;step++)
  for(const row of run.result.reputation.filter(x=>x.step===step&&x.sybil))
   assert.equal(row.localTrust,c.initial_trust,"dormant Sybil must retain prior");
 assert.equal(run.result.modelVersion,TRUST_MODEL_VERSION);
});

test("NZ-04/05: pre-attack isolation is not detection, delay is attack-relative",()=>{
 const c={...DEFAULTS,seed:731,n_agents:7,n_byzantine:2,n_steps:12,attack_start_step:12,
  trim_each_side:1,minimum_evidence_steps:1,isolation_threshold:.99,isolation_patience:1,
  isolation_cooldown_steps:100,network_enabled:false};
 const run=simulateRun(c,"static_bias",0,0,true),row=run.rows[0],result=run.result;
 assert.ok(result.agents.some(x=>x.byzantine&&x.isolated_at!==null&&x.isolated_at<12),
  "require pre-attack latent Byzantine alarm");
 assert.equal(row.detection_rate,0);
 assert.equal(row.mean_detection_delay_steps,null);
 assert.equal(row.mean_detection_time_steps,null);
 assert.ok(row.premature_byzantine_isolations>0);
 assert.ok(result.events.some(e=>e.prematureByzantineIsolation&&e.type==="false_positive"));
 assert.ok(row.false_isolations>=row.premature_byzantine_isolations);
 const follow=simulateRun({...c,minimum_evidence_steps:12,attack_start_step:12},"static_bias",0,0,true);
 const after=follow.rows[0];
 if(after.detection_rate>0){
  assert.equal(after.mean_detection_delay_steps,0,"first possible detection is onset tick");
 }
});

test("NZ-03: sensitivity plans vary only f, never the configured trimming rule",()=>{
 const c={...DEFAULTS,n_agents:11,n_byzantine:2,n_steps:20,attack_start_step:3,
  trim_each_side:1,n_sensitivity_runs:2,factorial_runs_per_point:1,factorial_max_points:32};
 const one=makePlan({action:"sensitivity",sensitivity_mode:"one_factor",config:c,f_values:[0,1,2,3]});
 assert.ok(one.tasks.every(x=>x.c.trim_each_side===1));
 assert.deepEqual([...new Set(one.tasks.map(x=>x.c.n_byzantine))],[0,1,2,3]);
 const factorial=makePlan({action:"sensitivity",sensitivity_mode:"factorial",config:c});
 assert.equal(factorial.designs.length,32);
 assert.ok(factorial.tasks.every(x=>x.c.trim_each_side===1));
 assert.ok(new Set(factorial.tasks.map(x=>x.c.n_byzantine)).size>1);
});

test("NZ-02: maximum scenario loss is exactly one, not silently capped at 0.9",()=>{
 const x=executeStudy("uncertainty",{runs:50,loss:1,signalNoise:0,corruption:0,seed:991});
 const loss=x.rows.filter(row=>row.scenario==="Неполнота данных");
 assert.equal(loss.length,3);
 for(const row of loss){
  assert.equal(row.effectiveMissingProbability,1);
  assert.equal(row.coverage,0);
  assert.equal(row.accuracy,null);
  assert.equal(row.correctUnconditional,0);
 }
 const baseline=x.rows.filter(row=>row.scenario.includes("Базовый сценарий"));
 assert.ok(baseline.every(row=>row.effectiveMissingProbability===.2));
 assert.equal(x.modelVersion,RESEARCH_MODEL_VERSION);
});

test("NZ-11: E3/E5 animation matches the actual paired run zero, not another RNG",()=>{
 const e3=executeStudy("probgraph",{agents:22,runs:9,steps:5,seed:871,spread:.33,edgeProbability:.5});
 assert.equal(e3.replay.runId,"E3/scenario-0/run-0/baseline");
 assert.equal(e3.replay.eventSeed,e3.pairedRuns[0].eventSeed);
 assert.deepEqual(e3.replay.edges,e3.replaySample.edges);
 assert.deepEqual(e3.replaySample.initialNodes,e3.pairedRuns[0].initialNodes);
 assert.equal(e3.replay.frames.at(-1).value,e3.pairedRuns[0].methods[0].finalFraction);
 assert.equal(e3.replay.frames.at(-1).status.filter(x=>x==="compromised").length,
  e3.pairedRuns[0].methods[0].infectedCount);
 const e5=executeStudy("cascade",{runs:9,seed:912,spread:.45,lossScale:2.5});
 assert.equal(e5.replay.runId,"E5/source-0/run-0/baseline");
 assert.equal(e5.replay.eventSeed,e5.pairedRuns[0].eventSeed);
 assert.deepEqual(e5.replay.edges,e5.replaySample.edges);
 assert.equal(e5.replay.frames.at(-1).value,e5.pairedRuns[0].methods[0].loss);
 assert.equal(e5.replay.frames.at(-1).status.filter(x=>x==="affected").length,
  e5.pairedRuns[0].methods[0].affectedCount);
});

test("NZ-09: fixed f by trim grid uses the same observations as main E6 trim=3",()=>{
 const r=executeStudy("misinformation",{runs:60,seed:472,spread:.4,noise:.2,
  attackBias:2.5,threshold:.16,costWrong:3,costRefuse:.5});
 assert.equal(r.robustnessSensitivity.length,16);
 for(let f=0;f<=3;f++){
  const values=r.robustnessSensitivity.filter(x=>x.compromised===f);
  assert.deepEqual(values.map(x=>x.trim_each_side),[0,1,2,3]);
  for(const x of values){
   assert.ok(Math.abs(x.correctProbability+x.wrongProbability+x.abstentionProbability-1)<1e-12);
   assert.ok(Math.abs(x.risk-(3*x.wrongProbability+.5*x.abstentionProbability))<1e-12);
  }
  const main=r.rows.find(x=>x.compromised===f&&x.method.includes("fmax=3"));
  const fixed=values.find(x=>x.trim_each_side===3);
  assert.equal(fixed.correctProbability,main.correctProbability);
  assert.equal(fixed.wrongProbability,main.wrongProbability);
  assert.equal(fixed.abstentionProbability,main.abstentionProbability);
  assert.equal(fixed.meanDeviation,main.meanDeviation);
 }
});
