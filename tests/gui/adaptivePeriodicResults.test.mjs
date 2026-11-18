import test from "node:test";
import assert from "node:assert/strict";
import {periodicCampaignDesign} from "../../gui/src/adaptivePeriodicCampaignProtocol.js";
import {PERIODIC_RESULT_MODES,validateImportedPeriodicSummary,
 periodicModeOverview,periodicFilteredConditions} from "../../gui/src/adaptivePeriodicResults.js";

const hash=k=>k.repeat(64);
function fixture(stage="exploratory"){
 const plan=periodicCampaignDesign(),conditions=plan.stages[stage].map((cell,index)=>{
  const d=index%7===0?-0.002:0.001;
  return {...cell,combinedRmse:0.12+index*0.0001,combinedLoss:0.02,
   meanDeltaDiscreteCombined:d,ciDiscreteLow:d-0.01,ciDiscreteHigh:d+0.01,
   meanDeltaRiskCombined:d-0.001,ciRiskLow:d-0.011,ciRiskHigh:d+0.009,
   meanDeltaAdaptiveCombined:d+0.002,ciAdaptiveLow:d-0.008,ciAdaptiveHigh:d+0.012};
 });
 const mean=(name)=>conditions.reduce((s,x)=>s+x[name],0)/conditions.length;
 const cellRuns=conditions.reduce((s,c)=>s+c.runs,0);
 return {protocol:plan.protocol,stage,conditions,conditionsCount:conditions.length,
  cellRuns,individualSimulations:3*cellRuns,
  sourceSha256:hash("a"),designSha256:hash("b"),fingerprint:hash("c"),
  overall:{adaptive:{meanDeltaRmse:mean("meanDeltaAdaptiveCombined")},
   risk:{meanDeltaRmse:mean("meanDeltaRiskCombined")},
   discrete:{meanDeltaRmse:mean("meanDeltaDiscreteCombined")}}
 };
}
test("M5-B summary accepts all fixed stages and reconciles arithmetic",()=>{
 for(const stage of ["smoke","exploratory","confirmatory"]){
  const x=validateImportedPeriodicSummary(fixture(stage));
  assert.equal(x.conditionsCount,stage==="smoke"?3:stage==="exploratory"?80:16);
  assert.equal(x.individualSimulations,3*x.cellRuns);
 }
 assert.equal(PERIODIC_RESULT_MODES.length,3);
});
test("M5-B browser reports pulsed vs coordinated separately without phantom duty-factor controls",()=>{
 const data=validateImportedPeriodicSummary(fixture());
 assert.equal(periodicFilteredConditions(data,{strategy:"coordinated"}).length,16);
 assert.equal(periodicFilteredConditions(data,{strategy:"pulsed"}).length,64);
 const selected=periodicFilteredConditions(data,{
  strategy:"pulsed",law:"pulsed",schedule:"double",f:"12",correlation:"0.7"});
 assert.equal(selected.length,4);
 const common=periodicFilteredConditions(data,{
  strategy:"coordinated",f:"12",correlation:"0.7"});
 assert.equal(common.length,4);
 assert.ok(common.every(x=>x.period===null&&x.dutyFraction===null));
 const result=periodicModeOverview(data,"discrete");
 assert.equal(result.count,80);
 assert.equal(result.better+result.worse+result.equal,80);
 assert.throws(()=>periodicModeOverview(data,"oracle"),/Неизвестный/);
});
test("M5-B browser rejects altered cell factors, duplicate IDs and incorrect totals",()=>{
 const cases=[
  x=>{x.conditions[1].id=x.conditions[0].id;},
  x=>{x.conditions[5].period=99;},
  x=>{x.conditions[0].correlation=0.5;},
  x=>{x.conditions.pop();},
  x=>{x.cellRuns--;},
  x=>{x.individualSimulations--;},
  x=>{x.conditions[0].meanDeltaDiscreteCombined=Infinity;},
  x=>{x.conditions[0].ciRiskLow=99;},
  x=>{x.overall.discrete.meanDeltaRmse+=0.01;},
  x=>{x.sourceSha256="nonsense";}
 ];
 for(const edit of cases){
  const x=fixture();edit(x);
  assert.throws(()=>validateImportedPeriodicSummary(x));
 }
});
