/**
 * E1-A browser orchestrator: versioned IndexedDB checkpoints and resumable runs.
 * The origin-wide lock is shared with E1 to avoid cross-tab cache races.
 */
import {validateAdaptiveStudy,summarizeAdaptiveRuns,ADAPTIVE_STUDY_VERSION} from "./adaptiveExperiment.js";
import {ADAPTIVE_MODEL_VERSION} from "./adaptiveDecisionEngine.js";
import {TRUST_MODEL_VERSION} from "./trustEngine.js";
import {withOriginStorageLock,loadLyapunovCacheRecord,saveLyapunovCacheRecord} from "./trustBrowserClient.js";

export const ADAPTIVE_CACHE_SCHEMA=1;
export const adaptiveCacheKey=(core,options)=>JSON.stringify({
 namespace:"imas-lab-E1A",schema:ADAPTIVE_CACHE_SCHEMA,
 trust:TRUST_MODEL_VERSION,adaptive:ADAPTIVE_MODEL_VERSION,study:ADAPTIVE_STUDY_VERSION,
 config:core,options
});
let activeJob=null;
export async function loadAdaptiveCheckpoint(core,options){
 const key=adaptiveCacheKey(core,options),record=await loadLyapunovCacheRecord(key);
 if(!record)return null;
 if(record.key!==key||record.schema!==ADAPTIVE_CACHE_SCHEMA||
  !Array.isArray(record.runs)||record.runs.some((r,i)=>r?.run!==i))
  throw Error("Повреждённая контрольная точка E1-А: несовместимая версия или порядок прогонов");
 return record;
}
async function saveCheckpoint(key,runs,result=null){
 await saveLyapunovCacheRecord(key,{
  schema:ADAPTIVE_CACHE_SCHEMA,key,updatedAt:new Date().toISOString(),
  completedRuns:runs.length,runs:[...runs],result
 });
}
export async function runAdaptiveBrowser(config,options,onProgress=()=>{}){
 return withOriginStorageLock(async()=>{
  if(activeJob)throw Error("Исследование E1-А уже выполняется");
  const {core,options:o}=validateAdaptiveStudy(config,options);
  const key=adaptiveCacheKey(core,o),cached=await loadAdaptiveCheckpoint(core,o);
  if(cached?.result&&!cached.result.partial&&cached.runs.length===o.runs){
   onProgress({completed:o.runs,total:o.runs,percent:100,cacheHit:true});
   return {result:cached.result,state:"completed",cacheHit:true};
  }
  const runs=cached?[...cached.runs]:[];
  if(runs.length>o.runs)throw Error("Кэш содержит больше прогонов, чем план");
  return new Promise((resolve,reject)=>{
   let worker;
   try{worker=new Worker(new URL("./adaptiveWorker.js",import.meta.url),{type:"module"});}
   catch(error){reject(error);return;}
   let settled=false,writing=Promise.resolve();
   const job={worker,stop:()=>{}};
   activeJob=job;
   const finish=(error,value)=>{
    if(settled)return;settled=true;worker.terminate();
    if(activeJob===job)activeJob=null;
    if(error)reject(error);else resolve(value);
   };
   job.stop=()=>{
    worker.terminate();
    writing.then(()=>finish(null,{state:"stopped",result:null,
      completedRuns:runs.length,total:o.runs,cacheHit:false})).catch(e=>finish(e));
   };
   worker.onerror=event=>finish(Error(event.message||"Ошибка вычислительного потока E1-А"));
   worker.onmessage=({data})=>{
    if(settled)return;
    if(data?.type==="run"){
     writing=writing.then(async()=>{
      if(data.index!==runs.length||data.value?.run!==data.index)
       throw Error("Нарушен порядок результатов E1-А");
      runs.push(data.value);
      await saveCheckpoint(key,runs);
      onProgress({completed:runs.length,total:o.runs,percent:100*runs.length/o.runs,cacheHit:false});
     }).catch(e=>{finish(e);throw e;});
    }else if(data?.type==="finished"){
     writing.then(async()=>{
      if(runs.length!==o.runs)throw Error("Worker завершился до выполнения всех прогонов");
      const result=summarizeAdaptiveRuns(runs,core,o);
      await saveCheckpoint(key,runs,result);
      finish(null,{result,state:"completed",cacheHit:false});
     }).catch(e=>finish(e));
    }else if(data?.type==="error")finish(Error(data.message||"Worker E1-А вернул ошибку"));
    else finish(Error("Неизвестный тип сообщения Worker E1-А"));
   };
   onProgress({completed:runs.length,total:o.runs,percent:100*runs.length/o.runs,
    cacheHit:Boolean(cached),resumed:runs.length>0});
   worker.postMessage({type:"run",config:core,options:o,startIndex:runs.length});
  });
 });
}
export async function stopAdaptiveBrowser(){
 if(!activeJob)return false;
 activeJob.stop();
 return true;
}
