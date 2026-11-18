import test from "node:test";
import assert from "node:assert/strict";
import {campaignAttackSchedule} from "../../gui/src/adaptiveCampaignProtocol.js";
import {projectAdaptiveAttackExposure} from "../../gui/src/adaptiveExposureDiagnostics.js";

const config=(law,schedule,strategy,period=8,duty=2)=>({
 scenario:"dynamic",phases:campaignAttackSchedule(law,schedule),
 attackStrategy:strategy,attackPeriod:period,attackDuty:duty,
 reputationWarmup:10
});
test("exposure preview detects valid but completely non-overlapping periodic phases",()=>{
 const x=projectAdaptiveAttackExposure(config("constant","double","pulsed",16,4),48);
 assert.equal(x.nominalActiveSteps,16);
 assert.equal(x.effectiveActiveSteps,0);
 assert.equal(x.suppressedActiveSteps,16);
 assert.equal(x.zeroEffectiveExposure,true);
 assert.ok(x.points.every(p=>p.actualIntensity===0));
});
test("pulsed behavior and pulsed intensity remain independent gates",()=>{
 const a=projectAdaptiveAttackExposure(config("constant","double","pulsed",8,2),48);
 const b=projectAdaptiveAttackExposure(config("pulsed","double","pulsed",8,2),48);
 assert.equal(a.effectiveActiveSteps,4);
 assert.equal(b.effectiveActiveSteps,4);
 assert.equal(a.nominalActiveSteps,16);
 assert.equal(b.nominalActiveSteps,8);
 assert.ok(a.points.some(x=>x.intensity>0&&x.actualIntensity===0));
});
test("non-periodic behavior uses all active windows except reputation warmup",()=>{
 const a=projectAdaptiveAttackExposure(config("constant","single","coordinated"),48);
 assert.equal(a.nominalActiveSteps,16);
 assert.equal(a.effectiveActiveSteps,16);
 const b=projectAdaptiveAttackExposure(config("constant","single","reputation_boost"),48);
 assert.equal(b.effectiveActiveSteps,14);
 assert.equal(b.zeroEffectiveExposure,false);
 assert.deepEqual(b.points.map(x=>x.step).filter((t,i)=>b.points[i].actualActive),
  Array.from({length:14},(_,i)=>i+11));
});
test("exposure preview rejects invalid dynamic configurations and leaves static scenarios alone",()=>{
 assert.equal(projectAdaptiveAttackExposure({scenario:"static_bias"},48),null);
 assert.throws(()=>projectAdaptiveAttackExposure(config("constant","single","pulsed"),0),/horizon/);
 assert.throws(()=>projectAdaptiveAttackExposure({...config("constant","double","pulsed"),attackDuty:20},48),/temporal/);
 assert.throws(()=>projectAdaptiveAttackExposure({...config("constant","single","coordinated"),attackStrategy:"oracle"},48),/unknown/);
});
