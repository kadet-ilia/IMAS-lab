import {createMC} from "./monteCarlo.js";
let state=null,limit=0;
function tick(){
 if(!state)return;
 try{const n=state.advance(5000);postMessage({type:"progress",n,total:limit});if(n>=limit){postMessage({type:"done",result:state.result()});state=null;}else setTimeout(tick,0);}
 catch(e){state=null;postMessage({type:"error",error:e.message||String(e)});}
}
self.onmessage=({data})=>{try{if(data.type!=="start"||state)throw Error("Некорректный запуск");state=createMC(data.config);limit=data.config.samples;tick();}catch(e){state=null;postMessage({type:"error",error:e.message||String(e)});}};
