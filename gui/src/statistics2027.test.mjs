import test from "node:test";
import assert from "node:assert/strict";
import {wilson95,mean95,bootstrap95,pairedDifference95,pairedSignFlipP,holmAdjusted,Z95} from "./statistics2027.js";

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


test("UP-30 exact paired sign flips recognise symmetric null and strong directional alternatives",()=>{
 const n=10,plus=Array(n).fill(1),zeros=Array(n).fill(0);
 const extreme=pairedSignFlipP(plus,9);
 assert.equal(extreme.method,"exact-paired-sign-flip");
 assert.equal(extreme.replicates,1024);
 assert.equal(extreme.p,2/1024);
 const none=pairedSignFlipP(zeros);
 assert.equal(none.p,1);assert.equal(none.method,"degenerate-zero");
 const mixed=pairedSignFlipP([1,-1,2,-2,3,-3]);
 assert.equal(mixed.p,1);
 assert.throws(()=>pairedSignFlipP([0]));
});
test("UP-30 Holm step-down adjusts all valid p-values monotonically",()=>{
 const p=[.01,.005,.03,.9];
 const adjusted=holmAdjusted(p);
 assert.deepEqual(adjusted,[.03,.02,.06,.9]);
 assert.ok(adjusted.every((v,i)=>v>=p[i]&&v<=1));
 assert.deepEqual(holmAdjusted([]),[]);
 assert.throws(()=>holmAdjusted([.02,-.1]));
 const large=Array.from({length:30},(_,i)=>(i+1)/100);
 assert.ok(holmAdjusted(large).every((v,i)=>v>=large[i]));
});
test("UP-30 seeded Monte-Carlo sign flips are repeatable with large paired samples",()=>{
 const d=Array.from({length:25},(_,i)=>Math.sin(i)*.2+.1);
 const a=pairedSignFlipP(d,124,2000),b=pairedSignFlipP(d,124,2000);
 assert.deepEqual(a,b);
 assert.equal(a.method,"monte-carlo-paired-sign-flip");
 assert.ok(a.p>0&&a.p<=1);
 assert.equal(a.replicates,2000);
});
