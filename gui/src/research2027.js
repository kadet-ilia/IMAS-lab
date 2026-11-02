/* IMAS-lab 2027: independent, seeded, synthetic research kernels.
   The formulations are explicit experimental hypotheses, not field-calibrated evidence. */
export const STUDY_DEFS = [
  { id:"uncertainty", short:"Неопределённость", title:"Модель распределённой поддержки принятия решений интеллектуальными агентами по обеспечению кибербезопасности объектов информационной инфраструктуры в условиях информационной неопределённости",
    origin:"Статья 1 2027", defaults:{agents:21,runs:500,seed:20270101,signalNoise:0.30,loss:0.12,corruption:0.12,threshold:0.22} },
  { id:"probgraph", short:"Граф угроз", title:"Графо-вероятностное моделирование сценариев реализации угроз безопасности информации в интеллектуальной мультиагентной системе поддержки принятия решений с учётом межагентных взаимодействий",
    origin:"Статья 2 2027", defaults:{agents:30,runs:2500,seed:20270201,edgeProbability:0.16,spread:0.24,steps:6,criticalFraction:0.33} },
  { id:"petri", short:"Сети Петри", title:"Формальное моделирование сценариев реализации угроз безопасности информации и верификация достижимости опасных состояний интеллектуальной мультиагентной системы на основе временных раскрашенных сетей Петри",
    origin:"Статья 2 2027", defaults:{agents:7,runs:1,seed:20270202,steps:6,detectionDelay:3,criticalCount:3,stateLimit:30000} },
  { id:"cascade", short:"Каскадные риски", title:"Метод оценки рисков нарушения функционирования интеллектуальной мультиагентной системы поддержки принятия решений на основе сценарного моделирования каскадных последствий кибератак",
    origin:"Статья 3 2027", defaults:{agents:8,runs:3000,seed:20270301,spread:0.34,lossScale:1,defenseFactor:0.45} },
  { id:"misinformation", short:"Коллективное решение", title:"Метод оценки рисков нарушения процессов коллективного принятия решений в интеллектуальной мультиагентной системе при компрометации агентов и распространении недостоверной информации",
    origin:"Статья 3 2027", defaults:{agents:7,runs:3000,seed:20270302,spread:0.40,noise:0.24,attackBias:2.5,threshold:0.16} }
];
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const avg=x=>x.length?x.reduce((a,b)=>a+b,0)/x.length:0;
const pct=(x,q)=>{if(!x.length)return 0;const z=[...x].sort((a,b)=>a-b);const h=(z.length-1)*q;const lo=Math.floor(h);return z[lo]+(z[Math.min(z.length-1,lo+1)]-z[lo])*(h-lo);};
export function rng(seed){let state=(Number(seed)>>>0)||1;const next=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return(state>>>0)/4294967296;};return {random:next,normal:()=>{const u=Math.max(next(),1e-12),v=next();return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v);}};}
const sample=(rand,n)=>Math.floor(rand.random()*n);
const quantileInfo=x=>({mean:avg(x),p05:pct(x,.05),p50:pct(x,.5),p95:pct(x,.95)});
function graph(n,p,r){const edges=[];for(let i=0;i<n;i++)for(let j=0;j<n;j++)if(i!==j&&r.random()<p)edges.push([i,j]);return edges;}
const fixedEdges8=[[0,1],[0,2],[1,3],[1,4],[2,4],[2,5],[3,6],[4,6],[4,7],[5,7],[6,7]];
const fixedEdges7=[[0,1],[0,2],[1,3],[2,3],[2,4],[3,5],[4,5],[5,6],[1,6]];
const scenarioSettings=[
 {name:"Полные наблюдения",noise:0.7,missing:0.2,delay:0},
 {name:"Неполнота данных",noise:1,missing:1.7,delay:0},
 {name:"Противоречивые данные",noise:1.8,missing:0.7,delay:0.2},
 {name:"Несвоевременные сообщения",noise:1.2,missing:0.9,delay:0.55}
];
export function runUncertainty(c){
 const r=rng(c.seed);const rows=[],samples=[];const names=["Обычное голосование","Робастное согласование","С учётом достоверности и времени"];
 for(const s of scenarioSettings){const acc=names.map(()=>({correct:0,accepted:0,delay:0,wrong:0}));for(let k=0;k<c.runs;k++){
  const truth=r.random()<.5?-1:1;const obs=[];
  for(let i=0;i<c.agents;i++){if(r.random()<clamp(c.loss*s.missing,0,.9))continue;const sigma=c.signalNoise*s.noise;const attacked=r.random()<c.corruption;const stale=r.random()<s.delay;const x=(stale?-truth:truth)+r.normal()*sigma+(attacked?-truth*1.6:0);const reliability=(attacked?.22:.93)/(sigma*sigma+.15)*(stale?.22:1);obs.push({x,w:reliability,d:stale?3:1});}
  const values=obs.map(o=>o.x).sort((a,b)=>a-b);const trim=Math.min(Math.floor(values.length*.16),Math.floor((values.length-1)/2));
  const trimmed=values.slice(trim,values.length-trim);
  const decisions=[avg(values),avg(trimmed),obs.length?obs.reduce((a,o)=>a+o.x*o.w,0)/obs.reduce((a,o)=>a+o.w,0):0];
  decisions.forEach((v,j)=>{const ready=obs.length>=Math.ceil(c.agents*.3)&&Math.abs(v)>=Number(c.threshold)*(j===1?.75:1);
   if(ready){acc[j].accepted++;if(Math.sign(v)===truth)acc[j].correct++;else acc[j].wrong++;acc[j].delay+=avg(obs.map(o=>o.d));}
  });
 }
 acc.forEach((m,j)=>{const row={scenario:s.name,method:names[j],runs:c.runs,coverage:m.accepted/c.runs,correctUnconditional:m.correct/c.runs,accuracy:m.accepted?m.correct/m.accepted:0,errorRate:m.wrong/c.runs,latency:m.accepted?m.delay/m.accepted:0};rows.push(row);samples.push(row);});}
 return {rows,summary:"Оценка качества коллективного решения при четырёх видах информационной неопределённости. Точность среди принятых решений следует анализировать совместно с долей отказов.",chartKey:"correctUnconditional",chartLabel:"P(правильное решение без отказа)",series:"method",limits:"Оценка достоверности имитируется условными весами, известными генератору; это оптимистичный контрольный вариант, а не доказательство реализуемости идеального детектора."};
}
function propagate(n,edges,initial,r,p,steps,defense=0){
 const infected=new Set(initial), history=[infected.size];let available=new Set(initial);
 for(let t=1;t<=steps;t++){const newly=new Set();for(const [a,b] of edges)if(available.has(a)&&!infected.has(b)&&r.random()<clamp(p*(1-defense),0,1))newly.add(b);
  for(const v of newly)infected.add(v);available=new Set([...available,...newly]);history.push(infected.size);}
 return {infected,history};
}
export function runProbGraph(c){
 const r=rng(c.seed);const rows=[];const modes=[["Без дополнительной защиты",0],["Фильтрация сообщений",.38],["Фильтрация и робастная координация",.68]];
 const scenarios=[["Компрометация источника",.8,1],["Подмена межагентных сообщений",1.2,1],["Компрометация координатора",1.35,2],["Согласованная атака",1.25,3]];
 for(const [scenario,mult,start] of scenarios){for(const [method,defense] of modes){const loss=[],events=[],trajectories=Array(c.steps+1).fill(0);
  for(let k=0;k<c.runs;k++){const ed=graph(c.agents,c.edgeProbability,r);const init=Array.from({length:start},()=>sample(r,c.agents));const p=propagate(c.agents,ed,init,r,c.spread*mult,c.steps,defense);const fraction=p.infected.size/c.agents;loss.push(fraction);events.push(fraction>=c.criticalFraction?1:0);p.history.forEach((v,j)=>trajectories[j]+=v/c.agents);}
  rows.push({scenario,method,runs:c.runs,expectedFraction:avg(loss),dangerProbability:avg(events),p95Fraction:pct(loss,.95),...Object.fromEntries(trajectories.map((v,j)=>["t"+j,v/c.runs]))});
 }}
 return {rows,summary:"Монте-Карло на ориентированных графах взаимодействий. Вероятность опасного состояния определяется как доля прогонов с превышением порога поражённых агентов.",chartKey:"dangerProbability",chartLabel:"P(опасного состояния)",series:"method",limits:"Вероятности распространения и степени защиты заданы синтетически; независимые попытки по рёбрам не учитывают коррелированные уязвимости и особенности реальных протоколов."};
}
export function runPetri(c){
 const n=clamp(Math.floor(c.agents),3,12),T=Math.floor(c.steps),critical=clamp(Math.floor(c.criticalCount),1,n);
 const edges=fixedEdges7.filter(([a,b])=>a<n&&b<n);
 const start={mask:1,isolated:0,t:0,trace:["t=0: скомпрометирован A1"]};let q=[start],index=0,seen=new Set(["1:0:0"]),reachable=false,witness=[],statesByTime=Array(T+1).fill(0),truncated=false;
 const add=(mask,isolated,t,trace)=>{const key=[mask,isolated,t].join(":");if(!seen.has(key)){seen.add(key);q.push({mask,isolated,t,trace});}};
 const popcount=mask=>{let n=0;while(mask){n+=mask&1;mask>>>=1;}return n;};
 while(index<q.length){const state=q[index++];statesByTime[state.t]++;if(popcount(state.mask)>=critical){reachable=true;witness=state.trace;break;}
  if(index>=c.stateLimit){truncated=true;break;}if(state.t>=T)continue;
  // Timed transitions: transmission and isolation each consume one simulated tick.
  const next=state.t+1;
  add(state.mask,state.isolated,next,[...state.trace,"t="+next+": ожидание"]);
  for(const [a,b] of edges)if(state.mask&(1<<a)&&!(state.isolated&(1<<a))&&!(state.mask&(1<<b))&&!(state.isolated&(1<<b)))
   add(state.mask|(1<<b),state.isolated,next,[...state.trace,"t="+next+": передача A"+(a+1)+" → A"+(b+1)]);
  if(next>=c.detectionDelay){for(let v=0;v<n;v++)if((state.mask&(1<<v))&&!(state.isolated&(1<<v)))
   add(state.mask,state.isolated|(1<<v),next,[...state.trace,"t="+next+": изоляция A"+(v+1)]);}
 }
 const rows=[{criterion:"Достижимо опасное состояние",value:truncated?"Не установлено":(reachable?"Да":"Нет")},{criterion:"Число исследованных маркировок",value:index},{criterion:"Число зарегистрированных маркировок",value:seen.size},{criterion:"Горизонт, тактов",value:T},{criterion:"Порог компрометации",value:critical},{criterion:"Превышен предел пространства состояний",value:truncated?"Да":"Нет"}];
 return {rows,witness,statesByTime,edges,summary:"Ограниченная по времени проверка достижимости в дискретной временной раскрашенной сети Петри: метки окрашены идентификатором агента; переходы заражения, ожидания и изоляции имеют задержку один такт.",chartKey:"",chartLabel:"",limits:"Текущий формализованный подкласс использует единичную задержку переходов и один цвет токена — идентификатор агента. При превышении предела поиска результат НЕ является доказательством недостижимости."};
}
export function runCascade(c){
 const r=rng(c.seed),rows=[],impacts=[1,1.2,1.1,1.7,2.1,1.5,2.4,3.0].map(x=>x*c.lossScale),conditions=[["Без сдерживания",0],["Защитные меры",c.defenseFactor]];
 for(let start=0;start<c.agents;start++){for(const [method,defense] of conditions){const losses=[],affected=[],critical=[];for(let k=0;k<c.runs;k++){
  const p=propagate(8,fixedEdges8,[start],r,c.spread,8,defense);const cost=[...p.infected].reduce((s,i)=>s+impacts[i],0);
  losses.push(cost);affected.push(p.infected.size);critical.push(cost>=impacts.reduce((a,b)=>a+b,0)*.45?1:0);}
  const tail=losses.filter(v=>v>=pct(losses,.95));
  rows.push({scenario:"Начальная компрометация A"+(start+1),method,runs:c.runs,directDamage:impacts[start],expectedDamage:avg(losses),excessDamage:avg(losses)-impacts[start],dangerProbability:avg(critical),p95Damage:pct(losses,.95),cvar95:avg(tail),affectedAgents:avg(affected)});
 }}
 return {rows,summary:"Оценка прямого и каскадного ущерба при поражении каждого из восьми функционально зависимых агентов (11 ориентированных связей). CVaR95 — средняя потеря в верхнем хвосте распределения.",chartKey:"expectedDamage",chartLabel:"Математическое ожидание ущерба",series:"method",limits:"Условные коэффициенты критичности и интенсивности распространения не являются оценками денежных потерь или эксплуатационных вероятностей."};
}
function tmean(x){if(!x.length)return 0;const a=[...x].sort((p,q)=>p-q),trim=Math.min(1,Math.floor((a.length-1)/2));return avg(a.slice(trim,a.length-trim));}
export function runMisinformation(c){
 const r=rng(c.seed),rows=[],methods=["Обычное среднее","Взвешивание по доверию","Усечённое среднее"];
 for(let bad=0;bad<=Math.min(3,c.agents-1);bad++){const stats=methods.map(()=>({wrong:0,correct:0,abstain:0,deviation:0,exposed:0}));
  for(let k=0;k<c.runs;k++){
   const truth=r.random()<.5?1:-1;const seeds=new Set();while(seeds.size<bad)seeds.add(sample(r,c.agents));const exposed=new Set(seeds);
   for(let t=0;t<3;t++)for(const [a,b] of fixedEdges7)if(exposed.has(a)&&r.random()<c.spread)exposed.add(b);
   const points=[];for(let i=0;i<c.agents;i++){const compromised=seeds.has(i),misled=exposed.has(i);
    const x=truth+r.normal()*c.noise+(compromised?-truth*c.attackBias:misled?-truth*c.attackBias*.7:0);
    const trust=compromised?.08:misled?.55:.94;points.push({x,trust});
   }
   const votes=[avg(points.map(x=>x.x)),points.reduce((a,x)=>a+x.x*x.trust,0)/points.reduce((a,x)=>a+x.trust,0),tmean(points.map(x=>x.x))];
   votes.forEach((v,j)=>{const m=stats[j];if(Math.abs(v)<c.threshold)m.abstain++;else if(Math.sign(v)===truth)m.correct++;else m.wrong++;
     m.deviation+=Math.abs(v-truth);m.exposed+=exposed.size/c.agents;});
  }
  stats.forEach((s,j)=>rows.push({scenario:"Скомпрометировано "+bad+" из "+c.agents,compromised:bad,method:methods[j],runs:c.runs,wrongProbability:s.wrong/c.runs,correctProbability:s.correct/c.runs,abstentionProbability:s.abstain/c.runs,meanDeviation:s.deviation/c.runs,meanExposedFraction:s.exposed/c.runs,risk:s.wrong/c.runs*1}));
 }
 return {rows,summary:"Сравнительная оценка риска неверного коллективного решения при компрометации от нуля до трёх агентов и распространении ложной информации по девяти ориентированным зависимостям.",chartKey:"wrongProbability",chartLabel:"P(ошибочного решения)",series:"method",limits:"Истинность и качество сообщений известны генератору; оценка доверия задана условно. Результат нельзя переносить на реальные ИМАС без независимой калибровки."};
}
export function validateStudy(id,raw){
 const def=STUDY_DEFS.find(s=>s.id===id);if(!def)throw new Error("Неизвестный эксперимент");
 const c={...def.defaults,...raw};
 for(const [k,v] of Object.entries(c)){if(!Number.isFinite(Number(v)))throw new Error("Параметр "+k+" должен быть числом");c[k]=Number(v);}
 if(c.agents<3||c.agents>100||!Number.isInteger(c.agents))throw new Error("Число агентов должно быть целым от 3 до 100");
 if(c.runs<1||c.runs>10000||!Number.isInteger(c.runs))throw new Error("Число прогонов должно быть целым от 1 до 10000");
 if(!Number.isInteger(c.seed))throw new Error("Начальное зерно должно быть целым");
 for(const k of ["loss","corruption","edgeProbability","spread","criticalFraction","defenseFactor"]){if(k in c&&(c[k]<0||c[k]>1))throw new Error(k+": требуется диапазон [0;1]");}
 for(const k of ["noise","signalNoise","attackBias","threshold","lossScale"]){if(k in c&&c[k]<0)throw new Error(k+": значение не может быть отрицательным");}
 if("steps" in c&&(!Number.isInteger(c.steps)||c.steps<1||c.steps>20))throw new Error("Горизонт: от 1 до 20 тактов");
 if("criticalCount" in c&&(c.criticalCount<1||c.criticalCount>c.agents))throw new Error("Некорректный порог");
 if("detectionDelay" in c&&c.detectionDelay<0)throw new Error("Некорректная задержка");
 if("stateLimit" in c&&(c.stateLimit<100||c.stateLimit>200000))throw new Error("Предел маркировок: 100–200000");
 if(id==="cascade"&&c.agents!==8)throw new Error("Для экспериментального графа каскадов предусмотрено ровно 8 агентов");
 if(id==="misinformation"&&c.agents!==7)throw new Error("Для модели информационных зависимостей предусмотрено ровно 7 агентов");
 return c;
}
export function executeStudy(id,params={}){const c=validateStudy(id,params);const start=Date.now();const handlers={uncertainty:runUncertainty,probgraph:runProbGraph,petri:runPetri,cascade:runCascade,misinformation:runMisinformation};const result=handlers[id](c);return {id,config:c,model:"synthetic-experimental",...result,replay:buildResearchReplay(id,c,result),elapsedMs:Date.now()-start};}
export function toCsv(rows){if(!rows?.length)return "";const columns=[...new Set(rows.flatMap(row=>Object.keys(row)))];const escape=x=>{const t=x==null?"":String(x);return /[";\r\n]/.test(t)?'"'+t.replaceAll('"','""')+'"':t;};return "\ufeff"+columns.join(";")+"\n"+rows.map(row=>columns.map(k=>escape(row[k])).join(";")).join("\n");}
export function statisticalIndicators(values){return quantileInfo(values);}


/* A deterministic, explicitly labelled path for graph playback.
   Statistical tables retain their independent Monte-Carlo interpretation. */
export function buildResearchReplay(id,c,result={}){
 const r=rng(c.seed), n=c.agents, vertices=Array.from({length:n},(_,i)=>({id:i,label:"А"+(i+1)}));
 const frames=[], snap=(step,status,activeEdges=[],info="",value=null)=>frames.push({
   step,status:[...status],activeEdges:activeEdges.map(e=>[...e]),info,value
 });
 const choose=(x)=>x===undefined?0:x;
 if(id==="uncertainty"){
   const edges=Array.from({length:n-1},(_,i)=>[i,n-1]); const truth=1;
   for(let t=0;t<9;t++){
     const status=Array(n).fill("normal"), observed=[],active=[];
     for(let i=0;i<n-1;i++){
       if(r.random()<c.loss){status[i]="missing";continue;}
       const corrupt=r.random()<c.corruption,stale=r.random()<(t%3===2?.35:.03);
       const x=(stale?-truth:truth)+r.normal()*c.signalNoise+(corrupt?-truth*1.6:0);
       if(corrupt||stale)status[i]="misled";else status[i]="normal";
       observed.push(x);active.push([i,n-1]);
     }
     const estimate=avg(observed),decision=observed.length<Math.ceil(n*.3)||Math.abs(estimate)<c.threshold?"оператор":estimate>0?"угроза":"норма";
     status[n-1]=decision==="оператор"?"isolated":"coordinator";
     snap(t,status,active,"Принято сообщений: "+observed.length+"/"+(n-1)+"; решение: "+decision,estimate);
   }
   return {title:"Маршрут сообщений и автоматическая выработка решения",vertices,edges,frames,notes:"Иллюстративная отдельная трасса для фиксированного зерна; статистические показатели вычисляются по независимым прогонам.",valueLabel:"Оценка состояния"};
 }
 if(id==="probgraph"){
   const edges=graph(n,c.edgeProbability,r);const seeds=[sample(r,n)];const infected=new Set(seeds),available=new Set(seeds);
   const status=()=>Array.from({length:n},(_,i)=>infected.has(i)?"compromised":"normal");
   snap(0,status(),[],"Исходная компрометация: А"+(seeds[0]+1),infected.size/n);
   for(let t=1;t<=c.steps;t++){
     const active=[],newly=new Set();
     for(const [a,b] of edges)if(available.has(a)&&!infected.has(b)&&r.random()<clamp(c.spread*.8,0,1)){newly.add(b);active.push([a,b]);}
     for(const v of newly){infected.add(v);available.add(v);}
     snap(t,status(),active,"Новые поражённые агенты: "+newly.size+"; всего: "+infected.size+"/"+n,infected.size/n);
   }
   return {title:"Графо-вероятностное распространение нарушения",vertices,edges,frames,notes:"Первая реализация сценария «Компрометация источника» без дополнительной защиты; рёбра случайного графа фиксированы зерном.",valueLabel:"Доля поражённых"};
 }
 if(id==="petri"){
   const edges=result.edges||fixedEdges7.filter(([a,b])=>a<n&&b<n), compromised=new Set([0]),isolated=new Set(),witness=result.witness||[];
   const status=()=>Array.from({length:n},(_,i)=>isolated.has(i)?"isolated":compromised.has(i)?"compromised":"normal");
   snap(0,status(),[],"Начальная маркировка: токен компрометации агента А1",1);
   for(let t=1;t<=c.steps;t++){
     const line=witness[t]||"t="+t+": ожидание", transmitted=line.match(/передача A(\d+) → A(\d+)/),blocked=line.match(/изоляция A(\d+)/),active=[];
     if(transmitted){compromised.add(Number(transmitted[2])-1);active.push([Number(transmitted[1])-1,Number(transmitted[2])-1]);}
     if(blocked)isolated.add(Number(blocked[1])-1);
     snap(t,status(),active,line,compromised.size);
     if(witness.length&&t>=witness.length-1)break;
   }
   return {title:"Последовательность маркировок и переходов сети Петри",vertices,edges,frames,notes:result.witness?.length?"Воспроизводится найденная трасса-контрпример, содержащая достижение опасной маркировки.":"Контрпример не найден; показана траектория ожидания. Отсутствие контрпримера не доказывает безопасность при неполном поиске.",valueLabel:"Число компрометированных"};
 }
 if(id==="cascade"){
   const edges=fixedEdges8,infected=new Set([0]),available=new Set([0]),impacts=[1,1.2,1.1,1.7,2.1,1.5,2.4,3].map(x=>x*c.lossScale);
   const cost=()=>[...infected].reduce((a,i)=>a+impacts[i],0);
   const status=()=>Array.from({length:n},(_,i)=>infected.has(i)?"affected":"normal");
   snap(0,status(),[],"Исходная компрометация: А1; прямой ущерб",cost());
   for(let t=1;t<=8;t++){
     const active=[],newly=new Set();
     for(const [a,b] of edges)if(available.has(a)&&!infected.has(b)&&r.random()<c.spread){newly.add(b);active.push([a,b]);}
     for(const i of newly){infected.add(i);available.add(i);}
     snap(t,status(),active,"Каскадные переходы: "+newly.size+"; поражено "+infected.size+"/8",cost());
   }
   return {title:"Каскад функциональных нарушений",vertices,edges,frames,notes:"Первая реализация начальной компрометации А1 без сдерживания; условные коэффициенты ущерба совпадают с вычислительной моделью.",valueLabel:"Совокупный ущерб"};
 }
 if(id==="misinformation"){
   const edges=fixedEdges7,compromised=new Set([0,1]),exposed=new Set(compromised);
   const states=()=>Array.from({length:n},(_,i)=>compromised.has(i)?"compromised":exposed.has(i)?"misled":"normal");
   const evaluate=()=>{const points=Array.from({length:n},(_,i)=>1+r.normal()*c.noise+(compromised.has(i)?-c.attackBias:exposed.has(i)?-c.attackBias*.7:0));return avg(points);};
   snap(0,states(),[],"Начально скомпрометированы А1 и А2; эталонное состояние +1",evaluate());
   for(let t=1;t<=3;t++){
     const newly=new Set(),active=[];
     for(const [a,b] of edges)if(exposed.has(a)&&!exposed.has(b)&&r.random()<c.spread){newly.add(b);active.push([a,b]);}
     for(const i of newly)exposed.add(i);
     snap(t,states(),active,"Недостоверная информация достигла "+exposed.size+"/7 агентов; новых: "+newly.size,evaluate());
   }
   return {title:"Передача недостоверной информации и смещение коллективной оценки",vertices,edges,frames,notes:"Отдельная иллюстративная трасса при двух скомпрометированных агентах (из исследуемого диапазона 0–3).",valueLabel:"Средняя оценка"};
 }
 throw new Error("Неизвестная модель воспроизведения");
}
