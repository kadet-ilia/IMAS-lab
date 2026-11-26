import test from "node:test";
import assert from "node:assert/strict";
import {identifiedBounds} from "./identifiedBounds.js";
import {completionBounds} from "./partialCalibration.js";
import {EXTRA_DEFAULTS} from "./extendedStudies.js";
import {validateObservations,partialExampleDataset} from "./dataValidation.js";
test("Bounded selection odds yields nested feasible regions",()=>{
 // n=2; 600 fully observed, 400 empty; complete counts 120,180,300.
 const hist=[400,0,0,120,180,300],base=completionBounds(2,hist,.02),a=identifiedBounds(base,1000,.02,1),b=identifiedBounds(base,1000,.02,4);
 assert.ok(a.compatible&&b.compatible);for(let j=0;j<3;j++){const q=[.2,.3,.5][j];assert.ok(a.lower[j]<=q&&q<=a.upper[j]);assert.ok(base.lower[j]<=b.lower[j]&&b.lower[j]<=a.lower[j]);assert.ok(base.upper[j]>=b.upper[j]&&b.upper[j]>=a.upper[j]);}
 assert.ok(a.widthAfter<a.widthBefore);
});
test("Empty complete sample is not interpreted as identified",()=>{
 const a=identifiedBounds(completionBounds(2,[100,0,0,0,0,0],.1),100,.1,1);assert.deepEqual(a.lower,[0,0,0]);assert.deepEqual(a.upper,[1,1,1]);
});
test("Incompatible intersection retains completion bounds",()=>{
 const base={forced:[90,10],lower:[0,.8],upper:[.2,1]},a=identifiedBounds(base,100,.001,1);
 assert.equal(a.compatible,false);assert.deepEqual(a.lower,base.lower);assert.deepEqual(a.upper,base.upper);
});
test("Partial identification compares 3 policies without future labels",()=>{
 const f=partialExampleDataset(1000,123),c={...EXTRA_DEFAULTS,calibrationMode:"identified",selectionGamma:1},a=validateObservations(f,c);
 assert.equal(a.summary.length,3);assert.equal(a.certified,false);assert.equal(a.partial.identified,true);
 for(const row of a.partial.fit)for(const v of row){assert.ok(v.identified.widthAfter<=v.identified.widthBefore+1e-12);}
 assert.ok(a.summary[2].coverage>=a.summary[1].coverage-1e-12);
 const cut=a.split.cut,b=validateObservations({...f,rows:f.rows.map((r,i)=>i<cut?r:{...r,x:1-r.x})},c);
 assert.deepEqual(a.partial.fit,b.partial.fit);assert.deepEqual(a.trace.map(r=>r.action),b.trace.map(r=>r.action));
});
