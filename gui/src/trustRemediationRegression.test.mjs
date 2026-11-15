import test from "node:test";
import assert from "node:assert/strict";
import {
 DEFAULTS, createRng, validateConfig, observations, simulateRun, makePlan, buildAdjacency,
 accountCommunicationStep, auditSourceEventJournal, makeSourceEventRecorder, TRUST_MODEL_VERSION
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

test("NZ-06: Sybil augmentation is explicitly distinct from pure G(N,p)",()=>{
 const c=validateConfig({...DEFAULTS,n_agents:7,n_byzantine:1,n_sybil_agents:2,
  trim_each_side:1,n_steps:20,attack_start_step:4,network_enabled:true,
  network_topology:"random",network_edge_probability:0});
 const g=buildAdjacency(c,createRng(331),Array(9).fill(false));
 for(let i=0;i<7;i++)for(let j=0;j<7;j++)
  if(i!==j)assert.equal(g[i][j],false,"legitimate G(N,0) must have no edges");
 assert.equal(g[7][8],true);
 assert.equal(g[8][7],true);
 for(const sybil of [7,8])for(const anchor of [0,1,2]){
  assert.equal(g[sybil][anchor],true);
  assert.equal(g[anchor][sybil],true);
 }
 const data=simulateRun(c,"static_bias",0,0,true);
 assert.match(data.result.configuration.topology_semantics,/forced_sybil_clique/);
});

// Regression tests migrated from the second remediation wave without changing their assertions.
const base={...DEFAULTS,seed:20261106,n_agents:9,n_byzantine:2,trim_each_side:2,
 n_steps:18,attack_start_step:4,minimum_evidence_steps:4,isolation_patience:2,
 source_event_limit:20000};

test("NZ-07: per-channel message ledgers conserve attempts at every step",()=>{
 for(const network of [false,true]){
  const result=simulateRun({...base,record_source_events:true,network_enabled:network,
   network_topology:"ring",message_loss_probability:.3,
   message_delay_min_steps:0,message_delay_max_steps:3,
   max_message_staleness_steps:2,bandwidth_messages_per_step:2,
   n_sybil_agents:2,sybil_activation_step:6,partition_enabled:network,
   partition_start_step:8,partition_end_step:12},"on_off",0,0,true).result;
  assert.equal(result.message_ledger.length,base.n_steps);
  for(const item of result.message_ledger){
   assert.equal(item.proposal.balance,0,"proposals at "+item.step);
   assert.equal(item.evidence.balance,0,"evidence at "+item.step);
   assert.equal(item.total.balance,0,"total at "+item.step);
   assert.equal(item.total.attempted,item.total.delivered+item.total.lost+
    item.total.bandwidth_dropped+item.total.expired+item.total.pending);
   const row=result.network_series[item.step-1];
   assert.equal(row.message_balance,0);
   assert.equal(row.proposal_message_balance,0);
   assert.equal(row.evidence_message_balance,0);
   assert.equal(item.total.delivered/Math.max(1,item.total.attempted),row.delivery_ratio);
  }
  const last=result.message_ledger.at(-1);
  assert.equal(last.total.attempted,result.summary.communication_attempted);
  assert.equal(last.total.pending,result.summary.communication_queued);
  assert.deepEqual(result.summary.communication_channel_ledger,last);
  assert.equal(result.modelVersion,TRUST_MODEL_VERSION);
  assert.equal(result.source_event_log.complete,true);
  assert.equal(result.source_event_log.audit.valid,true);
  assert.deepEqual(auditSourceEventJournal(result.source_event_log.events,result.message_ledger),
   result.source_event_log.audit);
  if(network){
   assert.ok(last.proposal.expired>0);
   assert.ok(last.evidence.bandwidth_dropped>0);
  }
 }
});

test("NZ-15: source events preserve numerical results and reproduce exactly by seed",()=>{
 const c={...base,n_steps:10,network_enabled:true,network_topology:"random",
  network_edge_probability:.6,message_loss_probability:.15,
  bandwidth_messages_per_step:7,record_source_events:true};
 const a=simulateRun(c,"collusion",2,0,true).result;
 const b=simulateRun(c,"collusion",2,0,true).result;
 const reference=simulateRun({...c,record_source_events:false},"collusion",2,0,true).result;
 assert.deepEqual(a.source_event_log.events,b.source_event_log.events);
 assert.deepEqual(a.series,reference.series);
 assert.deepEqual(a.message_ledger,reference.message_ledger);
 assert.deepEqual(a.metrics,reference.metrics);
 assert.deepEqual(a.agents,reference.agents);
 assert.equal(a.source_event_log.rngScheme,"stateful-xorshift32");
 assert.ok(a.source_event_log.events.some(x=>x.kind==="proposal_generated"));
 assert.ok(a.source_event_log.events.some(x=>x.kind==="proposal_attempt"));
 assert.ok(a.source_event_log.events.some(x=>x.kind==="evidence"));
 const changed=a.source_event_log.events.map(x=>({...x}));
 const item=changed.find(x=>x.kind==="evidence"&&["delivered","lost","dropped"].includes(x.status));
 assert.ok(item);
 item.status=item.status==="delivered"?"lost":"delivered";
 const bad=auditSourceEventJournal(changed,a.message_ledger);
 assert.equal(bad.valid,false);
 assert.ok(bad.issues.includes("evidence_outcomes"));
});

test("NZ-15: journal limit fails closed without partial scientific result",()=>{
 assert.throws(()=>simulateRun({...base,record_source_events:true,source_event_limit:5},"static_bias",0,0,true),
  /Лимит журнала исходных событий/);
 assert.throws(()=>makeSourceEventRecorder(0));
 assert.throws(()=>makeSourceEventRecorder(250001));
 const recorder=makeSourceEventRecorder(2);
 recorder.record({kind:"test",step:1});
 recorder.record({kind:"test",step:2});
 assert.throws(()=>recorder.record({kind:"test",step:3}),/Лимит/);
 assert.equal(recorder.events.length,2);
});

test("NZ-07: independent channel accounting rejects invalid and missing messages",()=>{
 const evidence={attempted:3,delivered:2,lost:1,bandwidth_dropped:0};
 const one=accountCommunicationStep(null,{attempted:2,delivered:0,lost:0,
  bandwidth_dropped:0,expired:0},evidence,2,1);
 assert.equal(one.proposal.pending,2);
 assert.equal(one.evidence.balance,0);
 const two=accountCommunicationStep(one,{attempted:0,delivered:1,lost:0,expired:1},
  {attempted:0,delivered:0,lost:0,bandwidth_dropped:0},0,2);
 assert.equal(two.total.pending,0);
 assert.equal(two.proposal.expired,1);
 assert.throws(()=>accountCommunicationStep(one,{attempted:0,delivered:1,lost:0,expired:1},
  {attempted:0,delivered:0,lost:0},1,2),/conservation/);
 assert.throws(()=>accountCommunicationStep(null,{attempted:1,delivered:0,lost:-1},
  {attempted:0,delivered:0,lost:0},0,1),/invalid/);
});
