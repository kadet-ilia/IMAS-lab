import {makePlan,runTask,assembleResult} from "./trustEngine.js";

/** All browser-only tasks run here. No API requests, filesystem or Python. */
self.onmessage=async ({data})=>{
 if(data?.type!=="run")return;
 const {id,payload,previous=[]}=data;
 try{
  const plan=makePlan(payload),completed=previous.slice();
  self.postMessage({type:"progress",id,completed:completed.length,total:plan.total,stage:plan.action,message:completed.length?"Восстановление серии из контрольной точки":"Начало расчёта"});
  const interval=Math.max(1,Math.floor(plan.total/30));
  for(let i=completed.length;i<plan.tasks.length;i++){
   const result=runTask(plan,plan.tasks[i]);completed.push(result);
   if(i===0 || completed.length%interval===0 || completed.length===plan.total){
    self.postMessage({type:"progress",id,completed:completed.length,total:plan.total,stage:plan.action,message:plan.action==="trace"?"Расчет траектории":"Вычисление независимых реализаций",checkpoint:plan.total>1?completed:null});
   }
   // Yield to worker's event loop, without blocking React's main thread.
   if(i%2===0)await new Promise(resolve=>setTimeout(resolve,0));
  }
  const result=assembleResult(plan,completed);
  self.postMessage({type:"completed",id,result});
 }catch(error){self.postMessage({type:"failed",id,error:String(error?.message||error)});}
};