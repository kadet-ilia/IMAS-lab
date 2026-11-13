import {runLyapunovStudy} from "./lyapunovStudy.js";

self.postMessage({type:"status",stage:"worker_imported"});
self.onmessage=event=>{
 const payload=event.data||{};
 if(payload.type!=="run")return;
 self.postMessage({type:"status",stage:"computing"});
 try{
  const result=runLyapunovStudy(payload.config,payload.options,(completed,total)=>{
   self.postMessage({type:"progress",completed,total});
  });
  self.postMessage({type:"result",result});
 }catch(error){
  self.postMessage({type:"error",message:error?.message||String(error)});
 }
};
