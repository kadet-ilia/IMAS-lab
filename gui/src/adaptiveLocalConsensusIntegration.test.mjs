import test from "node:test";
import assert from "node:assert/strict";
import {runAdaptiveSingle,runAdaptiveStudy,validateAdaptiveStudy} from "./adaptiveExperiment.js";
import {E1A_LOCAL_CONSENSUS_VERSION} from "./adaptiveLocalConsensus.js";
const config={
 seed:713019,n_agents:10,n_byzantine:2,n_steps:12,trim_each_side:2,
 attack_start_step:3,network_enabled:true,network_topology:"ring",
 partition_enabled:true,partition_start_step:5,partition_end_step:8,
 partition_fraction:.4,message_loss_probability:0.05,
 message_delay_min_steps:0,message_delay_max_steps:1,
 bandwidth_messages_per_step:100
};
const options={
 comparisonMode:"network_feedback",evidenceModel:"behavior_linked",
 attackStrategy:"coordinated",scenario:"static_bias",
 alphaMode:"adaptive",runs:2
};
test("component-local pilot refuses unnetworked/estimator-only experiments",()=>{
 assert.throws(()=>validateAdaptiveStudy({...config,network_enabled:false},
  {...options,localConsensusPilot:true}),/сетевого моделирования/);
 assert.throws(()=>validateAdaptiveStudy(config,
  {...options,comparisonMode:"estimator_only",localConsensusPilot:true}),
 /локальный консенсус|Локальный консенсус/);
});
test("turning on idealized component-local pilot cannot change E1-A decisions/trust/feedback",()=>{
 const a=runAdaptiveSingle(config,{...options,localConsensusPilot:false},0);
 const b=runAdaptiveSingle(config,{...options,localConsensusPilot:true,
  localConsensusRounds:4,localConsensusTrim:1},0);
 assert.deepEqual(b.trajectory,a.trajectory);
 assert.deepEqual(b.feedback,a.feedback);
 const withoutTimes=byMethod=>Object.fromEntries(
  Object.entries(byMethod).map(([method,rows])=>[method,
   rows.map(row=>Object.fromEntries(
    Object.entries(row).filter(([key])=>!key.endsWith("_wall_ms"))))
  ]));
 assert.deepEqual(withoutTimes(b.original_metrics),withoutTimes(a.original_metrics));
 assert.equal(b.methodStates.adaptive_robust.length,config.n_steps);
 for(const method of Object.keys(b.methodStates)){
  const c=b.scenarioDiagnosticsByMethod[method].localConsensus;
  assert.equal(c.modelVersion,E1A_LOCAL_CONSENSUS_VERSION);
  assert.equal(c.history.length,config.n_steps);
  for(const entry of c.history){
   assert.equal(entry.states.length,config.n_agents);
   assert.ok(entry.componentCount>0);
   assert.ok(entry.totalMessages>=0);
   assert.ok(entry.states.every(v=>v===null||v>=config.safe_action_min&&v<=config.safe_action_max||
    v>=-2&&v<=2));
  }
  assert.ok(b.methodStates[method].some(s=>s.local_consensus_component_count>1),
   "Partition must be visible to local module");
 }
});
test("local-consensus pilot is deterministic per run and retains experiment metrics",()=>{
 const o={...options,localConsensusPilot:true,localConsensusRounds:2,
  localConsensusTrim:0};
 const one=runAdaptiveSingle(config,o,1);
 const repeat=runAdaptiveSingle(config,o,1);
 assert.deepEqual(one.trajectory,repeat.trajectory);
 assert.deepEqual(one.scenarioDiagnosticsByMethod,repeat.scenarioDiagnosticsByMethod);
 const study=runAdaptiveStudy(config,o);
 assert.equal(study.completedRuns,2);
 assert.equal(study.models.localConsensus,E1A_LOCAL_CONSENSUS_VERSION);
 assert.match(study.methodology.localConsensus,/Optional diagnostic/);
 for(const row of study.summary){
  assert.equal(row.mean_local_consensus_spread.n,2);
  assert.equal(row.mean_local_consensus_components.n,2);
  assert.ok(row.mean_local_consensus_messages.mean>0);
 }
});
