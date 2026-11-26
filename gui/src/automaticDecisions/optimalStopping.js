// E2.14: finite-horizon static-latent POMDP. X and full group counts J do not evolve
// during a request. Query one previously unseen member of a chosen group.
import {validateExt,lawsExt,calibration,tables,point,select,loss,seedFor,sampler,groupGeometry} from "./extendedModel.js";
import {random} from "./kernel.js";
const sum=a=>a.reduce((s,v)=>s+v,0);
export function validateStopping(c){
 if(!Number.isInteger(c.queryBudget)||c.queryBudget<0||c.queryBudget>12||!Number.isFinite(c.queryCost)||c.queryCost<0||c.queryCost>1000||!Number.isFinite(c.safetyRisk)||c.safetyRisk<0||c.safetyRisk>1000)throw Error("Некорректный горизонт или цена запроса");
 if(c.groups.length>8||c.groups.reduce((s,n)=>s*(Math.min(n,c.queryBudget)+1)*(Math.min(n,c.queryBudget)+2)/2,1)>3000000)throw Error("Слишком большое пространство активного запроса; уменьшите число групп/горизонт");
 return c;
}
function likelihood(c,T,m,k){
 const l=[0,1].map(x=>Math.log(x?c.prior:1-c.prior)+sum(m.map((v,g)=>{
  const h=T.G[g].H[v*(v+1)/2+k[g]],z=sum(h.map((w,j)=>w*T.hat[x][g][j]));return Math.log(z);
 })));
 const max=Math.max(...l);if(!Number.isFinite(max))return null;const a=l.map(v=>Math.exp(v-max)),z=sum(a);return a.map(v=>v/z);
}
export function stoppingPolicy(c,T,active=true){
 const cache=new Map(),B=c.groups.length;
 function solve(m,k){
  const key=m.join(",")+"|"+k.join(",");if(cache.has(key))return cache.get(key);
  const p=likelihood(c,T,m,k),ix=m.map((v,g)=>v*(v+1)/2+k[g]),[lo,hi]=point(c,T,ix);
  let best={value:c.c,action:2,query:null,lo,hi};
  if(p){
   // Safety constraint is fixed, independent of acquisition cost and optimization.
   const safe=select({...c,c:c.safetyRisk},lo,hi,6);
   if(safe!==2){const value=p[0]*loss(c,safe,0)+p[1]*loss(c,safe,1);if(value<best.value)best={value,action:safe,query:null,lo,hi};}
   if(sum(m)<c.queryBudget){
    let available=m.map((v,g)=>v<c.groups[g]?g:-1).filter(g=>g>=0);
    if(!active&&available.length)available=[available.reduce((a,b)=>m[a]<=m[b]?a:b)];
    for(const g of available){
     const n=c.groups[g],h=T.G[g].H[ix[g]];
     let py=0;for(let x=0;x<2;x++){const w=T.hat[x][g].map((v,j)=>v*h[j]),z=sum(w);if(z>0)py+=p[x]*sum(w.map((v,j)=>v*(j-k[g])/(n-m[g])))/z;}
     py=Math.max(0,Math.min(1,py));
     const nextM=m.slice();nextM[g]++;const k1=k.slice();k1[g]++;
     let value=c.queryCost;
     if(py<1)value+=(1-py)*solve(nextM,k).value;
     if(py>0)value+=py*solve(nextM,k1).value;
     if(value<best.value-1e-12)best={value,action:null,query:g,lo,hi,py};
    }
   }
  }
  cache.set(key,best);return best;
 }
 const root=solve(Array(B).fill(0),Array(B).fill(0));return {root,solve,cache};
}
export function optimalStopping(raw){
 const c=validateStopping(validateExt({...raw,stress:"none",eta:0})),q=lawsExt(c).nominal,counts=calibration(c,q),T=tables(c,counts),active=stoppingPolicy(c,T,true),passive=stoppingPolicy(c,T,false);
 const seed=seedFor(c.seed,85000),next=sampler(c,q,random(seed)),r=random(seedFor(c.seed,85001)),names=["Немедленное решение","Циклический запрос (DP)","Активный запрос (DP)"],acc=names.map(()=>({L:0,auto:0,queries:0,miss:0,fp:0,unsafe:0})),trace=[],queryCounts=c.groups.map(()=>0);
 const empty=Array(c.groups.length).fill(0);
 for(let i=0;i<c.steps;i++){
  const {x,full}=next(),streams=c.groups.map((n,g)=>{const a=Array.from({length:n},(_,j)=>+(j<full[g]));for(let j=n-1;j>0;j--){const k=Math.floor(r()*(j+1));[a[j],a[k]]=[a[k],a[j]];}return a;});
  for(let j=0;j<3;j++){
   const m=empty.slice(),k=empty.slice();let a;
   for(;;){
    if(j===0){const p=likelihood(c,T,m,k),safe=select({...c,c:c.safetyRisk},...point(c,T,m.map((v,g)=>v*(v+1)/2+k[g])));a=p&&safe!==2&&p[0]*loss(c,safe,0)+p[1]*loss(c,safe,1)<c.c?safe:2;break;}
    const step=(j===1?passive:active).solve(m,k);
    if(step.query===null){a=step.action;break;}
    const g=step.query;k[g]+=streams[g][m[g]++];if(j===2)queryCounts[g]++;
   }
   const [lo,hi]=point(c,T,m.map((v,g)=>v*(v+1)/2+k[g])),n=sum(m),A=acc[j];A.unsafe+=+(a!==2&&select({...c,c:c.safetyRisk},lo,hi)!==a);A.L+=loss(c,a,x)+c.queryCost*n;A.auto+=+(a!==2);A.queries+=n;A.miss+=+(a===0&&x===1);A.fp+=+(a===1&&x===0);
  }
  if((i+1)%Math.max(1,Math.floor(c.steps/100))===0||i+1===c.steps)trace.push({t:i+1,immediateLoss:acc[0].L/(i+1),passiveLoss:acc[1].L/(i+1),activeLoss:acc[2].L/(i+1),activeQueries:acc[2].queries/(i+1)});
 }
 const summary=acc.map((a,i)=>({policy:names[i],loss:a.L/c.steps,coverage:a.auto/c.steps,delay:a.queries/c.steps,miss:a.miss/c.steps,false:a.fp/c.steps,unsafe:a.unsafe,nominalValue:i===0?Math.min(c.c,(()=>{const p=likelihood(c,T,empty,empty),a=select({...c,c:c.safetyRisk},...point(c,T,empty));return a===2?c.c:p[0]*loss(c,a,0)+p[1]*loss(c,a,1);})()):i===1?passive.root.value:active.root.value}));
 return {summary,trace,counts,seed,querySeed:seedFor(c.seed,85001),states:{active:active.cache.size,passive:passive.cache.size},root:active.root,queryCounts,warning:"Оптимальность относится к номинальному конечному POMDP со статическими скрытыми X,J. Запрос выбирает группу и случайного нераскрытого члена, а не индивидуальный источник. Ограничение M6 на риск независимо от цены ожидания. Параметр drop не используется."};
}
