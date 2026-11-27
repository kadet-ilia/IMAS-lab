// E2.34: fixed chronological train/test cohorts; no test labels for fitting.
// Arbitrary selective missing labels: sharp finite-cohort outcome bounds.
import {parseDataset,exampleDataset,validateObservations} from "./dataValidation.js";
import {BASE,validateExt,tables,point,select,loss} from "./extendedModel.js";
import {predictiveTables} from "./probabilityBounds.js";
export const EXTERNAL_SCHEMA="imas-e2-external-v1";
const sum=a=>a.reduce((s,v)=>s+v,0),seq=n=>Array.from({length:n},(_,i)=>i),text=(s,max=1000)=>typeof s==="string"&&s.trim().length>0&&s.length<=max;
const kinds=["operational","benchmark","semi_synthetic","synthetic"];
function fail(message){throw Error("Внешняя валидация: "+message);}
function sourceInfo(s){
 if(!s||!["name","reference","collection","labelMethod"].every(k=>text(s[k])))fail("для каждого периода нужны name, reference, collection, labelMethod");
 return Object.fromEntries(["name","reference","collection","labelMethod"].map(k=>[k,s[k]]));
}
export function parseExternal(raw){
 const f=typeof raw==="string"?JSON.parse(raw):raw;
 if(!f||f.schema!==EXTERNAL_SCHEMA||!Array.isArray(f.groups)||f.groups.length<1||f.groups.length>20||f.groups.some(n=>!Number.isInteger(n)||n<1||n>50)||!Array.isArray(f.rows)||f.rows.length<20||f.rows.length>50000||f.rows.length*sum(f.groups)>10000000)fail("неверная схема или превышен лимит 50 000 строк / 10 млн наблюдений");
 const P=f.provenance;
 if(!P||!kinds.includes(P.kind)||!text(P.mapping,4000)||typeof P.independentSource!=="boolean")fail("обязательны тип данных, описание сопоставления агентов и декларация независимости источника");
 const provenance={kind:P.kind,train:sourceInfo(P.train),test:sourceInfo(P.test),mapping:P.mapping,independentSource:P.independentSource};
 if(!Array.isArray(f.agentIds)||f.agentIds.length!==f.groups.length||f.agentIds.some((g,i)=>!Array.isArray(g)||g.length!==f.groups[i]||g.some(v=>!text(v,100)))||new Set(f.agentIds.flat()).size!==sum(f.groups))fail("уникальные постоянные идентификаторы агентов обязательны");
 if(!Number.isFinite(f.evaluationAt))fail("нужен числовой момент фиксации аудитов evaluationAt");
 const ids=new Set(),incident=new Map(),rows=[];let previous=-Infinity,seenTest=false,cut=0;
 for(const r of f.rows){
  if(!r||!text(r.id,150)||!text(r.incident,150)||ids.has(r.id)||!["train","test"].includes(r.split)||!Number.isFinite(r.time)||r.time<previous||r.time>f.evaluationAt||![0,1,null].includes(r.x)||!Array.isArray(r.agents)||r.agents.length!==f.groups.length||r.agents.some((a,g)=>!Array.isArray(a)||a.length!==f.groups[g]||a.some(v=>![0,1,null].includes(v))))fail("неверная строка, дубликат id или временной порядок");
  if(r.x===null?r.labelTime!==null:(!Number.isFinite(r.labelTime)||r.labelTime<r.time||r.labelTime>f.evaluationAt))fail("несогласованное время истинной метки");
  if(incident.has(r.incident)&&incident.get(r.incident)!==r.split)fail("один инцидент присутствует в обучении и тесте");
  incident.set(r.incident,r.split);ids.add(r.id);previous=r.time;
  if(r.split==="test")seenTest=true;
  else{if(seenTest||r.x===null||r.agents.some(a=>a.includes(null)))fail("обучение должно предшествовать тесту и содержать полные аудиты; строки не удаляются");cut++;}
  rows.push({id:r.id,incident:r.incident,split:r.split,time:r.time,x:r.x,labelTime:r.labelTime,agents:r.agents.map(a=>a.slice())});
 }
 if(cut<4||rows.length-cut<10||rows[cut-1].time>=rows[cut].time||rows.slice(0,cut).some(r=>r.labelTime>rows[cut].time))fail("нужны непересекающиеся периоды, минимум 4/10 строк и все обучающие метки доступны к началу теста");
 const M=[0,1].map(x=>rows.slice(0,cut).filter(r=>r.x===x).length);if(M.some(n=>n<2))fail("не менее двух обучающих аудитов каждого класса");
 return {schema:EXTERNAL_SCHEMA,groups:f.groups.slice(),agentIds:f.agentIds.map(g=>g.slice()),source:provenance.test.name,synthetic:provenance.kind==="synthetic",provenance,evaluationAt:f.evaluationAt,rows};
}
export function parseDataImport(raw){
 if(typeof raw!=="string")return raw?.schema===EXTERNAL_SCHEMA?parseExternal(raw):parseDataset(raw);
 let f;try{f=JSON.parse(raw);}catch{
  const lines=raw.trim().split(/\r?\n/);try{const head=JSON.parse(lines[0]);if(head.schema!==EXTERNAL_SCHEMA||head.rows!==undefined)throw Error();f={...head,rows:lines.slice(1).map(l=>JSON.parse(l))};}catch{fail("ожидается JSON либо JSONL: заголовок external-v1 и одна строка наблюдения на строку файла");}
 }
 return f?.schema===EXTERNAL_SCHEMA?parseExternal(f):parseDataset(f);
}
export function externalExample(N=1000){
 const f=exampleDataset(N),cut=Math.floor(N*.6),source={name:"Синтетический контроль",reference:"exampleDataset/20261126",collection:"Искусственный генератор; не внешние данные",labelMethod:"Известный класс генератора"};
 return parseExternal({schema:EXTERNAL_SCHEMA,groups:f.groups,agentIds:f.groups.map((n,g)=>seq(n).map(j=>"G"+g+"A"+j)),evaluationAt:N+10,provenance:{kind:"synthetic",train:source,test:source,mapping:"Постоянные идентификаторы искусственных агентов; часть тестовых меток намеренно скрыта",independentSource:false},rows:f.rows.map((r,i)=>{const hidden=i>=cut&&i%3===0;return {...r,id:"row-"+i,incident:"incident-"+i,split:i<cut?"train":"test",x:hidden?null:r.x,labelTime:hidden?null:r.time};})});
}
// Exact bounds on realized finite-cohort sums when unknown labels can vary
// independently over {0,1}. No missing-at-random assumption, no confidence level.
export function outcomeBounds(rows,fn){
 let lo=0,hi=0,known=0,K=0;
 for(const r of rows){if(r.x===null){const a=fn(r,0),b=fn(r,1);lo+=Math.min(a,b);hi+=Math.max(a,b);}else{const v=fn(r,r.x);lo+=v;hi+=v;known+=v;K++;}}
 const N=rows.length;if(!N)fail("пустая оценочная когорта");
 return {low:lo/N,high:hi/N,known:K?known/K:null,knownN:K,exact:lo===hi?lo/N:null};
}
function summarize(c,trace,policy){
 const R=outcomeBounds(trace,(r,x)=>loss(c,r.action,x)),A=outcomeBounds(trace,(r,x)=>r.action===2?0:loss(c,r.action,x)),M=outcomeBounds(trace,(r,x)=>+(r.action===0&&x===1)),F=outcomeBounds(trace,(r,x)=>+(r.action===1&&x===0));
 const N=trace.length,coverage=trace.filter(r=>r.action!==2).length/N;
 return {policy,N,knownN:R.knownN,labelCoverage:R.knownN/N,coverage,loss:R.exact,lossKnown:R.known,lossLow:R.low,lossHigh:R.high,autoRiskLow:A.low,autoRiskHigh:A.high,miss:M.exact,missLow:M.low,missHigh:M.high,false:F.exact,falseLow:F.low,falseHigh:F.high,certified:false};
}
export function evaluateExternal(raw,config){
 const f=parseExternal(raw);
 if(config.discoverGroups||config.iidTest||config.calibrationMode!=="complete")fail("для external-v1: фиксированные группы, полная калибровка, без iid-интервалов");
 const train=f.rows.filter(r=>r.split==="train"),test=f.rows.slice(train.length),M=[0,1].map(x=>train.filter(r=>r.x===x).length);
 const c=validateExt({...BASE,...config,groups:f.groups,u:[0,1].map(()=>f.groups.map(()=>.5)),rho:f.groups.map(()=>0),m:Math.max(...M),prior:M[1]/train.length,stress:"none",eta:0});
 const counts=[0,1].map(()=>f.groups.map(n=>seq(n+1).map(()=>0)));
 for(const r of train)r.agents.forEach((g,i)=>counts[r.x][i][sum(g)]++);
 const T=tables(c,counts,M),P=predictiveTables(T.G,T.hat),names=["M6 — строгая","M7 — minimax","Точечная групповая","Полная эскалация"],traces=names.map(()=>[]);
 for(const r of test){
  const ix=r.agents.map(a=>{const m=a.filter(v=>v!==null).length,k=a.filter(v=>v===1).length;return m*(m+1)/2+k;}),I=point(c,T,ix),J=point(c,P,ix);
  [select(c,...I,6),select(c,...I,7),select(c,...J,6),2].forEach((a,i)=>{const [lo,hi]=i===2?J:I;traces[i].push({id:r.id,time:r.time,x:r.x,labelTime:r.labelTime,policy:names[i],action:a,lo:i===3?null:lo,hi:i===3?null:hi,loss:r.x===null?null:loss(c,a,r.x)});});
 }
 const summary=traces.map((v,i)=>summarize(c,v,names[i]));
 const testIndex=new Map(test.map((r,i)=>[r.id,i]));
 const contrasts=names.slice(1).map((baseline,i)=>{const r=outcomeBounds(traces[0],(v,x)=>loss(c,traces[i+1][testIndex.get(v.id)].action,x)-loss(c,v.action,x));return {baseline,candidate:names[0],gainLow:r.low,gainHigh:r.high,gainKnown:r.known,knownN:r.knownN};});
 const diagnostics=[];
 for(let i=0;i<names.length;i++)for(const a of [0,1,2]){const rows=traces[i].filter(r=>r.action===a),known=rows.filter(r=>r.x!==null).length;diagnostics.push({policy:names[i],action:a,N:rows.length,knownN:known,labelCoverage:rows.length?known/rows.length:null});}
 const delivery=f.groups.map((n,g)=>({group:g+1,trainDelivery:1,testDelivery:sum(test.map(r=>r.agents[g].filter(v=>v!==null).length))/(test.length*n)}));
 return {version:"E2-external-v1",external:true,source:f.source,synthetic:f.synthetic,provenance:f.provenance,evaluationAt:f.evaluationAt,agentIds:f.agentIds,config:c,split:{cut:train.length,trainN:train.length,testN:test.length,trainLast:train.at(-1).time,testFirst:test[0].time,M},counts,summary,trace:traces.flat(),diagnostics,delivery,contrasts,iidTest:false,certified:false,warning:"Раздельные периоды и инциденты, полная историческая калибровка. Источник и независимость заявлены пользователем, не верифицированы. При неизвестных метках приводятся точные границы реализованной конечной когорты по всем допустимым меткам; известные метки могут быть селективны. Не доверительные интервалы, не гарантия будущего риска, не полевой сертификат M6. Синтетический и полусинтетический наборы не являются эксплуатационным подтверждением."};
}
export function evaluateImportedDataset(raw,config){return raw.schema===EXTERNAL_SCHEMA?evaluateExternal(raw,config):validateObservations(raw,config);}
