import test from "node:test";
import assert from "node:assert/strict";
import {FRACTION_METRICS,formatStudyValue} from "./metricFormatting.js";

test("UP-31 all probability displays share a percent formatter without modifying raw values",()=>{
 for(const key of ["dangerProbability","coverage","meanExposedFraction","wrongCI95High","reductionDanger"]){
  assert.equal(formatStudyValue(key,.2),"20%");
  assert.ok(FRACTION_METRICS.has(key));
 }
 assert.equal(formatStudyValue("expectedDamage",.2),"0,2");
 assert.equal(formatStudyValue("dangerProbability",null),"—");
 assert.equal(formatStudyValue("dangerProbability",NaN),"—");
 assert.equal(formatStudyValue("runs",20),"20");
 assert.equal(formatStudyValue("paired",true),"Да");
});
