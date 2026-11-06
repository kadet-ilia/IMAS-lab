import test from "node:test";
import assert from "node:assert/strict";
import {wilson95,mean95,holmAdjusted,pairedSignFlipP} from "./statistics2027.js";
import {rng,executeStudy} from "./research2027.js";
import {planPairedBinaryPrecision,worstCaseWilsonPrecision,auditResearchInference} from "./researchStatisticalAudit.js";

test("UP-36 numerical coverage: Wilson-95 under binomial Monte Carlo reference",()=>{
 const r=rng(20261126),R=100,trials=1200;
 for(const p of [.05,.1,.5,.9,.95]){
  let enclosed=0;
  for(let i=0;i<trials;i++){
   let successes=0;
   for(let j=0;j<R;j++)if(r.random()<p)successes++;
   const ci=wilson95(successes,R);
   if(ci.lower<=p&&p<=ci.upper)enclosed++;
  }
  const coverage=enclosed/trials;
  assert.ok(coverage>.90&&coverage<.99,"p="+p+" empirical="+coverage);
 }
});
test("UP-36 numerical coverage: normal-approximation mean CI at R=100",()=>{
 const r=rng(20261127),R=100,trials=1000;let covered=0;
 for(let i=0;i<trials;i++){
  const values=Array.from({length:R},()=>r.normal());
  const ci=mean95(values);
  if(ci.lower<=0&&ci.upper>=0)covered++;
 }
 const observed=covered/trials;
 assert.ok(observed>.91&&observed<.99,"normal mean CI coverage="+observed);
});
test("UP-36 Holm FWER under a complete null with 16 uniform p-values",()=>{
 const r=rng(20261128),trials=6000;let falseFamilyDiscoveries=0;
 for(let i=0;i<trials;i++){
  const p=Array.from({length:16},()=>r.random());
  const adjusted=holmAdjusted(p);
  if(adjusted.some(x=>x<.05))falseFamilyDiscoveries++;
 }
 const fwer=falseFamilyDiscoveries/trials;
 assert.ok(fwer>=0&&fwer<.075,"unexpected FWER "+fwer);
});
test("UP-36 exact paired sign-flip extreme tables and prospective power assumptions",()=>{
 const z=pairedSignFlipP(Array(9).fill(1));
 assert.equal(z.method,"exact-paired-sign-flip");
 assert.ok(Math.abs(z.p-2/512)<1e-15);
 const plan=planPairedBinaryPrecision({minimumEffect:.1,discordance:.5});
 assert.ok(plan.requiredPairs>150&&plan.requiredPairs<1000);
 const largeEffect=planPairedBinaryPrecision({minimumEffect:.2,discordance:.5});
 assert.ok(largeEffect.requiredPairs<plan.requiredPairs);
 assert.throws(()=>planPairedBinaryPrecision({minimumEffect:.8,discordance:.4}),/Δ/);
 assert.ok(worstCaseWilsonPrecision(.05).requiredIndependentRuns>300);
});
for(const id of ["probgraph","cascade"]){
 test("UP-36 audit rejects altered Holm families and flags unverified assumptions: "+id,()=>{
  const result=executeStudy(id,{runs:30,seed:id==="probgraph"?20261129:20261130,
   ...(id==="probgraph"?{agents:9,steps:4,edgeProbability:.3}:{} )});
  const audit=result.statisticsAudit;
  assert.equal(audit.valid,true);
  assert.equal(audit.modelExternallyCalibrated,false);
  assert.equal(audit.independentlyScientificallyAccepted,false);
  assert.ok(audit.holmFamilyChecked>0);
  assert.ok(audit.warnings.some(x=>x.includes("обменности")));
  const changed=structuredClone(result);
  if(id==="probgraph")changed.pairedEffects[0].pHolm=.1234567;
  else changed.pairedEffects[0].pHolmDamage=.1234567;
  assert.equal(auditResearchInference(id,changed.config,changed).valid,false);
 });
}
test("UP-36 Petri report distinguishes formal bounded search from sampling uncertainty",()=>{
 const c={agents:7,steps:5,stateLimit:100,criticalCount:7,isolationPolicy:0};
 const result=executeStudy("petri",c);
 assert.equal(result.statisticsAudit.valid,true);
 assert.equal(result.statisticsAudit.holmFamilyChecked,0);
 assert.equal(result.statisticsAudit.illustrativeWilsonRunRequirement,null);
 assert.ok(result.statisticsAudit.warnings.some(x=>x.includes("не является p-значением")));
});
