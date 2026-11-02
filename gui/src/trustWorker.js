import {makePlan,runTask} from "./trustEngine.js";
/** A single shard of an independent-run pool. Only task indices cross the worker boundary. */
self.onmessage=async ({data})=>{
 if(data?.type!=="run")return;
 const {id,payload,indices=[]}=data;
 try{
  const plan=makePlan(payload);
  for(let k=0;k<indices.length;k++){
   const index=indices[k],result=runTask(plan,plan.tasks[index]);
   self.postMessage({type:"task",id,index,result});
   if(k%2===0)await new Promise(resolve=>setTimeout(resolve,0));
  }
  self.postMessage({type:"finished",id});
 }catch(error){self.postMessage({type:"failed",id,error:String(error?.message||error)});}
};