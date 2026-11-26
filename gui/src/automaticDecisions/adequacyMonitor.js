// E2.23/E2.25: finite-horizon multiscale scan and a change-start mixture
// e-process. All monitor features are available at arrival or delayed label.
// Calibration of the reference is independent of the fixed decision rule.
import {validateExt,lawsExt,calibration,tables,point,select,loss,sampler,seedFor,mixLaw} from "./extendedModel.js";
import {weightedTables} from "./adaptiveNext.js";
import {random} from "./kernel.js";
const sum=a=>a.reduce((s,v)=>s+v,0),mean=a=>sum(a)/a.length,clip=v=>Math.max(0,Math.min(1,v));
const int=(v,a,b)=>Number.isInteger(v)&&v>=a&&v<=b,real=(v,a,b)=>Number.isFinite(v)&&v>=a&&v<=b;
const BETS=[.25,.5,1,2,4,8];
function logAdd(a,b){if(a===-Infinity)return b;if(b===-Infinity)return a;const m=Math.max(a,b);return m+Math.log1p(Math.exp(Math.min(a,b)-m));}
export function referenceInterval(values,F,alpha){
 if(!values.length)return [0,1];
 const p=mean(values),h=Math.sqrt(Math.log(4*F/alpha)/(2*values.length));
 return [clip(p-h),clip(p+h)];
}
// Each feature is its own stream; the reference event and monitor event
// receive alpha/2 each. E-values are averaged across directions and bets,
// with equal mass on every possible start index 1..H (unstarted mass = 1).
export function featureMonitor(reference,F,H,windows,alpha){
 const [lo,hi]=referenceInterval(reference,F,alpha),prefix=[0],logs=BETS.flatMap(()=>[-Infinity,-Infinity]),logH=Math.log(H),threshold=Math.log(2*F/alpha),unique=[...new Set(windows)];
 let n=0,scanHit=false,eHit=false;
 return {lo,hi,referenceN:reference.length,push(v){
  if(!real(v,0,1)||n>=H)throw Error("Некорректный поток мониторинга");
  n++;prefix.push(prefix.at(-1)+v);let scan=0;
  for(const w of unique)if(n>=w){const m=(prefix[n]-prefix[n-w])/w,h=Math.sqrt(Math.log(4*F*H*unique.length/alpha)/(2*w));scan=Math.max(scan,(m-hi)/h,(lo-m)/h);}
  scanHit||=scan>1;
  for(let j=0;j<BETS.length;j++){const l=BETS[j];logs[2*j]=logAdd(logs[2*j],-logH)+l*(v-hi)-l*l/8;logs[2*j+1]=logAdd(logs[2*j+1],-logH)+l*(lo-v)-l*l/8;}
  const idle=n<H?Math.log1p(-n/H):-Infinity,logE=logAdd(idle,logs.reduce(logAdd,-Infinity)-Math.log(logs.length));
  eHit||=logE>=threshold;
  return {scan,logE,scanHit,eHit,n};
 }};
}
function features(c,G,row,a){
 const mk=row.ix.map((i,g)=>G[g].pairs[i]),k=mk.map(([m,k],g)=>k/c.groups[g]),m=mk.map(([m],g)=>m/c.groups[g]),v=[mean(m),mean(k),+(a!==2)];
 const names=["delivery","positive","auto"],labelled=[];
 for(let g=0;g<k.length;g++){labelled.push(["k"+g,k[g]],["m"+g,m[g]],["square"+g,k[g]**2]);}
 for(let g=0;g<k.length;g++)for(let j=g+1;j<k.length;j++)labelled.push(["pair"+g+"_"+j,k[g]*k[j]]);
 const Lmax=Math.max(c.b,c.f,c.d,c.c);labelled.push(["loss",loss(c,a,row.x)/Lmax],["autoLoss",a===2?0:loss(c,a,row.x)/Lmax]);
 return {arrival:names.map((k,i)=>[k,v[i]]),labelled:labelled.map(([k,v])=>["x"+row.x+":"+k,v])};
}
function featureKeys(c){const k=["delivery","positive","auto"];for(const x of [0,1]){for(let g=0;g<c.groups.length;g++)for(const p of ["k","m","square"])k.push("x"+x+":"+p+g);for(let g=0;g<c.groups.length;g++)for(let j=g+1;j<c.groups.length;j++)k.push("x"+x+":pair"+g+"_"+j);k.push("x"+x+":loss","x"+x+":autoLoss");}return k;}
export function validateMonitor(c){
 if(c.family!=="l1"||!["drift","driftAll","cross","mnar","biasedMask"].includes(c.monitorStress)||!int(c.monitorRef,200,20000)||!int(c.monitorReps,1,30)||!int(c.shortWindow,10,c.window)||!int(c.monitorMin,10,c.window)||!real(c.alarmAlpha,1e-6,.5)||c.groups.length>8||c.m>20000)throw Error("Мониторинг: L1, до 8 групп, M до 20000, проверьте окна и параметры");
 if((c.steps+c.monitorRef)*featureKeys(c).length*c.monitorReps>1e8||c.steps/c.updateEvery*c.groups.reduce((s,n)=>s+(n+1)*(n+2)/2,0)*c.monitorReps>2e7)throw Error("Превышен бюджет мониторинга");
 return c;
}
const accum=()=>({coverage:0,loss:0,miss:0,false:0,revoked:0});
function add(v,c,a,x,revoked){v.coverage+=+(a!==2);v.loss+=loss(c,a,x);v.miss+=+(a===0&&x===1);v.false+=+(a===1&&x===0);v.revoked+=+revoked;}
function normalized(a,N){return Object.fromEntries(Object.entries(a).map(([k,v])=>[k,v/N]));}
export function monitorStudy(raw,unit){
 const c=validateMonitor(validateExt({...raw,stress:"none",eta:0})),shift=unit.shift,seed=seedFor(c.seed,93000+unit.rep*3),refSeed=seedFor(c.seed,93001+unit.rep*3),testSeed=seedFor(c.seed,93002+unit.rep*3);
 if(!real(shift,0,1))throw Error("Некорректная интенсивность");
 const q=lawsExt(c).nominal,counts=calibration(c,q,seed),fixed=tables(c,counts),G=fixed.G,keys=featureKeys(c),F=keys.length,ref=Object.fromEntries(keys.map(k=>[k,[]])),reference=sampler(c,q,random(refSeed));
 const nominalAction=row=>select(c,...point(c,fixed,row.ix));
 for(let i=0;i<c.monitorRef;i++){const row=reference(),f=features(c,G,row,nominalAction(row));for(const [k,v] of [...f.arrival,...f.labelled])ref[k].push(v);}
 const windows=[c.shortWindow,c.window],mon=Object.fromEntries(keys.map(k=>[k,featureMonitor(ref[k],F,c.steps,windows,c.alarmAlpha)]));
 const referenceStats=keys.map(k=>({feature:k,N:ref[k].length,mean:ref[k].length?mean(ref[k]):null,lo:mon[k].lo,hi:mon[k].hi}));
 const afterC={...c,stress:c.monitorStress==="driftAll"?"drift":c.monitorStress,eta:shift},afterQ=lawsExt(afterC).test;
 if(c.monitorStress==="driftAll")afterQ[1]=c.groups.map((n,g)=>mixLaw(n,(1-shift)*c.u[1][g]+shift*.45,c.rho[g]*c.rhoScale));
 const rng=random(testSeed),before=sampler(c,q,rng),after=sampler(afterC,afterQ,rng),switchAt=Math.floor(c.steps*c.changeAt),pending=[],history=[[],[]],events=[],trace=[];
 const names=["Фиксированная M6","Отзыв: многомасштабное окно","Отзыв: e-процесс","Перекалибровка после e-сигнала"],acc=names.map(accum);let block=names.map(accum),blockN=0,released=0,scanAlarm=null,eAlarm=null,scanFeature=null,eFeature=null,scanScore=0,eScore=0,model=null,updates=0;
 function feed(entries,t){
  for(const [k,v] of entries){const a=mon[k].push(v);scanScore=Math.max(scanScore,a.scan);eScore=Math.max(eScore,a.logE/Math.log(2*F/c.alarmAlpha));
   if(scanAlarm===null&&a.scanHit){scanAlarm=t;scanFeature=k;}
   if(eAlarm===null&&a.eHit){eAlarm=t;eFeature=k;}
  }
 }
 for(let t=0;t<c.steps;t++){
  while(released<pending.length&&pending[released].reveal<=t){
   const v=pending[released++];feed(v.labelled,t);
   // Full count recovery after audit is explicitly simulated. No future labels.
   if(eAlarm!==null&&v.time>=eAlarm){history[v.x].push(v.full);if(history[v.x].length>c.window)history[v.x].shift();}
  }
  if(eAlarm!==null&&history.every(a=>a.length>=c.monitorMin)&&t%c.updateEvery===0){
   // Exploratory re-fit only: certificate remains withdrawn, even if a
   // post-alarm window appears stable. No automatic recertification.
   model=weightedTables(c,history,c.window,1,c.alpha);updates++;
  }
  const row=t<switchAt?before():after(),a=nominalAction(row),f=features(c,G,row,a);
  // Current delivered observations can trigger withdrawal BEFORE deciding.
  // Labelled features are consumed only after the actual reveal time.
  feed(f.arrival,t);
  const actions=[a,scanAlarm===null?a:2,eAlarm===null?a:2,eAlarm===null?a:model?select(c,...point(c,model,row.ix)):2],revoked=[false,scanAlarm!==null,eAlarm!==null,eAlarm!==null];
  for(let i=0;i<names.length;i++){add(acc[i],c,actions[i],row.x,revoked[i]);add(block[i],c,actions[i],row.x,revoked[i]);}
  pending.push({time:t,reveal:t+Math.max(1,c.delay),x:row.x,full:row.full,labelled:f.labelled});
  events.push({t,x:row.x,ix:row.ix,actions,revoked,scanAlarm,eAlarm,released,refit:!!model});blockN++;
  if((t+1)%c.updateEvery===0||t===c.steps-1){trace.push({t:t+1,fixedLoss:block[0].loss/blockN,scanLoss:block[1].loss/blockN,eLoss:block[2].loss/blockN,refitLoss:block[3].loss/blockN,scanScore,eScore,threshold:1,scanRevoked:+(scanAlarm!==null),eRevoked:+(eAlarm!==null),released,cal0:history[0].length,cal1:history[1].length,refitUpdates:updates});block=names.map(accum);blockN=0;}
 }
 const summary=names.map((policy,i)=>{const alarm=i===0?null:i===1?scanAlarm:eAlarm,pre=alarm!==null&&(shift===0||alarm<switchAt),detected=shift>0&&alarm!==null&&alarm>=switchAt;return {policy,rep:unit.rep,shift,...normalized(acc[i],c.steps),firstAlarm:alarm,preAlarm:+pre,detected:+detected,alarmDelay:detected?alarm-switchAt:null,updates:i===3?updates:0,certificate:"conditional_only"};});
 return {unit,summary,trace,events,referenceStats,counts,seed,refSeed,testSeed,switchAt,scanAlarm,eAlarm,scanFeature,eFeature,released,updates,warning:"Уровень ложной тревоги относится отдельно к каждому детектору при стационарном iid потоке и независимом эталоне; не является гарантией отсутствия сдвига. Сигнал отзывает сертификат до внешней проверки. Перекалибровка экспериментальная, предполагает восстановление полного счётчика при аудите; сертификат не восстанавливается."};
}
export function monitorSummary(records){
 const groups=new Map();
 for(const r of records)for(const v of r.summary){const k=JSON.stringify([v.policy,v.shift]);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(v);}
 const rows=[...groups.values()].map(a=>{const v=a[0],avg=k=>mean(a.map(r=>r[k])),det=a.filter(r=>r.detected);return {policy:v.policy,shift:v.shift,reps:a.length,coverage:avg("coverage"),loss:avg("loss"),miss:avg("miss"),false:avg("false"),revoked:avg("revoked"),falseAlarm:avg("preAlarm"),detectionRate:v.shift>0?avg("detected"):null,alarmDelay:det.length?mean(det.map(r=>r.alarmDelay)):null,updates:avg("updates")};});
 return {rows,aux:(records.find(r=>r.unit.shift>0)||records[0]).trace};
}
