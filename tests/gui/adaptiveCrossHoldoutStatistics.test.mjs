import test from "node:test";
import assert from "node:assert/strict";
import {exactMcNemarTwoSided} from
 "../../gui/src/adaptiveCrossHoldoutStatistics.js";

const series=(b,c,t=0)=>
 [...Array(b).fill({off:false,on:true}),
  ...Array(c).fill({off:true,on:false}),
  ...Array(t).fill({off:false,on:false})];

test("exact conditional McNemar probabilities and discordance accounting",()=>{
 let v=exactMcNemarTwoSided(series(5,0,2));
 assert.equal(v.pValue,2/32);
 assert.equal(v.improvement,5);
 assert.equal(v.onSuccess,5);
 assert.equal(v.offSuccess,0);
 assert.equal(v.n,7);
 assert.equal(v.ties,2);
 v=exactMcNemarTwoSided(series(2,2,1));
 assert.equal(v.pValue,1);
 v=exactMcNemarTwoSided(series(0,0,6));
 assert.equal(v.pValue,1);
 assert.equal(v.discordant,0);
 v=exactMcNemarTwoSided(series(6,1,3));
 assert.equal(v.pValue,2*(1+7)/128);
 assert.equal(exactMcNemarTwoSided(series(1,6,3)).pValue,v.pValue,
  "Swapping which policy wins cannot change a two-sided p-value");
});

test("exact McNemar rejects malformed or selected-only episodes",()=>{
 for(const pairs of [[],null,[{}],[{off:0,on:true}],
  [{off:false,on:null}]]){
  assert.throws(()=>exactMcNemarTwoSided(pairs),/некорректная выборка/);
 }
});
