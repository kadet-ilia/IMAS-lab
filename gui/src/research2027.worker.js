import {executeStudy,executeStudyChunk} from "./research2027.js";

let current=null;
function executeStage(){
 if(!current)return;
 try{
  const output=executeStudyChunk(current.id,current.config,current.checkpoint);
  if(output.done){
   current=null;
   self.postMessage({type:"result",result:output.result});
  }else{
   current.checkpoint=output.state;
   current.waitingForAck=true;
   self.postMessage({type:"checkpoint",state:output.state,
    completedUnits:output.completedUnits,totalUnits:output.totalUnits});
  }
 }catch(error){
  current=null;
  self.postMessage({type:"error",error:error instanceof Error?error.message:String(error)});
 }
}
self.onmessage=({data})=>{
 if(data?.type==="start"){
  if(current){
   self.postMessage({type:"error",error:"Вычисление уже выполняется"});
   return;
  }
  current={id:data.id,config:data.config,checkpoint:data.checkpoint||null,waitingForAck:false};
  executeStage();
 }else if(data?.type==="continue"){
  if(!current?.waitingForAck||data.nextScenario!==current.checkpoint?.nextScenario){
   self.postMessage({type:"error",error:"Неверное подтверждение контрольной точки"});
   return;
  }
  current.waitingForAck=false;
  // Yield between scenarios so the host can stop the Worker after durable commit.
  setTimeout(executeStage,0);
 }else if(!data?.type){
  // Legacy Worker contract kept for external clients, without checkpoint support.
  try{self.postMessage({ok:true,result:executeStudy(data.id,data.config)});}
  catch(error){self.postMessage({ok:false,error:error instanceof Error?error.message:String(error)});}
 }else self.postMessage({type:"error",error:"Неизвестный тип команды"});
};
