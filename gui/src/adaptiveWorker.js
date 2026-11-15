import {runAdaptiveSingle,validateAdaptiveStudy} from "./adaptiveExperiment.js";

/** Sequential, interruptible E1-A worker; browser client persists each run. */
self.onmessage=async ({data})=>{
 if(data?.type!=="run")return;
 try{
  const {config,options,startIndex=0}=data;
  const {options:o}=validateAdaptiveStudy(config,options);
  if(!Number.isInteger(startIndex)||startIndex<0||startIndex>o.runs)
   throw Error("Некорректный индекс возобновления");
  for(let index=startIndex;index<o.runs;index++){
   const value=runAdaptiveSingle(config,options,index);
   self.postMessage({type:"run",index,value});
   // Yield so Terminate can interrupt a large series without losing completed runs.
   await new Promise(resolve=>setTimeout(resolve,0));
  }
  self.postMessage({type:"finished"});
 }catch(error){self.postMessage({type:"error",message:error?.message||String(error)});}
};
