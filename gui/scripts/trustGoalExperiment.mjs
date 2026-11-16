#!/usr/bin/env node
/**
 * Reproducible scientific evidence for E1 "Расчёт доверия".
 * Run from the gui directory: node scripts/trustGoalExperiment.mjs
 * A quick protocol/aggregator smoke check: node scripts/trustGoalExperiment.mjs --quick
 *
 * The experiment executes the actual trustEngine.js from the GitHub branch.
 * Results are conditional on this scalar model, not an operational field trial.
 */
import {METHODS,DEFAULTS,simulateRun,TRUST_MODEL_VERSION} from "../src/trustEngine.js";
const finite=x=>Number.isFinite(x);
const mean=x=>x.reduce((v,y)=>v+y,0)/x.length;
const round=(x,d=6)=>finite(x)?Number(x.toFixed(d)):null;
const quick=process.argv.includes("--quick");
const mainRuns=quick?2:60,controlRuns=quick?2:40;
const config={...DEFAULTS,
 seed:20260716,n_agents:21,n_byzantine:4,n_steps:70,attack_start_step:11,
 trim_each_side:4,correctness_tolerance:.10,minimum_evidence_steps:8,
 paired_exogenous_events:true,isolation_cooldown_steps:100,collusion_bias:4
};
const scenarios=["static_bias","subtle_bias","on_off","collusion"];
function runSeries(scenario,f,k,R){
 const traces=[],stats=[];
 for(let i=0;i<R;i++){
  const z=simulateRun({...config,n_byzantine:f,trim_each_side:k},scenario,i,0,false);
  traces.push(z.trajectory);stats.push(z.rows[0]);
 }
 const start=config.attack_start_step;
 const metrics={};
 for(const m of METHODS){
  const samples=traces.map(trace=>{
   const e=trace.filter(t=>t.step>=start).map(row=>row[m]-config.desired_action).filter(finite);
   const T=config.n_steps-start+1;
   return {
    rmse:e.length?Math.sqrt(mean(e.map(x=>x*x))):null,
    mae:e.length?mean(e.map(Math.abs)):null,
    correct:e.filter(x=>Math.abs(x)<=config.correctness_tolerance).length/T,
    coverage:e.length/T
   };
  });
  metrics[m]=Object.fromEntries(["rmse","mae","correct","coverage"].map(k=>{
   const a=samples.map(x=>x[k]).filter(finite),mu=mean(a);
   const sd=a.length>1?Math.sqrt(a.reduce((s,x)=>s+(x-mu)**2,0)/(a.length-1)):null;
   return [k,{mean:round(mu),ci95_half_width:sd===null?null:round(1.95996398454*sd/Math.sqrt(a.length))}];
  }));
 }
 const all=traces.map(x=>x[0]);
 return {
  scenario,f,k,R,metrics,
  detection_rate:round(mean(stats.map(x=>x.detection_rate).filter(finite))),
  mean_detection_delay:round(mean(stats.map(x=>x.mean_detection_time_steps).filter(finite))),
  mean_false_isolations:round(mean(stats.map(x=>x.false_isolations))),
  sampled_absolute_errors:traces.length&&scenario==="static_bias"?
    [1,5,10,11,12,15,20,25,30,40,50,60,70].map(step=>({
     step,...Object.fromEntries(METHODS.map(m=>[m,round(mean(traces.map(tr=>Math.abs(tr[step-1][m]-config.desired_action)).filter(finite)))]))
    })):null
 };
}
const main=scenarios.map(s=>runSeries(s,4,4,mainRuns));
const noAttack=runSeries("collusion",0,4,controlRuns);
const attackedK4=runSeries("collusion",4,4,controlRuns);
const attackedK2=runSeries("collusion",4,2,controlRuns);
const degradation=Object.fromEntries(METHODS.map(m=>[m,round(attackedK4.metrics[m].rmse.mean/noAttack.metrics[m].rmse.mean)]));
const output={
 protocol:"imas-trust-goal-accuracy-resilience-v1",
 modelVersion:TRUST_MODEL_VERSION,seed:config.seed,
 limits:"One-dimensional synthetic estimates; no network losses; finite Monte Carlo; no guarantee of Lyapunov stability for the complete IMAS.",
 config,mainRuns,controlRuns,
 main,noAttack,attackedK4,attackedK2,degradation,
 interpretation:{
  goal:"Повышение устойчивости и точности коллективных оценок ИМАС при деструктивных воздействиях на часть агентов.",
  quality:"RMSE conditional on accepted decisions; correct probability is unconditional, across all attack-period ticks.",
  stability:"Relative RMSE degradation versus no-Byzantine scenario with other settings fixed.",
  isolation:"on-off attack may evade isolation even when robust aggregation keeps collective error bounded.",
  comparison:"Combination and unweighted trimming are nearly indistinguishable when k equals the number of Byzantine agents; this is not proof that trust weighting always helps."
 }
};
process.stdout.write(JSON.stringify(output,null,2)+"\n");
