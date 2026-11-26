import {createMC} from "./monteCarlo.js";
let state=null,limit=0,awaiting=false;
function tick(){
 if(!state)return;
 try{if(state.checkpoint().n>=limit){postMessage({type:"done",result:state.result()});state=null;return;}const n=state.advance(5000);awaiting=true;postMessage({type:"checkpoint",n,total:limit,checkpoint:state.checkpoint()});}
 catch(e){state=null;postMessage({type:"error",error:e.message||String(e)});}
}
self.onmessage=({data})=>{try{if(data.type==="start"&&!state){state=createMC(data.config,null,data.resume||null);limit=data.config.samples;tick();return;}if(data.type==="continue"&&state&&awaiting&&data.n===state.checkpoint().n){awaiting=false;setTimeout(tick,0);return;}throw Error("Некорректная команда MC");}catch(e){state=null;postMessage({type:"error",error:e.message||String(e)});}};
