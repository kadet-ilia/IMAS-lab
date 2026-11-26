import {studyPlan,evaluateUnit,validateStudy} from "./extendedStudies.js";
import {validateObservations} from "./dataValidation.js";
let session=null;
function next(){if(!session)return;try{const {mode,c,plan,i}=session;if(i>=plan.length){postMessage({type:"done"});session=null;return;}const record=evaluateUnit(mode,c,plan[i],plan.length);session.i++;postMessage({type:"record",record,index:session.i,total:plan.length});}catch(e){session=null;postMessage({type:"error",error:String(e.message||e)});}}
self.onmessage=({data})=>{try{
 if(data.type==="data"){postMessage({type:"dataDone",result:validateObservations(data.dataset,data.config)});return;}
 if(data.type==="start"){const c=validateStudy(data.mode,data.config),plan=studyPlan(data.mode,c);if(!Number.isInteger(data.index)||data.index<0||data.index>plan.length)throw Error("Некорректная контрольная точка");session={mode:data.mode,c,plan,i:data.index};next();return;}
 if(data.type==="continue"&&session&&data.index===session.i){setTimeout(next,0);return;}
 throw Error("Неверная команда вычислительного потока");
 }catch(e){session=null;postMessage({type:"error",error:String(e.message||e)});}
};
