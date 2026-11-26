// E2.18: partial likelihood under ignorable uniform masks; conservative
// completion bounds require no assumption on the calibration mask mechanism.
import {groupGeometry,point,select,loss} from "./extendedModel.js";
import {boundedTables,predictiveTables} from "./probabilityBounds.js";
const sum=a=>a.reduce((s,v)=>s+v,0),seq=n=>Array.from({length:n},(_,i)=>i),clip=v=>Math.max(0,Math.min(1,v));
export function observationIndex(a){const m=a.filter(v=>v!==null).length,k=a.filter(v=>v===1).length;return m*(m+1)/2+k;}
export function fitPartialGroup(n,hist,iterations=300,tol=1e-8){
 const G=groupGeometry(n),N=sum(hist);
 if(hist.length!==G.pairs.length||hist.some(v=>!Number.isSafeInteger(v)||v<0)||N<1||!Number.isInteger(iterations)||iterations<1||!(tol>0))throw Error("Некорректная гистограмма неполных наблюдений");
 const observed=hist.map((count,i)=>({count,h:G.H[i],pair:G.pairs[i]})).filter(v=>v.count>0);
 let p=seq(n+1).map(()=>1/(n+1)),logLikelihood=null,converged=false,done=0,delta=null;
 const logL=q=>sum(observed.map(({count,h})=>count*Math.log(sum(h.map((v,j)=>v*q[j])))));
 logLikelihood=logL(p);
 const initialLogLikelihood=logLikelihood;
 for(let t=0;t<iterations;t++){
  const z=seq(n+1).map(()=>0);
  for(const {count,h} of observed){const a=sum(h.map((v,j)=>v*p[j]));if(!(a>0))throw Error("Нулевая вероятность наблюдения в EM");for(let j=0;j<=n;j++)z[j]+=count*h[j]*p[j]/a;}
  const norm=sum(z),next=z.map(v=>v/norm),ll=logL(next);
  if(ll<logLikelihood-1e-9*Math.max(1,N))throw Error("EM нарушил монотонность правдоподобия");
  delta=sum(next.map((v,j)=>Math.abs(v-p[j])));p=next;logLikelihood=ll;done=t+1;
  if(delta<=tol){converged=true;break;}
 }
 const maxDelivered=Math.max(...observed.map(v=>v.pair[0])),complete=observed.filter(v=>v.pair[0]===n).reduce((a,v)=>a+v.count,0),empty=hist[0];
 return {p,N,iterations:done,converged,delta,initialLogLikelihood,logLikelihood,maxDelivered,complete,empty,identifiability:maxDelivered<n?"design_rank_deficient":"full_delivery_observed"};
}
export function completionBounds(n,hist,h){
 const G=groupGeometry(n),N=sum(hist);if(!(N>0)||hist.length!==G.pairs.length||!Number.isFinite(h)||h<0)throw Error("Некорректные границы завершения");
 const forced=seq(n+1).map(()=>0),possible=forced.slice();
 G.pairs.forEach(([m,k],i)=>{if(m===n)forced[k]+=hist[i];for(let j=k;j<=k+n-m;j++)possible[j]+=hist[i];});
 return {forced,possible,lower:forced.map(v=>clip(v/N-h)),upper:possible.map(v=>clip(v/N+h))};
}
export function fitPartial(c,train,config){
 const G=c.groups.map(groupGeometry),M=[0,1].map(x=>train.filter(r=>r.x===x).length),hist=[0,1].map(()=>G.map(g=>g.pairs.map(()=>0)));
 for(const row of train)row.agents.forEach((a,g)=>hist[row.x][g][observationIndex(a)]++);
 const K=2*sum(c.groups.map(n=>n+1)),radius=M.map(N=>Math.sqrt(Math.log(2*K/c.alpha)/(2*N)));
 if(c.groups.reduce((s,n)=>s+(n+1)*(n+2)/2*(n+1),0)*config.emIterations>5e7)throw Error("Слишком большой объём EM; уменьшите число итераций или размер групп");
 const fit=hist.map((row,x)=>row.map((a,g)=>({...fitPartialGroup(c.groups[g],a,config.emIterations,config.emTolerance),...completionBounds(c.groups[g],a,radius[x])})));
 const hat=fit.map(row=>row.map(v=>v.p)),lower=fit.map(row=>row.map(v=>v.lower)),upper=fit.map(row=>row.map(v=>v.upper)),robust=boundedTables(G,hat,lower,upper),predictive=predictiveTables(G,hat);
 return {hist,fit,radius,robust,predictive,M};
}
export function evaluatePartial(c,train,test,config){
 const fit=fitPartial(c,train,config),names=["EM — точечный","Границы завершения — M6"],H=names.map(()=>[[0,0,0],[0,0,0]]),trace=[];
 for(const row of test){
  const ix=row.agents.map(observationIndex),intervals=[point(c,fit.predictive,ix),point(c,fit.robust,ix)];
  intervals.forEach(([lo,hi],i)=>{const a=select(c,lo,hi,i===0?7:6);H[i][row.x][a]++;trace.push({policy:names[i],time:row.time,x:row.x,lo,hi,action:a,loss:loss(c,a,row.x)});});
 }
 const N=test.length,h=Math.sqrt(Math.log(16/c.alpha)/(2*N)),Lmax=Math.max(c.b,c.f,c.d,c.c),summary=H.map((a,i)=>{
  const coverage=1-(a[0][2]+a[1][2])/N,miss=a[1][0]/N,fp=a[0][1]/N,L=(c.b*a[1][0]+c.f*a[0][1]+c.d*a[1][1])/N+c.c*(1-coverage);
  return {policy:names[i],N,coverage,loss:L,miss,false:fp,...(config.iidTest?{coverageLow:clip(coverage-h),coverageHigh:clip(coverage+h),lossLow:Math.max(0,L-Lmax*h),lossHigh:Math.min(Lmax,L+Lmax*h),missLow:clip(miss-h),missHigh:clip(miss+h),falseLow:clip(fp-h),falseHigh:clip(fp+h)}:{})};
 });
 const diagnostics=fit.fit.flatMap((row,x)=>row.map((v,g)=>({x,group:g+1,N:v.N,complete:v.complete,empty:v.empty,maxDelivered:v.maxDelivered,identifiability:v.identifiability,converged:v.converged,iterations:v.iterations,logLikelihood:v.logLikelihood,delta:v.delta})));
 return {summary,trace,diagnostics,hist:H[1],partial:{hist:fit.hist,fit:fit.fit,radius:fit.radius,policyHist:H,assumptions:"EM: независимость маски от полного счётчика, равномерная доставка внутри группы. Границы завершения: iid истинные полные счётчики и отсутствие ошибок в доставленных значениях, без предположения MCAR для калибровочной маски. Апостериорный расчёт обеих политик требует номинального тестового ядра и независимости групп."}};
}
