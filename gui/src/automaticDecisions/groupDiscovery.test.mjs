import test from "node:test";
import assert from "node:assert/strict";
import {conditionalGraph,partitionGraph,residual,discoverGrouping} from "./groupDiscovery.js";
import {validateObservations} from "./dataValidation.js";
import {EXTRA_DEFAULTS} from "./extendedStudies.js";
const rows=Array.from({length:400},(_,i)=>{const x=i%2,a=(i>>1)%2,b=(i>>2)%2;return {time:i,x,agents:[[a,b],[a,b]]};});
test("Conditional MI identifies duplicated sources and excludes independent pairs",()=>{const g=conditionalGraph(rows,4);assert.ok(g.edges.find(e=>e.i===0&&e.j===2).cmi>.99);assert.ok(g.edges.find(e=>e.i===0&&e.j===1).cmi<.001);for(const method of ["complete","components"])assert.deepEqual(partitionGraph(g,.1,method),[[0,2],[1,3]]);assert.equal(residual(g,[[0,2],[1,3]]).maxBetween,0);});
test("Grouping is frozen before separate calibration and test",()=>{const f={schema:"imas-e2-observations-v1",groups:[2,2],rows},c={...EXTRA_DEFAULTS,discoverGroups:true,trainFraction:.6,groupThreshold:.1},a=validateObservations(f,c);assert.deepEqual(a.grouping.groups,[[0,2],[1,3]]);assert.equal(a.grouping.discoveryN,120);assert.equal(a.split.trainN,120);assert.equal(a.summary.length,2);const b=validateObservations({...f,rows:rows.map((r,i)=>i<240?r:{...r,x:1-r.x})},c);assert.deepEqual(b.grouping,a.grouping);assert.deepEqual(b.grouped.counts,a.grouped.counts);});
test("Singleton clusters preserved, not silently merged",()=>{const g=conditionalGraph(rows,4);assert.deepEqual(partitionGraph(g,.1,"complete",1),[[0],[1],[2],[3]]);});
