/**
 * E1-A campaign evidence layer: paired run-level data, phase-scoped metrics,
 * stratified bootstrap across fixed cells, and Holm control per campaign stage.
 * No post hoc condition selection is permitted.
 */
import {campaignDesign,campaignStageForStep,E1A_CAMPAIGN_VERSION} from "./adaptiveCampaignProtocol.js";
import {bootstrap95,pairedSignFlipP,holmAdjusted} from "./statistics2027.js";

export const E1A_CAMPAIGN_ANALYSIS_VERSION="e1a-analysis-1.0.0";
export const E1A_CAMPAIGN_PRIMARY="adaptive_robust";
export const E1A_CAMPAIGN_CONTROL="trimmed_unweighted";
export const E1A_CAMPAIGN_PHASES=Object.freeze(["pre","active","intermission","recovery"]);
const finite=Number.isFinite;
const average=a=>a.reduce((s,v)=>s+v,0)/a.length;
const near=(a,b)=>Math.abs(a-b)<=1e-10*Math.max(1,Math.abs(a),Math.abs(b));
const seeded=seed=>{
 let s=(seed>>>0)||1;
 return()=>{s^=s<<13;s^=s>>>17;s^=s<<5;return (s>>>0)/4294967296;};
};
function quantile(values,p){
 const a=[...values].sort((x,y)=>x-y);
 const x=(a.length-1)*p,k=Math.floor(x);
 return a[k]+(a[Math.min(a.length-1,k+1)]-a[k])*(x-k);
}
export function phaseMetricsForRun(run,cell,truth){
 if(!Array.isArray(run?.trajectory)||!run.trajectory.length||!finite(truth))
  throw Error("Phase analysis requires trajectory and finite truth");
 const methodIds=["trimmed_unweighted","proposed_robust","adaptive_unweighted",
  "adaptive_weighted","adaptive_robust"];
 const summary=Object.fromEntries(methodIds.map(method=>[method,
  Object.fromEntries(E1A_CAMPAIGN_PHASES.map(phase=>[phase,{
   total:0,accepted:0,correct:0,sumSquared:0,sumAbsolute:0
  }]))]));
 for(const [index,row] of run.trajectory.entries()){
  if(row.step!==index+1)throw Error("Missing or reordered trajectory step");
  const phase=campaignStageForStep(row.step,cell.schedule,cell.law);
  const modelActive=row.attack_intensity>0;
  if(modelActive!==(phase==="active"))
   throw Error("Attack timing classification disagrees with E1 simulator");
  for(const method of methodIds){
   const out=summary[method][phase];out.total++;
   if(!finite(row[method]))continue;
   const error=row[method]-truth;
   out.accepted++;
   out.sumSquared+=error*error;
   out.sumAbsolute+=Math.abs(error);
  }
 }
 const converted=Object.fromEntries(methodIds.map(method=>[method,
  Object.fromEntries(E1A_CAMPAIGN_PHASES.map(phase=>{
   const x=summary[method][phase];
   return [phase,{steps:x.total,accepted:x.accepted,
    coverage:x.total?x.accepted/x.total:null,
    rmse:x.accepted?Math.sqrt(x.sumSquared/x.accepted):null,
    mae:x.accepted?x.sumAbsolute/x.accepted:null}];
  }))
 ]));
 const fullMethod=run.metrics.find(m=>m.method===E1A_CAMPAIGN_PRIMARY);
 const reconstructed=Object.values(summary[E1A_CAMPAIGN_PRIMARY]);
 const totalAccepted=reconstructed.reduce((n,x)=>n+x.accepted,0);
 const totalSquared=reconstructed.reduce((n,x)=>n+x.sumSquared,0);
 if(totalAccepted&&(!fullMethod||!near(
   Math.sqrt(totalSquared/totalAccepted),fullMethod.rmse
 )))throw Error("Campaign phase RMSE does not reconcile with experiment RMSE");
 return converted;
}
export function analyzeCampaignCell(record,cell){
 if(record?.partial||record?.completedRuns!==cell?.runs||
  !Array.isArray(record.runs)||record.runs.length!==cell.runs)
  throw Error("Incomplete campaign cell "+cell?.id);
 const primary=[],phaseByRun=[];
 for(let i=0;i<record.runs.length;i++){
  const run=record.runs[i];
  if(run.run!==i)throw Error("Run order mismatch in "+cell.id);
  const a=run.metrics.find(row=>row.method===E1A_CAMPAIGN_PRIMARY),
   b=run.metrics.find(row=>row.method===E1A_CAMPAIGN_CONTROL);
  if(!a||!b||!finite(a.rmse)||!finite(b.rmse))
   throw Error("Campaign primary RMSE is unavailable; refusal handling must be explicit");
  const phases=phaseMetricsForRun(run,cell,record.configuration.desired_action);
  const diff=a.rmse-b.rmse;
  primary.push({run:i,adaptive_rmse:a.rmse,baseline_rmse:b.rmse,difference:diff,
   adaptive_coverage:a.decision_coverage,baseline_coverage:b.decision_coverage});
  phaseByRun.push(phases);
 }
 const diffs=primary.map(x=>x.difference);
 const estimate=average(diffs);
 const bootstrap=bootstrap95(diffs,average,cell.seed^0x57E0,499);
 const sign=pairedSignFlipP(diffs,cell.seed^0x4731,4095);
 const phaseSummary=Object.fromEntries(
  [E1A_CAMPAIGN_PRIMARY,E1A_CAMPAIGN_CONTROL].map(method=>[method,
   Object.fromEntries(E1A_CAMPAIGN_PHASES.map(phase=>{
    const xs=phaseByRun.map(x=>x[method][phase]),
     measured=xs.filter(x=>finite(x.rmse)),
     totals=xs.map(x=>x.steps);
    return [phase,{steps:totals[0]??0,
     meanRmse:measured.length?average(measured.map(x=>x.rmse)):null,
     validRuns:measured.length,coverage:xs.every(x=>finite(x.coverage))?
      average(xs.map(x=>x.coverage)):null}];
   }))
  ])
 );
 return {
  campaignCellId:cell.id,stage:cell.stage,law:cell.law,schedule:cell.schedule,
  f:cell.f,N:record.configuration.n_agents,T:record.configuration.n_steps,
  seed:cell.seed,runs:cell.runs,adaptiveMeanRmse:average(primary.map(x=>x.adaptive_rmse)),
  trimmedMeanRmse:average(primary.map(x=>x.baseline_rmse)),
  meanDeltaRmse:estimate,practicalThreshold:0.01,
  practicalDirection:estimate<=-0.01?"benefit_at_least_0.01":
   estimate>=0.01?"harm_at_least_0.01":"smaller_than_0.01_magnitude",
  differences:{runs:primary,mean:estimate,bootstrapCi95:[bootstrap.lower,bootstrap.upper],
   bootstrapMethod:bootstrap.method,bootstrapReplicates:bootstrap.replicates,
   signFlipP:sign.p,signFlipMethod:sign.method,
   wins:diffs.filter(x=>x<0).length,losses:diffs.filter(x=>x>0).length,
   ties:diffs.filter(x=>x===0).length},
  phaseSummary
 };
}
/** Summary across prespecified fixed cells; no across-method multiplicity re-use. */
export function summarizeCampaignStage(stage,cellResults,{bootstrapReplicates=499}={}){
 if(!["smoke","exploratory","confirmatory"].includes(stage))
  throw Error("Unknown campaign stage");
 const design=campaignDesign(),expected=design.cells[stage];
 if(!Array.isArray(cellResults)||cellResults.length!==expected.length)
  throw Error("Campaign stage incomplete: expected "+expected.length+" cells");
 const lookup=new Map(cellResults.map(x=>[x.campaignCellId,x]));
 if(lookup.size!==cellResults.length)
  throw Error("Duplicate scientific campaign cell");
 const ordered=expected.map(cell=>{
  const x=lookup.get(cell.id);
  if(!x||x.seed!==cell.seed||x.runs!==cell.runs||x.stage!==stage)
   throw Error("Campaign cell missing or incompatible: "+cell.id);
  return x;
 });
 const p=ordered.map(x=>x.differences.signFlipP);
 if(p.some(v=>!finite(v)))throw Error("Nonfinite campaign randomization p-value");
 const adjusted=holmAdjusted(p);
 const conditions=ordered.map((x,i)=>({
  id:x.campaignCellId,law:x.law,schedule:x.schedule,f:x.f,runs:x.runs,seed:x.seed,
  adaptiveMeanRmse:x.adaptiveMeanRmse,trimmedMeanRmse:x.trimmedMeanRmse,
  meanDeltaRmse:x.meanDeltaRmse,practicalDirection:x.practicalDirection,
  bootstrapLower95:x.differences.bootstrapCi95[0],
  bootstrapUpper95:x.differences.bootstrapCi95[1],
  signFlipP:x.differences.signFlipP,holmAcrossCellsP:adjusted[i],
  wins:x.differences.wins,losses:x.differences.losses
 }));
 const input=ordered.map(x=>x.differences.runs.map(y=>y.difference));
 const point=average(ordered.map(x=>x.meanDeltaRmse));
 if(!Number.isInteger(bootstrapReplicates)||bootstrapReplicates<100||
  bootstrapReplicates>5000)throw Error("Bootstrap replicates must be 100..5000");
 const random=seeded(stage==="confirmatory"?0x19AAC:0xF434);
 const samples=[];
 // Stratified paired bootstrap: independently resample whole RUN differences
 // within each fixed factorial cell, never individual time ticks.
 for(let b=0;b<bootstrapReplicates;b++){
  let across=0;
  for(const diffs of input){
   let inside=0;
   for(let j=0;j<diffs.length;j++)inside+=diffs[Math.floor(random()*diffs.length)];
   across+=inside/diffs.length;
  }
  samples.push(across/input.length);
 }
 const summary={
  stage,protocol:E1A_CAMPAIGN_VERSION,analysis:E1A_CAMPAIGN_ANALYSIS_VERSION,
  cells:conditions.length,pairedRuns:conditions.reduce((n,x)=>n+x.runs,0),
  primary:"mean independent-run RMSE(adaptive_robust) - RMSE(trimmed_unweighted)",
  equalCellWeightedMeanDeltaRmse:point,
  stratifiedBootstrapCi95:[quantile(samples,.025),quantile(samples,.975)],
  stratifiedBootstrapReplicates:bootstrapReplicates,
  benefits:conditions.filter(x=>x.meanDeltaRmse<0).length,
  harms:conditions.filter(x=>x.meanDeltaRmse>0).length,
  ties:conditions.filter(x=>x.meanDeltaRmse===0).length,
  benefitAtLeast001:conditions.filter(x=>x.meanDeltaRmse<=-0.01).length,
  harmAtLeast001:conditions.filter(x=>x.meanDeltaRmse>=0.01).length,
  possibleHolmDiscoveries:conditions.filter(x=>x.holmAcrossCellsP<0.05).length,
  inference:"Simulation sampling uncertainty only; stage fixed cells, synthetic threat model; bootstrap CIs descriptive and unadjusted; sign-flip p-values require sign-exchangeability",
  conditions
 };
 return summary;
}
