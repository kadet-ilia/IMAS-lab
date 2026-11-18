/**
 * E1-A experiment orchestrator. Every compared estimator uses the same
 * delivered proposals, reputation, isolation and exogenous event stream.
 * Oracle truth is used only AFTER decisions to compute research metrics.
 */
import {validateConfig,simulateRun,TRUST_MODEL_VERSION} from "./trustEngine.js";
import {validateAttackPhases,defaultAttackPhases,attackIntensityAt} from "./attackProfiles.js";
import {validateAdaptiveOptions,estimateAdaptiveDecision,ADAPTIVE_METHODS,ADAPTIVE_METHOD_IDS,ADAPTIVE_MODEL_VERSION} from "./adaptiveDecisionEngine.js";
import {createAdaptiveScenarioAdapter,ADAPTIVE_SCENARIO_VERSION} from "./adaptiveScenario.js";
import {createAdaptiveRiskController,ADAPTIVE_RISK_MODEL_VERSION} from "./adaptiveRiskController.js";
import {createAdaptivePolicySelector,ADAPTIVE_POLICY_SELECTOR_VERSION} from "./adaptivePolicySelector.js";
import {ADAPTIVE_EVIDENCE_QUALITY_VERSION} from "./adaptiveEvidenceQuality.js";
import {ADAPTIVE_REGIME_DETECTOR_VERSION} from "./adaptiveRegimeDetector.js";
import {E1A_DECISION_CHANNEL_VERSION} from "./adaptiveDecisionChannel.js";
import {E1A_ROUTED_CHANNEL_VERSION} from "./adaptiveRoutedDecisionChannel.js";
import {E1A_LOCAL_CONSENSUS_VERSION} from "./adaptiveLocalConsensus.js";
import {E1A_LOCAL_TRANSPORT_VERSION} from "./adaptiveLocalTransport.js";
import {E1A_LOCAL_AUTONOMY_VERSION} from "./adaptiveLocalAutonomy.js";
import {pairedSignFlipP,holmAdjusted} from "./statistics2027.js";

export const ADAPTIVE_STUDY_VERSION="adaptive-study-2.4.0-experimental-regime-aware-opt-in";
const finite=Number.isFinite;
const sum=a=>a.reduce((s,x)=>s+x,0);
const average=a=>a.length?sum(a)/a.length:null;
const variance=a=>a.length>1?sum(a.map(x=>(x-average(a))**2))/(a.length-1):null;
const quantile=(a,p)=>{
 if(!a.length)return null;
 const v=[...a].sort((x,y)=>x-y),pos=(v.length-1)*p,i=Math.floor(pos);
 return v[i]+(v[Math.min(i+1,v.length-1)]-v[i])*(pos-i);
};
const stats=a=>{
 const x=a.filter(finite),m=average(x),v=variance(x);
 return {mean:m,sd:v===null?null:Math.sqrt(v),ci95_half_width:v===null?null:1.96*Math.sqrt(v/x.length),n:x.length};
};
export function validateAdaptiveStudy(config={},options={}){
 const core=validateConfig(config),adaptive=validateAdaptiveOptions(options);
 if(["decision_feedback","network_feedback","network_routed"].includes(adaptive.comparisonMode)&&adaptive.evidenceModel==="legacy")
  throw Error("Для обратной связи по решениям требуется поведенческая модель свидетельств");
 if(adaptive.comparisonMode==="decision_feedback"&&core.network_enabled)
  throw Error("Режим decision_feedback требует отключённой сети; используйте network_feedback для ограниченного по компонентам распространения решений");
 if(["network_feedback","network_routed"].includes(adaptive.comparisonMode)&&!core.network_enabled)
  throw Error("Режим network_feedback требует включённого сетевого моделирования E1");
 if(["network_feedback","network_routed"].includes(adaptive.comparisonMode)&&adaptive.decisionOriginAgent>=core.n_agents+core.n_sybil_agents)
  throw Error("Источник коллективного решения вне множества агентов");
 if(adaptive.localConsensusPilot&&!["network_feedback","network_routed"].includes(adaptive.comparisonMode))
  throw Error("Локальный консенсус как диагностический режим требует сетевой обратной связи");
 if(adaptive.localTransportEnabled&&!adaptive.localConsensusPilot)
  throw Error("Локальные сообщения требуют включённой диагностики локального согласования");
 if(adaptive.localTransportEnabled&&!core.network_enabled)
  throw Error("Локальные сообщения требуют включённой сетевой модели E1");
 if(adaptive.localAutonomyEnabled&&!adaptive.localTransportEnabled)
  throw Error("Автономные локальные решения требуют причинного локального транспорта");
 if(adaptive.localAutonomyGuardEnabled&&!adaptive.localAutonomyEnabled)
  throw Error("Локальная защитная фильтрация требует автономных локальных решений");
 if(adaptive.localAutonomyActionFeedbackEnabled&&!adaptive.localAutonomyEnabled)
  throw Error("Замкнутый локальный контур действий требует автономных локальных решений");
 if(adaptive.decisionBandwidthPolicy==="local_floor"&&
  (adaptive.comparisonMode!=="network_routed"||!adaptive.localTransportEnabled))
  throw Error("Гарантированная локальная квота требует network_routed и локального транспорта");
 const phases=adaptive.scenario==="dynamic"
  ?validateAttackPhases(adaptive.phases??defaultAttackPhases(core.n_steps,core.attack_start_step),core.n_steps)
  :null;
 return {core:{...core,paired_exogenous_events:true,
  ...(phases?{attack_schedule:phases}:{})},options:{...adaptive,phases}};
}
function feedbackMetrics(rows,method,gain,initial){
 let e=initial,bound=Math.abs(e),squares=[],positiveDelta=0,decisions=0;
 const rho=Math.abs(1-gain),points=[{step:0,e,V:e*e,iss_bound:bound,deltaV:null}];
 for(const row of rows){
  const y=row[method],accepted=finite(y),delta=accepted?y-row.truth:null;
  const next=accepted?(1-gain)*e-gain*delta:e;
  const boundNext=accepted?rho*bound+gain*Math.abs(delta):bound;
  const dV=next*next-e*e;
  if(Math.abs(next)>boundNext+1e-9)throw Error("Нарушена оценка ISS на шаге "+row.step);
  if(accepted){decisions++;if(dV>1e-12)positiveDelta++;}
  squares.push(next*next);
  points.push({step:row.step,e:next,V:next*next,deltaV:dV,iss_bound:boundNext,
   decision_available:accepted});
  e=next;bound=boundNext;
 }
 return {metrics:{state_rmse:Math.sqrt(average(squares)),final_abs_error:Math.abs(e),
   positive_delta_v_fraction:decisions?positiveDelta/decisions:null,
   decision_coverage:decisions/rows.length,iss_bound_final:bound,
   missing_decisions:rows.length-decisions},
   points};
}
export function runAdaptiveSingle(config={},options={},runIndex=0){
 if(!Number.isInteger(runIndex)||runIndex<0)throw Error("Некорректный индекс прогона");
 const {core,options:o}=validateAdaptiveStudy(config,options);
 if(["decision_feedback","network_feedback","network_routed"].includes(o.comparisonMode))
  return runAdaptiveSingleDecisionFeedback(core,o,runIndex);
 const adaptive=[];
 const risk=o.alphaMode==="risk_aware"?createAdaptiveRiskController(o):null;
 const policy=o.alphaMode==="regime_aware"?createAdaptivePolicySelector(o):null;
 const generator=createAdaptiveScenarioAdapter(core,o,runIndex);
 const simulation=simulateRun(core,o.scenario,runIndex,0,false,null,observable=>{
  const result=estimateAdaptiveDecision(observable,o,core,risk,policy);
  adaptive.push({step:observable.step,...result.decisions,diagnostics:result.diagnostics});
 },generator);
 if(simulation.trajectory.length!==adaptive.length||adaptive.length!==core.n_steps)
  throw Error("Несоответствие длины трассы E1 и наблюдений E1-А");
 const trajectory=simulation.trajectory.map((row,i)=>{
  const a=adaptive[i];
  if(row.step!==a.step)throw Error("Нарушен порядок тактов E1-А");
  const {trimmed_unweighted,proposed_robust,...newMethods}=a;
  // Original E1 decisions are retained verbatim; the adaptive observer
  // is not permitted to modify historical method outputs.
  if(Math.abs((row.trimmed_unweighted??0)-(trimmed_unweighted??0))>1e-10||
     Math.abs((row.proposed_robust??0)-(proposed_robust??0))>1e-10)
   throw Error("Нарушена согласованность контрольного агрегатора E1");
  const nominalIntensity=o.scenario==="dynamic"?attackIntensityAt(row.step,o.phases,core.n_steps):row.attack_intensity;
  const activeIntensity=generator?.effectiveIntensity(row.step,nominalIntensity)??nominalIntensity;
  return {...row,...newMethods,attack_intensity:activeIntensity,
   attack_active:Number(activeIntensity>0),nominal_attack_intensity:nominalIntensity};
 });
 const metrics=ADAPTIVE_METHOD_IDS.map(method=>{
  const accepted=trajectory.filter(row=>finite(row[method]));
  const errors=accepted.map(row=>row[method]-core.desired_action);
  const attackErrors=accepted.filter(row=>row.attack_intensity>0).map(row=>row[method]-core.desired_action);
  const squared=errors.map(e=>e*e),abs=errors.map(Math.abs);
  const feedback=feedbackMetrics(trajectory,method,o.feedbackGain,o.feedbackInitialError);
  return {method,run:runIndex,
   decision_coverage:accepted.length/core.n_steps,
   refusals:core.n_steps-accepted.length,
   unconditional_decision_loss:(sum(squared)+
    (core.n_steps-accepted.length)*o.decisionRefusalPenalty)/core.n_steps,
   probability_correct:errors.filter(e=>Math.abs(e)<=core.correctness_tolerance).length/core.n_steps,
   accuracy_accepted:accepted.length?errors.filter(e=>Math.abs(e)<=core.correctness_tolerance).length/accepted.length:null,
   rmse:errors.length?Math.sqrt(average(squared)):null,
   mae:average(abs),p95_abs_error:quantile(abs,.95),max_abs_error:abs.length?Math.max(...abs):null,
   attack_rmse:attackErrors.length?Math.sqrt(average(attackErrors.map(e=>e*e))):null,
   ...feedback.metrics};
 });
 const feedback=Object.fromEntries(ADAPTIVE_METHOD_IDS.map(method=>[
  method,feedbackMetrics(trajectory,method,o.feedbackGain,o.feedbackInitialError).points
 ]));
 return {run:runIndex,metrics,trajectory,feedback,original_metrics:simulation.rows,
  scenarioDiagnostics:generator?.getDiagnostic()??null};
}

/**
 * Reduced closed-loop study: each estimator independently changes the
 * collective reference used to create the NEXT trust state via witnesses.
 * It recomputes the whole E1 execution five times with the same keyed
 * exogenous random-event stream. Network is restricted to unrestricted
 * broadcast until per-component decision dissemination is implemented.
 */
function runAdaptiveSingleDecisionFeedback(core,o,runIndex){
 const methodPaths={},methodStates={},methodDiagnostics={},originalMetrics={};
 let adaptiveDiagnostics=[];
 for(const method of ADAPTIVE_METHOD_IDS){
  const generator=createAdaptiveScenarioAdapter(core,o,runIndex);
  if(!generator?.evidenceValue)throw Error("Для раздельного контура требуется модель наблюдаемых свидетельств");
  const observed=[];
  const methodRisk=o.alphaMode==="risk_aware"?createAdaptiveRiskController(o):null;
  const methodPolicy=o.alphaMode==="regime_aware"?createAdaptivePolicySelector(o):null;
  const simulation=simulateRun(core,o.scenario,runIndex,0,false,null,observable=>{
   const data=estimateAdaptiveDecision(observable,o,core,methodRisk,methodPolicy);
   const value=data.decisions[method];
   generator.onFeedbackDecision({step:observable.step,value});
   observed.push({step:observable.step,value,diagnostics:data.diagnostics,
    meanReputation:average(observable.reputation.filter((r,i)=>observable.available[i]&&finite(r))),
    availableAgents:observable.available.filter(Boolean).length});
  },generator);
  if(simulation.trajectory.length!==core.n_steps||observed.length!==core.n_steps)
   throw Error("Неполный методоспецифический контур "+method);
  const paths=[],states=[];
  const channelHistory=generator.getDiagnostic().decisionChannel?.history??[];
  const localHistory=generator.getDiagnostic().localConsensus?.history??[];
  const linkHistory=generator.getDiagnostic().localTransport?.history??[];
  if(o.localTransportEnabled&&linkHistory.length!==core.n_steps)
   throw Error("Локальные сообщения: получена неполная причинная трасса");
  if(o.localConsensusPilot&&localHistory.length!==core.n_steps)
   throw Error("Неполная трасса локального согласования E1-А");
  for(let index=0;index<core.n_steps;index++){
   const row=simulation.trajectory[index],ob=observed[index];
   if(row.step!==ob.step)throw Error("Нарушен порядок тактов "+method);
   if((method==="trimmed_unweighted"||method==="proposed_robust")&&
     !(row[method]===ob.value||(row[method]===null&&ob.value===null)))
    throw Error("Не совпала формула контрольного оценивателя "+method);
   const nominal=o.scenario==="dynamic"?
    attackIntensityAt(row.step,o.phases,core.n_steps):row.attack_intensity;
   const effective=generator.effectiveIntensity(row.step,nominal);
   paths.push({step:row.step,truth:row.truth,
    attack_intensity:effective,nominal_attack_intensity:nominal,[method]:ob.value});
   states.push({step:row.step,active_agents:row.active_agents,
    isolated_agents:row.isolated_agents,available_agents:row.available_agents,
    mean_reputation:ob.meanReputation,largest_component:row.largest_component,
    decision_reference_coverage:channelHistory[index]?.coverage??null,
    decision_reference_informed:channelHistory[index]?.informed??null,
    decision_reference_reachable:channelHistory[index]?.reachable??null,
    decision_packets_pending:channelHistory[index]?.pending??null,
    decision_hops_routed:channelHistory[index]?.routingHopsThisStep??null,
    decision_shared_capacity:channelHistory[index]?.sharedCapacity??null,
    decision_e1_used:channelHistory[index]?.e1Used??null,
    decision_reserved_slots:channelHistory[index]?.reserved??null,
    decision_shared_utilization:channelHistory[index]?.sharedCapacity?
     channelHistory[index].sharedUsed/channelHistory[index].sharedCapacity:null,
    decision_borrowed_slots:channelHistory[index]?.borrowedFromE1??null,
    decision_released_to_e1_slots:channelHistory[index]?.releasedToE1??null,
    decision_target_reservation:channelHistory[index]?.targetReservation??null,
    local_consensus_spread:localHistory[index]?.maxHonestSpread??null,
    local_consensus_component_count:localHistory[index]?.componentCount??null,
    local_consensus_messages:localHistory[index]?.totalMessages??null,
    local_consensus_active_agents:localHistory[index]?.activeCount??null,
    local_link_neighbor_readings:linkHistory[index]?.neighborReadingsThisStep??null,
    local_link_informed_nodes:linkHistory[index]?.informedNodes??null,
    local_link_transmissions:linkHistory[index]?.localUsed??null,
    local_link_honest_spread:linkHistory[index]?.localHonestSpread??null,
    local_link_shared_utilization:linkHistory[index]?.sharedUtilization??null,
    local_link_total_used:linkHistory[index]?.totalUsed??null,
    local_link_shared_capacity:linkHistory[index]?.sharedCapacity??null,
    local_autonomous_coverage:linkHistory[index]?.autonomousCoverage??null,
    local_autonomous_trust_updates:linkHistory[index]?.autonomousTrustUpdates??null,
    local_autonomous_refusals:linkHistory[index]?.autonomousRefusals??null,
    local_autonomous_mean_trust:linkHistory[index]?.autonomousMeanTrust??null,
    local_autonomous_guarded:linkHistory[index]?.autonomousGuarded??null,
    local_autonomous_released:linkHistory[index]?.autonomousReleased??null,
    local_autonomous_excluded:linkHistory[index]?.autonomousExcluded??null,
    local_autonomous_honest_excluded:linkHistory[index]?.autonomousHonestExcluded??null,
    local_autonomous_action_updates:linkHistory[index]?.autonomousActionUpdates??null,
    local_autonomous_action_refusals:linkHistory[index]?.autonomousActionRefusals??null});
  }
  methodPaths[method]=paths;
  methodStates[method]=states;
  methodDiagnostics[method]=generator.getDiagnostic();
  originalMetrics[method]=simulation.rows;
  if(method==="adaptive_robust")adaptiveDiagnostics=observed.map(x=>x.diagnostics);
 }
 const trajectory=Array.from({length:core.n_steps},(_,index)=>{
  const base=methodPaths.adaptive_robust[index];
  return {...base,...Object.fromEntries(ADAPTIVE_METHOD_IDS.map(method=>[
   method,methodPaths[method][index][method]
  ])),diagnostics:adaptiveDiagnostics[index]};
 });
 const metrics=ADAPTIVE_METHOD_IDS.map(method=>{
  const accepted=trajectory.filter(row=>finite(row[method]));
  const errors=accepted.map(row=>row[method]-core.desired_action);
  const attackErrors=accepted.filter(row=>row.attack_intensity>0)
   .map(row=>row[method]-core.desired_action);
  const abs=errors.map(Math.abs),feedback=feedbackMetrics(
   trajectory,method,o.feedbackGain,o.feedbackInitialError);
  const state=methodStates[method];
  const localRows=o.localAutonomyEnabled?
   (methodDiagnostics[method]?.localTransport?.history??[]):[];
  const localAccepted=localRows.flatMap(h=>(h.autonomousDecisions??[]).filter(finite));
  const localDenominator=localRows.reduce((total,h)=>total+h.activeNodes,0);
  const honestAccepted=localRows.flatMap(h=>(h.autonomousDecisions??[])
   .filter((v,i)=>h.autonomousHonestMask?.[i]&&finite(v)));
  const honestDenominator=localRows.reduce((total,h)=>total+
   (h.autonomousHonestMask??[]).filter(Boolean).length,0);
  // Post-hoc: every honest active node/tick pays accepted squared error OR
  // the explicit refusal penalty, never a selection-biased accepted-only loss.
  const honestCosts=localRows.flatMap(h=>(h.autonomousDecisions??[])
   .flatMap((v,i)=>h.autonomousHonestMask?.[i]?
    [finite(v)?(v-core.desired_action)**2:o.localAutonomyRefusalPenalty]:[]));
  if(honestCosts.length!==honestDenominator)
   throw Error("Локальная оценка риска: нарушен состав честных наблюдений");
  const honestApplied=localRows.flatMap(h=>(h.autonomousActions??[])
   .filter((v,i)=>h.autonomousHonestMask?.[i]&&finite(v)));
  return {method,run:runIndex,decision_coverage:accepted.length/core.n_steps,
   refusals:core.n_steps-accepted.length,
   unconditional_decision_loss:(sum(errors.map(e=>e*e))+
    (core.n_steps-accepted.length)*o.decisionRefusalPenalty)/core.n_steps,
   probability_correct:errors.filter(e=>Math.abs(e)<=core.correctness_tolerance).length/core.n_steps,
   accuracy_accepted:accepted.length?
    errors.filter(e=>Math.abs(e)<=core.correctness_tolerance).length/accepted.length:null,
   rmse:errors.length?Math.sqrt(average(errors.map(e=>e*e))):null,
   mae:average(abs),p95_abs_error:quantile(abs,.95),
   max_abs_error:abs.length?Math.max(...abs):null,
   attack_rmse:attackErrors.length?Math.sqrt(average(attackErrors.map(e=>e*e))):null,
   mean_isolated_agents:average(state.map(v=>v.isolated_agents)),
   max_isolated_agents:Math.max(...state.map(v=>v.isolated_agents)),
   mean_reputation:average(state.map(v=>v.mean_reputation)),
   mean_decision_reference_coverage:average(state.map(v=>v.decision_reference_coverage).filter(finite)),
   mean_decision_hops_routed:average(state.map(v=>v.decision_hops_routed).filter(finite)),
   mean_shared_utilization:average(state.map(v=>v.decision_shared_utilization).filter(finite)),
   mean_borrowed_decision_slots:average(state.map(v=>v.decision_borrowed_slots).filter(finite)),
   mean_released_to_e1_slots:average(state.map(v=>v.decision_released_to_e1_slots).filter(finite)),
   mean_local_consensus_spread:average(state.map(v=>v.local_consensus_spread).filter(finite)),
   mean_local_consensus_components:average(state.map(v=>v.local_consensus_component_count).filter(finite)),
   mean_local_consensus_messages:average(state.map(v=>v.local_consensus_messages).filter(finite)),
   mean_local_link_neighbor_readings:average(state.map(v=>v.local_link_neighbor_readings).filter(finite)),
   mean_local_link_informed_nodes:average(state.map(v=>v.local_link_informed_nodes).filter(finite)),
   mean_local_link_transmissions:average(state.map(v=>v.local_link_transmissions).filter(finite)),
   mean_local_link_honest_spread:average(state.map(v=>v.local_link_honest_spread).filter(finite)),
   mean_local_link_shared_utilization:average(state.map(v=>v.local_link_shared_utilization).filter(finite)),
   mean_local_autonomous_coverage:o.localAutonomyEnabled?
    localAccepted.length/Math.max(1,localDenominator):null,
   mean_local_autonomous_rmse:localAccepted.length?
    Math.sqrt(average(localAccepted.map(x=>(x-core.desired_action)**2))):null,
   mean_local_autonomous_honest_coverage:o.localAutonomyEnabled&&honestDenominator?
    honestAccepted.length/honestDenominator:null,
   mean_local_autonomous_honest_rmse:honestAccepted.length?
    Math.sqrt(average(honestAccepted.map(x=>(x-core.desired_action)**2))):null,
   mean_local_autonomous_honest_unconditional_loss:honestDenominator?
    average(honestCosts):null,
   mean_local_autonomous_honest_accepted_squared_contribution:honestDenominator?
    sum(honestAccepted.map(x=>(x-core.desired_action)**2))/honestDenominator:null,
   // Applied-action MSE also includes fallback after refusals.
   mean_local_autonomous_honest_action_mse:honestApplied.length?
    average(honestApplied.map(x=>(x-core.desired_action)**2)):null,
   mean_local_autonomous_action_updates:o.localAutonomyActionFeedbackEnabled?
    localRows.reduce((total,h)=>total+(h.autonomousActionUpdates??0),0):null,
   mean_local_autonomous_trust_updates:o.localAutonomyEnabled?
    localRows.reduce((sum,h)=>sum+(h.autonomousTrustUpdates??0),0):null,
   mean_local_autonomous_guard_exclusions:o.localAutonomyEnabled?
    localRows.reduce((sum,h)=>sum+(h.autonomousExcluded??0),0):null,
   mean_local_autonomous_guard_honest_exclusions:o.localAutonomyEnabled?
    localRows.reduce((sum,h)=>sum+(h.autonomousHonestExcluded??0),0):null,
   mean_local_autonomous_guard_activations:o.localAutonomyEnabled?
    localRows.reduce((sum,h)=>sum+(h.autonomousGuarded??0),0):null,
   ...feedback.metrics};
 });
 const feedback=Object.fromEntries(ADAPTIVE_METHOD_IDS.map(method=>[
  method,feedbackMetrics(trajectory,method,o.feedbackGain,o.feedbackInitialError).points
 ]));
 return {run:runIndex,metrics,trajectory,feedback,methodStates,
  original_metrics:originalMetrics,scenarioDiagnostics:methodDiagnostics.adaptive_robust,
  scenarioDiagnosticsByMethod:methodDiagnostics};
}

export function summarizeAdaptiveRuns(runs,config={},options={}){
 const {core,options:o}=validateAdaptiveStudy(config,options);
 if(!Array.isArray(runs)||!runs.length||runs.length>o.runs)throw Error("Неполный список прогонов E1-А");
 const ordered=[...runs].sort((a,b)=>a.run-b.run);
 if(new Set(ordered.map(r=>r.run)).size!==ordered.length||ordered.some((r,i)=>r.run!==i||r.trajectory?.length!==core.n_steps))
  throw Error("Нарушен состав или порядок прогонов");
 const metrics=["decision_coverage","refusals","unconditional_decision_loss","probability_correct","accuracy_accepted","rmse","mae",
  "p95_abs_error","max_abs_error","attack_rmse","state_rmse","final_abs_error","positive_delta_v_fraction",
  "mean_isolated_agents","max_isolated_agents","mean_reputation","mean_decision_reference_coverage",
  "mean_decision_hops_routed","mean_shared_utilization",
  "mean_borrowed_decision_slots","mean_released_to_e1_slots",
  "mean_local_consensus_spread","mean_local_consensus_components","mean_local_consensus_messages",
  "mean_local_link_neighbor_readings","mean_local_link_informed_nodes",
  "mean_local_link_transmissions","mean_local_link_honest_spread","mean_local_link_shared_utilization",
  "mean_local_autonomous_coverage","mean_local_autonomous_rmse",
  "mean_local_autonomous_honest_coverage","mean_local_autonomous_honest_rmse",
  "mean_local_autonomous_trust_updates","mean_local_autonomous_guard_exclusions",
  "mean_local_autonomous_guard_honest_exclusions",
  "mean_local_autonomous_guard_activations",
  "mean_local_autonomous_honest_unconditional_loss",
  "mean_local_autonomous_honest_accepted_squared_contribution",
  "mean_local_autonomous_honest_action_mse",
  "mean_local_autonomous_action_updates"];
 const summary=ADAPTIVE_METHOD_IDS.map(method=>{
  const group=ordered.map(run=>run.metrics.find(row=>row.method===method));
  if(group.some(v=>!v))throw Error("Отсутствует оценка метода "+method);
  return {method,...Object.fromEntries(metrics.map(m=>[m,stats(group.map(row=>row[m]))]))};
 });
 const pairedRaw=ADAPTIVE_METHOD_IDS.filter(method=>method!=="adaptive_robust").map((baseline,index)=>{
  const diffs=ordered.map(run=>{
   const a=run.metrics.find(x=>x.method==="adaptive_robust")?.rmse;
   const b=run.metrics.find(x=>x.method===baseline)?.rmse;
   return finite(a)&&finite(b)?a-b:null;
  }).filter(finite);
  const sign=diffs.length>=2?pairedSignFlipP(diffs,core.seed+index*101,4095):null;
  return {baseline,adaptive:"adaptive_robust",metric:"rmse_adaptive_minus_baseline",
   ...stats(diffs),wins:diffs.filter(x=>x<0).length,losses:diffs.filter(x=>x>0).length,
   ties:diffs.filter(x=>x===0).length,p_value:sign?.p??null,
   sign_flip_method:sign?.method??null,sign_flip_replicates:sign?.replicates??0};
 });
 const indices=pairedRaw.map((row,i)=>row.p_value===null?-1:i).filter(i=>i>=0);
 const adjusted=holmAdjusted(indices.map(i=>pairedRaw[i].p_value));
 const holmByIndex=new Map(indices.map((i,j)=>[i,adjusted[j]]));
 const paired=pairedRaw.map((row,i)=>({...row,p_holm:holmByIndex.get(i)??null,
  inferentialStatus:"exploratory; not independently confirmed"}));
 const diagnostics=ordered[0].trajectory.map(row=>({
  step:row.step,attack_intensity:row.attack_intensity,truth:core.desired_action,
  trimmed_unweighted:row.trimmed_unweighted,proposed_robust:row.proposed_robust,
  adaptive_unweighted:row.adaptive_unweighted,adaptive_weighted:row.adaptive_weighted,
  adaptive_robust:row.adaptive_robust,...row.diagnostics
 }));
 return {
  archiveFormat:"imas-adaptive-collective-decisions",archiveVersion:1,
  models:{base:TRUST_MODEL_VERSION,adaptive:ADAPTIVE_MODEL_VERSION,study:ADAPTIVE_STUDY_VERSION,
   scenario:ADAPTIVE_SCENARIO_VERSION,risk:ADAPTIVE_RISK_MODEL_VERSION,
   policy:ADAPTIVE_POLICY_SELECTOR_VERSION,
   regimeDetector:ADAPTIVE_REGIME_DETECTOR_VERSION,
   evidenceQuality:ADAPTIVE_EVIDENCE_QUALITY_VERSION,
   decisionChannel:E1A_DECISION_CHANNEL_VERSION,
   routedDecisionChannel:E1A_ROUTED_CHANNEL_VERSION,
   localConsensus:E1A_LOCAL_CONSENSUS_VERSION,
   localTransport:E1A_LOCAL_TRANSPORT_VERSION,
   localAutonomy:E1A_LOCAL_AUTONOMY_VERSION},
  methodology:{comparison:"estimator_only: shared E1 proposals, trust, isolation and delivery",
   evidence:"E1-A behavior-linked witnesses use delivered proposals and robust peers, not oracle truth; lagged_observation is an observation lag, not transport latency",
   comparisonMode:o.comparisonMode,
   feedbackReference:o.comparisonMode==="network_routed"
    ?"method-specific centrally computed decision routed hop-by-hop on actual active E1 link graph, shortest path recomputed at each forwarding, fixed reserved share of the SAME per-tick proposal/evidence/decision budget; independent method-specific trust/isolations; no distributed consensus"
    :o.comparisonMode==="network_feedback"
    ?"method-specific centrally computed decision emitted by a designated origin, delivered on subsequent ticks only to active reachable agents within E1 connected components; separate broadcast channel and ledger"
    :o.comparisonMode==="decision_feedback"
    ?"method-specific collective decision broadcast in an unconstrained network; independent reputation and isolation for each method"
    :"common reputation and isolation for all estimators",
   attack:"strategy independent of temporal intensity profile; attacker labels used by simulator only",
   inputLeakage:"adaptive estimator does not receive oracle truth, labels or future evidence",
   routedBandwidthPolicy:o.comparisonMode==="network_routed"?o.decisionBandwidthPolicy:null,
   localConsensus:o.localConsensusPilot
    ?"Optional diagnostic: ideal synchronous unbudgeted local update; no feedback to central E1 decision or Byzantine agreement guarantee"
    :"disabled",
   localTransport:o.localTransportEnabled
    ?"Optional causal one-hop local neighbor transport with delayed/lossy delivery and shared budget; legacy and local_floor bandwidth modes preserved"
    :"disabled",
   localAutonomy:o.localAutonomyEnabled
    ?"SHADOW research: independent directed soft-Beta local trust from causal delivered observations. Opt-in two-threshold local guard, with post-hoc honest false exclusion counts. Optional BOUNDED local action-state loop z(t) feeds the NEXT neighbor message but NOT physical plant state, E1 evidence, global topology, isolation or E1 central decision. All honest active (node,tick) units enter predeclared unconditional loss: squared error if accepted, configured refusal penalty if absent. Truth and labels enter only offline evaluation, never local estimation, action or trust. Distinct local and central evaluation units preclude direct paired RMSE claims; NOT Byzantine consensus or full cyberdefence closed-loop control."
    :"disabled",
   riskMode:o.alphaMode==="risk_aware"?"Prequential proxy loss: evaluate prior-tick plain/weighted decisions against currently observed median, then choose current alpha. No oracle truth, hidden labels, or future observations":
    o.alphaMode==="regime_aware"?"Experimental causal expert policy: prior-tick expert decisions scored against current observable median with model-configured evidence quality and EWMA/CUSUM changes; fallback to historical combined E1 after shifts. No oracle truth or attacker labels":"disabled",
   rmse:"each run: sqrt(mean of squared errors on accepted decisions); summary: mean across runs",
   rejection:"refusal counts as incorrect for unconditional probability_correct; unconditional_decision_loss uses the configured squared-error penalty for every missing decision",
   confidence:"normal-approximation 95% CI for independent run means, not adjusted for multiple tests; two-sided paired sign-flip p values Holm-adjusted across four planned RMSE contrasts",
   inference:"Sign-flip requires pairwise sign-exchangeability under the null; paired seeds alone do not establish validity. This study is exploratory; independent confirmatory series required.",
   stability:"auxiliary scalar feedback only, not a proof of full IMAS stability",
   limitation:"All feedback modes are synthetic closed-loop surrogates. network_feedback is a component-broadcast abstraction with a separate decision budget. network_routed offers frozen static reservation or opt-in opportunistic bidirectional idle-slot borrowing. Even the latter is a sequential work-conserving approximation under currently routable demand, NOT an optimized joint packet scheduler: no per-edge parallel transmissions, queue-priority optimization, retransmission, physical link capacity or distributed decision generation. E1 first-attack diagnostics may refer to nominal rather than effective attack onset"},
  configuration:core,options:o,methods:ADAPTIVE_METHODS,summary,paired,
  completedRuns:ordered.length,requestedRuns:o.runs,partial:ordered.length!==o.runs,
  trace:diagnostics,runs:ordered
 };
}
export function runAdaptiveStudy(config={},options={},onProgress=()=>{}){
 const {core,options:o}=validateAdaptiveStudy(config,options);
 const runs=[];
 for(let i=0;i<o.runs;i++){
  runs.push(runAdaptiveSingle(core,o,i));
  onProgress(i+1,o.runs);
 }
 return summarizeAdaptiveRuns(runs,core,o);
}
