// E2.31: reproducible two-factor designs and a compact record per independent run.
// All computation uses existing mathematical kernels.
import {validateExt,spaceSize,exactExt,seedFor} from "./extendedModel.js";
import {random} from "./kernel.js";
import {advancedMC,validateAdvancedMC} from "./advancedMC.js";
import {optimalStopping,validateStopping} from "./optimalStopping.js";
import {closedQueue,validateClosedQueue} from "./closedLoopQueue.js";
const seq=n=>Array.from({length:n},(_,i)=>i),sum=a=>a.reduce((s,v)=>s+v,0),int=(v,a,b)=>Number.isInteger(v)&&v>=a&&v<=b,real=(v,a,b)=>Number.isFinite(v)&&v>=a&&v<=b;
const bounds={prior:[.01,.8],c:[0,3],m:[100,100000],rhoScale:[0,1],drop:[0,.9]};
export const BATCH_TARGETS={exact:"Точная M6",mc:"Расширенный Монте-Карло M6/M7",cross:"Межгрупповая зависимость",optimal:"Активный запрос DP",queue:"Замкнутая СМО"};
function axis(c,k,lo,hi){if(!bounds[k]||!real(lo,...bounds[k])||!real(hi,lo,bounds[k][1])||hi===lo||(k==="m"&&(!Number.isInteger(lo)||!Number.isInteger(hi))))throw Error("Некорректный диапазон "+k);}
function value(k,lo,hi,u){const v=lo+(hi-lo)*u;return k==="m"?Math.round(v):v;}
export function batchDesign(c){
 const r=random(seedFor(c.seed,190000)),a=c.factor,b=c.factor2,points=[];
 if(c.batchDesign==="grid"){
  for(const i of seq(c.levels))for(const j of seq(c.levels2))points.push({[a]:value(a,c.from,c.to,i/(c.levels-1)),[b]:value(b,c.from2,c.to2,j/(c.levels2-1))});
 }else{
  const N=c.batchN,order=seq(N);
  if(c.batchDesign==="lhs")for(let i=N-1;i>0;i--){const j=Math.floor(r()*(i+1));[order[i],order[j]]=[order[j],order[i]];}
  for(let i=0;i<N;i++){const u=c.batchDesign==="lhs"?(i+r())/N:r(),v=c.batchDesign==="lhs"?(order[i]+r())/N:r();points.push({[a]:value(a,c.from,c.to,u),[b]:value(b,c.from2,c.to2,v)});}
 }
 if(new Set(points.map(v=>JSON.stringify(v))).size!==points.length)throw Error("Повторяющиеся конфигурации после округления: увеличьте диапазон M или уменьшите число уровней");
 return points;
}
export function batchPlan(raw){
 const c=validateExt({...raw,stress:"none",eta:0});
 if(!Object.hasOwn(BATCH_TARGETS,c.batchTarget)||!["grid","lhs","random"].includes(c.batchDesign)||c.factor===c.factor2||!int(c.levels,2,15)||!int(c.levels2,2,15)||!int(c.batchN,2,1000)||!int(c.batchWorkers,1,4)||!real(c.batchStress,0,1))throw Error("Некорректный план пакетной серии");
 axis(c,c.factor,c.from,c.to);axis(c,c.factor2,c.from2,c.to2);
 const points=batchDesign(c),total=points.length*c.reps;
 if(total>2000)throw Error("Не более 2000 расчётных единиц на пакет");
 if(["exact","cross"].includes(c.batchTarget)&&(spaceSize(c)>300000||spaceSize(c)*total>50000000))throw Error("Точный пакет ограничен 300000 наблюдений на задачу и 50 млн суммарно");
 if(c.batchTarget==="mc"){validateAdvancedMC({...c,reps:1});if(c.mcN*total>10000000)throw Error("Пакет MC ограничен 10 млн тестовых запросов");}
 if(c.batchTarget==="optimal"){if(!int(c.steps,100,20000))throw Error("Некорректное число тестовых запросов DP");validateStopping(c);if(c.steps*total>2000000)throw Error("Пакет DP ограничен 2 млн тестовых запросов");}
 if(c.batchTarget==="queue"){if(!real(c.arrival,.01,100000)||!real(c.service,.01,100000)||!int(c.operators,1,100)||!real(c.deadline,0,10000))throw Error("Некорректные параметры потока или обслуживания");validateClosedQueue(c);if(c.arrival*c.queueHorizon*(1+(c.peakEnd-c.peakStart)*(c.peakMultiplier-1))*total>2000000)throw Error("Пакет СМО ограничен 2 млн ожидаемых запросов");}
 return points.flatMap((values,i)=>seq(c.reps).map(rep=>({kind:"batch",case:i+1,rep,values,seed:seedFor(c.seed,200000+i*c.reps+rep)})));
}
const compact=r=>Object.fromEntries(["coverage","loss","miss","false","tight","upperRisk","posteriorMass","violation","assumptionsValid","failed","Wq","Lq","unsafe","nominalValue","delay","n","achieved","method","policy","coverageLow","coverageHigh","lossLow","lossHigh","missLow","missHigh","falseLow","falseHigh","exactLoss","exactCoverage","missEvents","falseEvents","rejected","timeout","rho","N","escalation","served","meanPrice"].filter(k=>r[k]!==undefined).map(k=>[k,r[k]]));
export function batchEvaluate(raw,unit){
 const c=validateExt({...raw,...unit.values,seed:unit.seed,reps:1,stress:"none",eta:0}),start=performance.now();
 let summary,primary;
 if(c.batchTarget==="exact"||c.batchTarget==="cross"){
  const conf={...c,stress:c.batchTarget==="cross"?"cross":"none",eta:c.batchTarget==="cross"?c.batchStress:0},r=exactExt(conf);summary=[{policy:"M6",...compact(r)}];primary={counts:r.counts,stress:conf.stress,eta:conf.eta};
 }else if(c.batchTarget==="mc"){
  const r=advancedMC(c,0);summary=r.summary.map(v=>({policy:"M"+v.method,...compact(v)}));primary={counts:r.counts,hist:r.hist,calSeed:r.calSeed,testSeed:r.testSeed,proposal:r.proposal,weights:r.weights,alphaPerLook:r.alphaPerLook,n:r.n};
 }else if(c.batchTarget==="optimal"){
  const r=optimalStopping(c);summary=r.summary.map(compact);primary={counts:r.counts,seed:r.seed,querySeed:r.querySeed,states:r.states};
 }else if(c.batchTarget==="queue"){
  const r=closedQueue(c,{kind:"closedQueue",rep:0});summary=r.summary.map(compact);primary={counts:r.calibrationCounts,outcomes:r.outcomes.map(v=>v.counts),calSeed:r.calSeed,arrivalSeed:r.arrivalSeed,observationSeed:r.observationSeed,serviceSeed:r.serviceSeed};
 }else throw Error("Неизвестная модель пакета");
 // Distinguish invalid nominal bounds from valid ones. No pooling across
 // configurations and no simultaneous claim for all independently calibrated policies.
 return {unit,summary,primary,ms:performance.now()-start};
}
export function batchSummary(records){
 const rows=records.flatMap(r=>r.summary.map(v=>({case:r.unit.case,rep:r.unit.rep,seed:r.unit.seed,...r.unit.values,...v,ms:r.ms}))),groups=new Map();
 for(const r of rows){const key=JSON.stringify([r.case,r.policy]);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r);}
 const stats=(a,k)=>{const v=a.map(r=>r[k]).filter(Number.isFinite);if(!v.length)return [null,null];const m=sum(v)/v.length;return [m,v.length>1?Math.sqrt(sum(v.map(x=>(x-m)**2))/(v.length-1)):null];};
 const aux=[...groups.values()].map(a=>{const [loss,lossSD]=stats(a,"loss"),[coverage,coverageSD]=stats(a,"coverage");return {case:a[0].case,policy:a[0].policy,reps:a.length,loss,lossSD,coverage,coverageSD};});
 return {rows,aux};
}
