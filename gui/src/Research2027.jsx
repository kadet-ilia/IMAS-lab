import React, {forwardRef,useEffect,useImperativeHandle,useMemo,useRef,useState} from "react";
import {Bar,BarChart,CartesianGrid,Legend,ResponsiveContainer,Tooltip,XAxis,YAxis} from "recharts";
import {STUDY_DEFS,toCsv,validateStudy,buildResearchReplay} from "./research2027.js";
import {TopologyPlayback,StudyVisualization} from "./ExperimentVisuals.jsx";
import {ResearchSettings} from "./ResearchSettings.jsx";
import {UnifiedHelp} from "./UnifiedHelp.jsx";
import "./research2027.css";

const FIELD={
 agents:["N — число агентов","Число программных агентов, представленных в экспериментальной модели.",1],
 runs:["R — число повторений","Независимые прогоны Монте-Карло с воспроизводимой последовательностью случайных чисел.",1],
 seed:["Зерно генератора","Фиксирует псевдослучайную последовательность для воспроизведения результата.",1],
 signalNoise:["σ — шум наблюдений","Среднеквадратическое отклонение аддитивной ошибки локального наблюдения.",.01],
 loss:["pₘ — потеря сообщений","Вероятность отсутствия наблюдения у одного агента.",.01],
 corruption:["pₐ — недостоверные данные","Вероятность искажения сообщения в имитационном эксперименте.",.01],
 threshold:["δ — порог решения","При недостаточной уверенности производится отказ от автоматического решения.",.01],
 edgeProbability:["pₑ — вероятность ребра","Вероятность ориентированной связи от агента к агенту.",.01],
 spread:["pₛ — распространение","Условная вероятность передачи воздействия по доступному ориентированному ребру за такт.",.01],
 steps:["T — горизонт моделирования","Максимальное число дискретных временных тактов.",1],
 criticalFraction:["q — опасная доля","Порог доли скомпрометированных агентов, задающий опасное состояние.",.01],
 detectionDelay:["τ — задержка обнаружения","Первый такт, начиная с которого разрешается переход изоляции.",1],
 criticalCount:["K — опасное число","Достижимость опасного состояния проверяется по числу скомпрометированных агентов.",1],
 stateLimit:["M — предел маркировок","Ограничение поиска состояний; при его достижении доказательство неполно.",100],
 lossScale:["k — масштаб ущерба","Множитель условных потерь вследствие нарушения функций.",.1],
 defenseFactor:["η — эффект защиты","Снижение вероятности распространения при активированных мерах.",.01],
 noise:["σ — шум оценок","Среднеквадратическое отклонение локальных оценок.",.01],
 attackBias:["b — смещение нарушителя","Модуль преднамеренного искажения оценки, направленного против правильного решения.",.1]
};
const METHOD_COLORS=["#2164ba","#0a947b","#db6b38","#7955a8"];
const THEORY={
 uncertainty:{
 goal:"Исследовать, как информационная неполнота, неоднозначность, противоречивость и несвоевременность сообщений изменяют вероятность корректного коллективного решения и долю отказов от автоматического реагирования.",
 model:"Каждый агент получает неполное наблюдение бинарного состояния киберобстановки. Часть сообщений не поступает; часть содержит шум, устаревшие сведения либо искажения. Сравниваются обычное голосование, усечённая оценка и взвешивание с учётом достоверности и времени доставки. Для каждого решения действует порог достаточности информации.",
 formulas:["yᵢ(t) = θ(t−dᵢ) + εᵢ(t) + aᵢ(t),  εᵢ ~ N(0,σ²)","x̄(t) = (1 / |I|) Σᵢ∈I yᵢ(t)","x̃(t) = (1 / |I'|) Σᵢ∈I' yᵢ(t),  I' — множество после симметричного усечения","x̂(t) = Σᵢ wᵢ(t)yᵢ(t) / Σᵢ wᵢ(t)","d(t) = sign(x̂(t)), если |x̂(t)| ≥ δ и наблюдений достаточно; иначе — оператор"],
 procedure:["Формирование эталонного бинарного состояния и независимых локальных наблюдений.","Наложение четырёх вариантов информационной неопределённости и пропусков сообщений.","Формирование трёх коллективных оценок и проверка допустимости выдачи решения.","Повторение опытов с одним зерном генератора и вычисление доли правильных, неправильных и отклонённых решений."],
 glossary:["Локальное наблюдение — информация, доступная отдельному агенту.","Отказ от автоматического решения — выдача состояния «недостаточно данных» вместо необоснованного выбора.","Покрытие — доля тактов, на которых система сформировала автоматическое решение."]
 },
 probgraph:{
 goal:"Оценить вероятность достижения опасного состояния при распространении последствий реализации киберугроз через ориентированные межагентные взаимодействия.",
 model:"Информационная инфраструктура представлена ориентированным случайным графом. Вершины обозначают агентов, рёбра — каналы передачи потенциально недостоверной информации. На каждом такте осуществляется вероятностный переход нарушения по рёбрам от уже затронутых агентов к незатронутым. Выделены четыре условных сценария и три режима защиты.",
 formulas:["G = (V,E),  |V| = N,  P[(i,j)∈E] = pₑ","P(Xⱼ(t+1)=1 | Xᵢ(t)=1, (i,j)∈E) = pₛ(1−η)","H(t) = 1{ |{i:Xᵢ(t)=1}| / N ≥ q }","P̂опасн = (1/R) Σᵣ Hᵣ(T)"],
 procedure:["Сгенерировать ориентированный граф межагентных зависимостей для каждого прогона.","Задать первоначально скомпрометированные вершины и интенсивность передачи воздействия.","На каждом такте воспроизвести распространение и ограничения, обусловленные выбранным режимом защиты.","Сравнить три режима по вероятности критического состояния, масштабу поражения и верхним квантилям."],
 glossary:["Ориентированное ребро — направленная информационная зависимость между агентами.","Вероятность реализации угрозы — частота определённого события в заданной синтетической модели.","Опасное состояние — превышение установленного порога числа поражённых агентов."]
 },
 petri:{
 goal:"Выполнить ограниченную формальную проверку достижимости опасного состояния при развитии угрозы с учётом задержек переходов и возможной изоляции.",
 model:"Исследуется конечная временная раскрашенная сеть Петри в форме её эквивалентного графа маркировок. Цвет соответствует идентификатору агента. Маркировка фиксирует набор затронутых и изолированных агентов, а также дискретное время. Допустимы переходы ожидания, передачи нарушения вдоль заданного ориентированного ребра и изоляции после наступления заданного такта.",
 formulas:["M = (C, I, t), C⊆V — скомпрометированные, I⊆V — изолированные","M —[передача i→j, +1]→ M' : i∈C\\I, j∉C∪I, (i,j)∈E","M —[изоляция i, +1]→ M' : i∈C\\I, t+1≥τ","Unsafe(M) ⇔ |C| ≥ K","EF≤T Unsafe — существует допустимая траектория длиной не более T до опасной маркировки"],
 procedure:["Построить исходную маркировку с одним скомпрометированным агентом.","Перебрать доступные переходы поиском в ширину с фиксацией уже посещённых маркировок.","При обнаружении маркировки с K затронутыми агентами сохранить трассу-контрпример.","При отсутствии контрпримера проверить полноту обхода и отсутствие превышения заданного предела состояний."],
 glossary:["Маркировка — полное состояние сети Петри: размещение токенов по позициям.","Цвет токена — типизированный атрибут; здесь — идентификатор агента.","Достижимость — наличие последовательности разрешённых переходов от начальной маркировки.","Контрпример — последовательность переходов, нарушающая условие безопасности.","EF — оператор существования пути с достижением заданного состояния."]
 },
 cascade:{
 goal:"Оценить ожидаемый ущерб и верхнехвостовой риск распространения последствий компрометации через функциональные зависимости агентов.",
 model:"Рассматривается фиксированный ориентированный граф из восьми агентов и одиннадцати зависимостей. Для каждой из восьми возможных начальных компрометаций воспроизводятся каскадные переходы. Условная критичность агента задаёт потери при отказе его функции. Сопоставляются режимы без защитных мер и с вероятностным подавлением распространения.",
 formulas:["L(ω) = Σᵢ cᵢ · 1{i поражён в ω}","E[L] ≈ (1/R) Σᵣ Lᵣ","ΔL = E[L] − cₛ, cₛ — прямой ущерб от начального агента s","VaR₀.₉₅ = Q₀.₉₅(L)","CVaR₀.₉₅ = E[L | L≥VaR₀.₉₅]"],
 procedure:["Задать ориентированный граф зависимостей и условные коэффициенты критичности.","Последовательно инициировать компрометацию каждого из восьми агентов.","Для каждого источника провести Монте-Карло с распространением по зависимостям.","Рассчитать прямой, каскадный, средний и верхнехвостовой ущерб; сравнить режимы защиты."],
 glossary:["Каскад — распространение функционального нарушения за пределы исходного компонента.","Математическое ожидание ущерба — средняя модельная потеря.","VaR — квантиль распределения потерь.","CVaR — средняя потеря в наиболее неблагоприятном хвосте распределения."]
 },
 misinformation:{
 goal:"Установить зависимость риска неправильного коллективного решения от числа скомпрометированных участников и передачи недостоверной информации через граф межагентных зависимостей.",
 model:"Семь агентов образуют ориентированный граф с девятью зависимостями. Компрометированные агенты формируют смещённые оценки; их информация с заданной вероятностью воздействует на связанных участников. Сопоставляются обычное среднее, доверительно-взвешенная оценка и симметричное усечение.",
 formulas:["zᵢ = θ + εᵢ − θ·bᵢ,  εᵢ ~ N(0,σ²)","x̄ = N⁻¹ Σᵢ zᵢ","x̂w = Σᵢ wᵢ zᵢ / Σᵢ wᵢ","x̂trim = TrimMean(z₁,…,zN;1)","Risk = P(неверное решение) · Cневерн"],
 procedure:["Задать число первоначально скомпрометированных агентов от 0 до 3.","Смоделировать три шага распространения недостоверной информации по девяти связям.","Вычислить коллективные оценки тремя методами и применить критерий отказа.","По независимым прогонам определить вероятность неверного решения, отказа и среднее смещение."],
 glossary:["Компрометация агента — потеря гарантии корректности формируемых им сообщений.","Недостоверная информация — сообщение, искажающее представление о моделируемом состоянии.","Ошибка коллективного решения — выбор противоположного эталонному состояния.","Усечённое среднее — агрегатор с исключением крайних оценок."]
 }
};
const glossary=[
 ["ИМАС","Интеллектуальная мультиагентная система поддержки принятия решений."],
 ["Агент","Автономный программный компонент с локальным состоянием, знаниями и функцией взаимодействия."],
 ["Такт","Один дискретный шаг модельного времени."],
 ["Монте-Карло","Оценка статистических характеристик посредством независимых случайных реализаций."],
 ["Зерно генератора","Целое значение, обеспечивающее воспроизведение последовательности псевдослучайных чисел."],
 ["Синтетический параметр","Численное предположение, не идентифицированное по измерениям реального объекта."],
 ["Безопасный режим","Режим отказа от автоматического применения потенциально опасного управляющего действия."],
 ["Доверие","Численная оценка предшествующей надёжности источника, не являющаяся доказательством истинности сообщения."]
];
const fmt=(x)=>typeof x==="number"? (Number.isInteger(x)?String(x):x.toLocaleString("ru-RU",{maximumFractionDigits:4})):String(x??"—");
const pctFields=new Set(["correctUnconditional","accuracy","coverage","errorRate","dangerProbability","expectedFraction","p95Fraction","wrongProbability","correctProbability","abstentionProbability","meanExposedFraction"]);
const metricNames={correctUnconditional:"Правильные решения / все опыты",accuracy:"Точность среди выданных решений",coverage:"Доля выданных решений",errorRate:"Доля неправильных решений",dangerProbability:"Вероятность опасного состояния",expectedFraction:"Средняя доля поражённых",p95Fraction:"95-й процентиль поражения",expectedDamage:"Средний ущерб",excessDamage:"Каскадный ущерб",cvar95:"CVaR95",wrongProbability:"Вероятность неверного решения",meanDeviation:"Среднее смещение",abstentionProbability:"Доля отказов",risk:"Условный риск"};
function download(name,text,type){const blob=new Blob([text],{type}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);}
function ScientificGraph({result,metric}) {
 const rows=result.rows||[];const methods=[...new Set(rows.map(x=>x.method).filter(Boolean))],scenarios=[...new Set(rows.map(x=>x.scenario))];
 const chart=scenarios.map(s=>{const item={scenario:s};rows.filter(r=>r.scenario===s).forEach(x=>item[x.method]=x[metric]);return item;});
 if(!metric||!methods.length)return null;
 const isProbability=pctFields.has(metric);
 return <div className="r27-chart" role="img" aria-label={"Сравнение по показателю "+(metricNames[metric]||metric)}>
  <ResponsiveContainer width="100%" height={Math.max(310,scenarios.length*66+120)}>
   <BarChart layout="vertical" data={chart} margin={{top:10,right:30,bottom:18,left:12}} barGap={2}>
    <CartesianGrid stroke="#e3eaf2" strokeDasharray="3 3"/><XAxis type="number" domain={[0,"auto"]} tickFormatter={v=>isProbability?(v*100).toFixed(0)+"%":fmt(v)}/>
    <YAxis dataKey="scenario" type="category" width={208} tick={{fontSize:11}}/>
    <Tooltip formatter={(v,n)=>[isProbability?(v*100).toFixed(2)+"%":fmt(v),n]}/><Legend wrapperStyle={{fontSize:12}}/>
    {methods.map((name,i)=><Bar key={name} dataKey={name} fill={METHOD_COLORS[i%METHOD_COLORS.length]} maxBarSize={15}/>)}
   </BarChart>
  </ResponsiveContainer>
 </div>;
}
function PetriGraph({result}) {
 const edges=result.edges||[], n=result.config.agents;const coords=Array.from({length:n},(_,i)=>({x:215+150*Math.cos(i*2*Math.PI/n-Math.PI/2),y:160+120*Math.sin(i*2*Math.PI/n-Math.PI/2)}));
 return <svg className="r27-net" viewBox="0 0 430 320" aria-label="Ориентированный граф переходов между агентами"><defs><marker id="r27-arrow" markerWidth="9" markerHeight="9" refX="9" refY="4.5" orient="auto"><path d="M0 0 L9 4.5 L0 9Z" fill="#8ba4bf"/></marker></defs>
  {edges.map(([a,b],i)=><line key={i} x1={coords[a].x} y1={coords[a].y} x2={coords[b].x} y2={coords[b].y} stroke="#8ba4bf" strokeWidth="1.8" markerEnd="url(#r27-arrow)" />)}
  {coords.map(({x,y},i)=><g key={i}><circle cx={x} cy={y} r="22" fill={i===0?"#f2c1b6":"#d8e8fa"} stroke={i===0?"#c34d39":"#346caa"} strokeWidth="2"/><text x={x} y={y+5} textAnchor="middle" fontSize="13" fontWeight="600" fill="#1d3c5b">A{i+1}</text></g>)}
 </svg>;
}
function ResultTable({rows}){if(!rows?.length)return null;const cols=Object.keys(rows[0]);return <div className="r27-table-scroll"><table className="r27-table"><thead><tr>{cols.map(col=><th key={col}>{metricNames[col]||col}</th>)}</tr></thead><tbody>{rows.map((row,i)=><tr key={i}>{cols.map(col=><td key={col}>{pctFields.has(col)&&typeof row[col]==="number"?(row[col]*100).toFixed(2)+"%":fmt(row[col])}</td>)}</tr>)}</tbody></table></div>;}
const KEY_STATS={
 uncertainty:[["correctUnconditional","Правильных решений"],["coverage","Покрытие"],["errorRate","Ошибочных решений"]],
 probgraph:[["dangerProbability","Опасных состояний"],["expectedFraction","Доля поражённых"],["p95Fraction","95-й процентиль"]],
 cascade:[["expectedDamage","Ожидаемый ущерб"],["dangerProbability","Опасных состояний"],["cvar95","Верхнехвостовой ущерб"]],
 misinformation:[["wrongProbability","Ошибочных решений"],["abstentionProbability","Отказов"],["meanExposedFraction","Информационный охват"]]
};
function ResearchKpis({studyId,result}){
 if(!result)return null;
 const rows=result.rows||[],keys=KEY_STATS[studyId]||[];
 const items=studyId==="petri"
 ? [["Достижимость",rows[0]?.value||"—"],["Исследовано маркировок",rows[1]?.value||"—"],["Горизонт, тактов",result.config.steps],["Порог поражения",result.config.criticalCount]]
 : [["Число агентов",result.config.agents],["Прогонов/сценарий",result.config.runs],...keys.slice(0,2).map(([key,label])=>{
    const values=rows.map(r=>r[key]).filter(Number.isFinite);
    const average=values.length?values.reduce((a,b)=>a+b,0)/values.length:NaN;
    return [label,Number.isFinite(average)?(pctFields.has(key)?(100*average).toFixed(1)+"%":average.toFixed(3)):"—"];
   })];
 return <div className="kpi-grid r27-research-kpis">{items.map(([label,value],i)=><div className="kpi" key={label}>
   <div className="kpi-label">{label}</div><div className={"kpi-value "+(i===3?"teal":"")}>{value}</div>
   <div className="kpi-note">{i>1&&studyId!=="petri"?"Среднее по строкам сравнения":"Воспроизводимый расчёт"}</div>
  </div>)}</div>;
}
export const ResearchStudy=forwardRef(function ResearchStudy({studyId,navigation,onRuntimeChange},actionsRef){
 const def=STUDY_DEFS.find(x=>x.id===studyId);
 const [config,setConfig]=useState({...def.defaults}),[result,setResult]=useState(null),[running,setRunning]=useState(false),[error,setError]=useState(""),[metric,setMetric]=useState(""),[lastCompletedAt,setLastCompletedAt]=useState(null),worker=useRef(null);
 useEffect(()=>{setConfig({...def.defaults});setResult(null);setError("");setMetric("");},[def.id]);
 useEffect(()=>()=>{worker.current?.terminate();worker.current=null;},[]);
 const previewReplay=useMemo(()=>{try{return buildResearchReplay(studyId,validateStudy(studyId,config),result||{});}catch{return null;}},[studyId,config,result]);
 const update=(k,v)=>{worker.current?.terminate();worker.current=null;setRunning(false);setResult(null);setMetric("");setConfig(old=>({...old,[k]:v}));};
 const start=()=>{try{const validated=validateStudy(studyId,config);worker.current?.terminate();setError("");setRunning(true);
  const w=new Worker(new URL("./research2027.worker.js",import.meta.url),{type:"module"});worker.current=w;
  w.onmessage=({data})=>{setRunning(false);if(data.ok){setResult(data.result);setMetric(data.result.chartKey||"");setLastCompletedAt(new Date());}else setError(data.error||"Ошибка моделирования");w.terminate();if(worker.current===w)worker.current=null;};
  w.onerror=(event)=>{setRunning(false);setError(event.message||"Ошибка вычислительного процесса");w.terminate();if(worker.current===w)worker.current=null;};
  w.postMessage({id:studyId,config:validated});
 }catch(e){setError(e.message);}};
 const stop=()=>{worker.current?.terminate();worker.current=null;setRunning(false);};
 const resetStudy=()=>{stop();setConfig({...def.defaults});setResult(null);setError("");setMetric("");setLastCompletedAt(null);};
 const newStudySeed=()=>update("seed",Math.floor((Date.now()+Math.random()*100000)%2147483647));
 useImperativeHandle(actionsRef,()=>({start,stop,reset:resetStudy,newSeed:newStudySeed}));
 useEffect(()=>{onRuntimeChange?.({studyId,running,seed:config.seed,lastCompletedAt,hasResult:Boolean(result)});},[studyId,running,config.seed,lastCompletedAt,Boolean(result),onRuntimeChange]);
 const opts=result?.rows?.length?Object.keys(result.rows[0]).filter(x=>x in metricNames):[];
 const theory=THEORY[studyId];
 const author=studyId==="petri"||studyId==="misinformation"?"Авторы · ктн Ушаков И.А. · ктн Харжевская А.В. · Егоров Е.В.":"Авторы · ктн Ушаков И.А. · Трофимова Н.А.";
 return <>
  <ResearchSettings studyId={studyId} config={config} onChange={update} onStart={start} onStop={stop} onReset={resetStudy} running={running}/>
  <main className="content r27-experiment-content" data-study={studyId}>
   {navigation}
   <div className="r27-kicker">{author}</div>
   <h2 className="r27-study-title">{def.title}</h2>
   <p className="r27-study-purpose">{theory.goal}</p>
   {running?<div className="progress-strip r27-study-progress" role="status"><div className="progress-head"><strong>Выполняются независимые вычислительные прогоны…</strong><span>Модель: {def.short}</span></div><div className="progress-track"><i className="r27-progress-indeterminate"/></div></div>:null}
   {error?<div className="error-banner" role="alert">{error}</div>:null}
   <div className="trust-overview-grid r27-study-overview">
     <TopologyPlayback replay={result?.replay||previewReplay} compact/>
     <section className="panel r27-summary-panel">
       <header className="panel-header"><div><h2>Сводная таблица результатов</h2><p>Показатели расчётов по сценариям и методам</p></div></header>
       <div className="panel-body">
         {result?<ResultTable rows={result.rows}/>:<div className="r27-summary-empty">Таблица формируется после запуска вычислительного эксперимента.</div>}
       </div>
     </section>
   </div>
   <ResearchKpis studyId={studyId} result={result}/>
   {result?<>
     <section className="panel r27-study-summary">
       <header className="panel-header"><div><h2>Основные результаты исследования</h2><p>Сводные оценки и исходные параметры расчёта</p></div></header>
       <div className="panel-body">
         <p>{result.summary}</p>
         <div className="r27-meta"><span>Зерно: {result.config.seed}</span><span>Прогонов: {result.config.runs}</span><span>Расчёт: {fmt(result.elapsedMs)} мс</span><span>Модель: синтетическая</span></div>
       </div>
     </section>
     {studyId==="petri"?
       <section className="panel r27-petri-report">
         <header className="panel-header"><div><h2>Результат верификации</h2><p>Достижимость опасной маркировки</p></div></header>
         <div className="panel-body">
           <p>{result.witness?.length?"Найден контрпример достижения опасной маркировки.":"Контрпример не найден на заданном горизонте и при указанном ограничении перебора."}</p>
           <ol>{(result.witness||[]).map((state,i)=><li key={i}>{state}</li>)}</ol>
           <p>Количество состояний по тактам: {result.statesByTime.join(" · ")}</p>
         </div>
       </section>:
       <section className="panel r27-comparison-panel">
         <header className="panel-header"><div><h2>Сравнение сценариев и методов</h2><p>Групповые показатели вычислительного эксперимента</p></div>
           <label className="r27-metric">Показатель <select value={metric} onChange={e=>setMetric(e.target.value)}>{opts.map(x=><option value={x} key={x}>{metricNames[x]}</option>)}</select></label>
         </header>
         <div className="panel-body"><ScientificGraph result={result} metric={metric}/></div>
       </section>}
     <StudyVisualization result={result} metric={metric}/>
     <section className="panel r27-study-limits">
       <header className="panel-header"><div><h2>Интерпретация и экспорт</h2><p>Границы применимости и результаты воспроизводимых расчётов</p></div>
         <div className="r27-result-tools"><button type="button" onClick={()=>download("imas_"+studyId+"_"+result.config.seed+".csv",toCsv(result.rows),"text/csv;charset=utf-8")}>Скачать CSV</button><button type="button" onClick={()=>download("imas_"+studyId+"_"+result.config.seed+".json",JSON.stringify(result,null,2),"application/json;charset=utf-8")}>Скачать JSON</button></div>
       </header>
       <div className="panel-body"><p className="r27-note"><strong>Граница применимости.</strong> {result.limits}</p></div>
     </section>
   </>:<div className="empty r27-study-empty">Задайте параметры в боковом меню и запустите эксперимент. Математическая модель и ограничения изложены в единой справке.</div>}
  </main>
 </>;
});
export function ResearchHelp({baselineArticle,baselineSections}){
 return <UnifiedHelp baselineArticle={baselineArticle} baselineSections={baselineSections} researchTheory={THEORY}/>;
}
