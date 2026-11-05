import {makePlan,assembleResult,TRUST_MODEL_VERSION} from "./trustEngine.js";

/**
 * IMAS_LaB_test: parallel browser workers, IndexedDB checkpoints, no backend.
 * Purely local results belong to the browser's origin and user profile.
 */
const memory=new Map(),STORE="imas-lab-test-trust-v3-remediation";
let active=null;
function openStore(){
 if(typeof indexedDB==="undefined")return Promise.resolve(null);
 return new Promise(resolve=>{
  const req=indexedDB.open(STORE,1);
  req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains("entries"))db.createObjectStore("entries");};
  req.onsuccess=()=>resolve(req.result);
  req.onerror=()=>resolve(null);
  req.onblocked=()=>resolve(null);
 });
}
async function storage(key,value){
 const read=arguments.length===1;
 if(read&&memory.has(key))return memory.get(key);
 const db=await openStore();
 if(!read)memory.set(key,value);
 if(!db)return read?memory.get(key):undefined;
 return new Promise(resolve=>{
  let tx;
  try{tx=db.transaction("entries",read?"readonly":"readwrite");}
  catch{db.close();resolve(read?memory.get(key):undefined);return;}
  const req=read?tx.objectStore("entries").get(key):tx.objectStore("entries").put(value,key);
  req.onsuccess=()=>{db.close();resolve(read?req.result:undefined);};
  req.onerror=()=>{db.close();resolve(read?memory.get(key):undefined);};
 });
}
export const cacheKeyForPayload=p=>JSON.stringify({modelVersion:TRUST_MODEL_VERSION,action:p.action||"trace",scenario:p.scenario||"collusion",config:p.config,sensitivity_mode:p.sensitivity_mode||"one_factor",f_values:p.f_values||null,factor_ranges:p.factor_ranges||null,run_index:p.run_index||0});
export const isBrowserOnly=()=>true;
export async function runBrowserExperiment(payload,onProgress=()=>{}){
 if(active)throw Error("Другое вычисление ещё выполняется");
 const key=cacheKeyForPayload(payload),cached=await storage("complete:"+key);
 if(cached)return{result:cached,cache_hit:true,state:"completed"};
 const plan=makePlan(payload),previous=await storage("checkpoint:"+key);
 const results=Array(plan.total).fill(null);
 for(const item of previous?.completed||[])if(item&&item.index>=0&&item.index<plan.total)results[item.index]=item.result;
 const pending=results.map((r,i)=>r===null?i:null).filter(x=>x!==null);
 if(!pending.length){const result=assembleResult(plan,results);result.parallel_workers_used=0;await storage("complete:"+key,result);return{result,cache_hit:true,state:"completed"};}
 const cores=Number(globalThis.navigator?.hardwareConcurrency)||2;
 const requested=Number(payload.config?.parallel_workers)||0;
 const count=Math.max(1,Math.min(pending.length,4,requested>0?requested:Math.max(1,cores-1)));
 const shards=Array.from({length:count},()=>[]);
 pending.forEach((task,i)=>shards[i%count].push(task));
 let resolveJob,rejectJob;
 const promise=new Promise((resolve,reject)=>{resolveJob=resolve;rejectJob=reject;});
 const job={key,plan,results,count:results.filter(x=>x!==null).length,workers:[],finished:0,done:false,resolve:resolveJob,reject:rejectJob};
 active=job;
 const progress=()=>onProgress({stage:plan.action,completed:job.count,total:plan.total,percent:Math.round(job.count*100/plan.total),message:"Параллельные вычисления в "+count+" браузерных потоках"});
 progress();
 const save=async()=>storage("checkpoint:"+key,{completed:results.map((result,index)=>result===null?null:{index,result}).filter(Boolean)});
 const finish=async()=>{
  if(job.done)return;job.done=true;active=null;job.workers.forEach(w=>w.terminate());
  try{const result=assembleResult(plan,results);if(plan.action!=="trace")result.parallel_workers_used=count;await storage("complete:"+key,result);await storage("checkpoint:"+key,null);job.resolve({result,cache_hit:false,state:"completed"});}
  catch(error){job.reject(error);}
 };
 const fail=(error)=>{if(job.done)return;job.done=true;active=null;job.workers.forEach(w=>w.terminate());job.reject(Error(String(error)));};
 for(let j=0;j<count;j++){
  const worker=new Worker(new URL("./trustWorker.js",import.meta.url),{type:"module"});
  job.workers.push(worker);
  worker.onmessage=({data})=>{
   if(job.done)return;
   if(data.type==="failed"){fail(data.error||"Ошибка вычислительного потока");return;}
   if(data.type==="task"){
    if(results[data.index]===null){results[data.index]=data.result;job.count++;progress();
      if(job.count===plan.total||job.count%Math.max(1,Math.floor(plan.total/30))===0)void save();}
   }
   if(data.type==="finished"){job.finished++;if(job.finished===count)void finish();}
  };
  worker.onerror=e=>fail(e.message||"Поток завершился с ошибкой");
  worker.postMessage({type:"run",id:j,payload,indices:shards[j]});
 }
 return promise;
}
export async function stopBrowserExperiment(){
 const job=active;if(!job||job.done)return false;
 job.done=true;active=null;job.workers.forEach(w=>w.terminate());
 await storage("checkpoint:"+job.key,{completed:job.results.map((result,index)=>result===null?null:{index,result}).filter(Boolean)});
 if(!job.count){job.reject(Error("Расчет остановлен до получения результатов"));return true;}
 try{
  const completed=job.results.filter(Boolean),result=assembleResult(job.plan,completed);
  if(job.plan.action!=="trace")result.parallel_workers_used=job.workers.length;
  // For a partial Monte-Carlo run ordering can be sparse; completed run data
  // are aggregated, while IDs are retained in the checkpoint for exact resume.
  result.partial=true;job.resolve({result,state:"stopped",cache_hit:false});
 }catch(error){job.reject(error);}
 return true;
}
export async function clearBrowserResults(){
 memory.clear();const db=await openStore();if(!db)return;
 await new Promise(resolve=>{const tx=db.transaction("entries","readwrite");tx.objectStore("entries").clear();tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>{db.close();resolve();};});
}
