// E2.10: arbitrary groups, stratified importance sampling by true class,
// predeclared sequential looks and simultaneous finite-sample bounds.
import {validateExt,lawsExt,calibration,tables,point,select,loss,seedFor,sampler,spaceSize,exactExt} from "./extendedModel.js";
import {random} from "./kernel.js";
const sum=a=>a.reduce((s,v)=>s+v,0),clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const methods=[6,7],keys=["coverage","loss","miss","false"];
export function validateAdvancedMC(c){
 const b=validateExt(c);
 if(!Number.isInteger(c.mcN)||c.mcN<1000||c.mcN>2000000||!Number.isInteger(c.mcBatch)||c.mcBatch<100||c.mcBatch>c.mcN||!Number.isFinite(c.mcAlpha)||c.mcAlpha<=0||c.mcAlpha>=1||!Number.isFinite(c.mcTolerance)||c.mcTolerance<0||c.mcTolerance>1||!Number.isFinite(c.mcProposal)||c.mcProposal<=0||c.mcProposal>=1||typeof c.mcImportance!=="boolean"||typeof c.mcExact!=="boolean")throw Error("Некорректные параметры расширенного Монте-Карло");
 if(c.mcExact&&spaceSize(b)>300000)throw Error("Отключите точное сравнение при размере пространства >300000");
 return {...c,...b};
}
// Exact binomial bounds via Chernoff inversion, including zero observed events.
// KL inversion produces conservative two-sided intervals, not a normal approximation.
export function bernoulliBounds(k,n,alpha){
 if(!Number.isInteger(k)||!Number.isInteger(n)||k<0||k>n||n<1||!(alpha>0&&alpha<1))throw Error("Некорректный биномиальный интервал");
 const p=k/n,t=Math.log(2/alpha)/n;
 const kl=q=>(p===0?0:p*Math.log(p/q))+(p===1?0:(1-p)*Math.log((1-p)/(1-q)));
 let l=0,h=p;
 for(let i=0;i<60;i++){const q=(l+h)/2;if(kl(q)>t)l=q;else h=q;}
 const lo=p===0?0:l;
 l=p;h=1;for(let i=0;i<60;i++){const q=(l+h)/2;if(kl(q)>t)h=q;else l=q;}
 return [lo,p===1?1:h];
}
export function advancedMC(raw,rep){
 const c=validateAdvancedMC(raw),q=lawsExt(c),calSeed=seedFor(c.seed,2*rep+100000),testSeed=seedFor(c.seed,2*rep+100001),counts=calibration(c,q.cal,calSeed),T=tables(c,counts);
 const proposal=c.mcImportance?c.mcProposal:c.prior,w=[(1-c.prior)/(1-proposal),c.prior/proposal],wmax=Math.max(...w),Lmax=Math.max(c.b,c.f,c.d,c.c),next=sampler({...c,prior:proposal},q.test,random(testSeed)),looks=Math.ceil(c.mcN/c.mcBatch),alpha=c.mcAlpha/(c.reps*methods.length*keys.length*looks),hist=methods.map(()=>[[0,0,0],[0,0,0]]),checkpoints=[];
 let n=0,achieved=false;
 const exact=c.mcExact?exactExt(c,counts):null;
 while(n<c.mcN){
  const end=Math.min(c.mcN,n+c.mcBatch);
  for(;n<end;n++){const {x,ix}=next(),[lo,hi]=point(c,T,ix);methods.forEach((m,i)=>hist[i][x][select(c,lo,hi,m)]++);}
  const h=Math.sqrt(Math.log(2/alpha)/(2*n));
  const rows=methods.map((method,i)=>{
   const H=hist[i],cov=sum(H.map((a,x)=>w[x]*(a[0]+a[1])))/n,L=sum(H.map((a,x)=>w[x]*sum(a.map((v,j)=>v*loss(c,j,x))))/n,miss=w[1]*H[1][0]/n,fp=w[0]*H[0][1]/n;
   const [ml,mh]=bernoulliBounds(H[1][0],n,alpha).map(v=>clamp(v*w[1],0,c.prior)),[fl,fh]=bernoulliBounds(H[0][1],n,alpha).map(v=>clamp(v*w[0],0,1-c.prior));
   return {n,method,coverage:cov,coverageLow:clamp(cov-wmax*h,0,1),coverageHigh:clamp(cov+wmax*h,0,1),loss:L,lossLow:clamp(L-wmax*Lmax*h,0,Lmax),lossHigh:clamp(L+wmax*Lmax*h,0,Lmax),miss,missLow:ml,missHigh:mh,false:fp,falseLow:fl,falseHigh:fh,missEvents:H[1][0],falseEvents:H[0][1],exactCoverage:method===6?exact?.coverage??null:null,exactLoss:method===6?exact?.loss??null:null};
  });
  checkpoints.push(...rows);
  // Absolute errors in probabilities and loss normalized by Lmax.
  achieved=c.mcTolerance>0&&rows.every(r=>Math.max(Math.abs(r.coverage-r.coverageLow),Math.abs(r.coverageHigh-r.coverage),Math.abs(r.loss-r.lossLow)/Lmax,Math.abs(r.lossHigh-r.loss)/Lmax,Math.abs(r.miss-r.missLow),Math.abs(r.missHigh-r.miss),Math.abs(r.false-r.falseLow),Math.abs(r.falseHigh-r.false))<=c.mcTolerance);
  if(achieved)break;
 }
 return {summary:checkpoints.slice(-2).map(r=>({...r,rep,achieved})),trace:checkpoints,counts,hist,calSeed,testSeed,proposal,weights:w,alphaPerLook:alpha,looks,maxN:c.mcN,n,achieved,nominalAssumptions:c.stress==="none"||c.eta===0,warning:"Условные интервалы при фиксированной калибровке, совместные по повторам, методам, показателям и заранее заданным проверкам. Оценка средних по калибровкам не заменяет неопределённость генерального распределения калибровок."};
}
