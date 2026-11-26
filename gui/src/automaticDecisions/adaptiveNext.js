// E2.13: delayed class-labelled full observations; predeclared weighted suffix policies.
import {validateExt,lawsExt,groupGeometry,point,select,loss,sampler,seedFor,draw} from "./extendedModel.js";
import {random,extrem} from "./kernel.js";
const sum=a=>a.reduce((s,v)=>s+v,0),seq=n=>Array.from({length:n},(_,i)=>i),clamp=(v)=>Math.max(0,Math.min(1,v));
const cdf=a=>{let s=0;return a.map(v=>s+=v);};
export function weightedLaw(history,n,g,limit,decay=1){
 const rows=history.slice(-limit),w=rows.map((_,i)=>decay**(rows.length-1-i)),z=sum(w),p=seq(n+1).map(()=>0);
 if(!rows.length||!(z>0))throw Error("Пустая калибровка");
 rows.forEach((a,i)=>p[a[g]]+=w[i]/z);
 return {p,effectiveN:z*z/sum(w.map(v=>v*v))};
}
export function weightedTables(c,history,limit,decay,alpha){
 const G=c.groups.map(groupGeometry),hat=[],low=[],high=[],radii=[],effectiveN=[];
 for(let x=0;x<2;x++){
  hat[x]=[];low[x]=[];high[x]=[];radii[x]=[];effectiveN[x]=[];
  for(let g=0;g<G.length;g++){
   const {p,effectiveN:N}=weightedLaw(history[x],c.groups[g],g,limit,decay);
   // Weighted Hoeffding over all nontrivial subsets; L1 = 2 max subset deviation.
   const eps=Math.min(2,Math.sqrt(2*Math.log((2**(c.groups[g]+1)-2)*2*G.length/alpha)/N));
   hat[x][g]=p;radii[x][g]=eps;effectiveN[x][g]=N;
   low[x][g]=G[g].H.map(h=>clamp(-extrem(h.map(v=>-v),p,eps)));
   high[x][g]=G[g].H.map(h=>clamp(extrem(h,p,eps)));
  }
 }
 return {G,hat,low,high,radii,effectiveN};
}
const valid=(v,a,b)=>Number.isFinite(v)&&v>=a&&v<=b;
const int=(v,a,b)=>Number.isInteger(v)&&v>=a&&v<=b;
export function validateAdaptiveNext(c){
 if(c.family!=="l1")throw Error("Для взвешенной калибровки выберите L1");
 if(!int(c.shortWindow,10,c.window)||!valid(c.forgetting,.8,1)||!int(c.adaptiveReps,1,30)||!valid(c.alarmAlpha,1e-6,.5))throw Error("Некорректные параметры адаптивной калибровки");
 if(c.steps*c.groups.reduce((s,n)=>s+(n+1)*(n+2)/2,0)/c.updateEvery>2e7)throw Error("Слишком большой объём обновления таблиц");
 return c;
}
const initAcc=()=>({auto:0,L:0,miss:0,fp:0});
function observe(a,c,d,x){a.auto+=+(d!==2);a.L+=loss(c,d,x);a.miss+=+(d===0&&x===1);a.fp+=+(d===1&&x===0);}
export function adaptiveNext(raw,unit){
 const c=validateAdaptiveNext(validateExt({...raw,stress:"none",eta:0})),shift=unit.shift,seed=seedFor(c.seed,81000+unit.rep*2),testSeed=seedFor(c.seed,81001+unit.rep*2),q=lawsExt(c).nominal,r=random(seed),F=q.map(row=>row.map(cdf));
 const history=F.map(row=>seq(c.window).map(()=>row.map(a=>draw(a,r()))));
 const initial=history.map(row=>row.map(a=>a.slice()));
 // All potential class-specific suffix endpoints up to window+steps, and 4 fixed weight patterns.
 // Union over deterministic endpoints, not random selected update times.
 const alphaPer=c.alpha/(4*(c.steps+c.window+1)),fixed=weightedTables(c,history,c.window,1,alphaPer);
 const ref=weightedLaw(initial[1],c.groups[0],0,c.window).p,refMean=sum(ref.map((p,j)=>p*j/c.groups[0]));
 const alarmRadius=Math.sqrt(Math.log(4*(c.steps+c.window+1)/c.alarmAlpha)/(2*c.window))+Math.sqrt(Math.log(4*(c.steps+c.window+1)/c.alarmAlpha)/(2*c.shortWindow));
 const names=["Фиксированная","Длинное окно","Экспоненциальное забывание","Адаптивное окно"],acc=names.map(initAcc),trace=[],pending=[],rng=random(testSeed);
 const shifted={...c,stress:"drift",eta:shift},before=sampler(c,q,rng),after=sampler(shifted,lawsExt(shifted).test,rng),switchAt=Math.floor(c.steps*c.changeAt);
 let released=0,firstAlarm=null,alarmCount=0,preAlarm=false,active=false,models=[fixed,fixed,fixed,fixed],block=names.map(initAcc),blockN=0,updates=0;
 for(let t=0;t<c.steps;t++){
  while(released<pending.length&&pending[released].reveal<=t){const v=pending[released++];history[v.x].push(v.full);if(history[v.x].length>c.window)history[v.x].shift();}
  if(t%c.updateEvery===0){
   const p=weightedLaw(history[1],c.groups[0],0,c.shortWindow).p,avg=sum(p.map((v,j)=>v*j/c.groups[0])),signal=Math.abs(avg-refMean)>alarmRadius;
   if(signal){alarmCount++;if(t<switchAt||shift===0)preAlarm=true;if(firstAlarm===null)firstAlarm=t;}
   active=signal;updates++;
   const long=weightedTables(c,history,c.window,1,alphaPer),short=weightedTables(c,history,c.shortWindow,1,alphaPer),ew=weightedTables(c,history,c.window,c.forgetting,alphaPer);
   models=[fixed,long,ew,active?short:long];
  }
  const {x,ix,full}=t<switchAt?before():after();
  models.forEach((T,k)=>{const a=select(c,...point(c,T,ix));observe(acc[k],c,a,x);observe(block[k],c,a,x);});blockN++;
  pending.push({x,full,reveal:t+Math.max(1,c.delay)});
  if((t+1)%c.updateEvery===0||t===c.steps-1){trace.push({t:t+1,fixedLoss:block[0].L/blockN,longLoss:block[1].L/blockN,ewLoss:block[2].L/blockN,windowLoss:block[3].L/blockN,windowCoverage:block[3].auto/blockN,activeWindow:active?c.shortWindow:c.window,effectiveN:models[2].effectiveN[1][0],released});block=names.map(initAcc);blockN=0;}
 }
 const summary=names.map((policy,i)=>({policy,rep:unit.rep,shift,coverage:acc[i].auto/c.steps,loss:acc[i].L/c.steps,miss:acc[i].miss/c.steps,false:acc[i].fp/c.steps,preAlarm,firstAlarm,alarmDelay:firstAlarm===null||firstAlarm<switchAt||shift===0?null:firstAlarm-switchAt,alarmCount,updates}));
 return {summary,trace,seed,testSeed,initial,finalHistory:history,released,switchAt,firstAlarm,preAlarm,alarmRadius,alphaPer,stationaryGuarantee:shift===0,warning:"При стационарном iid законе взвешенная граница действует одновременно по фиксированным схемам и конечным позициям. При сдвиге — эвристическая; сигнал только по первой группе класса X=1."};
}
