// E2.12: finite, heterogeneous design set; conservative MC certificate for large spaces.
import {validateExt,spaceSize,lawsExt,calibration,tables,point,select,loss,sampler,seedFor,exactExt} from "./extendedModel.js";
import {random} from "./kernel.js";
const sum=a=>a.reduce((s,v)=>s+v,0);
export function candidateConfigs(base,spec){
 if(!Array.isArray(spec)||!spec.length||spec.length>100)throw Error("Задайте 1–100 конфигураций");
 const seen=new Set();
 return spec.map((a,i)=>{
  if(!a||!Array.isArray(a.groups)||!a.groups.length)throw Error("Кандидат "+(i+1)+": укажите groups");
  const groups=a.groups.slice(),B=groups.length,u=a.u??[0,1].map(x=>groups.map((_,g)=>base.u[x][g%base.u[x].length])),rho=a.rho??groups.map((_,g)=>base.rho[g%base.rho.length]);
  const c=validateExt({...base,groups,u,rho,stress:"none",eta:0});
  const costs=a.costs??groups.map(n=>base.groupCost+n*base.agentCost);
  if(!Array.isArray(costs)||costs.length!==B||costs.some(v=>!Number.isFinite(v)||v<0||v>1e6))throw Error("Кандидат "+(i+1)+": costs должны быть неотрицательными затратами по группам");
  const key=JSON.stringify([groups,u,rho,costs]);if(seen.has(key))throw Error("Повтор конфигурации "+(i+1));seen.add(key);
  return {id:i+1,name:typeof a.name==="string"?a.name.slice(0,100):"К"+(i+1),groups:c.groups,u:c.u,rho:c.rho,costs};
 });
}
export function evaluateDesign(base,unit,K){
 const {spec}=unit,agents=sum(spec.groups),cost=sum(spec.costs),seed=seedFor(base.seed,70000+2*spec.id),testSeed=seedFor(base.seed,70001+2*spec.id);
 const conf=validateExt({...base,groups:spec.groups,u:spec.u,rho:spec.rho,alpha:base.alpha/K,seed,stress:"none",eta:0});
 const size=spaceSize(conf),start=performance.now();
 if(size<=300000){const r=exactExt(conf);return {...r,unit,modelConfig:r.config,agents,cost,status:r.tight>=base.requiredCoverage&&r.upperRisk<=base.riskLimit?"feasible":"not_certified",algorithm:"exact",ms:performance.now()-start};}
 if(!base.approxLarge)return {unit,modelConfig:conf,agents,cost,size,status:"not_evaluated",algorithm:"none",ms:0};
 // Half the candidate error budget for calibration and half for independent evaluation
 // under the nominal estimated law. Total variation extends this nominal certificate
 // to every true law in the calibration confidence region.
 const alphaCal=conf.alpha/2,alphaMC=conf.alpha/2,c={...conf,alpha:alphaCal},q=lawsExt(c),counts=calibration(c,q.cal),T=tables(c,counts),N=base.mcN,Lmax=Math.max(c.b,c.f,c.d,c.c);
 const next=sampler(c,T.hat,random(testSeed)),hist=[[0,0,0],[0,0,0]];
 for(let i=0;i<N;i++){const {x,ix}=next(),a=select(c,...point(c,T,ix));hist[x][a]++;}
 const nomCoverage=1-(hist[0][2]+hist[1][2])/N,nomLoss=sum(hist.map((row,x)=>sum(row.map((v,a)=>v*loss(c,a,x)))))/N;
 const h=Math.sqrt(Math.log(2/alphaMC)/(2*N)),lower=Math.max(0,nomCoverage-h-T.D),upperRisk=Math.min(Lmax,nomLoss+Lmax*(h+T.D));
 return {unit,modelConfig:c,agents,cost,size,algorithm:"mc_certificate",counts,hist,N,testSeed,alphaCal,alphaMC,D:T.D,halfWidth:h,nomCoverage,nomLoss,coverage:null,loss:null,lower,tight:lower,upperRisk,status:lower>=base.requiredCoverage&&upperRisk<=base.riskLimit?"feasible":"not_certified",assumptionsValid:true,ms:performance.now()-start};
}
