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
