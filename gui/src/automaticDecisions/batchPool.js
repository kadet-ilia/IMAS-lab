// Complete waves are committed in original plan order; incomplete waves are
// discarded on cancellation. At most four workers and one wave are in flight.
export function runBatchPool({config,plan,index,onWave,onDone,onError}){
 const workers=Array.from({length:Math.min(config.batchWorkers,plan.length-index)},()=>new Worker(new URL("./batch.worker.js",import.meta.url),{type:"module"}));
 let stopped=false;
 const terminate=()=>{stopped=true;workers.forEach(w=>w.terminate());};
 const task=(w,i)=>new Promise((resolve,reject)=>{
  w.onmessage=({data})=>{if(data.error){reject(Error(data.error));return;}if(data.index!==i||JSON.stringify(data.record?.unit)!==JSON.stringify(plan[i])){reject(Error("Нарушена идентичность расчётной единицы"));return;}resolve(data.record);};
  w.onerror=e=>reject(Error(e.message||"Ошибка вычислительного потока"));
  w.postMessage({config,unit:plan[i],index:i});
 });
 (async()=>{try{let i=index;while(!stopped&&i<plan.length){const count=Math.min(workers.length,plan.length-i),records=await Promise.all(workers.slice(0,count).map((w,j)=>task(w,i+j)));if(stopped)return;await onWave(records);i+=count;}if(!stopped){terminate();onDone();}}catch(e){if(!stopped){terminate();onError(e);}}})();
 return {terminate};
}
