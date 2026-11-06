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
