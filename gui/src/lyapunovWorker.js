import {runLyapunovStudy} from "./lyapunovStudy.js";

self.postMessage({type:"status",stage:"worker_imported"});
self.onmessage=event=>{
 const payload=event.data||{};
 if(payload.type!=="run")return;
 self.postMessage({type:"status",stage:"computing"});
 try{
  let lastPercent=-1;
  const result=runLyapunovStudy(payload.config,payload.options,(completed,total,step,totalSteps)=>{
   const fraction=(completed+(step?step/totalSteps:0))/Math.max(1,total);
   const percent=Math.min(100,Math.max(0,100*fraction));
   if(percent-lastPercent>=.5||percent===100){
    lastPercent=percent;
    self.postMessage({type:"progress",completed,total,step,totalSteps,percent});
   }
  });
  self.postMessage({type:"result",result});
 }catch(error){
  self.postMessage({type:"error",message:error?.message||String(error)});
 }
};
