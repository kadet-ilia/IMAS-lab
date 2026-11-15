/**
 * Deterministic small-sample E1-A pilot.
 *
 * Exploratory code/metric smoke data, NOT the prespecified 72x30 + 12x100
 * confirmatory experiment and NOT evidence of universal estimator superiority.
 * Node.js 20+; no remote data or network requirements.
 */
import {mkdirSync,writeFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import path from "node:path";
import {runAdaptiveStudy} from "../src/adaptiveExperiment.js";
import {ADAPTIVE_MODEL_VERSION} from "../src/adaptiveDecisionEngine.js";
import {ADAPTIVE_SCENARIO_VERSION} from "../src/adaptiveScenario.js";

const output=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../adaptive-results");
mkdirSync(output,{recursive:true});
const n_agents=30,T=48,trim_each_side=6,seed=20261115;
const laws=[
 {id:"constant",profile:"constant",intensity:1.8,endIntensity:1.8},
 {id:"exponential",profile:"exponential",intensity:0.2,endIntensity:3},
 {id:"hyperbolic",profile:"hyperbolic",intensity:0.2,endIntensity:3}
];
const evidence=[
 {id:"legacy",strategy:"legacy",evidenceModel:"legacy"},
 {id:"behavior",strategy:"coordinated",evidenceModel:"behavior_linked"}
];
const configs=[];
for(let lawIndex=0;lawIndex<laws.length;lawIndex++){
 const law=laws[lawIndex];
 for(const f of [6,9]){
  const phases=[
   {start:1,intensity:0,profile:"constant"},
   {start:9,intensity:law.intensity,profile:law.profile,
    ...(law.profile!=="constant"?{endIntensity:law.endIntensity}:{})},
   {start:25,intensity:0,profile:"constant"},
   {start:33,intensity:2,profile:"constant"}
  ];
  for(const ev of evidence)configs.push({
   id:law.id+"-f"+f+"-"+ev.id,law:law.id,f,phases,
   options:{runs:4,scenario:"dynamic",comparisonMode:"estimator_only",
    attackStrategy:ev.strategy,evidenceModel:ev.evidenceModel,
    coordinatedBias:2,phases},
   seed:seed+100*lawIndex+f
  });
 }
}
for(const [i,f] of [9,12].entries()){
 const law=laws[i];
 const phases=[
  {start:1,intensity:0,profile:"constant"},
  {start:9,intensity:law.intensity,profile:law.profile,
   ...(law.profile!=="constant"?{endIntensity:law.endIntensity}:{})},
  {start:25,intensity:0,profile:"constant"},
  {start:33,intensity:2,profile:"constant"}
 ];
 configs.push({
  id:"feedback-"+law.id+"-f"+f,law:law.id,f,phases,seed:seed+300+i,
  options:{runs:3,scenario:"dynamic",comparisonMode:"decision_feedback",
   attackStrategy:"coordinated",evidenceModel:"behavior_linked",
   coordinatedBias:2,phases}
 });
}
const runs=[],rows=[];
for(let i=0;i<configs.length;i++){
 const c=configs[i];
 const input={
  n_agents,n_byzantine:c.f,n_steps:T,trim_each_side,
  seed:c.seed,attack_start_step:8,network_enabled:false
 };
 const record=runAdaptiveStudy(input,c.options);
 if(record.completedRuns!==c.options.runs||record.summary.length!==5||record.partial)
  throw Error("Incomplete pilot study: "+c.id);
 const metric=m=>record.summary.find(x=>x.method===m)?.rmse?.mean;
 const control=metric("trimmed_unweighted"),weighted=metric("proposed_robust"),
  adaptive=metric("adaptive_robust");
 if(![control,weighted,adaptive].every(Number.isFinite))
  throw Error("Nonfinite pilot estimator result: "+c.id);
 const comparison=record.paired.find(x=>x.baseline==="trimmed_unweighted");
 const row={id:c.id,mode:c.options.comparisonMode,law:c.law,f:c.f,
  attackStrategy:c.options.attackStrategy,evidenceModel:c.options.evidenceModel,
  R:record.completedRuns,seed:c.seed,
  rmse_trimmed:control,rmse_combined:weighted,rmse_adaptive:adaptive,
  delta_adaptive_minus_trimmed:adaptive-control,
  wins:comparison.wins,losses:comparison.losses,
  p_sign_flip:comparison.p_value,p_holm:comparison.p_holm,
  mean_isolation_adaptive:record.summary.find(x=>x.method==="adaptive_robust")?.mean_isolated_agents?.mean??null};
 rows.push(row);
 runs.push({id:c.id,input,options:c.options,methodology:record.methodology,
  metrics:record.summary,contrasts:record.paired,
  run_metrics:record.runs.map(r=>({run:r.run,metrics:r.metrics,scenarioDiagnostics:r.scenarioDiagnostics}))});
}
const keys=Object.keys(rows[0]);
const csv=[keys.join(";"),...rows.map(row=>keys.map(key=>row[key]??"").join(";"))].join("\n")+"\n";
const report={
 experiment:"E1-A exploratory pilot",status:"exploratory; not confirmatory",
 version:{adaptive:ADAPTIVE_MODEL_VERSION,scenario:ADAPTIVE_SCENARIO_VERSION},
 design:{conditions:rows.length,pairedRunsTotal:rows.reduce((n,r)=>n+r.R,0),
  estimators:5,baselineModel:"E1",T,N:n_agents,trimEachSide:trim_each_side,
  primaryMetric:"paired mean run-level RMSE; normal CI + exploratory sign-flip Holm",
  limitation:"Small R, selected scenarios and synthetic evidence; no inferential/generalization claims"},
 summary:{
  adaptiveBetterThanTrimmed:rows.filter(r=>r.delta_adaptive_minus_trimmed<0).length,
  adaptiveWorseThanTrimmed:rows.filter(r=>r.delta_adaptive_minus_trimmed>0).length,
  ties:rows.filter(r=>r.delta_adaptive_minus_trimmed===0).length
 },
 rows,details:runs
};
writeFileSync(path.join(output,"adaptive-pilot-summary.csv"),csv,"utf8");
writeFileSync(path.join(output,"adaptive-pilot-full.json"),JSON.stringify(report,null,2)+"\n","utf8");
console.log("E1-A PILOT "+JSON.stringify({
 conditions:report.design.conditions,pairedRuns:report.design.pairedRunsTotal,
 better:report.summary.adaptiveBetterThanTrimmed,
 worse:report.summary.adaptiveWorseThanTrimmed,
 sample:rows.map(({id,delta_adaptive_minus_trimmed})=>({id,delta:+delta_adaptive_minus_trimmed.toFixed(6)}))
}));
