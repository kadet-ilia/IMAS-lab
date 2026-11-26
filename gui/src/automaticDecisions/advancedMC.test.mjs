import test from "node:test";
import assert from "node:assert/strict";
import {EXTRA_DEFAULTS,studyPlan,evaluateUnit,summarizeStudy} from "./extendedStudies.js";
import {advancedMC,bernoulliBounds} from "./advancedMC.js";
const c={...EXTRA_DEFAULTS,groups:[2,2],u:[[.2,.15],[.8,.85]],rho:[.4,.2],stress:"none",prior:.01,m:1000,reps:2,mcN:10000,mcBatch:1000,mcExact:true,mcImportance:true,mcProposal:.5};
test("Rare-event upper bound remains positive with zero observations",()=>{const [l,h]=bernoulliBounds(0,10000,.05);assert.equal(l,0);assert.ok(h>0&&h<.001);});
test("Importance sampling, exact comparison and prespecified looks",()=>{const a=advancedMC(c,0),b=advancedMC(c,0);assert.deepEqual(a,b);const r=a.summary[0];assert.ok(r.coverageLow<=r.exactCoverage&&r.coverageHigh>=r.exactCoverage);assert.ok(r.lossLow<=r.exactLoss&&r.lossHigh>=r.exactLoss);assert.equal(a.n,c.mcN);assert.notEqual(a.calSeed,a.testSeed);assert.notEqual(a.calSeed,advancedMC(c,1).calSeed);const short=advancedMC({...c,mcTolerance:1},0);assert.ok(short.achieved&&short.n===1000);});
test("Extended series retains independent calibration replicates",()=>{const p=studyPlan("mcExtended",c);assert.equal(p.length,2);const records=p.map(u=>evaluateUnit("mcExtended",c,u,p.length));assert.equal(summarizeStudy("mcExtended",c,records).rows.length,4);});
