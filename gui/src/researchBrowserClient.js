import {withOriginStorageLock} from "./trustBrowserClient.js";
import {validateStudy,validateResearchCheckpoint,researchCheckpointUnits,
 RESEARCH_CHECKPOINT_SCHEMA,RESEARCH_MODEL_VERSION} from "./research2027.js";
import {STATISTICS_VERSION} from "./statistics2027.js";
import {auditResultMetrics} from "./metricPassport.js";
import {auditResearchInference} from "./researchStatisticalAudit.js";

/**
 * Scientific E2-E6 checkpoints. A worker processes exactly one complete
 * scenario/source per stage, then waits for an IndexedDB COMMIT ACK.
 * A process interruption can lose an unacknowledged stage, but cannot
 * mark that stage saved. E4 is a single bounded formal-search stage.
 */
export const RESEARCH_STORAGE_SCHEMA=2;
const DATABASE="imas-lab-research-checkpoints-v2",STORE="entries",memory=new Map();
const hex=bytes=>Array.from(new Uint8Array(bytes),x=>x.toString(16).padStart(2,"0")).join("");
async function contentDigest(key,payload){
 if(!globalThis.crypto?.subtle||typeof TextEncoder==="undefined")
  throw Error("Криптографический SHA-256 недоступен; результаты нельзя безопасно кешировать");
 const data=new TextEncoder().encode(JSON.stringify({key,payload}));
 return hex(await globalThis.crypto.subtle.digest("SHA-256",data));
}
async function sealRecord(key,payload){
 return {schemaVersion:RESEARCH_STORAGE_SCHEMA,key,sha256:await contentDigest(key,payload),payload};
}
async function unsealRecord(key,record){
 if(!record||record.schemaVersion!==RESEARCH_STORAGE_SCHEMA||record.key!==key||
  !/^[a-f0-9]{64}$/.test(record.sha256||""))
  throw Error("Повреждённый либо несовместимый кэш исследования: неверный конверт");
 const actual=await contentDigest(key,record.payload);
 if(actual!==record.sha256)throw Error("Повреждённый кэш исследования: SHA-256 не совпадает");
 return record.payload;
}
function auditCachedResult(id,config,result){
 if(result?.id!==id||result?.modelVersion!==RESEARCH_MODEL_VERSION||
  result?.statisticsVersion!==STATISTICS_VERSION||JSON.stringify(result.config)!==JSON.stringify(config))
  throw Error("Кэш исследования относится к другой версии или конфигурации");
 const metrics=auditResultMetrics(id,result),stats=auditResearchInference(id,config,result);
 if(!metrics.valid||!stats.valid||result.metricIntegrity?.valid!==true||
  result.statisticsAudit?.valid!==true)
  throw Error("Контроль сохранённого исследования не пройден: "+[...metrics.issues,...stats.issues].join("; "));
 return result;
}
let active=null,pendingLease=false,cancelPendingLease=false;
export function researchKey(id,raw){
 const config=validateStudy(id,raw);
 return JSON.stringify({schema:RESEARCH_STORAGE_SCHEMA,modelVersion:RESEARCH_MODEL_VERSION,
  statisticsVersion:STATISTICS_VERSION,id,config});
}
const cancelled=()=>Error("Вычисление остановлено до получения завершённого результата");
async function openDb(){
 if(typeof indexedDB==="undefined"){
  if(typeof window!=="undefined")throw Error("Для контрольных точек необходим IndexedDB");
  return null;
 }
 return new Promise((resolve,reject)=>{
  let request;
  try{request=indexedDB.open(DATABASE,1);}catch(err){reject(err);return;}
  request.onupgradeneeded=()=>{
   if(!request.result.objectStoreNames.contains(STORE))request.result.createObjectStore(STORE);
  };
  request.onsuccess=()=>resolve(request.result);
  request.onerror=()=>reject(Error("IndexedDB: "+(request.error?.message||"ошибка открытия")));
  request.onblocked=()=>reject(Error("IndexedDB заблокирована другой вкладкой"));
 });
}
async function access(key,value,write=false){
 const db=await openDb();
 if(!db){if(write){if(value===null)memory.delete(key);else memory.set(key,value);return;}return memory.get(key);}
 return new Promise((resolve,reject)=>{
  let settled=false,data;
  const finish=(error=null)=>{
   if(settled)return;settled=true;
   try{db.close();}catch{}
   if(error)reject(Error("Ошибка транзакции IndexedDB: "+(error?.message||String(error))));
   else resolve(data);
  };
  try{
   const transaction=db.transaction(STORE,write?"readwrite":"readonly");
   const request=write?(value===null?transaction.objectStore(STORE).delete(key):transaction.objectStore(STORE).put(value,key)):transaction.objectStore(STORE).get(key);
   if(!write)request.onsuccess=()=>{data=request.result;};
   transaction.oncomplete=()=>finish();
   transaction.onerror=()=>finish(transaction.error||request.error);
   transaction.onabort=()=>finish(transaction.error||request.error);
   request.onerror=()=>finish(request.error);
  }catch(error){finish(error);}
 });
}
export async function clearResearchCheckpoints(){
 if(active||pendingLease)throw Error("Нельзя очищать результаты исследований во время вычислений");
 return withOriginStorageLock(async()=>{
  if(active)throw Error("Вычисление ещё выполняется");
  const db=await openDb();
  if(!db){memory.clear();return;}
  return new Promise((resolve,reject)=>{
   let settled=false;
   const finish=(e=null)=>{
    if(settled)return;settled=true;db.close();
    if(e)reject(e);else{memory.clear();resolve();}
   };
   try{
    const tx=db.transaction(STORE,"readwrite");
    tx.objectStore(STORE).clear();
    tx.oncomplete=()=>finish();
    tx.onerror=()=>finish(tx.error||Error("clear failed"));
    tx.onabort=()=>finish(tx.error||Error("clear aborted"));
   }catch(e){finish(e);}
  });
 });
}
async function runUnlocked(id,config,key,onProgress,options){
 if(active)throw Error("Другое исследовательское вычисление уже выполняется");
 const job={id,key,worker:null,stopRequested:false,done:false,finishing:false,
  saveChain:Promise.resolve(),stop:null};
 active=job;
 try{
  const completed=await access("complete:"+key);
  if(job.stopRequested)throw cancelled();
  if(completed!==undefined){
   const verified=auditCachedResult(id,config,await unsealRecord("complete:"+key,completed));
   return {state:"completed",result:verified,cache_hit:true,resumed_units:0};
  }
  const stored=await access("checkpoint:"+key);
  if(job.stopRequested)throw cancelled();
  const checkpoint=stored===undefined?null:await unsealRecord("checkpoint:"+key,stored);
  if(checkpoint)validateResearchCheckpoint(id,config,checkpoint);
  const total=researchCheckpointUnits(id,config);
  let next=checkpoint?.nextScenario||0;
  let resolveJob,rejectJob;
  const promise=new Promise((resolve,reject)=>{resolveJob=resolve;rejectJob=reject;});
  const terminate=()=>{try{job.worker?.terminate();}catch{}};
  const progress=()=>onProgress({completed:next,total,percent:Math.round(100*next/total),
   message:"Завершено и сохранено стадий: "+next+"/"+total});
  const fail=async(error)=>{
   if(job.done||job.stopRequested||job.finishing)return;
   job.done=true;terminate();
   try{await job.saveChain;}catch{}
   rejectJob(error instanceof Error?error:Error(String(error)));
  };
  job.stop=async()=>{
   if(job.done||job.finishing||job.stopRequested)return false;
   job.stopRequested=true;terminate();
   try{
    await job.saveChain;
    job.done=true;
    resolveJob({state:"stopped",result:null,cache_hit:false,resumed_units:checkpoint?.nextScenario||0,
     saved_units:next,total_units:total});
   }catch(error){job.done=true;rejectJob(error);}
   return true;
  };
  try{
   const worker=options.workerFactory?
    options.workerFactory():new Worker(new URL("./research2027.worker.js",import.meta.url),{type:"module"});
   job.worker=worker;
   worker.onmessage=({data})=>{
    if(job.stopRequested||job.done||job.finishing)return;
    if(data?.type==="checkpoint"){
     const state=data.state;
     try{
      validateResearchCheckpoint(id,config,state);
      if(state.nextScenario!==next+1||state.nextScenario>=total)
       throw Error("Контрольная точка имеет неверный порядок стадий");
      next=state.nextScenario;
      job.saveChain=job.saveChain.then(async()=>{
       const sealed=await sealRecord("checkpoint:"+key,state);
       await access("checkpoint:"+key,sealed,true);
      });
      job.saveChain.then(()=>{
       if(job.stopRequested||job.done)return;
       try{progress();if(!job.stopRequested&&!job.done)worker.postMessage({type:"continue",nextScenario:state.nextScenario});}
       catch(e){void fail(e);}
      }).catch(e=>void fail(e));
     }catch(error){void fail(error);}
    }else if(data?.type==="result"){
     if(id!=="petri"&&next!==total-1) {void fail(Error("Результат получен без выполнения всех стадий"));return;}
     if(data.result?.id!==id||data.result.modelVersion!==RESEARCH_MODEL_VERSION||
       !data.result.metricIntegrity?.valid){void fail(Error("Worker вернул недостоверный результат"));return;}
     job.finishing=true;terminate();
     void(async()=>{
      try{
       await job.saveChain;
       auditCachedResult(id,config,data.result);
       await access("complete:"+key,await sealRecord("complete:"+key,data.result),true);
       await access("checkpoint:"+key,null,true);
       job.done=true;
       resolveJob({state:"completed",result:data.result,cache_hit:false,resumed_units:checkpoint?.nextScenario||0});
      }catch(error){job.done=true;rejectJob(error);}
     })();
    }else if(data?.type==="error")void fail(Error(data.error||"Ошибка Worker"));
    else void fail(Error("Неизвестный ответ исследовательского Worker"));
   };
   worker.onerror=event=>{void fail(Error(event.message||"Ошибка исследовательского Worker"));};
   progress();
   worker.postMessage({type:"start",id,config,checkpoint});
  }catch(e){void fail(e);}
  return await promise;
 }finally{job.done=true;if(active===job)active=null;}
}
/** Returns completed result or explicitly stopped state, never a fabricated partial result. */
export async function runResearchBrowser(id,raw,onProgress=()=>{},options={}){
 if(active||pendingLease)throw Error("Другое исследовательское вычисление уже выполняется");
 const config=validateStudy(id,raw),key=researchKey(id,config);
 // Reserve the local lease before any asynchronous Web Locks acquisition.
 pendingLease=true;cancelPendingLease=false;
 try{
  return await withOriginStorageLock(()=>{
   pendingLease=false;
   if(cancelPendingLease)throw cancelled();
   return runUnlocked(id,config,key,onProgress,options);
  });
 }finally{pendingLease=false;cancelPendingLease=false;}
}
export async function stopResearchBrowser(){
 if(pendingLease&&!active){cancelPendingLease=true;return true;}
 const job=active;
 if(!job||job.done||job.stopRequested||job.finishing)return false;
 if(!job.stop){job.stopRequested=true;return true;}
 return job.stop();
}
