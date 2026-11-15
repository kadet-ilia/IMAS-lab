/**
 * E1-A experiment orchestrator. Every compared estimator uses the same
 * delivered proposals, reputation, isolation and exogenous event stream.
 * Oracle truth is used only AFTER decisions to compute research metrics.
 */
import {validateConfig,simulateRun,TRUST_MODEL_VERSION} from "./trustEngine.js";
import {validateAttackPhases,defaultAttackPhases,attackIntensityAt} from "./attackProfiles.js";
import {validateAdaptiveOptions,estimateAdaptiveDecision,ADAPTIVE_METHODS,ADAPTIVE_METHOD_IDS,ADAPTIVE_MODEL_VERSION} from "./adaptiveDecisionEngine.js";
import {createAdaptiveScenarioAdapter,ADAPTIVE_SCENARIO_VERSION} from "./adaptiveScenario.js";

export const ADAPTIVE_STUDY_VERSION="adaptive-study-1.1.0-estimator-only";
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
 const adaptive=[];
 const generator=createAdaptiveScenarioAdapter(core,o,runIndex);
 const simulation=simulateRun(core,o.scenario,runIndex,0,false,null,observable=>{
  const result=estimateAdaptiveDecision(observable,o,core);
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
  return {...row,...newMethods,
   attack_intensity:o.scenario==="dynamic"?attackIntensityAt(row.step,o.phases,core.n_steps):row.attack_intensity};
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
export function summarizeAdaptiveRuns(runs,config={},options={}){
 const {core,options:o}=validateAdaptiveStudy(config,options);
 if(!Array.isArray(runs)||!runs.length||runs.length>o.runs)throw Error("Неполный список прогонов E1-А");
 const ordered=[...runs].sort((a,b)=>a.run-b.run);
 if(new Set(ordered.map(r=>r.run)).size!==ordered.length||ordered.some((r,i)=>r.run!==i||r.trajectory?.length!==core.n_steps))
  throw Error("Нарушен состав или порядок прогонов");
 const metrics=["decision_coverage","probability_correct","accuracy_accepted","rmse","mae",
  "p95_abs_error","max_abs_error","attack_rmse","state_rmse","final_abs_error","positive_delta_v_fraction"];
 const summary=ADAPTIVE_METHOD_IDS.map(method=>{
  const group=ordered.map(run=>run.metrics.find(row=>row.method===method));
  if(group.some(v=>!v))throw Error("Отсутствует оценка метода "+method);
  return {method,...Object.fromEntries(metrics.map(m=>[m,stats(group.map(row=>row[m]))]))};
 });
 const paired=ADAPTIVE_METHOD_IDS.filter(method=>method!=="adaptive_robust").map(baseline=>{
  const diffs=ordered.map(run=>{
   const a=run.metrics.find(x=>x.method==="adaptive_robust")?.rmse;
   const b=run.metrics.find(x=>x.method===baseline)?.rmse;
   return finite(a)&&finite(b)?a-b:null;
  }).filter(finite);
  return {baseline,adaptive:"adaptive_robust",metric:"rmse_adaptive_minus_baseline",
   ...stats(diffs),wins:diffs.filter(x=>x<0).length,losses:diffs.filter(x=>x>0).length,
   ties:diffs.filter(x=>x===0).length};
 });
 const diagnostics=ordered[0].trajectory.map(row=>({
  step:row.step,attack_intensity:row.attack_intensity,truth:core.desired_action,
  trimmed_unweighted:row.trimmed_unweighted,proposed_robust:row.proposed_robust,
  adaptive_unweighted:row.adaptive_unweighted,adaptive_weighted:row.adaptive_weighted,
  adaptive_robust:row.adaptive_robust,...row.diagnostics
 }));
 return {
  archiveFormat:"imas-adaptive-collective-decisions",archiveVersion:1,
  models:{base:TRUST_MODEL_VERSION,adaptive:ADAPTIVE_MODEL_VERSION,study:ADAPTIVE_STUDY_VERSION,
   scenario:ADAPTIVE_SCENARIO_VERSION},
  methodology:{comparison:"estimator_only: shared E1 proposals, trust, isolation and delivery",
   evidence:"E1-A behavior-linked witnesses use delivered proposals and robust peers, not oracle truth; lagged_observation is an observation lag, not transport latency",
   attack:"strategy independent of temporal intensity profile; attacker labels used by simulator only",
   inputLeakage:"adaptive estimator does not receive oracle truth, labels or future evidence",
   rmse:"each run: sqrt(mean of squared errors on accepted decisions); summary: mean across runs",
   rejection:"refusal counts as incorrect for unconditional probability_correct",
   confidence:"normal-approximation 95% CI for independent run means, not adjusted for multiple tests",
   stability:"auxiliary scalar feedback only, not a proof of full IMAS stability"},
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
