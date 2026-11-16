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
import {pairedSignFlipP,holmAdjusted} from "./statistics2027.js";

export const ADAPTIVE_STUDY_VERSION="adaptive-study-1.3.0-risk-prequential";
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
 if(adaptive.comparisonMode==="decision_feedback"&&adaptive.evidenceModel==="legacy")
  throw Error("Для обратной связи по решениям требуется поведенческая модель свидетельств");
 if(adaptive.comparisonMode==="decision_feedback"&&core.network_enabled)
  throw Error("Режим обратной связи по решениям E1-А пока поддерживается только при отключённых сетевых ограничениях: широковещательная доступность решения не моделируется по компонентам связности");
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
 if(o.comparisonMode==="decision_feedback")return runAdaptiveSingleDecisionFeedback(core,o,runIndex);
 const adaptive=[];
 const risk=o.alphaMode==="risk_aware"?createAdaptiveRiskController(o):null;
 const generator=createAdaptiveScenarioAdapter(core,o,runIndex);
 const simulation=simulateRun(core,o.scenario,runIndex,0,false,null,observable=>{
  const result=estimateAdaptiveDecision(observable,o,core,risk);
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
  const simulation=simulateRun(core,o.scenario,runIndex,0,false,null,observable=>{
   const data=estimateAdaptiveDecision(observable,o,core,methodRisk);
   const value=data.decisions[method];
   generator.onFeedbackDecision({step:observable.step,value});
   observed.push({step:observable.step,value,diagnostics:data.diagnostics,
    meanReputation:average(observable.reputation.filter((r,i)=>observable.available[i]&&finite(r))),
    availableAgents:observable.available.filter(Boolean).length});
  },generator);
  if(simulation.trajectory.length!==core.n_steps||observed.length!==core.n_steps)
   throw Error("Неполный методоспецифический контур "+method);
  const paths=[],states=[];
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
    mean_reputation:ob.meanReputation,largest_component:row.largest_component});
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
  return {method,run:runIndex,decision_coverage:accepted.length/core.n_steps,
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
 const metrics=["decision_coverage","probability_correct","accuracy_accepted","rmse","mae",
  "p95_abs_error","max_abs_error","attack_rmse","state_rmse","final_abs_error","positive_delta_v_fraction",
  "mean_isolated_agents","max_isolated_agents","mean_reputation"];
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
   scenario:ADAPTIVE_SCENARIO_VERSION,risk:ADAPTIVE_RISK_MODEL_VERSION},
  methodology:{comparison:"estimator_only: shared E1 proposals, trust, isolation and delivery",
   evidence:"E1-A behavior-linked witnesses use delivered proposals and robust peers, not oracle truth; lagged_observation is an observation lag, not transport latency",
   comparisonMode:o.comparisonMode,
   feedbackReference:o.comparisonMode==="decision_feedback"
    ?"method-specific collective decision broadcast in an unconstrained network; independent reputation and isolation for each method"
    :"common reputation and isolation for all estimators",
   attack:"strategy independent of temporal intensity profile; attacker labels used by simulator only",
   inputLeakage:"adaptive estimator does not receive oracle truth, labels or future evidence",
   riskMode:o.alphaMode==="risk_aware"?"Prequential proxy loss: evaluate prior-tick plain/weighted decisions against currently observed median, then choose current alpha. No oracle truth, hidden labels, or future observations":"disabled",
   rmse:"each run: sqrt(mean of squared errors on accepted decisions); summary: mean across runs",
   rejection:"refusal counts as incorrect for unconditional probability_correct",
   confidence:"normal-approximation 95% CI for independent run means, not adjusted for multiple tests; two-sided paired sign-flip p values Holm-adjusted across four planned RMSE contrasts",
   inference:"Sign-flip requires pairwise sign-exchangeability under the null; paired seeds alone do not establish validity. This study is exploratory; independent confirmatory series required.",
   stability:"auxiliary scalar feedback only, not a proof of full IMAS stability",
   limitation:"Decision-feedback comparison is a synthetic closed-loop surrogate, not a full graph/network model of the IMAS; E1 original first-attack diagnostics may refer to nominal rather than effective attack onset"},
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
