import test from "node:test";
import assert from "node:assert/strict";
import {
 E1A_CAMPAIGN_VERSION,campaignDesign,campaignAttackSchedule,
 campaignCellId,campaignConfiguration,campaignStageForStep,
 validateCampaignDesign,E1A_CAMPAIGN_LAWS,E1A_CAMPAIGN_F
} from "./adaptiveCampaignProtocol.js";
import {analyzeCampaignCell,summarizeCampaignStage,phaseMetricsForRun} from "./adaptiveCampaignAnalysis.js";
import {runAdaptiveStudy} from "./adaptiveExperiment.js";
import {attackIntensityAt} from "./attackProfiles.js";

test("frozen campaign is 6x3x4=72 plus twelve fixed, truly disjoint-seed validation cells",()=>{
 const plan=campaignDesign();
 assert.equal(plan.protocol,E1A_CAMPAIGN_VERSION);
 assert.equal(plan.cells.exploratory.length,72);
 assert.equal(plan.cells.confirmatory.length,12);
 assert.equal(plan.cells.smoke.length,3);
 const ids=new Set(plan.cells.exploratory.map(x=>x.id));
 assert.equal(ids.size,72);
 for(const x of plan.cells.confirmatory)assert.ok(ids.has(x.id));
 const all=[...plan.cells.exploratory,...plan.cells.confirmatory,...plan.cells.smoke];
 assert.equal(new Set(all.map(x=>x.seed)).size,87);
 for(const x of all){
  assert.ok(x.f<15);
  assert.equal(x.id,campaignCellId(x.law,x.schedule,x.f));
  assert.ok(Number.isInteger(x.seed)&&x.seed>0&&x.seed<=2147483647);
  const {config,options}=campaignConfiguration(x);
  assert.equal(config.seed,x.seed);
  assert.equal(config.n_agents,30);
  assert.equal(options.runs,x.runs);
  assert.equal(options.comparisonMode,"estimator_only");
  assert.equal(options.attackStrategy,"legacy");
  assert.equal(options.evidenceModel,"legacy");
 }
 validateCampaignDesign(plan);
 const tampered=structuredClone(plan);
 tampered.cells.confirmatory[0].f=9===tampered.cells.confirmatory[0].f?12:9;
 assert.throws(()=>validateCampaignDesign(tampered),/Tampered/);
});
test("all 72 temporal attack profiles reconcile with prespecified three windows and durations",()=>{
 for(const law of E1A_CAMPAIGN_LAWS){
  for(const schedule of ["single","sustained","double"]){
   const phases=campaignAttackSchedule(law,schedule);
   assert.equal(phases[0].start,1);
   let steps=0,active=0;
   for(let t=1;t<=48;t++){
    const intensity=attackIntensityAt(t,phases,48);
    assert.ok(intensity>=0&&intensity<=5);
    const stage=campaignStageForStep(t,schedule,law);
    assert.ok(["pre","active","intermission","recovery"].includes(stage));
    assert.equal(stage==="active",intensity>0);
    steps++;
    if(intensity>0)active++;
   }
   assert.equal(steps,48);
   if(law!=="pulsed"){
    assert.equal(active, schedule==="single"?16:schedule==="sustained"?36:16);
   }else assert.ok(active>0&&active<(schedule==="sustained"?36:16));
  }
 }
});
test("fixed-cell per-run primary differences reconcile exactly with aggregate RMSE and phase coverage",()=>{
 const cell=campaignDesign().cells.smoke[0];
 const {config,options}=campaignConfiguration(cell);
 const run=runAdaptiveStudy(config,options);
 const analysis=analyzeCampaignCell(run,cell);
 assert.equal(analysis.differences.runs.length,2);
 assert.ok(Number.isFinite(analysis.meanDeltaRmse));
 for(const replicate of analysis.differences.runs){
  assert.ok(Math.abs(replicate.difference-
   (replicate.adaptive_rmse-replicate.baseline_rmse))<1e-12);
 }
 const phases=phaseMetricsForRun(run.runs[0],cell,run.configuration.desired_action);
 for(const method of ["adaptive_robust","trimmed_unweighted"]){
  assert.equal(["pre","active","intermission","recovery"].reduce((n,key)=>n+phases[method][key].steps,0),48);
 }
 assert.ok(analysis.phaseSummary.adaptive_robust.active.steps>0);
 assert.ok(analysis.differences.bootstrapCi95[0]<=analysis.differences.bootstrapCi95[1]);
 assert.ok(analysis.differences.signFlipP>=0&&analysis.differences.signFlipP<=1);
});
test("campaign smoke analysis is complete, paired, seeded and protected against dropped or duplicate cells",()=>{
 const cells=campaignDesign().cells.smoke;
 const results=cells.map(cell=>{
  const {config,options}=campaignConfiguration(cell);
  return analyzeCampaignCell(runAdaptiveStudy(config,options),cell);
 });
 const summary=summarizeCampaignStage("smoke",results);
 const reversed=summarizeCampaignStage("smoke",[...results].reverse());
 assert.deepEqual(summary,reversed,"order of completed factorial cells must not change inference");
 assert.equal(summary.cells,3);
 assert.equal(summary.pairedRuns,6);
 assert.equal(summary.conditions.length,3);
 assert.equal(summary.possibleHolmDiscoveries,
  summary.conditions.filter(x=>x.holmAcrossCellsP<0.05).length);
 for(const p of summary.conditions){
  assert.ok(p.holmAcrossCellsP>=p.signFlipP);
  assert.ok(Number.isFinite(p.bootstrapLower95)&&Number.isFinite(p.bootstrapUpper95));
 }
 assert.throws(()=>summarizeCampaignStage("smoke",results.slice(1)),/incomplete/i);
 assert.throws(()=>summarizeCampaignStage("smoke",[results[0],results[0],results[2]]),/Duplicate/);
});
test("scientific refusal or phase mismatch cannot silently contaminate a cell summary",()=>{
 const cell=campaignDesign().cells.smoke[0];
 const {config,options}=campaignConfiguration(cell);
 const record=runAdaptiveStudy(config,options);
 const invalid=structuredClone(record);
 invalid.runs[0].trajectory[10].attack_intensity=0;
 assert.throws(()=>analyzeCampaignCell(invalid,cell),/Attack timing/);
 const partial=structuredClone(record);
 partial.completedRuns=1;partial.partial=true;
 assert.throws(()=>analyzeCampaignCell(partial,cell),/Incomplete/);
});
