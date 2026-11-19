import test from "node:test";
import assert from "node:assert/strict";
import {v2CampaignDesign} from "../../gui/src/adaptiveV2CampaignProtocol.js";
import {validateV2ImportedSummary,v2FilteredResults,v2ResearchOverview,
 V2_RESULT_METHODS} from "../../gui/src/adaptiveV2Results.js";

const methodNames=["adaptive","risk","v1","v2Discrete","v2Blend"];
const mean=x=>x.reduce((a,b)=>a+b,0)/x.length;
function fixture(stage="train"){
 const plan=v2CampaignDesign(),cells=plan.stages[stage].map((c,i)=>{
  const value=(i%5-2)*0.001;
  const fields={controlRmse:0.15,activeTicks:8};
  for(const p of methodNames)Object.assign(fields,{
   [p+"Delta"]:value,[p+"CiLow"]:value-0.01,
   [p+"CiHigh"]:value+0.01,[p+"Switches"]:0.1,[p+"LossDelta"]:value/2
  });
  if(stage==="holdout")Object.assign(fields,{signFlipP:1,holmP:1});
  return {...c,...fields};
 });
 const overall=Object.fromEntries(V2_RESULT_METHODS.map(m=>[
  m.value,{meanCellDelta:mean(cells.map(x=>x[m.prefix+"Delta"]))}
 ]));
 return {protocol:plan.protocol,stage,fingerprint:"a".repeat(64),
  planHash:"b".repeat(64),sourceHash:"c".repeat(64),
  cells:cells.length,
  wholeRunPairs:cells.reduce((sum,c)=>sum+c.runs,0),
  modelExecutions:cells.reduce((sum,c)=>sum+c.runs,0)*5,
  conditions:cells,overall};
}
test("v2 archive validator accepts all three preregistered stages",()=>{
 for(const stage of ["smoke","train","holdout"]){
  const f=validateV2ImportedSummary(fixture(stage));
  assert.equal(f.cells,stage==="smoke"?3:stage==="train"?48:12);
  assert.equal(f.modelExecutions,5*f.wholeRunPairs);
 }
});
test("v2 reader separates behavior, evidence and attacker count",()=>{
 const f=validateV2ImportedSummary(fixture());
 const sub=v2FilteredResults(f,{
  strategy:"pulsed",law:"constant",evidence:"behavior_linked",f:"12"});
 assert.equal(sub.length,2);
 assert.ok(sub.every(c=>c.strategy==="pulsed"&&c.f===12));
 const s=v2ResearchOverview(f,"regime_aware_v2_discrete",{
  strategy:"pulsed",f:"12"});
 assert.equal(s.cells,8);
 assert.equal(s.better+s.worse+s.ties,s.cells);
 assert.throws(()=>v2ResearchOverview(f,"oracle"),/неопределённый/);
});
test("v2 reader rejects manipulated factor, missing run and numeric corruption",()=>{
 for(const mutate of [
  d=>{d.cells--;},d=>{d.wholeRunPairs--;},
  d=>{d.modelExecutions--;},d=>{d.conditions.pop();},
  d=>{d.conditions[0].seed=99;},d=>{d.conditions[3].f=99;},
  d=>{d.conditions[0].v2DiscreteDelta=NaN;},
  d=>{d.conditions[0].v2DiscreteCiLow=1;},
  d=>{d.overall.regime_aware_v2_discrete.meanCellDelta=1;},
  d=>{d.planHash="bad"}
 ]){
  const f=fixture();mutate(f);
  assert.throws(()=>validateV2ImportedSummary(f));
 }
});
