import {ARTICLE_MODEL_VERSION,validateArticleConfig,summarizeArticleTasks} from "./articleEngine.js";
let current=null;
const dbName="imas-article-model-v1";
function idb(key,writeValue){
 if(typeof indexedDB==="undefined")return Promise.resolve(undefined);
 return new Promise((resolve,reject)=>{
  const open=indexedDB.open(dbName,1);open.onupgradeneeded=()=>open.result.createObjectStore("results");
  open.onerror=()=>reject(open.error);
  open.onsuccess=()=>{
   const db=open.result,tx=db.transaction("results",arguments.length===2?"readwrite":"readonly");
   const req=arguments.length===2?tx.objectStore("results").put(writeValue,key):tx.objectStore("results").get(key);
   req.onerror=()=>{db.close();reject(req.error);};
   if(arguments.length===2)tx.oncomplete=()=>{db.close();resolve();};
   else req.onsuccess=()=>{const value=req.result;db.close();resolve(value);};
   tx.onerror=()=>{db.close();reject(tx.error);};
  };
 });
}
export async function runArticleSeries(raw,onProgress=()=>{}){
 if(current)throw Error("Модель статьи: вычисление уже выполняется");
 const config=validateArticleConfig(raw);
 const key=JSON.stringify({modelVersion:ARTICLE_MODEL_VERSION,config});
 let tasks=await idb("progress:"+key)||[];
 if(!Array.isArray(tasks)||tasks.some((r,i)=>r.runIndex!==i))tasks=[];
 if(tasks.length===config.n_runs)return {result:summarizeArticleTasks(config,tasks),cache_hit:true};
 return await new Promise((resolve,reject)=>{
  const worker=new Worker(new URL("./trustWorker.js",import.meta.url),{type:"module"});
  let settled=false;
  current={worker,cancel:()=>{if(settled)return;settled=true;worker.terminate();current=null;reject(Error("Расчет остановлен; выполненные прогоны сохранены."));}};
  const finish=(err,result)=>{
   if(settled)return;settled=true;worker.terminate();current=null;err?reject(err):resolve({result,cache_hit:false});
  };
  worker.onerror=e=>finish(Error(e.message||"Ошибка вычислительного потока"));
  worker.onmessage=async({data})=>{
   if(settled)return;
   if(data?.type==="failed"){finish(Error(data.error));return;}
   if(data?.type==="task"){
    try{
     if(data.index!==tasks.length)throw Error("Нарушена последовательность контрольной точки");
     tasks.push(data.result);
     await idb("progress:"+key,tasks);
     onProgress({stage:"article",completed:tasks.length,total:config.n_runs,
      percent:100*tasks.length/config.n_runs,message:"Модель статьи: парные прогоны"});
    }catch(e){finish(e);}
   }
   if(data?.type==="finished"){
    try{if(tasks.length!==config.n_runs)throw Error("Не все прогоны завершены");
     finish(null,summarizeArticleTasks(config,tasks));}catch(e){finish(e);}
   }
  };
  onProgress({stage:"article",completed:tasks.length,total:config.n_runs,percent:100*tasks.length/config.n_runs});
  worker.postMessage({type:"run",id:"article",payload:{config,model:"article"},indices:Array.from({length:config.n_runs-tasks.length},(_,i)=>tasks.length+i)});
 });
}
export function stopArticleSeries(){if(!current)return false;current.cancel();return true;}
