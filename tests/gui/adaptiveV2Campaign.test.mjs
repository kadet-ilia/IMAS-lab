import test from "node:test";
import assert from "node:assert/strict";
import {v2CampaignDesign,validateV2CampaignDesign,v2CampaignParameters,
 V2_CAMPAIGN_MODES,V2_STAGE_COUNTS}
 from "../../gui/src/adaptiveV2CampaignProtocol.js";
import {runAdaptiveSingle} from "../../gui/src/adaptiveExperiment.js";

const design=v2CampaignDesign();
test("v2 preregistration has exactly 48 new train and 12 disjoint OOD heldout cells",()=>{
 assert.equal(design.protocol,"e1a-v2-huber-regret-factorial-1.0.0");
 assert.equal(design.stages.train.length,48);
 assert.equal(design.stages.holdout.length,12);
 assert.equal(design.stages.smoke.length,3);
 assert.equal(V2_STAGE_COUNTS.train.runs,12);
 assert.equal(V2_STAGE_COUNTS.holdout.runs,60);
 assert.deepEqual([...new Set(design.stages.train.map(x=>x.strategy))],
  ["coordinated","pulsed","stealth"]);
 assert.ok(design.stages.holdout.every(x=>x.law==="linear"&&x.schedule==="double"));
 assert.equal(new Set([...design.stages.train,...design.stages.holdout,
  ...design.stages.smoke].map(x=>x.seed)).size,63);
 assert.equal(new Set(design.stages.train.map(x=>x.id)).size,48);
 assert.equal(new Set(design.stages.holdout.map(x=>x.id)).size,12);
});

test("v2 campaign options only allow frozen cells and five declared policies",()=>{
 for(const stage of ["train","holdout","smoke"]){
  const c=design.stages[stage][0];
  for(const mode of V2_CAMPAIGN_MODES){
   const {core,options}=v2CampaignParameters(c,mode);
   assert.equal(core.n_agents,30);
   assert.equal(core.n_byzantine,c.f);
   assert.equal(core.n_steps,48);
   assert.equal(core.network_enabled,false);
   assert.equal(options.comparisonMode,"estimator_only");
   assert.equal(options.evidenceModel,c.evidence);
   assert.equal(options.decisionRefusalPenalty,1);
   assert.equal(options.alphaMode,mode.startsWith("regime_aware_v2")?
    "regime_aware_v2":mode);
  }
 }
 const changed=structuredClone(design);
 changed.stages.holdout[0].seed=999;
 assert.throws(()=>validateV2CampaignDesign(changed),/mutated/);
 assert.throws(()=>v2CampaignParameters(design.stages.train[0],"oracle"),/Unknown/);
 assert.throws(()=>v2CampaignParameters({...design.stages.train[0],seed:2},
  "adaptive"),/unfrozen/);
});

test("v2 smoke simulations preserve all four E1 intermediates and the paired attack stream",()=>{
 for(const c of design.stages.smoke){
  const simulations=V2_CAMPAIGN_MODES.map(mode=>{
   const x=v2CampaignParameters(c,mode);
   return runAdaptiveSingle(x.core,x.options,0);
  });
  for(let i=1;i<simulations.length;i++){
   for(let t=0;t<48;t++){
    const a=simulations[0].trajectory[t],b=simulations[i].trajectory[t];
    for(const key of ["step","truth","attack_intensity","proposed_robust",
     "trimmed_unweighted","adaptive_unweighted","adaptive_weighted"])
     assert.ok(Object.is(a[key],b[key]),c.id+" mode "+i+" key "+key+" tick "+t);
   }
  }
  assert.ok(simulations.every(x=>x.metrics.length===5));
 }
});
