import {runLyapunovStudy} from "./lyapunovStudy.js";

self.onmessage=event=>{
 const payload=event.data||{};
 if(payload.type!=="run")return;
 try{
  const result=runLyapunovStudy(payload.config,payload.options,(completed,total)=>{
   self.postMessage({type:"progress",completed,total});
  });
  self.postMessage({type:"result",result});
 }catch(error){
  self.postMessage({type:"error",message:error?.message||String(error)});
 }
};
