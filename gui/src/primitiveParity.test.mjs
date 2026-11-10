import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {betaTrust,eigenTrust,trimmedWeightedMean,validateConfig} from "./trustEngine.js";
const fixture=JSON.parse(fs.readFileSync(new URL("../../audit/scientific-integrity/03_parity/primitive_vectors.json",import.meta.url),"utf8"));
const close=(actual,expected,location="")=>{
 if(Array.isArray(expected)){
  assert.ok(Array.isArray(actual),location);
  assert.equal(actual.length,expected.length,location);
  expected.forEach((x,i)=>close(actual[i],x,location+"["+i+"]"));
 }else assert.ok(Math.abs(actual-expected)<=fixture.tolerance,location+": "+actual+" vs "+expected);
};
test("UP-34 parity fixture: discounted Beta update agrees with analytical reference",()=>{
 const c=validateConfig({n_agents:3,n_byzantine:0,trim_each_side:1,
  forgetting_factor:fixture.beta.forgettingFactor,
  initial_trust:fixture.beta.initialTrust,trust_prior_strength:fixture.beta.priorStrength});
 const history=[fixture.beta.oldest,fixture.beta.newest].map(mat=>mat.map(row=>row.map(x=>x===null?NaN:x)));
 close(betaTrust(history,c,fixture.beta.n),fixture.beta.expected,"beta");
});
test("UP-34 parity fixture: trimmed weighted scalar aggregation",()=>{
 close(trimmedWeightedMean(fixture.trimmed.values,fixture.trimmed.weights,fixture.trimmed.trimEachSide),
  fixture.trimmed.expected,"trim");
});
test("UP-34 parity fixture: regularized EigenTrust fixed point with inactive vertex",()=>{
 close(eigenTrust(fixture.eigen.trust,fixture.eigen.active,fixture.eigen.damping),
  fixture.eigen.expected,"eigen");
});
