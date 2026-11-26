import {batchEvaluate} from "./batchStudy.js";
self.onmessage=({data})=>{try{const record=batchEvaluate(data.config,data.unit);postMessage({index:data.index,record});}catch(e){postMessage({index:data.index,error:String(e.message||e)});}};
