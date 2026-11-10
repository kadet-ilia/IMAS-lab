import test from "node:test";
import assert from "node:assert/strict";
import {runResearchBrowser,stopResearchBrowser,clearResearchCheckpoints,
 researchKey,RESEARCH_STORAGE_SCHEMA} from "./researchBrowserClient.js";
import {executeStudy,executeStudyChunk,RESEARCH_MODEL_VERSION} from "./research2027.js";

const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function workerFactory({delayMs=1,collect=[]}={}){
 return ()=>({
  terminated:false,onmessage:null,onerror:null,
  terminate(){this.terminated=true;},
  postMessage(data){
   if(this.terminated)return;
   if(!["start","continue"].includes(data.type))throw Error("bad worker protocol");
   if(data.type==="start"){this.id=data.id;this.config=data.config;this.state=data.checkpoint;}
   else if(data.nextScenario!==this.state?.nextScenario)throw Error("wrong checkpoint ACK");
   setTimeout(()=>{
    if(this.terminated)return;
    try{
     const out=executeStudyChunk(this.id,this.config,this.state);
     collect.push(out.completedUnits);
     if(out.done)this.onmessage({data:{type:"result",result:out.result}});
     else{this.state=out.state;this.onmessage({data:{type:"checkpoint",state:out.state,
       completedUnits:out.completedUnits,totalUnits:out.totalUnits}});}
    }catch(error){this.onmessage({data:{type:"error",error:String(error)}});}
   },delayMs);
  }
 });
}
const compare=r=>{const out=structuredClone(r);delete out.elapsedMs;return out;};
const configs={
 uncertainty:{runs:17,agents:21,seed:431},
 probgraph:{runs:17,agents:20,steps:5,seed:432},
 cascade:{runs:17,seed:433},
 misinformation:{runs:17,seed:434},
 petri:{agents:7,runs:1,steps:3,stateLimit:4000,seed:435}
};
test("NZ-14 research cache keys include model and physical configuration",()=>{
 const key=JSON.parse(researchKey("uncertainty",configs.uncertainty));
 assert.equal(key.modelVersion,RESEARCH_MODEL_VERSION);
 assert.equal(key.schema,RESEARCH_STORAGE_SCHEMA);
 assert.notEqual(researchKey("uncertainty",configs.uncertainty),
  researchKey("uncertainty",{...configs.uncertainty,seed:432}));
});
for(const [id,config] of Object.entries(configs)){
 test("NZ-14 durable checkpoint, interrupted resume and cache: "+id,async()=>{
  await clearResearchCheckpoints();
  let stopPromise=null;
  const processed=[],first=runResearchBrowser(id,config,progress=>{
   if(id!=="petri"&&progress.completed>=1&&!stopPromise)
    stopPromise=stopResearchBrowser();
  },{workerFactory:workerFactory({delayMs:3,collect:processed})});
  const partial=await first;
  if(id!=="petri"){
   assert.equal(partial.state,"stopped");
   assert.equal(await stopPromise,true);
   assert.ok(partial.saved_units>=1);
   assert.ok(partial.saved_units<partial.total_units);
  }else{
   assert.equal(partial.state,"completed");
  }
  const pending=[],resumed=await runResearchBrowser(id,config,()=>{},
   {workerFactory:workerFactory({delayMs:1,collect:pending})});
  assert.equal(resumed.state,"completed");
  if(id!=="petri")assert.ok(resumed.resumed_units>=1);
  assert.deepEqual(compare(resumed.result),compare(executeStudy(id,config)));
  assert.ok(resumed.result.metricIntegrity.valid);
  const cached=await runResearchBrowser(id,config,()=>{},
   {workerFactory:()=>{throw Error("cached result must not launch a worker");}});
  assert.equal(cached.cache_hit,true);
  assert.deepEqual(compare(cached.result),compare(resumed.result));
 });
}
test("NZ-14 concurrent research jobs are rejected before cache access",async()=>{
 await clearResearchCheckpoints();
 const c=configs.cascade;
 const one=runResearchBrowser("cascade",c,()=>{},{workerFactory:workerFactory({delayMs:6})});
 await assert.rejects(runResearchBrowser("cascade",c,()=>{},
  {workerFactory:workerFactory()}),/вычисление|вкладке|Другое/);
 assert.equal((await one).state,"completed");
});

test("NZ-14 immediate cancellation during async cache initialization cannot start a worker",async()=>{
 await clearResearchCheckpoints();
 let created=0;
 const pending=runResearchBrowser("uncertainty",{...configs.uncertainty,seed:907},()=>{},{
  workerFactory:()=>{created++;throw Error("Early cancellation must prevent Worker creation");}
 });
 const stopped=await stopResearchBrowser();
 assert.equal(stopped,true);
 await assert.rejects(pending,/остановлено|отменено/);
 assert.equal(created,0);
});

test("UP-35 worker failure propagates and the storage lease is recoverable",async()=>{
 await clearResearchCheckpoints();
 const config={...configs.uncertainty,seed:1501};
 const broken=()=>({
  onmessage:null,onerror:null,terminate(){},
  postMessage(){this.onmessage({data:{type:"error",error:"injected worker failure"}});}
 });
 await assert.rejects(runResearchBrowser("uncertainty",config,()=>{},
  {workerFactory:broken}),/injected worker failure/);
 const recovered=await runResearchBrowser("uncertainty",config,()=>{},
  {workerFactory:workerFactory({delayMs:1})});
 assert.equal(recovered.state,"completed");
 assert.equal(recovered.result.metricIntegrity.valid,true);
});

test("UP-35 half-complete scenario archives survive stop/resume exactly",async()=>{
 await clearResearchCheckpoints();
 const config={...configs.probgraph,seed:1502,runs:7,
  record_source_runs:1,source_run_limit:7,source_event_limit:20000};
 let pendingStop=null;
 const result=await runResearchBrowser("probgraph",config,progress=>{
  if(progress.completed===2&&!pendingStop)pendingStop=stopResearchBrowser();
 },{workerFactory:workerFactory({delayMs:2})});
 assert.equal(result.state,"stopped");
 assert.equal(await pendingStop,true);
 assert.equal(result.saved_units,2);
 const resumed=await runResearchBrowser("probgraph",config,()=>{},
  {workerFactory:workerFactory({delayMs:1})});
 assert.equal(resumed.resumed_units,2);
 assert.equal(resumed.result.sourceRunJournal.entries.length,4*config.runs);
 assert.deepEqual(compare(resumed.result),compare(executeStudy("probgraph",config)));
});

test("UP-35 failed IndexedDB initialization aborts before creating a Worker",async()=>{
 await clearResearchCheckpoints();
 const had=Object.hasOwn(globalThis,"indexedDB"),old=globalThis.indexedDB;
 let created=0;
 try{
  globalThis.indexedDB={open(){throw Error("QuotaExceededError: simulated storage failure");}};
  await assert.rejects(runResearchBrowser("uncertainty",{...configs.uncertainty,seed:1503},
   ()=>{},{workerFactory:()=>{created++;throw Error("Worker should never start");}}),
   /QuotaExceededError/);
  assert.equal(created,0);
 }finally{
  if(had)globalThis.indexedDB=old;
  else delete globalThis.indexedDB;
 }
 const clean=await runResearchBrowser("uncertainty",{...configs.uncertainty,seed:1503},
  ()=>{},{workerFactory:workerFactory({delayMs:1})});
 assert.equal(clean.state,"completed");
});

test("UP-35 quota abort during checkpoint COMMIT cannot claim a saved stage or final result",async()=>{
 await clearResearchCheckpoints();
 const exists=Object.hasOwn(globalThis,"indexedDB"),original=globalThis.indexedDB;
 let writes=0;
 try{
  const db={objectStoreNames:{contains:()=>true},close(){},
   transaction(_name,mode){
    const tx={oncomplete:null,onabort:null,onerror:null,error:null,
     objectStore(){
      return {
       get(){
        const request={result:undefined,onsuccess:null,onerror:null};
        queueMicrotask(()=>{request.onsuccess?.();tx.oncomplete?.();});
        return request;
       },
       put(){
        writes++;
        const request={onerror:null};
        queueMicrotask(()=>{tx.error=Error("QuotaExceededError: injected quota abort");tx.onabort?.();});
        return request;
       },
       delete(){
        const request={onerror:null};
        queueMicrotask(()=>tx.oncomplete?.());
        return request;
       }
      };
     }};
    return tx;
   }};
  globalThis.indexedDB={open(){
   const req={result:db,onupgradeneeded:null,onsuccess:null,onerror:null,onblocked:null};
   queueMicrotask(()=>req.onsuccess?.());
   return req;
  }};
  const c={agents:7,runs:5,seed:1551};
  await assert.rejects(runResearchBrowser("uncertainty",c,()=>{},
   {workerFactory:workerFactory({delayMs:1})}),/QuotaExceededError/);
  assert.ok(writes>=1,"first checkpoint was never attempted");
 }finally{
  if(exists)globalThis.indexedDB=original;
  else delete globalThis.indexedDB;
 }
 const c={agents:7,runs:5,seed:1551};
 const next=await runResearchBrowser("uncertainty",c,()=>{},
  {workerFactory:workerFactory({delayMs:1})});
 assert.equal(next.cache_hit,false);
 assert.equal(next.resumed_units,0,"aborted checkpoint was incorrectly claimed durable");
 assert.deepEqual(compare(next.result),compare(executeStudy("uncertainty",c)));
});
