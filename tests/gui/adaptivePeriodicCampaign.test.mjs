import test from "node:test";
import assert from "node:assert/strict";
import {
 periodicCampaignDesign,validatePeriodicCampaignDesign,periodicCellOptions,
 E1A_PERIODIC_VERSION,PERIODIC_MODES
} from "../../gui/src/adaptivePeriodicCampaignProtocol.js";
import {runAdaptiveSingle} from "../../gui/src/adaptiveExperiment.js";

const design=periodicCampaignDesign();
const finite=Number.isFinite;
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-10, a+" != "+b);

test("M5-B fixed design contains 64 pulsed strategies and 16 nonduplicated controls",()=>{
 assert.equal(design.protocol,E1A_PERIODIC_VERSION);
 const explore=design.stages.exploratory;
 assert.equal(explore.length,80);
 assert.equal(explore.filter(x=>x.strategy==="pulsed").length,64);
 assert.equal(explore.filter(x=>x.strategy==="coordinated").length,16);
 assert.equal(new Set(explore.map(x=>x.id)).size,80);
 assert.ok(explore.filter(x=>x.strategy==="coordinated").every(x=>
  x.period===null&&x.attackDuty===null&&x.dutyFraction===null));
 assert.ok(explore.filter(x=>x.strategy==="pulsed").every(x=>
  x.attackDuty>0&&x.attackDuty<=x.period));
 assert.deepEqual([...new Set(explore.map(x=>x.law))],["constant","pulsed"]);
 assert.deepEqual([...new Set(explore.map(x=>x.schedule))],["single","double"]);
 assert.deepEqual([...new Set(explore.map(x=>x.correlation))],[0,0.7]);
 assert.deepEqual([...new Set(explore.map(x=>x.f))],[6,12]);
});

test("M5-B holds out disjoint seeds and unseen linear/sustained attack condition",()=>{
 const holdout=design.stages.confirmatory;
 assert.equal(holdout.length,16);
 assert.ok(holdout.every(x=>x.law==="linear"&&x.schedule==="sustained"&&
  x.strategy==="pulsed"&&x.runs===80));
 assert.equal(new Set(holdout.map(x=>x.id)).size,16);
 const all=Object.values(design.stages).flat();
 assert.equal(new Set(all.map(x=>x.seed)).size,99);
 assert.ok(all.every(x=>x.seed>0&&x.seed<=2147483647));
 const tampered=structuredClone(design);
 tampered.stages.confirmatory[0].seed++;
 assert.throws(()=>validatePeriodicCampaignDesign(tampered),/mutated/);
});

test("M5-B model strictly separates intensity profile from strategy period and duty",()=>{
 const a=design.stages.exploratory.find(x=>x.strategy==="pulsed"&&x.law==="pulsed");
 const b=design.stages.exploratory.find(x=>x.strategy==="pulsed"&&x.law==="constant"&&
  x.f===a.f&&x.schedule===a.schedule&&x.correlation===a.correlation&&
  x.period===a.period&&x.dutyFraction===a.dutyFraction);
 assert.ok(a&&b);
 const optsA=periodicCellOptions(a,"adaptive").options;
 const optsB=periodicCellOptions(b,"adaptive").options;
 assert.equal(optsA.attackStrategy,"pulsed");
 assert.equal(optsB.attackStrategy,"pulsed");
 assert.equal(optsA.attackDuty,optsB.attackDuty);
 assert.notDeepEqual(optsA.phases,optsB.phases);
 assert.equal(optsA.evidenceModel,"correlated_witnesses");
 assert.throws(()=>periodicCellOptions(a,"oracle"),/Unknown/);
 const invalid={...a,attackDuty:a.attackDuty+1};
 assert.throws(()=>periodicCellOptions(invalid,"adaptive"),/Invalid/);
});

test("M5-B smoke simulations preserve exogenous states and all historical E1 controls",()=>{
 for(const cell of design.stages.smoke){
  const runs=PERIODIC_MODES.map(mode=>{
   const {config,options}=periodicCellOptions(cell,mode);
   return runAdaptiveSingle(config,options,0);
  });
  assert.equal(runs.length,3);
  for(let i=1;i<runs.length;i++){
   assert.equal(runs[0].trajectory.length,48);
   for(let t=0;t<48;t++){
    const a=runs[0].trajectory[t],b=runs[i].trajectory[t];
    for(const field of ["step","truth","attack_intensity","trimmed_unweighted",
     "proposed_robust","adaptive_unweighted","adaptive_weighted"])
     assert.ok(Object.is(a[field],b[field]),field+" at step "+t);
   }
   for(const method of ["trimmed_unweighted","proposed_robust"]){
    near(runs[0].metrics.find(x=>x.method===method).rmse,
     runs[i].metrics.find(x=>x.method===method).rmse);
   }
  }
  for(const run of runs){
   const accepted=run.metrics.find(x=>x.method==="adaptive_robust");
   assert.ok(finite(accepted.rmse));
   assert.ok(finite(accepted.unconditional_decision_loss));
  }
 }
});
