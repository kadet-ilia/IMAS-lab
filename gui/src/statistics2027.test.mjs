import test from "node:test";
import assert from "node:assert/strict";
import {wilson95,mean95,bootstrap95,pairedDifference95,Z95} from "./statistics2027.js";

test("UP-30 Wilson-95 has positive upper bound when zero events observed",()=>{
 const zero=wilson95(0,100),all=wilson95(100,100);
 assert.equal(zero.estimate,0);assert.equal(zero.lower,0);assert.ok(zero.upper>.03&&zero.upper<.04);
 assert.equal(all.estimate,1);assert.equal(all.upper,1);assert.ok(all.lower>.96);
 const half=wilson95(50,100);assert.ok(half.lower<.5&&half.upper>.5);
 assert.equal(half.method,"Wilson-95");assert.equal(half.n,100);
 assert.throws(()=>wilson95(101,100));
 assert.throws(()=>wilson95(0,0));
});
test("UP-30 mean confidence limit and endpoint conventions",()=>{
 const c=mean95([1,2,3,4,5]);
 assert.equal(c.estimate,3);assert.ok(c.lower<3&&c.upper>3);
 assert.equal(mean95([4]).lower,null);
 assert.ok(Z95>1.95&&Z95<1.97);
});
test("UP-30 paired bootstrap preserves matching run indices and reproducibility",()=>{
 const a=[0,1,0,1,0,1,0,1],b=[0,1,0,1,0,1,0,1];
 const same=pairedDifference95(a,b,99,200);
 assert.equal(same.estimate,0);assert.equal(same.lower,0);assert.equal(same.upper,0);
 const step=pairedDifference95(a.map(v=>v+2),b,99,200);
 assert.equal(step.estimate,2);assert.equal(step.lower,2);assert.equal(step.upper,2);
 assert.deepEqual(pairedDifference95(a,b,99,200),same);
});
test("UP-25/30 bootstrap ES operates on discrete atoms with deterministic seed",()=>{
 const xs=[...Array(95).fill(1),...Array(5).fill(3)];
 const es=a=>{const v=[...a].sort((a,b)=>b-a);return v.slice(0,5).reduce((s,x)=>s+x,0)/5;};
 const out=bootstrap95(xs,es,103,150);
 assert.equal(out.estimate,3);assert.ok(out.lower>=1&&out.upper<=3);
 assert.deepEqual(out,bootstrap95(xs,es,103,150));
});
