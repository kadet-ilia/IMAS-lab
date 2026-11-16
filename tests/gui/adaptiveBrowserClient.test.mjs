import test from "node:test";
import assert from "node:assert/strict";
import {runAdaptiveBrowser,loadAdaptiveCheckpoint,adaptiveCacheKey} from "../../gui/src/adaptiveBrowserClient.js";
import {ADAPTIVE_SCENARIO_VERSION} from "../../gui/src/adaptiveScenario.js";
import {runAdaptiveSingle,validateAdaptiveStudy} from "../../gui/src/adaptiveExperiment.js";

class MockAdaptiveWorker {
 constructor(){this.onmessage=null;this.onerror=null;this.stopped=false;}
 postMessage({type,config,options,startIndex}){
  if(type!=="run")throw Error("Unexpected message");
  queueMicrotask(()=>{
   for(let i=startIndex;i<options.runs&&!this.stopped;i++){
    const result=runAdaptiveSingle(config,options,i);
    this.onmessage?.({data:{type:"run",index:i,value:result}});
   }
   if(!this.stopped)this.onmessage?.({data:{type:"finished"}});
  });
 }
 terminate(){this.stopped=true;}
}

test("E1-A holds one non-reentrant origin lock while preserving checkpoints and cache",async()=>{
 const descriptor=Object.getOwnPropertyDescriptor(globalThis,"navigator");
 const state={held:false,attempts:0,denied:0};
 const locks={async request(name,settings,fn){
  assert.equal(name,"imas-lab-test-trust-storage-exclusive-v1");
  assert.equal(settings.mode,"exclusive");
  state.attempts++;
  if(state.held){state.denied++;return fn(null);}
  state.held=true;
  try{return await fn({name});}finally{state.held=false;}
 }};
 Object.defineProperty(globalThis,"navigator",{configurable:true,value:{locks}});
 try{
  const config={n_agents:9,n_byzantine:2,n_steps:10,attack_start_step:2,
   seed:107038,trim_each_side:1,network_enabled:false};
  const options={runs:2,scenario:"static_bias",trimEachSide:1};
  const progress=[];
  const response=await runAdaptiveBrowser(config,options,p=>progress.push(p),
   {workerFactory:()=>new MockAdaptiveWorker()});
  assert.equal(response.state,"completed");
  assert.equal(response.result.completedRuns,2);
  assert.equal(response.result.summary.length,5);
  assert.equal(state.denied,0,"Nested Web Locks are forbidden");
  assert.equal(state.attempts,1,"One origin lock per scientific job");
  assert.ok(progress.some(p=>p.completed===2));
  const validated=validateAdaptiveStudy(config,options);
  assert.ok(adaptiveCacheKey(validated.core,validated.options).includes(ADAPTIVE_SCENARIO_VERSION));
  const checkpoint=await loadAdaptiveCheckpoint(validated.core,validated.options);
  assert.equal(checkpoint.completedRuns,2);
  assert.equal(checkpoint.result.partial,false);
  assert.equal(state.attempts,2,"Standalone cache reader acquires its own lock");
  const again=await runAdaptiveBrowser(config,options,()=>{},
   {workerFactory:()=>{throw Error("Cached replay must not spawn Worker");}});
  assert.equal(again.cacheHit,true);
  assert.equal(again.result.completedRuns,2);
  assert.equal(state.attempts,3);
  assert.equal(state.held,false);
 }finally{
  if(descriptor)Object.defineProperty(globalThis,"navigator",descriptor);
  else delete globalThis.navigator;
 }
});
