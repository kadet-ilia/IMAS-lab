/**
 * Supplement to the trust experiment: a specified scalar feedback object,
 * driven by the actual decision-error traces produced by trustEngine.
 *
 * e[t+1] = (1-k) e[t] - k (decision[t]-truth) if a decision exists;
 * e[t+1] = e[t] on abstention (safe hold).
 * V(t)=e(t)^2. This is NOT a Lyapunov proof for the complete IMAS or its
 * learning/reputation dynamics. Under nonzero disturbances the origin need
 * not be an equilibrium. The scalar nominal feedback is ISS for 0<k<2.
 */
import {METHODS, simulateRun, validateConfig, TRUST_MODEL_VERSION} from "./trustEngine.js";

export const LYAPUNOV_STUDY_VERSION="trust-feedback-lyapunov-1.0";
const finite=x=>typeof x==="number"&&Number.isFinite(x);
const mean=x=>x.length?x.reduce((s,v)=>s+v,0)/x.length:null;
const sd=x=>x.length<2?null:Math.sqrt(x.reduce((s,v)=>s+(v-mean(x))**2,0)/(x.length-1));
const roundStart=(x,t)=>Math.max(1,Math.min(t,Math.round(x)));

export function defaultAttackPhases(steps,attackStart=20){
 const t=Math.max(1,Math.round(steps)),start=roundStart(attackStart,t);
 const candidates=[
  {start:1,intensity:0},
  {start,intensity:1},
  {start:roundStart(Math.max(start+1,Math.floor(t*.40)),t),intensity:0},
  {start:roundStart(Math.max(start+2,Math.floor(t*.58)),t),intensity:1.5},
  {start:roundStart(Math.max(start+3,Math.floor(t*.78)),t),intensity:0}
 ];
 const distinct=new Map();
 for(const p of candidates)if(!distinct.has(p.start)||p.start===1&&start===1)distinct.set(p.start,p);
 return [...distinct.values()].sort((a,b)=>a.start-b.start);
}

export function validateAttackPhases(phases,steps){
 if(!Array.isArray(phases)||!phases.length||phases.length>30)throw Error("Профиль атаки: требуется от 1 до 30 фаз");
 let previous=0;
 for(const [i,p] of phases.entries()){
  if(!p||!Number.isInteger(p.start)||p.start<=previous||p.start>steps)
   throw Error("Профиль атаки: начала фаз должны возрастать и лежать в пределах 1…T (фаза "+(i+1)+")");
  if(!finite(p.intensity)||p.intensity<0||p.intensity>5)
   throw Error("Профиль атаки: множитель интенсивности должен лежать в пределах 0…5");
  previous=p.start;
 }
 if(phases[0].start!==1)throw Error("Профиль атаки: первая фаза должна начинаться с шага 1");
 return phases.map(p=>({start:p.start,intensity:p.intensity}));
}

export function attackIntensityAt(step,phases){
 let value=0;
 for(const p of phases){if(p.start>step)break;value=p.intensity;}
 return value;
}

export function validateLyapunovOptions(config,options={}){
 const c=validateConfig(config);
 const opts={
  gain:options.gain??.5,initialError:options.initialError??1,
  tolerance:options.tolerance??.1,runs:options.runs??12,
  phases:options.phases??defaultAttackPhases(c.n_steps,c.attack_start_step)
 };
 if(!finite(opts.gain)||opts.gain<=0||opts.gain>=2)throw Error("Коэффициент обратной связи должен удовлетворять 0 < k < 2");
 if(!finite(opts.initialError)||Math.abs(opts.initialError)>100)throw Error("Начальное отклонение должно лежать в пределах −100…100");
 if(!finite(opts.tolerance)||opts.tolerance<=0||opts.tolerance>100)throw Error("Допуск по состоянию должен лежать в пределах (0; 100]");
 if(!Number.isInteger(opts.runs)||opts.runs<1||opts.runs>200)throw Error("Число прогонов должно лежать в пределах 1…200");
 opts.phases=validateAttackPhases(opts.phases,c.n_steps);
 return {config:c,options:opts};
}

export function feedbackTrajectory(trajectory,config,options){
 const {config:c,options:o}=validateLyapunovOptions(config,options);
 if(!Array.isArray(trajectory)||trajectory.length!==c.n_steps)throw Error("Неверная длина траектории доверия");
 const rho=Math.abs(1-o.gain);
 const result={};
 for(const method of METHODS){
  let e=o.initialError,bound=Math.abs(e),valid=0,deltaVPositive=0;
  const points=[{step:0,e,V:e*e,deltaV:null,iss_bound:bound,decision_error:null,attack_intensity:0,decision_available:false}];
  const decisionErrors=[],stateErrors=[],correctOn=[],correctOff=[],onSteps=[],offSteps=[];
  let maxDelta=-Infinity,maxD=0;
  for(let i=0;i<trajectory.length;i++){
   const row=trajectory[i],intensity=attackIntensityAt(i+1,o.phases);
   if(row.step!==i+1)throw Error("Нарушена последовательность тактов при оценке устойчивости");
   const decision=row[method],accepted=finite(decision),d=accepted?decision-c.desired_action:null;
   const eNext=accepted?(1-o.gain)*e-o.gain*d:e;
   const boundNext=accepted?rho*bound+o.gain*Math.abs(d):bound;
   const deltaV=eNext*eNext-e*e;
   if(accepted){
    valid++;
    decisionErrors.push(d);
    maxD=Math.max(maxD,Math.abs(d));
    if(deltaV>1e-12)deltaVPositive++;
    (intensity>0?correctOn:correctOff).push(Math.abs(d)<=c.correctness_tolerance?1:0);
   }else (intensity>0?correctOn:correctOff).push(0);
   (intensity>0?onSteps:offSteps).push(i+1);
   maxDelta=Math.max(maxDelta,deltaV);
   if(Math.abs(eNext)>boundNext+1e-8)throw Error("Нарушена оценка ISS для метода "+method);
   points.push({step:i+1,e:eNext,V:eNext*eNext,deltaV,iss_bound:boundNext,
     decision_error:d,decision_available:accepted,attack_intensity:intensity});
   stateErrors.push(eNext);
   e=eNext;bound=boundNext;
  }
  const settling=points.findIndex((p,i)=>i>0&&points.slice(i).every(z=>Math.abs(z.e)<=o.tolerance));
  const metrics={
   method,decision_coverage:valid/c.n_steps,
   decision_mae:valid?mean(decisionErrors.map(Math.abs)):null,
   decision_rmse:valid?Math.sqrt(mean(decisionErrors.map(x=>x*x))):null,
   correct_probability:(correctOn.filter(Boolean).length+correctOff.filter(Boolean).length)/c.n_steps,
   attack_on_correct:correctOn.length?mean(correctOn):null,
   attack_off_correct:correctOff.length?mean(correctOff):null,
   state_rmse:Math.sqrt(mean(stateErrors.map(x=>x*x))),
   final_abs_error:Math.abs(e),max_abs_error:Math.max(...stateErrors.map(Math.abs)),
   positive_delta_v_fraction:valid?deltaVPositive/valid:null,
   max_delta_v:maxDelta,
   settling_step:settling<0?null:settling,
   max_observed_disturbance:maxD,
   sampled_input_ultimate_radius:valid===c.n_steps?o.gain*maxD/(1-rho):null,
   sampled_iss_bound_final:bound,
   missing_decisions:c.n_steps-valid
  };
  result[method]={points,metrics};
 }
 return result;
}

function statistic(values){
 const x=values.filter(finite),m=mean(x),s=sd(x);
 return {mean:m,sd:s,ci95_half_width:s===null?null:1.96*s/Math.sqrt(x.length),n:x.length};
}

export function buildLyapunovResult(runs,config,options){
 const {config:c,options:o}=validateLyapunovOptions(config,options);
 if(!runs.length)throw Error("Для оценки необходим хотя бы один прогон");
 const evaluated=runs.map((trajectory,run)=>({run,data:feedbackTrajectory(trajectory,c,o)}));
 const summary=METHODS.map(method=>{
  const keys=Object.keys(evaluated[0].data[method].metrics).filter(k=>k!=="method");
  const metrics=Object.fromEntries(keys.map(k=>[k,statistic(evaluated.map(x=>x.data[method].metrics[k]))]));
  return {method,...metrics};
 });
 const comparison=[];
 for(const baseline of METHODS.filter(m=>m!=="proposed_robust")){
  for(const metric of ["decision_rmse","state_rmse","final_abs_error","correct_probability"]){
   const benefit=evaluated.map(x=>{
    const a=x.data[baseline].metrics[metric],b=x.data.proposed_robust.metrics[metric];
    return finite(a)&&finite(b)?(metric==="correct_probability"?b-a:a-b):null;
   });
   comparison.push({baseline,proposed:"proposed_robust",metric,benefit:statistic(benefit),paired:true});
  }
 }
 const series=Array.from({length:c.n_steps+1},(_,i)=>{
  const row={step:i,attack_intensity:i===0?0:attackIntensityAt(i,o.phases)};
  for(const method of METHODS){
   row[method+"_V_mean"]=mean(evaluated.map(x=>x.data[method].points[i].V));
   row[method+"_e_mean"]=mean(evaluated.map(x=>x.data[method].points[i].e));
   row[method+"_decision_rmse"]=i?statistic(evaluated.map(x=>{
    const d=x.data[method].points[i].decision_error;return finite(d)?d*d:null;
   })).mean:null;
   if(finite(row[method+"_decision_rmse"]))row[method+"_decision_rmse"]=Math.sqrt(row[method+"_decision_rmse"]);
  }
  return row;
 });
 return {
  schemaVersion:1,modelVersion:TRUST_MODEL_VERSION,studyVersion:LYAPUNOV_STUDY_VERSION,
  object:"scalar_feedback_driven_by_trust_decision_errors",configuration:c,options:o,
  nominal:{rho:Math.abs(1-o.gain),nominal_asymptotically_stable:o.gain>0&&o.gain<2,
   equilibrium_requires_zero_disturbance:true,unforced_lyapunov_factor:(1-o.gain)**2},
  series,trace:evaluated[0].data,summary,comparison,
  runs:evaluated.map(x=>({run:x.run,metrics:Object.fromEntries(METHODS.map(m=>[m,x.data[m].metrics]))})),
  independence:"Independent pseudo-random seeds by run index; within-run paired methods",
  limits:"Sampled bounds use observed disturbances only. Asymptotic stability of full IMAS, learned trust, and arbitrary switching attacks is NOT established."
 };
}

export function runLyapunovStudy(config,options,onProgress=()=>{}){
 const {config:c,options:o}=validateLyapunovOptions(config,options),runs=[];
 const dynamicConfig={...c,attack_schedule:o.phases,paired_exogenous_events:true};
 for(let i=0;i<o.runs;i++){
  const run=simulateRun(dynamicConfig,"dynamic",i,0,false);
  runs.push(run.trajectory);
  onProgress(i+1,o.runs);
 }
 return buildLyapunovResult(runs,c,o);
}
