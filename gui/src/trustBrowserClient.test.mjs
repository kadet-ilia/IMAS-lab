import test from "node:test";
import assert from "node:assert/strict";
import {cacheKeyForPayload,runBrowserExperiment,stopBrowserExperiment,clearBrowserResults,TRUST_ORIGIN_LOCK,withOriginStorageLock,TRUST_CHECKPOINT_SCHEMA,snapshotCheckpoint,restoreCheckpoint} from "./trustBrowserClient.js";
import {TRUST_MODEL_VERSION,DEFAULTS,makePlan,runTask,runActionSync} from "./trustEngine.js";

test("UP-04/35 every browser cache key includes current mathematical model version",()=>{
 const payload={action:"trace",scenario:"collusion",config:{seed:11,n_agents:7}};
 const key=JSON.parse(cacheKeyForPayload(payload));
 assert.equal(key.modelVersion,TRUST_MODEL_VERSION);
 assert.equal(key.config.seed,11);
 const changed=JSON.parse(cacheKeyForPayload({...payload,config:{...payload.config,seed:12}}));
 assert.notDeepEqual(key,changed);
});


const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function fakeWorkerFactory({delayMs=1,failAfter=null,premature=false,collect=null}={}){
 return ()=>({
  terminated:false,
  terminate(){this.terminated=true;},
  postMessage({id,payload,indices}){
   const plan=makePlan(payload);
   if(collect)collect.push(...indices);
   void(async()=>{
    if(premature){
     await delay(delayMs);
     if(!this.terminated)this.onmessage({data:{type:"finished",id}});
     return;
    }
    let processed=0;
    for(const index of indices){
     await delay(delayMs);
     if(this.terminated)return;
     if(failAfter===processed){
      this.onmessage({data:{type:"failed",id,error:"synthetic failure"}});
      return;
     }
     const result=runTask(plan,plan.tasks[index]);
     this.onmessage({data:{type:"task",id,index,result}});
     processed++;
    }
    if(!this.terminated)this.onmessage({data:{type:"finished",id}});
   })();
  }
 });
}
const ablationPayload=()=>({
 action:"sensitivity",sensitivity_mode:"ablation",scenario:"collusion",
 config:{...DEFAULTS,n_agents:11,n_byzantine:2,trim_each_side:2,n_steps:16,
  attack_start_step:3,n_sensitivity_runs:3,parallel_workers:2}
});

test("UP-35 lease is acquired before async cache I/O and prevents overlapping runs",async()=>{
 await clearBrowserResults();
 const payload=ablationPayload();
 const first=runBrowserExperiment(payload,()=>{},{workerFactory:fakeWorkerFactory({delayMs:2})});
 await assert.rejects(runBrowserExperiment(payload,()=>{},{workerFactory:fakeWorkerFactory()}),/Другое вычисление/);
 const terminal=await first;
 assert.equal(terminal.state,"completed");
 assert.equal(terminal.result.partial,false);
 assert.equal(terminal.result.ablation_rows.length,12);
 assert.equal(terminal.result.completed_tasks,12);
 assert.equal(terminal.result.parallel_workers_used,2);
 const cached=await runBrowserExperiment(payload,()=>{},{workerFactory:()=>{throw Error("must not start worker on cache hit");}});
 assert.equal(cached.cache_hit,true);
 assert.deepEqual(cached.result.ablation_rows,terminal.result.ablation_rows);
});

test("UP-35 stopping and resuming preserves noncontiguous results, seeds and scientific outputs",async()=>{
 await clearBrowserResults();
 const payload=ablationPayload(),processed=[],progress=[];
 let stopRequested=false,stopPromise;
 const first=runBrowserExperiment(payload,update=>{
  progress.push(update);
  if(update.completed>=2&&!stopRequested){
   stopRequested=true;
   stopPromise=stopBrowserExperiment();
  }
 },{workerFactory:fakeWorkerFactory({delayMs:3,collect:processed})});
 const stopped=await first;
 assert.equal(await stopPromise,true);
 assert.equal(stopped.state,"stopped");
 assert.equal(stopped.result.partial,true);
 assert.ok(stopped.result.completed_tasks>=2&&stopped.result.completed_tasks<12);
 assert.ok(progress.at(-1).completed>=2);
 const pending=[],resumed=await runBrowserExperiment(payload,()=>{},{workerFactory:fakeWorkerFactory({delayMs:1,collect:pending})});
 assert.equal(resumed.state,"completed");
 assert.equal(resumed.cache_hit,false);
 assert.equal(resumed.result.partial,false);
 assert.equal(resumed.result.completed_tasks,12);
 assert.equal(pending.length,12-stopped.result.completed_tasks);
 assert.equal(new Set(pending).size,pending.length);
 const pure=runActionSync(payload);
 assert.deepEqual(resumed.result.ablation_rows,pure.ablation_rows);
 assert.deepEqual(resumed.result.ablation_contrasts,pure.ablation_contrasts);
 const cached=await runBrowserExperiment(payload,()=>{},{workerFactory:fakeWorkerFactory()});
 assert.equal(cached.cache_hit,true);
 await clearBrowserResults();
 const afterClear=await runBrowserExperiment(payload,()=>{},{workerFactory:fakeWorkerFactory()});
 assert.equal(afterClear.cache_hit,false);
});

test("UP-35 worker failures preserve completed checkpoints and resume only pending tasks",async()=>{
 await clearBrowserResults();
 const payload=ablationPayload(),firstProgress=[];
 await assert.rejects(runBrowserExperiment(payload,p=>firstProgress.push(p),{
  workerFactory:fakeWorkerFactory({delayMs:1,failAfter:1})
 }),/synthetic failure/);
 const completed=Math.max(...firstProgress.map(p=>p.completed));
 assert.ok(completed>=1);
 const resumedIndices=[];
 const recovered=await runBrowserExperiment(payload,()=>{},{
  workerFactory:fakeWorkerFactory({delayMs:1,collect:resumedIndices})
 });
 assert.equal(recovered.state,"completed");
 assert.equal(resumedIndices.length,12-completed);
 assert.deepEqual(recovered.result.ablation_rows,runActionSync(payload).ablation_rows);
});
test("UP-35 a worker cannot silently claim completion with tasks missing",async()=>{
 await clearBrowserResults();
 await assert.rejects(runBrowserExperiment(ablationPayload(),()=>{},{
  workerFactory:fakeWorkerFactory({premature:true})
 }),/невыполненными заданиями/);
});


test("UP-35 parallelism 1 vs 4 vs auto preserves all deterministic scientific results",async()=>{
 const baseline=runActionSync(ablationPayload());
 for(const workers of [1,4,0]){
  await clearBrowserResults();
  const payload=ablationPayload();
  payload.config.parallel_workers=workers;
  const assigned=[],progress=[];
  const value=await runBrowserExperiment(payload,p=>progress.push(p),{
   workerFactory:fakeWorkerFactory({delayMs:1,collect:assigned})
  });
  assert.equal(value.state,"completed");
  assert.equal(value.result.completed_tasks,12);
  assert.equal(value.result.partial,false);
  if(workers===0)assert.ok(value.result.parallel_workers_used>=1&&value.result.parallel_workers_used<=4);
  else assert.equal(value.result.parallel_workers_used,workers);
  assert.deepEqual(assigned.sort((a,b)=>a-b),Array.from({length:12},(_,i)=>i));
  assert.deepEqual(value.result.ablation_rows,baseline.ablation_rows);
  assert.deepEqual(value.result.ablation_contrasts,baseline.ablation_contrasts);
  assert.ok(progress.every(p=>p.completed>=0&&p.completed<=12));
  assert.equal(progress.at(-1).completed,12);
 }
});
test("UP-35 rejected IndexedDB opening must fail rather than silently pretend persistence",async()=>{
 await clearBrowserResults();
 const original=globalThis.indexedDB;
 globalThis.indexedDB={
  open(){
   const request={error:Error("IDB forced opening error")};
   queueMicrotask(()=>request.onerror?.());
   return request;
  }
 };
 try{
  const payload=ablationPayload();
  payload.config.seed=987654321;
  await assert.rejects(runBrowserExperiment(payload,()=>{},{
   workerFactory:fakeWorkerFactory()
  }),/Ошибка открытия IndexedDB/);
 }finally{
  if(original===undefined)delete globalThis.indexedDB;
  else globalThis.indexedDB=original;
 }
 assert.equal(await stopBrowserExperiment(),false);
});
test("UP-35 rejected persistent checkpoint transactions must not report completed work",async()=>{
 await clearBrowserResults();
 const original=globalThis.indexedDB;
 let writes=0;
 globalThis.indexedDB={
  open(){
   const db={
    objectStoreNames:{contains:()=>true},
    close(){},
    transaction(_store,mode){
     const tx={error:null};
     tx.objectStore=()=>({
      get(){
       const req={result:undefined,error:null};
       queueMicrotask(()=>req.onsuccess?.());
       return req;
      },
      put(){
       writes++;
       const req={error:null};
       queueMicrotask(()=>{
        tx.error=Error("simulated quota abort");
        tx.onabort?.();
       });
       return req;
      }
     });
     return tx;
    }
   };
   const req={result:db,error:null};
   queueMicrotask(()=>req.onsuccess?.());
   return req;
  }
 };
 try{
  const payload=ablationPayload();
  payload.config.seed=771132;
  await assert.rejects(runBrowserExperiment(payload,()=>{},{
   workerFactory:fakeWorkerFactory({delayMs:1})
  }),/Транзакция IndexedDB не завершена/);
  assert.ok(writes>0);
 }finally{
  if(original===undefined)delete globalThis.indexedDB;
  else globalThis.indexedDB=original;
 }
 assert.equal(await stopBrowserExperiment(),false);
});


test("UP-35 Web Locks deny overlapping work and cache clearing across independent tabs",async()=>{
 await clearBrowserResults();
 const previous=Object.getOwnPropertyDescriptor(globalThis,"navigator");
 let locked=false;
 const mock={
  request:async(name,options,callback)=>{
   assert.equal(name,TRUST_ORIGIN_LOCK);
   assert.equal(options.mode,"exclusive");
   assert.equal(options.ifAvailable,true);
   if(locked)return callback(null);
   locked=true;
   try{return await callback({name,mode:"exclusive"});}
   finally{locked=false;}
  }
 };
 let release;
 const hold=new Promise(resolve=>{release=resolve;});
 try{
  Object.defineProperty(globalThis,"navigator",{configurable:true,value:{locks:mock}});
  let acquired;
  const ready=new Promise(resolve=>{acquired=resolve;});
  const first=withOriginStorageLock(async()=>{acquired();await hold;});
  await ready;
  const payload=ablationPayload();
  payload.config.seed=333331;
  await assert.rejects(runBrowserExperiment(payload,()=>{},{
   workerFactory:fakeWorkerFactory()
  }),/другой вкладке/);
  await assert.rejects(clearBrowserResults(),/другой вкладке/);
  release();await first;
  const result=await runBrowserExperiment(payload,()=>{},{
   workerFactory:fakeWorkerFactory({delayMs:1})
  });
  assert.equal(result.state,"completed");
  assert.equal(locked,false);
 }finally{
  release?.();
  if(previous)Object.defineProperty(globalThis,"navigator",previous);
  else delete globalThis.navigator;
 }
});

test("UP-35 origin lock always releases after rejection so later jobs can start",async()=>{
 await clearBrowserResults();
 const previous=Object.getOwnPropertyDescriptor(globalThis,"navigator");
 let busy=false;
 try{
  Object.defineProperty(globalThis,"navigator",{configurable:true,value:{locks:{
   request:async(_name,_options,callback)=>{
    if(busy)return callback(null);
    busy=true;
    try{return await callback({name:TRUST_ORIGIN_LOCK});}
    finally{busy=false;}
   }
  }}});
  await assert.rejects(withOriginStorageLock(async()=>{throw Error("deliberate failure");}),/deliberate failure/);
  assert.equal(busy,false);
  const payload=ablationPayload();
  payload.config.seed=333332;
  const value=await runBrowserExperiment(payload,()=>{},{
   workerFactory:fakeWorkerFactory({delayMs:1})
  });
  assert.equal(value.state,"completed");
  assert.equal(busy,false);
 }finally{
  if(previous)Object.defineProperty(globalThis,"navigator",previous);
  else delete globalThis.navigator;
 }
});


test("UP-35 versioned checkpoint recovers exactly the completed (possibly noncontiguous) tasks",()=>{
 const payload=ablationPayload(),plan=makePlan(payload),key=cacheKeyForPayload(payload);
 const state=Array(plan.total).fill(null);
 for(const index of [0,5,11])state[index]=runTask(plan,plan.tasks[index]);
 const snap=snapshotCheckpoint(state,key,plan.total);
 assert.equal(snap.schemaVersion,TRUST_CHECKPOINT_SCHEMA);
 assert.equal(snap.modelVersion,TRUST_MODEL_VERSION);
 assert.equal(snap.cacheKey,key);
 assert.equal(snap.completed.length,3);
 assert.deepEqual(restoreCheckpoint(snap,key,plan),state);
 const fresh=restoreCheckpoint(null,key,plan);
 assert.equal(fresh.length,plan.total);
 assert.ok(fresh.every(v=>v===null));
 const old=restoreCheckpoint({completed:snap.completed},key,plan);
 assert.ok(old.every(v=>v===null),"unsafe unversioned snapshots must not be reused");
});
test("UP-35 checkpoint rejects version/key/length mismatch, duplicate indices and corrupt task data",()=>{
 const payload=ablationPayload(),plan=makePlan(payload),key=cacheKeyForPayload(payload);
 const state=Array(plan.total).fill(null);
 state[0]=runTask(plan,plan.tasks[0]);
 const snap=snapshotCheckpoint(state,key,plan.total);
 for(const patch of [
  {schemaVersion:TRUST_CHECKPOINT_SCHEMA+1},
  {cacheKey:key+"tampered"},
  {total:plan.total+1},
  {modelVersion:"wrong-version"},
  {completed:[...snap.completed,...snap.completed]},
  {completed:[{index:plan.total,result:state[0]}]},
  {completed:[{index:0,result:{rows:"invalid"}}]}
 ]){
  assert.throws(()=>restoreCheckpoint({...snap,...patch},key,plan),/контрольная точка/);
 }
});
