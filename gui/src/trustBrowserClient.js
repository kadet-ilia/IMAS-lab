import {makePlan,assembleResult} from "./trustEngine.js";

const memory=new Map();
let active=null;
const STORE="imas-lab-test-v1";
function openStore(){
 if(typeof indexedDB==="undefined")return Promise.resolve(null);
 return new Promise(resolve=>{
  let settled=false;const req=indexedDB.open(STORE,1);
  req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains("entries"))db.createObjectStore("entries");};
  req.onsuccess=()=>{settled=true;resolve(req.result);};
  req.onerror=()=>{if(!settled)resolve(null);};
  req.onblocked=()=>{if(!settled)resolve(null);};
 });
}
async function storage(key,value){
 if(arguments.length===1&&memory.has(key))return memory.get(key);
 const db=await openStore();
 if(arguments.length===2)memory.set(key,value);
 if(!db)return arguments.length===1?memory.get(key):undefined;
 return new Promise(resolve=>{
  let tx;try{tx=db.transaction("entries",arguments.length===1?"readonly":"readwrite");}
  catch{db.close();resolve(arguments.length===1?memory.get(key):undefined);return;}
  const req=arguments.length===1?tx.objectStore("entries").get(key):tx.objectStore("entries").put(value,key);
  req.onsuccess=()=>{db.close();resolve(arguments.length===1?req.result:undefined);};
  req.onerror=()=>{db.close();resolve(arguments.length===1?memory.get(key):undefined);};
 });
}
const canonical=(payload)=>JSON.stringify({action:payload.action||"trace",scenario:payload.scenario||"collusion",config:payload.config,sensitivity_mode:payload.sensitivity_mode||"one_factor",f_values:payload.f_values||null,factor_ranges:payload.factor_ranges||null,run_index:payload.run_index||0});
export function isBrowserOnly(){return true;}
export async function runBrowserExperiment(payload,onProgress=()=>{}){
 if(active)throw Error("Другое вычисление ещё выполняется");
 const key=canonical(payload),cached=await storage("complete:"+key);
 if(cached)return{result:cached,cache_hit:true,state:"completed"};
 const plan=makePlan(payload),partial=await storage("checkpoint:"+key),previous=Array.isArray(partial?.completed)?partial.completed:[];
 const worker=new Worker(new URL("./trustWorker.js",import.meta.url),{type:"module"});
 let resolvePromise,rejectPromise;
 const resultPromise=new Promise((resolve,reject)=>{resolvePromise=resolve;rejectPromise=reject;});
 const job={worker,key,plan,completed:previous,id:String(Date.now())+"-"+Math.random(),done:false,resolve:resolvePromise,reject:rejectPromise};
 active=job;
 worker.onmessage=async ({data})=>{
  if(job.done||data.id!==job.id)return;
  if(data.type==="progress"){
   if(data.checkpoint){
    job.completed=data.checkpoint;
    await storage("checkpoint:"+key,{completed:data.checkpoint});
   }
   onProgress({stage:data.stage,completed:data.completed,total:data.total,percent:Math.round(100*data.completed/Math.max(1,data.total)),message:data.message});
  }
  if(data.type==="completed"){
   job.done=true;active=null;worker.terminate();
   await storage("complete:"+key,data.result);
   await storage("checkpoint:"+key,null);
   job.resolve({result:data.result,cache_hit:false,state:"completed"});
  }
  if(data.type==="failed"){
   job.done=true;active=null;worker.terminate();job.reject(Error(data.error||"Ошибка JavaScript-модели"));
  }
 };
 worker.onerror=e=>{if(job.done)return;job.done=true;active=null;worker.terminate();job.reject(Error(e.message||"Вычислительный поток завершён с ошибкой"));};
 worker.postMessage({type:"run",id:job.id,payload,previous});
 return resultPromise;
}
export function stopBrowserExperiment(){
 const job=active;if(!job||job.done)return false;
 job.done=true;active=null;job.worker.terminate();
 if(!job.completed.length){job.reject(Error("Вычисления остановлены до получения результатов."));return true;}
 try{
  const result=assembleResult(job.plan,job.completed);
  result.partial=true;
  job.resolve({result,cache_hit:false,state:"stopped"});
 }catch(e){job.reject(e);}
 return true;
}
export async function removeBrowserCache(){
 const db=await openStore();memory.clear();if(!db)return;
 await new Promise(resolve=>{const tx=db.transaction("entries","readwrite");tx.objectStore("entries").clear();tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>{db.close();resolve();};});
}
