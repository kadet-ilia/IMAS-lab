#!/usr/bin/env node
/**
 * Opt-in E1-A local-only causal action state pilot. 16 exploratory cells,
 * 3 paired synthetic seeds per cell; no external calibration or inference.
 * Central E1 and its threat/transport event tape remain isolated.
 */
import {mkdirSync,writeFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {runAdaptiveStudy} from "../src/adaptiveExperiment.js";
const output=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../adaptive-results");
mkdirSync(output,{recursive:true});
const N=12,T=24,R=3,rows=[],details=[];
const mean=xs=>{const v=xs.filter(Number.isFinite);
 return v.length?v.reduce((s,x)=>s+x,0)/v.length:null;};
for(const topology of ["complete","ring"])
 for(const partition of [false,true])
  for(const capacity of [24,72])
   for(const feedback of [false,true]){
    const seed=20261117+(topology==="ring"?101:0)+(partition?17:0)+(capacity===72?5:0);
    const core={seed,n_agents:N,n_byzantine:2,n_steps:T,
     trim_each_side:2,attack_start_step:4,
     network_enabled:true,network_topology:topology,
     partition_enabled:partition,partition_start_step:8,partition_end_step:16,
     partition_fraction:.42,bandwidth_messages_per_step:capacity,
     message_delay_min_steps:0,message_delay_max_steps:1,
     message_loss_probability:.03};
    const options={runs:R,scenario:"static_bias",
     comparisonMode:"network_routed",evidenceModel:"behavior_linked",
     attackStrategy:"coordinated",alphaMode:"risk_aware",
     decisionBandwidthPolicy:"local_floor",decisionBandwidthFraction:.25,
     localTransportBandwidthFraction:.25,localConsensusPilot:true,
     localConsensusTrim:0,localConsensusRelaxation:.75,
     localTransportEnabled:true,localTransportDelaySteps:1,
     localTransportLossProbability:.05,localTransportMaxAgeSteps:5,
     localAutonomyEnabled:true,localAutonomyMinNeighbors:1,
     localAutonomyEvidenceTolerance:.3,localAutonomyDecay:.95,
     localAutonomyGuardEnabled:true,localAutonomyGuardThreshold:.45,
     localAutonomyGuardHysteresis:.1,localAutonomyGuardMinEvidence:2,
     localAutonomyActionFeedbackEnabled:feedback,
     localAutonomyActionGain:.5,localAutonomyActionMaxStep:.25,
     localAutonomyActionRefusalPolicy:"hold",
     localAutonomyRefusalPenalty:1};
    const result=runAdaptiveStudy(core,options);
    if(result.partial||result.completedRuns!==R)throw Error("Incomplete local feedback pilot");
    const individual=[];
    for(const run of result.runs){
     const metric=run.metrics.find(m=>m.method==="adaptive_robust");
     for(const diag of Object.values(run.scenarioDiagnosticsByMethod)){
      const link=diag.localTransport;
      if(link.generated!==link.delivered+link.lost+link.blocked+
       link.expired+link.superseded+link.pending||
       link.history.some(h=>h.totalUsed>h.sharedCapacity||
        h.autonomousHonestExcluded>h.autonomousExcluded))
       throw Error("Local action feedback violated network/resource accounting");
      if(feedback&&link.history.some(h=>!Array.isArray(h.autonomousActions)||
       h.autonomousActions.length!==N||
       h.autonomousActions.some(v=>v!==null&&(!Number.isFinite(v)||v< -2||v>2))))
       throw Error("Invalid local action state sequence");
      if(!feedback&&link.history.some(h=>h.autonomousActions!==null))
       throw Error("Historical shadow behavior changed when action feedback disabled");
     }
     individual.push({run:run.run,centralRmse:metric.rmse,
      acceptedRmse:metric.mean_local_autonomous_honest_rmse,
      coverage:metric.mean_local_autonomous_honest_coverage,
      unconditionalLoss:metric.mean_local_autonomous_honest_unconditional_loss,
      acceptedSquaredContribution:metric.mean_local_autonomous_honest_accepted_squared_contribution,
      actionMse:metric.mean_local_autonomous_honest_action_mse,
      actionUpdates:metric.mean_local_autonomous_action_updates,
      falseExclusions:metric.mean_local_autonomous_guard_honest_exclusions});
    }
    const row={cell:rows.length+1,topology,partition,capacity,feedback,seed,N,T,R,
     centralRmse:mean(individual.map(x=>x.centralRmse)),
     acceptedRmse:mean(individual.map(x=>x.acceptedRmse)),
     coverage:mean(individual.map(x=>x.coverage)),
     unconditionalLoss:mean(individual.map(x=>x.unconditionalLoss)),
     acceptedSquaredContribution:mean(individual.map(x=>x.acceptedSquaredContribution)),
     actionMse:mean(individual.map(x=>x.actionMse)),
     actionUpdates:mean(individual.map(x=>x.actionUpdates)),
     falseExclusions:mean(individual.map(x=>x.falseExclusions))};
    rows.push(row);details.push({row,core,options,individual});
    console.log("E1-A ACTION LOOP CELL "+JSON.stringify(row));
   }
const paired=[];
for(let i=0;i<rows.length;i+=2){
 const off=rows[i],on=rows[i+1];
 if(off.feedback||!on.feedback||off.seed!==on.seed||
  Math.abs(off.centralRmse-on.centralRmse)>1e-12)
  throw Error("Local action feedback broke the paired exogenous control");
 const sensitivity=[0,.25,1,4].map(penalty=>({
  penalty,
  deltaUnconditionalLoss:
   on.acceptedSquaredContribution-off.acceptedSquaredContribution+
   penalty*(off.coverage-on.coverage)
 }));
 paired.push({topology:on.topology,partition:on.partition,capacity:on.capacity,
  deltaCoverage:on.coverage-off.coverage,
  deltaAcceptedRmse:on.acceptedRmse-off.acceptedRmse,
  deltaUnconditionalLoss:on.unconditionalLoss-off.unconditionalLoss,
  actionMse:on.actionMse,actionUpdates:on.actionUpdates,
  deltaFalseExclusions:on.falseExclusions-off.falseExclusions,sensitivity});
 if(Math.abs(paired.at(-1).deltaUnconditionalLoss-
  sensitivity.find(x=>x.penalty===1).deltaUnconditionalLoss)>1e-10)
  throw Error("Unconditional risk does not reconcile with coverage and accepted errors");
}
const cols=Object.keys(rows[0]);
writeFileSync(path.join(output,"adaptive-local-action-feedback-pilot.csv"),
 [cols.join(";"),...rows.map(r=>cols.map(k=>r[k]??"").join(";"))].join("\n")+"\n");
writeFileSync(path.join(output,"adaptive-local-action-feedback-pilot.json"),
 JSON.stringify({version:"e1a-causal-local-action-state-pilot-1.0.0",
  status:"Synthetic exploratory; NOT closed-loop physical or full cyberdefence control",
  design:{N,T,R,cells:rows.length,methods:5,refusalPenalty:1,
   note:"Same exogenous seed per OFF/ON pair, no inferential claims"},
  rows,paired,details},null,2)+"\n");
console.log("E1-A ACTION LOOP SUMMARY "+JSON.stringify({
 cells:rows.length,methodRuns:rows.length*R*5,
 meanDeltaUnconditionalLoss:mean(paired.map(p=>p.deltaUnconditionalLoss)),
 meanDeltaCoverage:mean(paired.map(p=>p.deltaCoverage)),
 meanDeltaAcceptedRmse:mean(paired.map(p=>p.deltaAcceptedRmse)),
 meanActionMse:mean(paired.map(p=>p.actionMse)),
 centralRmseUnaffected:true,
 status:"exploratory scalar local communication loop only"}));
