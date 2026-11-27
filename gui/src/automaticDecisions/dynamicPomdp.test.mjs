import test from "node:test";
import assert from "node:assert/strict";
import {EXTRA_DEFAULTS,studyPlan,evaluateUnit,summarizeStudy} from "./extendedStudies.js";
import {dynamicPomdp,predictInterval,posteriorInterval} from "./dynamicPomdp.js";
const c={...EXTRA_DEFAULTS,experiment:"pomdp",prior:.5,b:1,f:1,d:0,c:.5,safetyRisk:.5,waitCost:0,p01:0,p10:0,transitionRadius:0,pomdpHorizon:1,pomdpAgents:[{name:"A",u0:.1,u1:.9,availability:1,delay:1,cost:.02,radius:0}]};
const eq=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,JSON.stringify([a,b]));
test("One-step symmetric query, exact Bayes risk and cost",()=>{const r=dynamicPomdp(c);eq(r.lowerBound,.12);eq(r.upperBound,.12);eq(r.summary[5].coverage,1);eq(r.summary[5].queries,1);eq(r.summary[5].acquisitionCost,.02);eq(r.summary[5].miss,.05);eq(r.summary[5].false,.05);});
test("Missingness and latency have exact cost, unavailable long query not allowed",()=>{const a={...c.pomdpAgents[0],availability:.8},r=dynamicPomdp({...c,pomdpAgents:[a],waitCost:.03});eq(r.upperBound,.23);eq(r.summary[5].coverage,.8);const z=dynamicPomdp({...c,pomdpAgents:[{...a,delay:2}]});eq(z.upperBound,.5);eq(z.summary[5].queries,0);});
test("Corner propagation contains every fixed transition and posterior",()=>{const a=predictInterval([.2,.7],[.1,.2],[.05,.15],3);for(const p of [.2,.45,.7])for(const x of [.1,.15,.2])for(const y of [.05,.1,.15]){let q=p;for(let i=0;i<3;i++)q=(1-q)*x+q*(1-y);assert.ok(q>=a[0]-1e-12&&q<=a[1]+1e-12);}const b=posteriorInterval([.2,.7],[.1,.3],[.6,.9]);for(const p of [.2,.45,.7])for(const x of [.1,.2,.3])for(const y of [.6,.75,.9]){const q=p*y/((1-p)*x+p*y);assert.ok(q>=b[0]-1e-12&&q<=b[1]+1e-12);}});
test("Robust bounds dominate both true laws; nominal lower bound and robust optimum",()=>{const z={...EXTRA_DEFAULTS,experiment:"pomdp",pomdpHorizon:3},p=studyPlan("dynamics",z),r=evaluateUnit("dynamics",z,p[0]);assert.equal(r.summary.length,6);assert.ok(r.states>1&&r.lowerBound<=r.upperBound+1e-10);for(const v of r.summary){assert.ok(v.loss<=v.upperRisk+1e-10&&v.stressLoss<=v.upperRisk+1e-10&&v.upperRisk>=r.upperBound-1e-10);eq(v.loss,v.decisionLoss+v.acquisitionCost+v.waitingCost);eq(v.unsafe,0);eq(v.stressUnsafe,0);}assert.equal(summarizeStudy("dynamics",z,[r]).rows.length,6);});
test("Heterogeneous source choice uses value, availability, cost and latency",()=>{const a=c.pomdpAgents[0],b={...a,name:"B",u0:.02,u1:.98,cost:.01},r=dynamicPomdp({...c,pomdpAgents:[a,b]});assert.equal(r.summary[5].firstAction,"B");eq(r.upperBound,.03);const q=dynamicPomdp({...c,pomdpAgents:[a,{...b,delay:2}]});assert.equal(q.summary[5].firstAction,"A");});

test("Closed safety boundary 3*.2=.6 is not rejected by binary rounding",()=>{
 const r=dynamicPomdp({...c,prior:.2,b:3,f:2,d:.2,c:1,safetyRisk:.6,p01:.1,p10:.2,waitCost:.01,pomdpHorizon:3,pomdpAgents:[{name:"A0",u0:.2,u1:.8,availability:.7,delay:2,cost:.02,radius:0},{name:"A1",u0:.4,u1:.6,availability:.6,delay:1,cost:0,radius:0}]});
 eq(r.lowerBound,.6);eq(r.upperBound,.6);
});
