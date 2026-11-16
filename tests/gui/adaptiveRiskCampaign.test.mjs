import test from "node:test";
import assert from "node:assert/strict";
import {
 riskCampaignDesign,riskCampaignConfig,riskCampaignAssertPair,
 riskCampaignValidateDesign,RISK_CAMPAIGN_VERSION
} from "../../gui/src/adaptiveRiskCampaign.js";
import {runAdaptiveSingle} from "../../gui/src/adaptiveExperiment.js";

test("risk campaign freezes distinct original/online alpha and fresh seeds",()=>{
 const plan=riskCampaignDesign();
 assert.equal(plan.protocol,RISK_CAMPAIGN_VERSION);
 assert.deepEqual(plan.comparisonModes,["risk_aware","adaptive"]);
 assert.equal(plan.stages.exploratory.length,72);
 assert.equal(plan.stages.confirmatory.length,12);
 assert.equal(plan.stages.smoke.length,3);
 const all=[...plan.stages.exploratory,...plan.stages.confirmatory,...plan.stages.smoke];
 assert.equal(new Set(all.map(c=>c.seed)).size,87);
 assert.ok(all.every(c=>c.seed>0&&c.seed<2147483647));
 assert.deepEqual(riskCampaignValidateDesign(plan),plan);
 const changed=structuredClone(plan);changed.design.confirmatoryRuns=15;
 assert.throws(()=>riskCampaignValidateDesign(changed),/protocol changed/);
});
test("risk alternative changes only alpha and its own adaptive output on exactly paired E1 events",()=>{
 const c=riskCampaignDesign().stages.smoke[0];
 const {config,risk,legacy}=riskCampaignConfig(c);
 assert.equal(risk.alphaMode,"risk_aware");assert.equal(legacy.alphaMode,"adaptive");
 assert.equal(risk.runs,2);assert.equal(legacy.runs,2);
 for(let run=0;run<c.runs;run++){
  const a=runAdaptiveSingle(config,risk,run),b=runAdaptiveSingle(config,legacy,run);
  const pair=riskCampaignAssertPair(a,b);
  assert.equal(pair.run,run);
  assert.ok(Number.isFinite(pair.dRiskLegacy));
  assert.ok(Number.isFinite(pair.dRiskCombined));
  assert.ok(Number.isFinite(pair.meanAlphaRisk));
  assert.ok(Number.isFinite(pair.meanAlphaLegacy));
  assert.ok(pair.meanRiskPairs>=0);
 }
});
test("campaign comparison detects accidental leakage of scenario events between methods",()=>{
 const cell=riskCampaignDesign().stages.smoke[1];
 const {config,risk,legacy}=riskCampaignConfig(cell);
 const runA=runAdaptiveSingle(config,risk,0),runB=runAdaptiveSingle(config,legacy,0);
 runB.trajectory[0].trimmed_unweighted+=.01;
 assert.throws(()=>riskCampaignAssertPair(runA,runB),/baseline mismatch/);
});
