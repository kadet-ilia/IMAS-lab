import test from "node:test";
import assert from "node:assert/strict";
import {fklDesign} from "../../gui/src/adaptiveFklProtocol.js";
import {E1A_FKL_FIELD_OPTIONS,validateImportedFklSummary,
 fklEffectAt,fklModeOverview} from "../../gui/src/adaptiveFklResults.js";

function fixture(stage="exploratory"){
 const design=fklDesign(),conditions=design.stages[stage].map((cell,i)=>({
  id:cell.id,stage:cell.stage,f:cell.f,k:cell.k,lag:cell.lag,R:cell.runs,
  meanCombinedRmse:0.2+0.001*i,
  meanDeltaDiscreteCombined:-0.002,
  meanDeltaBlendCombined:0.001,
  meanDeltaAdaptiveCombined:-0.003,
  meanDeltaRiskCombined:0.0005,
  ciDiscreteLow:-0.004,ciDiscreteHigh:0,
  ciBlendLow:0,ciBlendHigh:0.002,
  ciAdaptiveLow:-0.005,ciAdaptiveHigh:-0.001,
  ciRiskLow:0,ciRiskHigh:0.001
 }));
 const cellRuns=conditions.reduce((s,c)=>s+c.R,0);
 return {protocol:design.protocol,stage,cells:conditions.length,
  conditions,cellRuns,individualPolicyRuns:cellRuns*4,
  fingerprint:"a".repeat(64),sourceSha256:"b".repeat(64),
  designSha256:"c".repeat(64),lagContrasts:[]};
}

test("browser summary validates complete 80-cell exploratory protocol",()=>{
 const data=validateImportedFklSummary(fixture());
 assert.equal(data.cells,80);
 assert.equal(data.cellRuns,2400);
 assert.equal(data.individualPolicyRuns,9600);
 assert.equal(E1A_FKL_FIELD_OPTIONS.length,4);
 const effects=fklModeOverview(data,"discrete");
 assert.equal(effects.better,80);
 assert.equal(effects.worse,0);
 assert.equal(effects.meanCellWeightedDelta,-0.002);
 const point=fklEffectAt(data,12,12,4,"discrete");
 assert.equal(point.value,-0.002);
 assert.equal(point.cell.id,"f12__k12__lag4");
});

test("browser summary supports partial 16-cell OOD confirmation grid",()=>{
 const data=validateImportedFklSummary(fixture("confirmatory"));
 assert.equal(data.cells,16);
 assert.equal(data.cellRuns,1600);
 const missing=fklEffectAt(data,3,12,4,"risk");
 assert.equal(missing,null);
 const effects=fklModeOverview(data,"blend");
 assert.equal(effects.worse,16);
});

test("browser summary refuses incomplete or tampered/corrupt metadata",()=>{
 const d=fixture(),bad=structuredClone(d);
 bad.conditions.pop();
 assert.throws(()=>validateImportedFklSummary(bad),/Неполный/);
 const copy=structuredClone(d);
 copy.conditions[1].id=copy.conditions[0].id;
 assert.throws(()=>validateImportedFklSummary(copy),/Противоречивые/);
 const nums=structuredClone(d);
 nums.conditions[4].meanDeltaRiskCombined=Infinity;
 assert.throws(()=>validateImportedFklSummary(nums),/конечной/);
 const metadata=structuredClone(d);
 metadata.fingerprint="";
 assert.throws(()=>validateImportedFklSummary(metadata),/идентификаторы/);
 const count=structuredClone(d);
 count.individualPolicyRuns--;
 assert.throws(()=>validateImportedFklSummary(count),/числом прогонов/);
 assert.throws(()=>fklModeOverview(d,"oracle"),/Неизвестный/);
});
