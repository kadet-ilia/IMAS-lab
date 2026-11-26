import test from "node:test";
import assert from "node:assert/strict";
import {EXTRA_DEFAULTS,studyPlan,evaluateUnit,summarizeStudy} from "./extendedStudies.js";
import {candidateConfigs} from "./designOptimization.js";
const c={...EXTRA_DEFAULTS,experiment:"heterogeneous",m:1000,mcN:1000,requiredCoverage:0,riskLimit:1000,designSpec:[{name:"Малая",groups:[2,3],costs:[5,6]},{name:"Большая",groups:[20,20,20,20]}]};
test("Heterogeneous configurations: exact and conservative MC certification",()=>{const p=studyPlan("optimization",c);assert.equal(p.length,2);const r=p.map(u=>evaluateUnit("optimization",c,u,p.length));assert.equal(r[0].algorithm,"exact");assert.equal(r[0].cost,11);assert.equal(r[1].algorithm,"mc_certificate");assert.equal(r[1].coverage,null);assert.equal(r[1].loss,null);assert.equal(r[1].alphaCal+r[1].alphaMC,c.alpha/2);assert.ok(r[1].tight<=r[1].nomCoverage&&r[1].upperRisk>=r[1].nomLoss-1e-12);assert.equal(r[1].status,"feasible");assert.equal(r[1].hist.flat().reduce((a,b)=>a+b,0),1000);assert.equal(summarizeStudy("optimization",c,r).rows.length,2);});
test("No silent omission or duplicate design candidate",()=>{assert.throws(()=>candidateConfigs(c,[{groups:[3]},{groups:[3]}]));const p=studyPlan("optimization",{...c,approxLarge:false});assert.equal(evaluateUnit("optimization",{...c,approxLarge:false},p[1],2).status,"not_evaluated");});
