// Separate Node processes, not browser heap and not an estimate from array sizes.
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import fs from "node:fs";
import os from "node:os";
import {BASE,uniformGroups,exactExt,simulateExt,spaceSize} from "../src/automaticDecisions/extendedModel.js";
const cases=[{name:"exact-small",groups:[2,2,2],algorithm:"exact"},{name:"exact-article-size",groups:[9,7,5],algorithm:"exact"},{name:"mc-article-size",groups:[9,7,5],algorithm:"mc"},{name:"mc-1000-agents",groups:Array(20).fill(50),algorithm:"mc"}];
if(process.argv[2]==="--child"){
 const k=Number(process.argv[3]),spec=cases[k],B=spec.groups.length,c={...BASE,...uniformGroups(B,2),groups:spec.groups,m:500};
 const before=process.memoryUsage(),start=performance.now(),r=spec.algorithm==="exact"?exactExt(c):simulateExt(c,1000,20262125),ms=performance.now()-start,after=process.memoryUsage();
 console.log(JSON.stringify({name:spec.name,algorithm:spec.algorithm,groups:spec.groups,agents:spec.groups.reduce((a,b)=>a+b,0),space:spaceSize(c),m:c.m,N:spec.algorithm==="mc"?1000:null,ms,rssBeforeBytes:before.rss,rssAfterBytes:after.rss,heapBeforeBytes:before.heapUsed,heapAfterBytes:after.heapUsed,maxRssKiB:process.resourceUsage().maxRSS,coverage:r.coverage,loss:r.loss}));process.exit(0);
}
const rows=[];for(let i=0;i<cases.length;i++){const child=spawnSync(process.execPath,[fileURLToPath(import.meta.url),"--child",String(i)],{encoding:"utf8",timeout:120000});if(child.error||child.status!==0)throw Error(String(child.error||child.stderr));rows.push(JSON.parse(child.stdout));}
const result={schema:"e2-memory-node-v1",node:process.version,platform:process.platform,arch:process.arch,cpu:os.cpus()[0]?.model,units:"RSS/heap bytes; maxRSS KiB as reported by Node resourceUsage",scope:"Whole isolated Node process including engine/imports; not browser, not incremental model memory. One run per case.",rows};const json=JSON.stringify(result,null,2);console.log(json);if(process.argv[2])fs.writeFileSync(process.argv[2],json+"\n");
