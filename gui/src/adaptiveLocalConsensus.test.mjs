import test from "node:test";
import assert from "node:assert/strict";
import {simulateLocalConsensusTick,localWeightedTrim,
 validateLocalConsensusOptions,E1A_LOCAL_CONSENSUS_VERSION} from "./adaptiveLocalConsensus.js";
const graph=(n,edges)=>Array.from({length:n},(_,i)=>Array.from({length:n},(_,j)=>
 edges.some(([a,b])=>a===i&&b===j||a===j&&b===i)));
const chain=graph(5,[[0,1],[1,2],[2,3],[3,4]]);
const basic=({values=[0,1,2,3,4],reputation=Array(5).fill(.5),faulty}={})=>({
 step:1,values,reputation,active:Array(5).fill(true),
 labels:Array(5).fill(0),adjacency:chain,...(faulty?{faulty}:{})
});
test("local consensus enforces finite input, symmetry, partition and bounded parameters",()=>{
 assert.match(E1A_LOCAL_CONSENSUS_VERSION,/local-synchronous/);
 for(const [key,value] of [["localConsensusRounds",21],["localConsensusTrim",-1],
  ["localConsensusRelaxation",1.1],["localConsensusMinWeight",0]]){
  assert.throws(()=>validateLocalConsensusOptions({[key]:value}),new RegExp(key));
 }
 assert.throws(()=>simulateLocalConsensusTick({...basic(),adjacency:graph(5,[[0,1]]).map((r,i)=>r.map((v,j)=>i===0&&j===1?false:v))}),/ребро/);
 assert.throws(()=>simulateLocalConsensusTick({...basic(),labels:[0,0,1,1,1]}),/ребро/);
 assert.throws(()=>simulateLocalConsensusTick({...basic(),values:[NaN,1,2,3,4]}),/наблюдения/);
});
test("finite topology cannot propagate information faster than one edge per synchronous round",()=>{
 const settings={localConsensusTrim:0,localConsensusRounds:2,localConsensusRelaxation:1};
 const first=simulateLocalConsensusTick(basic(),settings);
 const far=simulateLocalConsensusTick(basic({values:[0,1,2,3,999]}),settings);
 for(let round=0;round<=2;round++){
  assert.equal(first.rounds[round].states[0],far.rounds[round].states[0]);
 }
 assert.notEqual(first.rounds[2].states[3],far.rounds[2].states[3]);
});
test("local inference remains separated across disconnected graph components",()=>{
 const g=graph(5,[[0,1],[1,2],[3,4]]);
 const input={...basic(),adjacency:g,labels:[0,0,0,1,1]};
 const a=simulateLocalConsensusTick(input,{localConsensusRounds:6,localConsensusTrim:0});
 const b=simulateLocalConsensusTick({...input,values:[0,1,2,100,200]},
  {localConsensusRounds:6,localConsensusTrim:0});
 assert.deepEqual(a.states.slice(0,3),b.states.slice(0,3));
 assert.notDeepEqual(a.states.slice(3),b.states.slice(3));
 assert.equal(a.components.length,2);
 assert.deepEqual(a.components[0].nodes,[0,1,2]);
 assert.equal(a.totalMessages,2*(4+2)*6/2);
});
test("bounded synchronous update is a convex combination of local states",()=>{
 const x=simulateLocalConsensusTick(basic({values:[-200,-1,0,1,250]}),
  {localConsensusRounds:10,localConsensusTrim:0,localConsensusRelaxation:.8});
 for(const row of x.rounds){
  for(const v of row.states)assert.ok(v>=-2&&v<=2);
 }
 assert.equal(x.role,"diagnostic_local_consensus_only_not_feedback_to_E1");
 assert.equal(x.rounds.length,11);
});
test("Byzantine forwarding is frozen by simulator but cannot bypass component wall",()=>{
 const input=basic({values:[0,0,0,0,2],faulty:[false,false,false,false,true]});
 const x=simulateLocalConsensusTick(input,{localConsensusRounds:4,localConsensusTrim:0});
 assert.equal(x.states[4],2);
 assert.equal(x.rounds.every(r=>r.states[4]===2),true);
 assert.ok(x.states[3]>0);
 const labels=[0,0,0,1,1],edges=graph(5,[[0,1],[1,2],[3,4]]);
 const a=simulateLocalConsensusTick({...input,labels,adjacency:edges},
  {localConsensusRounds:4,localConsensusTrim:0});
 assert.equal(a.states[0],0);
 assert.equal(a.states[1],0);
 assert.equal(a.states[2],0);
});
test("fractional equal-boundary trimming ignores ordering of equal values",()=>{
 const v=[1,1,1,4,4,7,7],w=[.1,.7,.5,.9,.3,.2,.1];
 const first=localWeightedTrim(v,w,2);
 const order=[4,6,2,0,5,1,3];
 const second=localWeightedTrim(order.map(i=>v[i]),order.map(i=>w[i]),2);
 assert.ok(Math.abs(first-second)<1e-12);
 assert.equal(localWeightedTrim([0,1,2],[1,1,1],0),1);
});
test("node permutation with corresponding graph/reputation relabelling preserves estimates",()=>{
 const a=basic({values:[-.1,0,.1,1.3,1.8],reputation:[.1,.9,.3,.8,.5]});
 const opts={localConsensusRounds:4,localConsensusTrim:1};
 const original=simulateLocalConsensusTick(a,opts);
 const p=[3,1,4,0,2],apply=arr=>p.map(i=>arr[i]);
 const permuted=simulateLocalConsensusTick({
  ...a,values:apply(a.values),reputation:apply(a.reputation),
  labels:apply(a.labels),active:apply(a.active),
  adjacency:p.map(i=>p.map(j=>a.adjacency[i][j]))
 },opts);
 for(let i=0;i<5;i++)assert.ok(Math.abs(original.states[p[i]]-permuted.states[i])<1e-12);
});
test("local-round message ledger counts directed graph transmissions exactly",()=>{
 const g=graph(5,[[0,1],[1,2],[3,4]]);
 const x=simulateLocalConsensusTick({...basic(),adjacency:g,labels:[0,0,0,1,1]},
  {localConsensusRounds:3});
 assert.equal(x.totalMessages,18);
 assert.deepEqual(x.rounds.slice(1).map(r=>r.messages),[6,6,6]);
 assert.equal(x.activeCount,5);
 assert.ok(x.components.every(c=>c.honestSpread>=0));
});
