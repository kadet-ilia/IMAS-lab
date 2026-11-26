// E2.1: independent stochastic observation generation; no joint enumeration in MC-only mode.
import {DEFAULTS,laws,geometry,radius,extrem,bounds,joint,decisions,metrics,random,multinomial} from "./kernel.js";
export const MC_VERSION="E2.1-mc-v2";
export const MC_DEFAULTS={...DEFAULTS,mode:"custom",reps:1,m:20000,samples:100000,mcSeed:20262128,mcAlpha:.05,exact:true};
const METHODS=[6,7], KEYS=["coverage","loss","miss","false"];
const dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0);
const sum=a=>a.reduce((s,x)=>s+x,0);
const clamp=(x,l,h)=>Math.max(l,Math.min(h,x));
export function validateMC(raw){
 const c={...MC_DEFAULTS,...raw},integer=(v,l,h)=>Number.isInteger(v)&&v>=l&&v<=h,real=(v,l,h)=>Number.isFinite(v)&&v>=l&&v<=h;
 if(!Array.isArray(c.groups)||c.groups.length!==3||c.groups.some(v=>!integer(v,2,30)))throw Error("Требуются три группы по 2–30 агентов");
 if(!Array.isArray(c.u)||c.u.length!==2||c.u.some(row=>!Array.isArray(row)||row.length!==3||row.some(v=>!real(v,0,1)))||!Array.isArray(c.rho)||c.rho.length!==3||c.rho.some(v=>!real(v,0,1)))throw Error("Некорректные вероятности групп");
 if(!integer(c.scenario,1,8)||!integer(c.m,1,1000000)||!integer(c.samples,1000,2000000)||!integer(c.seed,1,4294967295)||!integer(c.mcSeed,1,4294967295)||c.seed===c.mcSeed||!real(c.prior,1e-9,1-1e-9)||!real(c.alpha,1e-9,1-1e-9)||!real(c.mcAlpha,1e-9,1-1e-9)||!real(c.b,1e-9,1000)||!real(c.f,1e-9,1000)||!real(c.d,0,c.f)||c.d>=c.f||!real(c.c,0,1000)||typeof c.exact!=="boolean")throw Error("Некорректные параметры; зерна калибровки и тестирования должны различаться");
 const size=c.groups.reduce((s,n)=>s*(n+1)*(n+2)/2,1);
 if(c.exact&&size>300000)throw Error("Для более чем 300 000 конфигураций отключите точное сравнение");
 return c;
}
function cdf(a){let s=0;return a.map(v=>s+=v);}
function draw(F,u){let a=0,b=F.length-1;while(a<b){let i=(a+b)>>1;if(u<F[i])b=i;else a=i+1;}return a;}
export function makeCalibration(c,q){
 const r=random(c.seed);return q.map(row=>row.map(a=>multinomial(c.m,a,r)));
}
export function groupBounds(c,G,counts){
 if(!Array.isArray(counts)||counts.length!==2||counts.some(row=>!Array.isArray(row)||row.length!==3||row.some((a,g)=>!Array.isArray(a)||a.length!==c.groups[g]+1||a.some(v=>!Number.isSafeInteger(v)||v<0)||sum(a)!==c.m)))throw Error("Некорректные первичные частоты");
 const hat=counts.map(row=>row.map(a=>a.map(v=>v/c.m)));
 const lo=hat.map(row=>row.map((a,g)=>G.H[g].map(h=>Math.max(0,-extrem(h.map(v=>-v),a,radius(c,c.groups[g],c.m))))));
 const hi=hat.map(row=>row.map((a,g)=>G.H[g].map(h=>Math.max(0,extrem(h,a,radius(c,c.groups[g],c.m))))));
 return {hat,lo,hi};
}
export function pointBounds(c,B,ix){
 const product=(table,x)=>table[x].reduce((v,row,g)=>v*row[ix[g]],1);
 const a=c.prior*product(B.lo,1),b=(1-c.prior)*product(B.hi,0),u=c.prior*product(B.hi,1),v=(1-c.prior)*product(B.lo,0);
 return [a+b>0?a/(a+b):0,u+v>0?u/(u+v):1];
}
export function actionAt(c,B,ix,method){
 const [l,u]=pointBounds(c,B,ix);
 const th=c.f/(c.b+c.f-c.d),w0=c.b*u,w1=c.f+(c.d-c.f)*l;
 return method===6?(u<th&&w0<=c.c?0:l>th&&w1<=c.c?1:2):(Math.min(w0,w1)<=c.c?(w1<w0?1:0):2);
}
export function observation(c,F,r){
 const x=+(r()<c.prior),common=c.scenario===7&&r()<.2,shared=common?r():0;
 const ix=c.groups.map((n,g)=>{
  const j=draw(F[x][g],common?shared:r());let m=0,k=0;
  // Exchangeability: conditional on j, the identity of positive sources is immaterial for count observables.
  for(let i=0;i<n;i++){const y=i<j,delivery=c.scenario===8?(y?.35:.75):(c.scenario<=2?.95:.6);if(r()<delivery){m++;k+=+y;}}
  return m*(m+1)/2+k;
 });
 return {x,ix};
}
export function checkpointPlan(N){return [...new Set([1000,3000,10000,30000,100000,300000,1000000,N].filter(n=>n<=N))].sort((a,b)=>a-b);}
export function createMC(raw,counts0,resume=null){
 const c=validateMC(raw),G=geometry(c),{q,test}=laws(c,c.scenario),counts=resume?.counts||counts0||makeCalibration(c,q),B=groupBounds(c,G,counts),F=test.map(row=>row.map(cdf)),plan=checkpointPlan(c.samples);
 let rngState=(resume?.rngState??c.mcSeed)>>>0;const r=()=>{rngState^=rngState<<13;rngState^=rngState>>>17;rngState^=rngState<<5;return (rngState>>>0)/4294967296;};
 const exact=c.exact?(()=>{const P=joint(c,G,test,c.scenario),[l,u]=bounds(c,G,B.hat,c.m);return Object.fromEntries(METHODS.map(m=>[m,metrics(c,P,decisions(c,l,u,c.c,m===6))]));})():null;
 const maxLoss=Math.max(c.b,c.f,c.d,c.c), hist=resume?JSON.parse(JSON.stringify(resume.hist)):Object.fromEntries(METHODS.map(m=>[m,[[0,0,0],[0,0,0]]]));
 let n=resume?.n??0;const checkpoints=resume?resume.checkpoints.slice():[];
 if(resume&&(resume.version!==MC_VERSION||!Number.isInteger(n)||n<0||n>c.samples||!Number.isInteger(resume.rngState)||resume.rngState<1||resume.rngState>4294967295||METHODS.some(m=>!Array.isArray(hist[m])||hist[m].length!==2||hist[m].some(a=>!Array.isArray(a)||a.length!==3||a.some(v=>!Number.isSafeInteger(v)||v<0))||hist[m].flat().reduce((a,b)=>a+b,0)!==n)||checkpoints.length!==plan.filter(v=>v<=n).length*8))throw Error("Некорректная контрольная точка MC");
 function advance(count){
  if(!Number.isInteger(count)||count<1)throw Error("Некорректный размер пакета");
  const stop=Math.min(c.samples,n+count);
  while(n<stop){
   const {x,ix}=observation(c,F,r);
   for(const m of METHODS)hist[m][x][actionAt(c,B,ix,m)]++;
   n++;
   if(plan.includes(n)){
    // Fixed, predeclared looks; union bound across four metrics, two methods and all looks.
    const half=Math.sqrt(Math.log(2*KEYS.length*METHODS.length*plan.length/c.mcAlpha)/(2*n));
    for(const m of METHODS){
     const h=hist[m],miss=h[1][0]/n,fp=h[0][1]/n,tp=h[1][1]/n,coverage=(h[0][0]+h[0][1]+h[1][0]+h[1][1])/n,loss=c.b*miss+c.f*fp+c.d*tp+c.c*(1-coverage);
     const values={coverage,loss,miss,false:fp};
     for(const k of KEYS){const scale=k==="loss"?maxLoss:1,estimate=values[k],e=exact?.[m][k]??null;checkpoints.push({n,method:m,metric:k,estimate,lower:clamp(estimate-scale*half,0,scale),upper:clamp(estimate+scale*half,0,scale),exact:e,error:e===null?null:estimate-e});}
    }
   }
  }
  return n;
 }
 function result(){return {version:MC_VERSION,config:c,counts,checkpoints:checkpoints.slice(),hist:JSON.parse(JSON.stringify(hist)),n,exact,plannedLooks:plan,confidence:1-c.mcAlpha,assumptionsValid:![4,7,8].includes(c.scenario),calibrationIncluded:q.every((row,x)=>row.every((a,g)=>sum(a.map((v,j)=>Math.abs(v-B.hat[x][g][j])))<=radius(c,c.groups[g],c.m)))};}
 const checkpoint=()=>({version:MC_VERSION,n,rngState:rngState>>>0,counts,hist:JSON.parse(JSON.stringify(hist)),checkpoints:checkpoints.slice()});
 return {advance,result,checkpoint};
}
