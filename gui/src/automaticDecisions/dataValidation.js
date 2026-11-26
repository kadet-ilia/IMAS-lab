// All imported data remain in the browser. No automatic upload.
import {BASE,validateExt,tables,point,select,loss,seedFor,lawsExt,draw} from "./extendedModel.js";
import {random} from "./kernel.js";
const seq=n=>Array.from({length:n},(_,i)=>i),sum=a=>a.reduce((s,v)=>s+v,0),mean=a=>a.length?sum(a)/a.length:null,clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export const DATA_SCHEMA="imas-e2-observations-v1";
export function parseDataset(raw){
 const f=typeof raw==="string"?JSON.parse(raw):raw;
 if(!f||f.schema!==DATA_SCHEMA||!Array.isArray(f.groups)||f.groups.length<1||f.groups.length>20||f.groups.some(n=>!Number.isInteger(n)||n<2||n>50)||!Array.isArray(f.rows)||f.rows.length<20||f.rows.length>50000)throw Error("Ожидается imas-e2-observations-v1: 20–50 000 строк, 1–20 групп по 2–50 агентов");
 if(f.rows.length*sum(f.groups)>10000000)throw Error("Лимит импорта — 10 млн агентных наблюдений");
 let prev=-Infinity;const ids=new Set();
 for(const row of f.rows){if(!row||!Number.isFinite(row.time)||row.time<=prev||![0,1].includes(row.x)||!Array.isArray(row.agents)||row.agents.length!==f.groups.length||row.agents.some((a,g)=>!Array.isArray(a)||a.length!==f.groups[g]||a.some(v=>v!==0&&v!==1&&v!==null)))throw Error("Строки должны иметь строго возрастающее числовое time, x=0/1 и массивы agents заданных размеров (0,1,null)");prev=row.time;if(row.id!==undefined){if(typeof row.id!=="string"||ids.has(row.id))throw Error("Повтор или неверный id");ids.add(row.id);}}
 return {schema:DATA_SCHEMA,groups:f.groups.slice(),source:typeof f.source==="string"?f.source.slice(0,200):"Пользовательский набор",synthetic:f.synthetic===true,rows:f.rows.map(r=>({time:r.time,x:r.x,agents:r.agents.map(a=>a.slice()),...(r.id===undefined?{}:{id:r.id})}))};
}
export function exampleDataset(N=1000,seed=20261126){
 const c={...BASE,groups:[3,3,2],u:BASE.u,rho:BASE.rho},q=lawsExt(c).nominal,F=q.map(row=>row.map(a=>a.map((_,i)=>sum(a.slice(0,i+1))))),r=random(seed);
 return {schema:DATA_SCHEMA,groups:c.groups,source:"Синтетический демонстрационный набор; не реальные данные",synthetic:true,rows:seq(N).map(i=>{const x=+(r()<c.prior);return {time:i,x,agents:c.groups.map((n,g)=>{const j=draw(F[x][g],r()),a=seq(n).map(k=>+(k<j));for(let k=n-1;k>0;k--){const l=Math.floor(r()*(k+1));[a[k],a[l]]=[a[l],a[k]];}return i<Math.floor(N*.6)?a:a.map(v=>r()<.4?null:v);})};})};
}
function diagnostics(train,test,groups){
 const positions=groups.flatMap((n,g)=>seq(n).map(i=>({g,i}))),out=[];
 // Descriptive pairwise Pearson correlations conditional on X, only on complete calibration data.
 // Limit quadratic diagnostics for large systems: first up to 100 agents, reported explicitly.
 const P=positions.slice(0,100);
 for(const x of [0,1]){
  const rows=train.filter(r=>r.x===x),N=rows.length,probs=P.map(({g,i})=>mean(rows.map(r=>r.agents[g][i]))),pair=[];
  for(let i=0;i<P.length;i++)for(let j=i+1;j<P.length;j++){
   const a=probs[i],b=probs[j],den=Math.sqrt(a*(1-a)*b*(1-b));
   if(den>0){let joint=0;for(const row of rows)joint+=row.agents[P[i].g][P[i].i]*row.agents[P[j].g][P[j].i];const ab=joint/N;pair.push({within:P[i].g===P[j].g,r:Math.abs((ab-a*b)/den)});}
  }
  for(let g=0;g<groups.length;g++){const p=seq(groups[g]).map(i=>mean(rows.map(r=>r.agents[g][i]))),t=test.filter(r=>r.x===x);
   out.push({x,group:g+1,N,mean:mean(p),marginalSpread:Math.max(...p)-Math.min(...p),missing:t.length?sum(t.map(r=>r.agents[g].filter(v=>v===null).length))/(t.length*groups[g]):null});
  }
  out.push({x,group:"Все (до 100)",N,withinAbsCorr:mean(pair.filter(r=>r.within).map(r=>r.r)),betweenAbsCorr:mean(pair.filter(r=>!r.within).map(r=>r.r)),diagnosticAgents:P.length});
 }
 return out;
}
export function validateObservations(raw,config){
 const f=parseDataset(raw),fraction=config.trainFraction??.6;if(!Number.isFinite(fraction)||fraction<.1||fraction>.9)throw Error("Доля калибровки 0,1–0,9");
 const cut=Math.floor(f.rows.length*fraction),train=f.rows.slice(0,cut),test=f.rows.slice(cut);
 if(train.some(r=>r.agents.some(a=>a.includes(null))))throw Error("Калибровочная часть должна содержать полные наблюдения; неполные строки не исключаются молча. Измените долю или предоставьте отдельные полные данные.");
 const M=[0,1].map(x=>train.filter(r=>r.x===x).length);if(M.some(n=>n<2))throw Error("В калибровке нужны минимум две полные строки каждого класса");
 const c=validateExt({...BASE,...config,groups:f.groups,u:[0,1].map(()=>f.groups.map(()=>.5)),rho:f.groups.map(()=>0),m:Math.max(...M),prior:M[1]/cut,stress:"none",eta:0});
 const counts=[0,1].map(x=>f.groups.map(n=>seq(n+1).map(()=>0)));
 for(const r of train)r.agents.forEach((a,g)=>counts[r.x][g][sum(a)]++);
 const T=tables(c,counts,M),hist=[[0,0,0],[0,0,0]],predictions=[];
 for(const r of test){const ix=r.agents.map(a=>{const m=a.filter(v=>v!==null).length,k=a.filter(v=>v===1).length;return m*(m+1)/2+k;}),[lo,hi]=point(c,T,ix),a=select(c,lo,hi);hist[r.x][a]++;predictions.push({time:r.time,x:r.x,lo,hi,action:a,loss:loss(c,a,r.x)});}
 const N=test.length,coverage=1-(hist[0][2]+hist[1][2])/N,L=mean(predictions.map(v=>v.loss)),miss=hist[1][0]/N,fp=hist[0][1]/N,h=Math.sqrt(Math.log(8/c.alpha)/(2*N)),maxLoss=Math.max(c.b,c.f,c.d,c.c);
 const intervals=config.iidTest?{coverageLow:clamp(coverage-h,0,1),coverageHigh:clamp(coverage+h,0,1),lossLow:clamp(L-maxLoss*h,0,maxLoss),lossHigh:clamp(L+maxLoss*h,0,maxLoss),missLow:clamp(miss-h,0,1),missHigh:clamp(miss+h,0,1),falseLow:clamp(fp-h,0,1),falseHigh:clamp(fp+h,0,1)}:null;
 return {version:"E2-data-v1",source:f.source,synthetic:f.synthetic,config:c,split:{cut,trainN:cut,testN:N,trainLast:train.at(-1).time,testFirst:test[0].time,M},counts,hist,summary:[{coverage,loss:L,miss,false:fp,N,...intervals}],trace:predictions,diagnostics:diagnostics(train,test,f.groups),iidTest:!!config.iidTest,certified:false,warning:"Эмпирическая априорная вероятность оценена только по калибровке; интервалы модели не являются сертификатами без проверки предпосылок. Корреляции и разброс маргиналей — диагностика, не доказательство независимости; MNAR по неполным наблюдениям не идентифицируется."};
}
