// Prespecified follow-up after the initial campaign. New root seed and broader
// input domain. Check whether the sign of the interaction survives law/policy changes.
import fs from "node:fs";
import path from "node:path";
import {EXTRA_DEFAULTS} from "../src/automaticDecisions/extendedStudies.js";
import {random,laws} from "../src/automaticDecisions/kernel.js";
import {seedFor,lawsExt,calibration,tables,point,select,loss,transform,marginal,exactExt} from "../src/automaticDecisions/extendedModel.js";
import {predictiveTables} from "../src/automaticDecisions/probabilityBounds.js";
const N=128,ROOT=20261127,arr=(n,f)=>Array.from({length:n},(_,i)=>f(i)),sum=a=>a.reduce((s,v)=>s+v,0);
function evaluate(c,q,counts){
 const T=tables(c,counts),O=predictiveTables(T.G,q),F=marginal(transform(c,T.G),q),shape=T.G.map(g=>g.pairs.length),metrics=[{loss:0,coverage:0},{loss:0,coverage:0}];let mass=0;
 for(let a=0;a<shape[0];a++)for(let b=0;b<shape[1];b++)for(let d=0;d<shape[2];d++){
  const ix=[a,b,d],P=[0,1].map(x=>(x?c.prior:1-c.prior)*F[x].reduce((z,g,j)=>z*g[ix[j]],1)),z=sum(P);
  mass+=z;if(z===0)continue;
  const actions=[select(c,...point(c,T,ix)),select(c,...point(c,O,ix),7)];
  actions.forEach((v,j)=>{metrics[j].loss+=P[0]*loss(c,v,0)+P[1]*loss(c,v,1);if(v!==2)metrics[j].coverage+=z;});
 }
 if(Math.abs(mass-1)>1e-9)throw Error("normalization");
 if(metrics[1].loss>metrics[0].loss+1e-10)throw Error("oracle exceeds empirical robust loss");
 return metrics;
}
function stat(a){const b=a.slice().sort((x,y)=>x-y),n=b.length;return {n,mean:sum(b)/n,min:b[0],max:b.at(-1),negative:b.filter(v=>v< -1e-9).length,positive:b.filter(v=>v>1e-9).length,zero:b.filter(v=>Math.abs(v)<=1e-9).length};}
const rows=[];
for(let i=0;i<N;i++){
 const seed=seedFor(ROOT,31000+i),r=random(seedFor(seed,11)),uniform=(a,b)=>a+(b-a)*r(),integer=(a,b)=>Math.floor(uniform(a,b+1)),groups=arr(3,()=>integer(2,5)),u=[arr(3,()=>uniform(.05,.4)),arr(3,()=>uniform(.6,.95))],rhoLow=uniform(.01,.3),rhoHigh=uniform(.45,.95),dropLow=uniform(0,.35),dropHigh=uniform(.5,.95);
 const c={...EXTRA_DEFAULTS,groups,u,rho:[rhoLow,rhoLow,rhoLow],seed,prior:uniform(.01,.75),m:integer(400,20000),c:uniform(.15,2.7),reps:1,stress:"none",eta:0,family:"l1"};
 const output=[];
 for(const family of ["common_shock","beta_binomial"]){
  const values=[];
  for(const rho of [rhoLow,rhoHigh]){
   const base={...c,rho:[rho,rho,rho]},q=family==="common_shock"?lawsExt(base).nominal:laws(base,5).q,counts=calibration(base,q);
   for(const drop of [dropLow,dropHigh]){
    const v=evaluate({...base,drop},q,counts);
    if(family==="common_shock"&&i<8){const ex=exactExt({...base,drop},counts);if(Math.abs(ex.loss-v[0].loss)>1e-9||Math.abs(ex.coverage-v[0].coverage)>1e-9)throw Error("independent integration mismatch");}
    values.push({rho,drop,robust:v[0],oracle:v[1],counts});
   }
  }
  for(const policy of ["robust","oracle"]){const [a,b,d,e]=values.map(v=>v[policy]);output.push({family,policy,lossInteraction:e.loss-d.loss-b.loss+a.loss,coverageInteraction:e.coverage-d.coverage-b.coverage+a.coverage,values});}
 }
 rows.push({case:i+1,input:{seed,groups,u,prior:c.prior,m:c.m,price:c.c,dropLow,dropHigh,rhoLow,rhoHigh},output});
}
const summary=[];
for(const family of ["common_shock","beta_binomial"])for(const policy of ["robust","oracle"]){
 const values=rows.map(r=>r.output.find(v=>v.family===family&&v.policy===policy));
 summary.push({family,policy,lossInteraction:stat(values.map(v=>v.lossInteraction)),coverageInteraction:stat(values.map(v=>v.coverageInteraction))});
}
const out=process.argv[2]||"campaign-results";fs.mkdirSync(out,{recursive:true});
fs.writeFileSync(path.join(out,"sensitivity-confirmation.json"),JSON.stringify({rootSeed:ROOT,cases:N,rows,summary},null,2));
console.log("FOLLOWUP "+JSON.stringify({cases:N,rootSeed:ROOT,summary}));
