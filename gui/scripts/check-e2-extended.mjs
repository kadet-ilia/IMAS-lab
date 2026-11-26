import {spawnSync} from "node:child_process";
import {BASE,exactExt,wasserMax,momentMax} from "../src/automaticDecisions/extendedModel.js";
import {extrem,boxExt,random} from "../src/automaticDecisions/kernel.js";
import {erlang,robustMulti} from "../src/automaticDecisions/extendedStudies.js";
const r=random(20261126),exact=[],extrema=[],queue=[],multi=[];
for(const groups of [[2],[2,3],[2,2,2],[2,2,2,2]])for(const m of [500,20000]){
 const B=groups.length,c={...BASE,groups,u:[0,1].map(x=>groups.map((_,g)=>BASE.u[x][g%3])),rho:groups.map((_,g)=>BASE.rho[g%3]),m};
 exact.push(exactExt(c));
}
for(let i=0;i<24;i++){
 const h=Array.from({length:3+i%6},()=>2*r()-1),p=h.map(()=>r()),z=p.reduce((a,b)=>a+b,0);p.forEach((v,j)=>p[j]=v/z);
 for(const [family,fn] of [["l1",extrem],["box",boxExt],["wasserstein",wasserMax],["moments",momentMax]]){const radius=.01+.5*r();extrema.push({h,p,family,radius,value:fn(h,p,radius)});}
}
for(const s of [1,2,3,10])for(const rho of [0,.1,.5,.95,1,1.2]){const mu=8,lambda=rho*mu*s;queue.push({s,mu,lambda,result:erlang(lambda,mu,s)});}
for(let i=0;i<64;i++){const lo=Array.from({length:3+i%3},()=>r()*.2),hi=lo.map(v=>v+r()*.2),loss=Array.from({length:3},()=>lo.map(()=>r()*6)),c=1.5;multi.push({lo,hi,loss,c,action:robustMulti(lo,hi,loss,c)});}
const child=spawnSync(process.env.PYTHON||"python",["../research/automatic-decisions/reference/extended_reference.py"],{input:JSON.stringify({exact,extrema,queue,multi}),encoding:"utf8",maxBuffer:16*1024*1024});
if(child.error)throw child.error;
if(child.status!==0)throw Error(child.stderr+"\n"+child.stdout);
console.log(child.stdout);
