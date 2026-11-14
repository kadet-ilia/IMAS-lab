import test from "node:test";
import assert from "node:assert/strict";
import {ATTACK_SHAPES,MAX_ATTACK_PHASES,defaultAttackPhases,validateAttackPhases,
 attackIntensityAt,shapeFraction} from "./attackProfiles.js";

const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-12,a+" != "+b);
test("all five phase shapes are bounded, monotone and have correct endpoints",()=>{
 assert.equal(ATTACK_SHAPES.length,5);
 for(const {id} of ATTACK_SHAPES){
  const p=[{start:1,intensity:0,endIntensity:5,profile:id}];
  validateAttackPhases(p,11);
  const values=Array.from({length:11},(_,i)=>attackIntensityAt(i+1,p,11));
  near(values[0],id==="constant"?0:0);
  near(values.at(-1),id==="constant"?0:5);
  assert.ok(values.every((x,i)=>x>=0&&x<=5&&(i===0||x>=values[i-1])));
  if(id!=="constant"){near(shapeFraction(0,id),0);near(shapeFraction(1,id),1);}
 }
});
test("linear, exponential, parabolic and hyperbolic profiles have distinct midpoints",()=>{
 const ids=["linear","exponential","parabolic","hyperbolic"];
 const values=ids.map(id=>shapeFraction(.5,id));
 near(values[0],.5);near(values[2],.25);
 assert.ok(values[1]<values[2]);
 assert.ok(values[3]>values[0]);
 assert.equal(new Set(values.map(x=>x.toFixed(8))).size,4);
});
test("phase intervals end at the next phase, not at T",()=>{
 const p=[{start:1,intensity:0,endIntensity:4,profile:"linear"},
  {start:5,intensity:2,profile:"constant"}];
 near(attackIntensityAt(1,p,10),0);near(attackIntensityAt(4,p,10),4);
 near(attackIntensityAt(5,p,10),2);near(attackIntensityAt(10,p,10),2);
});
test("decreasing intensity is allowed, with nonnegative bounded values",()=>{
 const p=[{start:1,intensity:4,endIntensity:0,profile:"hyperbolic"}];
 const values=Array.from({length:11},(_,i)=>attackIntensityAt(i+1,p,11));
 near(values[0],4);near(values.at(-1),0);
 assert.ok(values.every((x,i)=>x>=0&&x<=4&&(i===0||x<=values[i-1])));
});
test("legacy constant phases and short horizons are preserved",()=>{
 for(const T of [1,2,3,5,8,30]){
  const p=defaultAttackPhases(T,Math.min(2,T));
  assert.ok(p.length>=1&&p.length<=MAX_ATTACK_PHASES);
  assert.equal(validateAttackPhases(p,T).length,p.length);
  assert.equal(p[0].start,1);
 }
 near(attackIntensityAt(7,[{start:1,intensity:0},{start:7,intensity:2}],8),2);
});
test("rejects invalid shapes, endpoints, overlaps and more than five phases",()=>{
 assert.throws(()=>validateAttackPhases([{start:1,intensity:1,profile:"sinus"}],10),/неизвестная/);
 assert.throws(()=>validateAttackPhases([{start:1,intensity:0,endIntensity:6,profile:"linear"}],10),/интенсивности/);
 assert.throws(()=>validateAttackPhases([{start:1,intensity:1},{start:1,intensity:2}],10),/возрастать/);
 assert.throws(()=>validateAttackPhases(Array.from({length:6},(_,i)=>({start:i+1,intensity:0})),10),/5 фаз/);
});
