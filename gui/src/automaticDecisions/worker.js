import {compute,geometry,laws,joint,units,validate} from "./kernel.js";
let session=null;
function next(){
 if(!session)return;
 try{
  const {config,fixture,plan,index,cache,G}=session;
  if(index>=plan.length){postMessage({type:"done"});session=null;return;}
  const unit=plan[index];
  if(!cache.has(unit.s))cache.set(unit.s,joint(config,G,laws(config,unit.s).test,unit.s));
  const record=compute(config,unit,fixture,{G,P:cache.get(unit.s)});
  session.index++;
  postMessage({type:"record",record,index:session.index,total:plan.length});
 }catch(e){postMessage({type:"error",error:String(e.message||e)});session=null;}
}
self.onmessage=({data})=>{
 try{if(data.type==="start"){const config=validate(data.config),plan=units(config);if(!Number.isInteger(data.index)||data.index<0||data.index>plan.length)throw Error("Некорректная контрольная точка");session={config,fixture:data.fixture,plan,index:data.index,cache:new Map(),G:geometry(config)};next();}
 else if(data.type==="continue"&&session&&data.index===session.index)setTimeout(next,0);
 else throw Error("Неверная команда вычислительного потока");
 }catch(e){session=null;postMessage({type:"error",error:String(e.message||e)});}
};
