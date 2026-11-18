import test from "node:test";
import assert from "node:assert/strict";
import {runAdaptiveStudy} from "../../gui/src/adaptiveExperiment.js";
import {campaignAttackSchedule} from "../../gui/src/adaptiveCampaignProtocol.js";
import {
 adaptiveRunComparisonRows,adaptivePhaseRows,adaptivePhaseComparison,
 adaptivePolicyEventRows,summarizeAdaptiveComparison,adaptiveRecordsCsv,
 adaptiveReproductionManifest,ADAPTIVE_RUN_EXPORT_FIELDS,
 ADAPTIVE_PHASE_EXPORT_FIELDS,ADAPTIVE_EVENT_EXPORT_FIELDS
} from "../../gui/src/adaptiveStudyDiagnostics.js";
import {ADAPTIVE_METHOD_IDS} from "../../gui/src/adaptiveDecisionEngine.js";

const config={n_agents:20,n_byzantine:4,n_steps:48,
 seed:20261118,trim_each_side:3,attack_start_step:9,network_enabled:false};
const params={runs:4,scenario:"dynamic",
 phases:campaignAttackSchedule("constant","double"),
 attackStrategy:"pulsed",attackPeriod:16,attackDuty:4,
 evidenceModel:"behavior_linked",trimEachSide:3,
 alphaMode:"regime_aware",regimeSelectionMode:"discrete"};
const study=runAdaptiveStudy(config,params);
const near=(a,b,epsilon=1e-10)=>assert.ok(Math.abs(a-b)<=epsilon,
 "expected "+a+" ≈ "+b);

test("M6 study comparisons reconcile against existing strong and weak controls",()=>{
 assert.equal(study.completedRuns,4);
 for(const reference of ["proposed_robust","trimmed_unweighted"]){
  const paired=adaptiveRunComparisonRows(study,reference);
  assert.equal(paired.length,4);
  const official=study.paired.find(x=>x.baseline===reference);
  const comparison=summarizeAdaptiveComparison(paired,"rmse");
  assert.equal(comparison.nPaired,official.n);
  near(comparison.meanDelta,official.mean);
  assert.equal(comparison.nRuns,study.completedRuns);
  const loss=summarizeAdaptiveComparison(paired,"unconditional_decision_loss");
  assert.equal(loss.nPaired,4);
  for(const row of paired){
   near(row.deltaRmse,row.rmseAdaptive-row.rmseBaseline);
   near(row.deltaLoss,row.lossAdaptive-row.lossBaseline);
   assert.ok(row.coverageAdaptive>=0&&row.coverageAdaptive<=1);
   assert.ok(row.coverageBaseline>=0&&row.coverageBaseline<=1);
  }
 }
 assert.throws(()=>adaptiveRunComparisonRows(study,"oracle"),/unapproved/);
 assert.throws(()=>summarizeAdaptiveComparison([], "rmse"),/completed/);
 assert.throws(()=>summarizeAdaptiveComparison([{}],"pseudo"),/unknown/);
});

test("M6 distinguishes zero realized attack from positive nominal attack and no active-phase sample",()=>{
 const paired=adaptiveRunComparisonRows(study);
 assert.ok(paired.every(x=>x.activeSteps===0));
 assert.ok(paired.every(x=>x.nominalActiveSteps===16));
 assert.ok(paired.every(x=>x.suppressedSteps===16));
 const aggregate=summarizeAdaptiveComparison(paired);
 assert.equal(aggregate.zeroAttackRuns,4);
 const phases=adaptivePhaseComparison(study);
 assert.equal(phases.length,2);
 assert.equal(phases[0].nRunsWithPhase,0);
 assert.equal(phases[0].nPairedRmse,0);
 assert.equal(phases[0].meanDeltaRmse,null);
 assert.equal(phases[0].meanDeltaLoss,null);
 assert.equal(phases[1].nRunsWithPhase,4);
 assert.equal(phases[1].nPairedRmse,4);
 const rows=adaptivePhaseRows(study);
 assert.equal(rows.length,4*ADAPTIVE_METHOD_IDS.length*2);
 assert.ok(rows.filter(x=>x.phase==="attack_active").every(x=>
  x.steps===0&&x.rmse===null&&x.unconditionalLoss===null));
 const inactive=rows.filter(x=>x.phase==="attack_inactive");
 assert.ok(inactive.every(x=>x.steps===48));
 for(const row of inactive)
  if(row.refusals===0)near(row.unconditionalLoss,row.rmse**2);
});

test("M6 complete per-run regime event trace is exported, not just first run",()=>{
 const rows=adaptivePolicyEventRows(study);
 assert.equal(rows.length,4*48);
 assert.equal(rows[0].run,0);
 assert.equal(rows.at(-1).run,3);
 assert.equal(rows.at(-1).step,48);
 assert.ok(rows.some(row=>row.selected==="proposed_robust"));
 assert.ok(rows.every(row=>row.quality===null||
  row.quality>=0&&row.quality<=1));
 assert.ok(rows.every(row=>row.combinedWeight===null||
  row.combinedWeight>=0&&row.combinedWeight<=1));
 const csv=adaptiveRecordsCsv(rows,ADAPTIVE_EVENT_EXPORT_FIELDS);
 assert.equal(csv.trimEnd().split("\n").length,1+4*48);
 assert.equal(csv.split("\n")[0].split(";").length,ADAPTIVE_EVENT_EXPORT_FIELDS.length);
});

test("M6 manifest preserves models, exact configuration, seed, phases and partial warning",()=>{
 const rows=adaptiveRunComparisonRows(study);
 const passport=adaptiveReproductionManifest(study,rows);
 assert.equal(passport.primaryControl,"proposed_robust");
 assert.equal(passport.configuration.seed,study.configuration.seed);
 assert.deepEqual(passport.options.phases,study.options.phases);
 assert.equal(passport.completedRuns,4);
 assert.equal(passport.requestedRuns,4);
 assert.deepEqual(passport.runIndices,[0,1,2,3]);
 assert.equal(passport.partial,false);
 assert.ok(passport.provenance.includes("not contain independently verified"));
 assert.ok(passport.inference.includes("Exploratory"));
 const copy=structuredClone(study);
 copy.partial=true;copy.requestedRuns=7;
 const incomplete=adaptiveReproductionManifest(copy,rows);
 assert.equal(incomplete.partial,true);
 assert.ok(incomplete.warning.includes("Incomplete"));
 assert.throws(()=>adaptiveReproductionManifest(study,[]),/inconsistent/);
});

test("M6 CSV schema is safe, flat and round-trip-friendly for negative numbers",()=>{
 const source=[{name:"simple",note:"semicolon; and \"quoted\"",value:-0.75},
  {name:"=SUM(1,2)",note:"a\nb",value:0.3},
  {name:"-cmd",note:"@evil",value:null}];
 const csv=adaptiveRecordsCsv(source,["name","note","value"]);
 assert.match(csv,/"semicolon; and ""quoted"""/);
 assert.match(csv,/"a\nb"/);
 assert.match(csv,/'=SUM/);
 assert.match(csv,/'-cmd/);
 assert.match(csv,/'@evil/);
 assert.ok(csv.includes(";-0.75"));
 assert.equal(csv.trimEnd().split("\n")[0],"name;note;value");
 assert.throws(()=>adaptiveRecordsCsv([{value:{nested:1}}],["value"]),/nested/);
 assert.throws(()=>adaptiveRecordsCsv([{value:Infinity}],["value"]),/nonfinite/);
 assert.throws(()=>adaptiveRecordsCsv([],[null]),/invalid/);
 assert.equal(adaptiveRecordsCsv(adaptiveRunComparisonRows(study),ADAPTIVE_RUN_EXPORT_FIELDS)
  .trimEnd().split("\n").length,5);
 assert.equal(adaptiveRecordsCsv(adaptivePhaseRows(study),ADAPTIVE_PHASE_EXPORT_FIELDS)
  .trimEnd().split("\n").length,1+4*5*2);
});

test("M6 diagnostic validator refuses corrupted run identity, truth and broken metrics",()=>{
 const changed=structuredClone(study);
 changed.runs[1].run=5;
 assert.throws(()=>adaptiveRunComparisonRows(changed),/identity/);
 const bad=structuredClone(study);
 bad.runs[0].trajectory[6].truth=Infinity;
 assert.throws(()=>adaptivePhaseRows(bad),/time step or attack intensity/);
 const badDecision=structuredClone(study);
 badDecision.runs[2].trajectory[0].adaptive_robust=NaN;
 assert.throws(()=>adaptivePhaseRows(badDecision),/nonfinite/);
 const missing=structuredClone(study);
 missing.runs[0].metrics.pop();
 assert.throws(()=>adaptivePhaseRows(missing),/duplicated estimator metrics/);
});
