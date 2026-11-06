import {makePlan,assembleResult,TRUST_MODEL_VERSION} from "./trustEngine.js";

/**
 * Browser-only execution with an exclusive job lease and strictly serialized
 * checkpoint writes. All scientific results remain local to this origin.
 */
const memory=new Map(),STORE="imas-lab-test-trust-v3-remediation";
// The same origin stores ALL trust experiments in a single IndexedDB database.
// Cross-tab lock covers reads, writes, checkpoints, and clearing as one atomic
// browser-facing job. Other tabs fail fast rather than running concurrently.
export const TRUST_ORIGIN_LOCK="imas-lab-test-trust-storage-exclusive-v1";
export async function withOriginStorageLock(task){
 const locks=globalThis.navigator?.locks;
 if(locks?.request){
  return locks.request(TRUST_ORIGIN_LOCK,{mode:"exclusive",ifAvailable:true},async lock=>{
   if(!lock)throw Error("Другое вычисление или очистка данных выполняется в другой вкладке. Завершите её перед повторным запуском.");
   return task();
  });
 }
 // A fallback process-local lease cannot protect IndexedDB against another tab.
 // Fail closed on browsers lacking Web Locks, but allow Node unit tests without
 // a browser DOM to exercise pure storage orchestration.
 if(typeof window!=="undefined")
  throw Error("Браузер не поддерживает Web Locks: безопасная межвкладочная запись недоступна.");
 return task();
}
let active=null;

function openStore(){
 if(typeof indexedDB==="undefined")return Promise.resolve(null);
 return new Promise((resolve,reject)=>{
  let req;
  try{req=indexedDB.open(STORE,1);}
  catch(error){reject(Error("Невозможно открыть IndexedDB: "+String(error)));return;}
  req.onupgradeneeded=()=>{
   const db=req.result;
   if(!db.objectStoreNames.contains("entries"))db.createObjectStore("entries");
  };
  req.onsuccess=()=>resolve(req.result);
  req.onerror=()=>reject(Error("Ошибка открытия IndexedDB: "+(req.error?.message||"неизвестная причина")));
  req.onblocked=()=>reject(Error("IndexedDB заблокирована другой вкладкой"));
 });
}
async function storage(key,value){
 const read=arguments.length===1;
 // Never trust a browser tab's in-memory cache: another tab may have cleared
 // or updated the persistent record while this tab was idle.
 if(read&&typeof indexedDB==="undefined"&&memory.has(key))return memory.get(key);
 const db=await openStore();
 // Memory-only operation is explicit only where the IndexedDB API is absent
 // (e.g. Node-based tests). If an existing browser IDB is unavailable or its
 // transaction aborts, reject instead of claiming that an unsaved checkpoint
 // or final result has been persisted.
 if(!db){
  if(!read)memory.set(key,value);
  return read?memory.get(key):undefined;
 }
 return new Promise((resolve,reject)=>{
  let tx,req,settled=false;
  const close=()=>{try{db.close();}catch{}};
  const success=v=>{
   if(settled)return;settled=true;
   if(read){
    if(v===undefined)memory.delete(key);
    else memory.set(key,v);
   }else memory.set(key,value);
   close();resolve(v);
  };
  const failure=error=>{
   if(settled)return;settled=true;close();
   reject(Error("Транзакция IndexedDB не завершена: "+(error?.message||"неизвестная причина")));
  };
  try{
   tx=db.transaction("entries",read?"readonly":"readwrite");
   req=read?tx.objectStore("entries").get(key):tx.objectStore("entries").put(value,key);
   // A write is considered saved only after readwrite transaction commit.
   if(read)req.onsuccess=()=>success(req.result);
   else tx.oncomplete=()=>success(undefined);
   tx.onerror=()=>failure(tx.error||req.error);
   tx.onabort=()=>failure(tx.error||req.error);
   req.onerror=()=>failure(req.error);
  }catch(error){failure(error);}
 });
}
export const cacheKeyForPayload=p=>JSON.stringify({
 modelVersion:TRUST_MODEL_VERSION,
 action:p.action||"trace",scenario:p.scenario||"collusion",config:p.config,
 sensitivity_mode:p.sensitivity_mode||"one_factor",f_values:p.f_values||null,
 factor_ranges:p.factor_ranges||null,run_index:p.run_index||0
});
export const isBrowserOnly=()=>true;
const snapshot=results=>({completed:results.map((result,index)=>result===null?null:{index,result}).filter(Boolean)});
const stoppedError=()=>Error("Расчет остановлен до получения результатов");

async function runBrowserExperimentUnlocked(payload,onProgress=()=>{},options={}){
 // Reserve the lease BEFORE the first asynchronous cache read. Otherwise two
 // near-simultaneous calls can both pass the old active check.
 if(active)throw Error("Другое вычисление ещё выполняется");
 const key=cacheKeyForPayload(payload);
 const job={key,phase:"initializing",stopRequested:false,done:false,finishing:false,
  workers:[],saveChain:Promise.resolve(),results:null,plan:null,count:0};
 active=job;
 const release=()=>{if(active===job)active=null;};
 try{
  const cached=await storage("complete:"+key);
  if(job.stopRequested)throw stoppedError();
  if(cached)return {result:cached,cache_hit:true,state:"completed"};
  const plan=makePlan(payload);
  job.plan=plan;
  const previous=await storage("checkpoint:"+key);
  if(job.stopRequested)throw stoppedError();
  const results=Array(plan.total).fill(null);
  for(const item of previous?.completed||[]){
   if(item&&Number.isInteger(item.index)&&item.index>=0&&item.index<plan.total&&item.result!=null)
    results[item.index]=item.result;
  }
  job.results=results;
  job.count=results.filter(v=>v!==null).length;
  const pending=results.map((v,i)=>v===null?i:null).filter(v=>v!==null);
  if(!pending.length){
   const result=assembleResult(plan,results);
   result.parallel_workers_used=0;
   await storage("complete:"+key,result);
   await storage("checkpoint:"+key,null);
   return {result,cache_hit:true,state:"completed"};
  }
  const requested=Number(payload.config?.parallel_workers)||0;
  const cores=Number(globalThis.navigator?.hardwareConcurrency)||2;
  const count=Math.max(1,Math.min(pending.length,4,requested>0?requested:Math.max(1,cores-1)));
  const shards=Array.from({length:count},()=>[]);
  pending.forEach((task,i)=>shards[i%count].push(task));
  const expected=shards.map(a=>new Set(a));
  const finished=new Set();
  let resolveJob,rejectJob;
  const completion=new Promise((resolve,reject)=>{resolveJob=resolve;rejectJob=reject;});
  job.phase="running";
  const terminate=()=>job.workers.forEach(w=>{try{w.terminate();}catch{}});
  const save=()=>{
   const state=snapshot(results); // Immutable snapshot at scheduling time.
   job.saveChain=job.saveChain.then(()=>storage("checkpoint:"+key,state));
   return job.saveChain;
  };
  const progress=()=>onProgress({
   stage:plan.action,completed:job.count,total:plan.total,
   percent:Math.round(job.count*100/plan.total),
   message:"Параллельные вычисления в "+count+" браузерных потоках"
  });
  const fail=async reason=>{
   if(job.done||job.finishing||job.stopRequested)return;
   job.done=true;terminate();
   try{await job.saveChain;await save();}catch{}
   rejectJob(reason instanceof Error?reason:Error(String(reason)));
  };
  const finish=async()=>{
   if(job.done||job.finishing||job.stopRequested)return;
   job.finishing=true;terminate();
   try{
    if(job.count!==plan.total)throw Error("Неполный результат: Worker сообщил завершение до выполнения всех задач");
    await job.saveChain;
    const result=assembleResult(plan,results);
    if(plan.action!=="trace")result.parallel_workers_used=count;
    await storage("complete:"+key,result);
    await storage("checkpoint:"+key,null);
    job.done=true;
    resolveJob({result,cache_hit:false,state:"completed"});
   }catch(error){job.done=true;rejectJob(error);}
  };
  job.stop=async()=>{
   if(job.done||job.finishing||job.stopRequested)return false;
   job.stopRequested=true;terminate();
   try{
    await job.saveChain;
    await save(); // Flush all already accepted task messages in order.
    job.done=true;
    if(!job.count){rejectJob(stoppedError());return true;}
    const completed=results.filter(v=>v!==null),result=assembleResult(plan,completed);
    if(plan.action!=="trace")result.parallel_workers_used=count;
    result.partial=true;
    resolveJob({result,state:"stopped",cache_hit:false});
   }catch(error){job.done=true;rejectJob(error);}
   return true;
  };
  const makeWorker=options.workerFactory||(()=>new Worker(new URL("./trustWorker.js",import.meta.url),{type:"module"}));
  try{
   for(let j=0;j<count;j++){
    if(job.stopRequested)break;
    const worker=makeWorker(j);
    job.workers.push(worker);
    worker.onmessage=({data})=>{
     if(job.done||job.stopRequested||job.finishing)return;
     if(data?.id!==j){void fail(Error("Несовпадение идентификатора Worker"));return;}
     if(data.type==="failed"){void fail(data.error||"Ошибка вычислительного потока");return;}
     if(data.type==="task"){
      if(!expected[j].has(data.index)||!data.result){
       void fail(Error("Worker вернул неверный индекс или пустой результат"));return;
      }
      if(results[data.index]!==null){void fail(Error("Worker повторно вернул задачу "+data.index));return;}
      expected[j].delete(data.index);
      results[data.index]=data.result;job.count++;
      try{progress();}catch(error){void fail(error);return;}
      if(job.count===plan.total||job.count%Math.max(1,Math.floor(plan.total/30))===0)
       void save().catch(fail);
     }else if(data.type==="finished"){
      if(expected[j].size){void fail(Error("Worker завершён с "+expected[j].size+" невыполненными заданиями"));return;}
      if(finished.has(j)){void fail(Error("Повторное завершение Worker"));return;}
      finished.add(j);
      if(finished.size===count)void finish();
     }else void fail(Error("Неизвестный тип сообщения Worker"));
    };
    worker.onerror=event=>{void fail(event.message||"Поток завершился с ошибкой");};
    worker.postMessage({type:"run",id:j,payload,indices:shards[j]});
   }
   if(!job.stopRequested)progress();
  }catch(error){void fail(error);}
  return await completion;
 }finally{job.done=true;release();}
}

export async function runBrowserExperiment(payload,onProgress=()=>{},options={}){
 if(active)throw Error("Другое вычисление ещё выполняется");
 return withOriginStorageLock(()=>runBrowserExperimentUnlocked(payload,onProgress,options));
}
export async function stopBrowserExperiment(){
 const job=active;
 if(!job||job.done||job.finishing||job.stopRequested)return false;
 if(job.phase==="initializing"){
  job.stopRequested=true; // The owner observes the cancellation after cache I/O.
  return true;
 }
 return job.stop();
}
async function clearBrowserResultsUnlocked(){
 if(active)throw Error("Нельзя очищать результаты во время вычислений");
 // Never clear memory until persistent clearing has committed successfully.
 const db=await openStore();if(!db){memory.clear();return;}
 await new Promise((resolve,reject)=>{
  let tx,settled=false;
  const done=(error=null)=>{
   if(settled)return;settled=true;db.close();
   if(error)reject(Error("Не удалось очистить IndexedDB: "+(error.message||"транзакция отклонена")));
   else{memory.clear();resolve();}
  };
  try{
   tx=db.transaction("entries","readwrite");
   tx.objectStore("entries").clear();
   tx.oncomplete=()=>done();
   tx.onerror=()=>done(tx.error||Error("onerror"));
   tx.onabort=()=>done(tx.error||Error("onabort"));
  }catch(error){done(error);}
 });
}

export async function clearBrowserResults(){
 if(active)throw Error("Нельзя очищать результаты во время вычислений");
 return withOriginStorageLock(()=>clearBrowserResultsUnlocked());
}
