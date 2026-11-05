import test from "node:test";
import assert from "node:assert/strict";
import {
 createRng,validateConfig,betaTrust,eigenTrust,trimmedWeightedMean,
 simulateRun,makePlan,runTask,assembleResult,runActionSync,bootstrapComparisons,observations,TRUST_MODEL_VERSION
} from "./trustEngine.js";

const cfg={seed:20260716,n_agents:11,n_byzantine:2,n_steps:18,attack_start_step:3,
 n_runs:4,n_sensitivity_runs:2,factorial_runs_per_point:1,factorial_max_points:8,
 bootstrap_samples:100,minimum_evidence_steps:3,isolation_patience:2,
 trim_each_side:2,trust_window_steps:6,parallel_workers:0};

test("seeded random generator and deterministic numeric model",()=>{
 const x=createRng(3,9),y=createRng(3,9);
 assert.deepEqual(Array.from({length:50},()=>x.normal()),Array.from({length:50},()=>y.normal()));
 const one=simulateRun(cfg,"collusion",0,0,true),two=simulateRun(cfg,"collusion",0,0,true);
 assert.deepEqual(one.result.series,two.result.series);
 assert.deepEqual(one.result.metrics,two.result.metrics);
 assert.equal(one.result.agents.length,11);
 assert.equal(one.result.series.length,18);
 assert.equal(one.result.states.length,18*11);
 assert.equal(one.result.reputation.length,18*11);
});
test("Beta evidence, EigenTrust, trimmed mean invariants",()=>{
 const c=validateConfig(cfg),e=[[[1,.8],[.2,1]]];
 const trust=betaTrust(e,c,2);
 assert.ok(trust[0][1]>.5&&trust[1][0]<.5);
 const rep=eigenTrust([[.9,.2],[.6,.9]],[true,true],.85);
 assert.ok(rep.every(x=>x>=0&&x<=1.000001));
 assert.equal(trimmedWeightedMean([0,1,2,3,100],[1,1,1,1,1],1),2);
 assert.throws(()=>trimmedWeightedMean([],[],0));
});
test("all four attack modes, networks and Sybil variants remain finite",()=>{
 for(const scenario of ["static_bias","subtle_bias","on_off","collusion"]){
  for(const topology of ["complete","ring","random","small_world"]){
   const n=simulateRun({...cfg,network_enabled:true,network_topology:topology,
    message_loss_probability:.14,message_delay_min_steps:0,message_delay_max_steps:2,
    bandwidth_messages_per_step:22,partition_enabled:true,
    partition_start_step:5,partition_end_step:8,n_sybil_agents:2,sybil_activation_step:4},scenario,0,0,true);
   assert.equal(n.rows.length,3);
   assert.ok(n.rows.every(r=>Number.isFinite(r.rmse_to_truth)&&r.delivery_ratio>=0&&r.delivery_ratio<=1));
   assert.ok(n.result.summary.communication_lost>=0);
   assert.ok(n.result.summary.communication_bandwidth_dropped>=0);
  }
 }
});
test("honest-only baseline is near reference, adversarial mean is affected",()=>{
 const base=simulateRun({...cfg,n_byzantine:0,trim_each_side:0,network_enabled:false},"static_bias");
 const attacked=simulateRun({...cfg,static_bias:8,network_enabled:false},"static_bias");
 const meanBase=base.rows.find(x=>x.method==="arithmetic_mean").mae_to_truth;
 const meanAttack=attacked.rows.find(x=>x.method==="arithmetic_mean").mae_to_truth;
 const robust=attacked.rows.find(x=>x.method==="proposed_robust").mae_to_truth;
 assert.ok(meanBase<.25);
 assert.ok(meanAttack>meanBase);
 assert.ok(robust<meanAttack);
});
test("Monte Carlo contract, confidence bands, distributions and bootstrap",()=>{
 const result=runActionSync({action:"monte_carlo",scenario:"collusion",config:cfg});
 assert.equal(result.runs.length,12);
 assert.equal(result.summary.length,3);
 assert.equal(result.trajectory_statistics.length,18);
 assert.ok(result.trajectory_statistics[0].proposed_robust_band90.length===2);
 assert.equal(result.distributions.length,15);
 assert.equal(result.bootstrap_comparisons.length,8);
 assert.equal(result.completed_runs,4);
});
test("one-factor sensitivity contract, browser-compatible task resumption",()=>{
 const payload={action:"sensitivity",sensitivity_mode:"one_factor",scenario:"collusion",config:cfg,f_values:[0,1,2]};
 const plan=makePlan(payload),part=plan.tasks.slice(0,3).map(task=>runTask(plan,task));
 const resumed=plan.tasks.slice(3).map(task=>runTask(plan,task));
 const full=assembleResult(plan,[...part,...resumed]);
 assert.equal(full.mode,"one_factor");
 assert.equal(full.partial,false);
 assert.equal(full.completed_tasks,6);
 assert.ok(full.sensitivity.some(x=>x.n_byzantine===1));
});
test("fractional factorial sensitivity returns main and pair effects",()=>{
 const out=runActionSync({action:"sensitivity",sensitivity_mode:"factorial",scenario:"collusion",config:cfg});
 assert.equal(out.mode,"factorial");
 assert.equal(out.design_points.length,24);
 assert.ok(out.main_effects.length>=6);
 assert.ok(out.interaction_effects.length>0);
 assert.equal(out.partial,false);
});
test("configuration limits are enforced before any simulation",()=>{
 assert.throws(()=>validateConfig({...cfg,n_byzantine:6}),/N>2f/);
 assert.throws(()=>validateConfig({...cfg,n_steps:501}),/500/);
 assert.throws(()=>validateConfig({...cfg,network_topology:"unknown"}),/топология/);
});


test("UP-01 strict type, probability, prior, radius and integral configuration",()=>{
 const bad=[
  ["n_agents",7.5],["n_steps",4.5],["n_byzantine",1.5],["message_loss_probability",1.5],
  ["reputation_damping",1],["reputation_damping",1.8],["clip_radius",-.1],
  ["trust_prior_strength",-2],["parallel_workers",1.4],["forgetting_factor",0],
  ["n_sybil_agents",1.2],["honest_noise_sigma",-1],["network_enabled",1],
  ["on_off_period",2.5],["bootstrap_samples",NaN],["n_runs","4"]
 ];
 for(const [key,value] of bad)assert.throws(()=>validateConfig({...cfg,[key]:value}),new RegExp(key));
 assert.throws(()=>validateConfig({...cfg,n_steps:4,attack_start_step:5}),/attack_start_step/);
 assert.throws(()=>validateConfig({...cfg,partition_enabled:true,partition_start_step:4,partition_end_step:80}),/partition_end_step/);
 assert.equal(validateConfig({...cfg,message_loss_probability:1,clip_radius:.001}).message_loss_probability,1);
});
test("UP-06 before activation Byzantine witnesses use the honest evidence generator",()=>{
 const c=validateConfig({...cfg,attack_start_step:18,network_enabled:false});
 const active=Array(c.n_agents).fill(true),labels=Array(c.n_agents).fill(0);
 const honest=Array(c.n_agents).fill(false),compromised=honest.map((_,i)=>i===1||i===3);
 const ref=observations(0,"collusion",c,honest,active,labels,createRng(101),999).matrix;
 const actual=observations(0,"collusion",c,compromised,active,labels,createRng(101),999).matrix;
 assert.deepEqual(actual,ref);
});
test("UP-08 complete loss of proposals produces refusal, not a zero-error oracle fallback",()=>{
 const c={...cfg,network_enabled:true,network_topology:"ring",message_loss_probability:1};
 const run=simulateRun(c,"collusion",0,0,true);
 assert.ok(run.result.series.every(x=>x.proposed_robust===null&&x.arithmetic_mean===null));
 for(const row of run.rows){
  assert.equal(row.decision_coverage,0);
  assert.equal(row.abstention_probability,1);
  assert.equal(row.accuracy_accepted,null);
  assert.equal(row.mae_to_truth,null);
  assert.equal(row.rmse_to_truth,null);
  assert.equal(row.probability_correct,0);
 }
 assert.equal(run.result.modelVersion,TRUST_MODEL_VERSION);
});
test("UP-05 every isolation is justified by the archived controller score at that tick",()=>{
 const c={...cfg,isolation_threshold:.95,isolation_patience:1,minimum_evidence_steps:1};
 const run=simulateRun(c,"collusion",0,0,true).result;
 assert.ok(run.events.length>0);
 for(const event of run.events){
  const row=run.reputation.find(x=>x.agent===event.agent&&x.step===event.step);
  assert.ok(row);
  assert.equal(event.isolationScore,row.isolationScore);
  assert.ok(row.isolationScore<event.threshold);
  assert.equal(row.isolationThreshold,event.threshold);
 }
});
