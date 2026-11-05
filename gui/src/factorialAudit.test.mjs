import test from "node:test";
import assert from "node:assert/strict";
import {auditFactorialDesign,estimateFactorialContrasts} from "./factorialAudit.js";
const factors=["a","b","c","d","e","f"],ranges=Object.fromEntries(factors.map(f=>[f,[-1,1]]));
const build=(fractional)=>{
 const all=Array.from({length:64},(_,i)=>factors.map((_,j)=>(i&(1<<(5-j)))?1:-1));
 const chosen=fractional?all.filter(x=>x.reduce((p,v)=>p*v,1)===1):all;
 return chosen.map((coded,index)=>({index,coded,values:Object.fromEntries(factors.map((f,j)=>[f,coded[j]])),
  settings:Object.fromEntries(factors.map((f,j)=>[f,coded[j]]))}));
};
test("UP-13 exact design auditor accepts complete and regular half-fraction designs",()=>{
 for(const mode of [false,true]){
  const plan=build(mode),audit=auditFactorialDesign(factors,ranges,plan);
  assert.equal(audit.valid,true);assert.equal(audit.columns,22);assert.equal(audit.rank,22);
  assert.equal(audit.points,mode?32:64);assert.equal(audit.definingRelation,mode?"I=ABCDEF":"none");
 }
});
test("UP-13 design auditor rejects duplicate, aliased or mismatched physical levels",()=>{
 const plan=build(true);
 assert.throws(()=>auditFactorialDesign(factors,ranges,[...plan.slice(0,-1),plan[0]]),/повтор/);
 const changed=build(true);changed[3].values.a=123;
 assert.throws(()=>auditFactorialDesign(factors,ranges,changed),/уровень/);
 const badRanges={...ranges,a:[1,1]};
 assert.throws(()=>auditFactorialDesign(factors,badRanges,plan),/уровень/);
});
test("UP-13 analytical main and interaction contrasts recover signal with finite CI",()=>{
 for(const fraction of [false,true]){
  const designs=build(fraction),rawRows=[];
  for(const point of designs)for(let run=0;run<5;run++){
   const x=point.coded;
   const metric=.55+.15*x[0]-.08*x[2]+.07*x[0]*x[1]+(run-2)*.005;
   rawRows.push({method:"proposed_robust",design_index:point.index,run,y:metric});
  }
  const {effects,interactions}=estimateFactorialContrasts(designs,rawRows,["y"]);
  const a=effects.find(x=>x.factorIndex===0),c=effects.find(x=>x.factorIndex===2);
  const ab=interactions.find(x=>x.factorIndices[0]===0&&x.factorIndices[1]===1);
  assert.ok(Math.abs(a.effect-.30)<1e-10);
  assert.ok(Math.abs(c.effect+.16)<1e-10);
  assert.ok(Math.abs(ab.effect-.14)<1e-10);
  assert.ok(a.ci95_low<a.effect&&a.ci95_high>a.effect);
  assert.equal(a.min_replicates_per_cell,5);
  assert.equal(a.missing_cells,0);
 }
});
test("UP-13 missing design cells forbid reporting misleading partial effects",()=>{
 const designs=build(true),rawRows=designs.slice(1).map(p=>({method:"proposed_robust",design_index:p.index,y:p.coded[0]}));
 const effects=estimateFactorialContrasts(designs,rawRows,["y"]).effects;
 assert.ok(effects.every(e=>!e.estimable&&e.effect===null&&e.ci95_low===null));
 assert.ok(effects.every(e=>e.missing_cells===1));
 const single=designs.map(p=>({method:"proposed_robust",design_index:p.index,y:p.coded[0]}));
 const enough=estimateFactorialContrasts(designs,single,["y"]).effects;
 assert.ok(enough.every(e=>e.estimable&&e.ci95_low===null&&e.ci95_high===null));
});
