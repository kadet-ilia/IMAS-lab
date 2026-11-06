import test from "node:test";
import assert from "node:assert/strict";
import {
 DEFAULTS,simulateRun,accountCommunicationStep,auditSourceEventJournal,
 makeSourceEventRecorder,TRUST_MODEL_VERSION
} from "./trustEngine.js";

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
