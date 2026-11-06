import React, {forwardRef,useEffect,useImperativeHandle,useMemo,useRef,useState} from "react";
import {Bar,BarChart,CartesianGrid,Legend,ResponsiveContainer,Tooltip,XAxis,YAxis} from "recharts";
import {STUDY_DEFS,toCsv,validateStudy,buildResearchReplay} from "./research2027.js";
import {runResearchBrowser,stopResearchBrowser} from "./researchBrowserClient.js";
import {TopologyPlayback,StudyVisualization,ScenarioComparisonMatrix} from "./ExperimentVisuals.jsx";
import {ResearchSettings} from "./ResearchSettings.jsx";
import {ExperimentLayout,ExperimentPanel,ExperimentKpi,ExperimentProgress} from "./ExperimentLayout.jsx";
import {UnifiedHelp} from "./UnifiedHelp.jsx";
import {FRACTION_METRICS,formatStudyValue} from "./metricFormatting.js";
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
 attackBias:["b — смещение нарушителя","Модуль преднамеренного искажения оценки, направленного против правильного решения.",.1],
 costWrong:["Cош — цена ошибочного решения","Условная стоимость неправильного автоматического выбора.",.1],
 costRefuse:["Cотк — цена отказа","Условная стоимость отказа и эскалации оператору.",.1]
};
const METHOD_COLORS=["#2164ba","#0a947b","#db6b38","#7955a8"];
const THEORY={
 uncertainty:{
 goal:"Исследовать, как информационная неполнота, неоднозначность, противоречивость и несвоевременность сообщений изменяют вероятность корректного коллективного решения и долю отказов от автоматического реагирования.",
 model:"Каждый агент получает неполное наблюдение бинарного состояния киберобстановки. Часть сообщений не поступает; часть содержит шум, устаревшие сведения либо искажения. Сравниваются знак арифметического среднего, усечённая оценка и взвешивание по наблюдаемым признакам. Идеализированный оракул с доступом к скрытым флагам выводится отдельно и не участвует в практическом ранжировании. Для каждого решения действует порог достаточности информации.",
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
 model:"Исследуется конечная временная раскрашенная сеть Петри в форме её эквивалентного графа маркировок. Цвет соответствует идентификатору агента. Маркировка фиксирует набор затронутых и изолированных агентов, а также дискретное время. Сопоставляются две политики: необязательная недетерминированная изоляция и приоритетная принудительная изоляция всех обнаруженных агентов. Вторая политика идеализирована и предполагает безошибочное мгновенное выявление компрометации, подавляя передачу начиная с такта τ.",
 formulas:["M = (C, I, t), C⊆V — скомпрометированные, I⊆V — изолированные","M —[передача i→j, +1]→ M' : i∈C\\I, j∉C∪I, (i,j)∈E","M —[изоляция i, +1]→ M' : i∈C\\I, t+1≥τ","Unsafe(M) ⇔ |C| ≥ K","EF≤T Unsafe — существует допустимая траектория длиной не более T до опасной маркировки"],
 procedure:["Построить исходную маркировку с одним скомпрометированным агентом.","Перебрать доступные переходы поиском в ширину с фиксацией уже посещённых маркировок.","При обнаружении маркировки с K затронутыми агентами сохранить трассу-контрпример.","При отсутствии контрпримера проверить полноту обхода и отсутствие превышения заданного предела состояний."],
 glossary:["Маркировка — полное состояние сети Петри: размещение токенов по позициям.","Цвет токена — типизированный атрибут; здесь — идентификатор агента.","Достижимость — наличие последовательности разрешённых переходов от начальной маркировки.","Контрпример — последовательность переходов, нарушающая условие безопасности.","EF — оператор существования пути с достижением заданного состояния."]
 },
 cascade:{
 goal:"Оценить ожидаемый ущерб и верхнехвостовой риск распространения последствий компрометации через функциональные зависимости агентов.",
 model:"Рассматривается фиксированный ориентированный граф из восьми агентов и одиннадцати зависимостей. Для каждой из восьми возможных начальных компрометаций воспроизводятся каскадные переходы. Условная критичность агента задаёт потери при отказе его функции. Сопоставляются режимы без защитных мер и с вероятностным подавлением распространения.",
 formulas:["L(ω) = Σᵢ cᵢ · 1{i поражён в ω}","E[L] ≈ (1/R) Σᵣ Lᵣ","ΔL = E[L] − cₛ, cₛ — прямой ущерб от начального агента s","VaR₀.₉₅ = Q₀.₉₅(L)","ES₀.₉₅ = (сумма худших 5% массы потерь)/(0,05R)"],
 procedure:["Задать ориентированный граф зависимостей и условные коэффициенты критичности.","Последовательно инициировать компрометацию каждого из восьми агентов.","Для каждого источника провести парные прогоны Монте-Карло с общими случайными событиями для режимов без сдерживания и с коэффициентом снижения передачи.","Рассчитать прямой, каскадный, средний и верхнехвостовой ущерб; сравнить режимы защиты."],
 glossary:["Каскад — распространение функционального нарушения за пределы исходного компонента.","Математическое ожидание ущерба — средняя модельная потеря.","VaR — квантиль распределения потерь.","ES95 — средняя потеря худших 5% вероятностной массы; граница учитывается дробно."]
 },
 misinformation:{
 goal:"Установить зависимость риска неправильного коллективного решения от числа скомпрометированных участников и передачи недостоверной информации через граф межагентных зависимостей.",
 model:"Семь агентов образуют ориентированный граф с девятью зависимостями. Компрометированные агенты формируют смещённые оценки; их информация с заданной вероятностью воздействует на связанных участников. Сопоставляются обычное среднее, взвешивание по наблюдаемому отклонению от медианы и усечение трёх максимальных и трёх минимальных оценок (N=7). Знание истинных меток компрометации в агрегаторах не используется.",
 formulas:["zᵢ = θ + εᵢ − θ·bᵢ,  εᵢ ~ N(0,σ²)","x̄ = N⁻¹ Σᵢ zᵢ","x̂w = Σᵢ wᵢ zᵢ / Σᵢ wᵢ","x̂trim = TrimMean(z₁,…,zN;3), N=7","Risk = Cwrong·P(неверно) + Crefuse·P(отказ)"],
 procedure:["Задать число первоначально скомпрометированных агентов от 0 до 3.","Смоделировать три шага распространения недостоверной информации по девяти связям.","Вычислить коллективные оценки тремя методами и применить критерий отказа.","По независимым прогонам определить вероятность ошибочного решения и отказа с 95%-ми интервалами Wilson, среднее смещение и риск с независимыми ценами ошибки и отказа. Охват недостоверной информацией относить к сценарию."],
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
const fmt=(x)=>x===null||x===undefined?"—":typeof x==="number"?(Number.isInteger(x)?String(x):x.toLocaleString("ru-RU",{maximumFractionDigits:4})):String(x);
const pctFields=FRACTION_METRICS;
const metricNames={correctUnconditional:"Правильные решения / все опыты",accuracy:"Точность среди выданных решений",coverage:"Доля выданных решений",errorRate:"Доля неправильных решений",dangerProbability:"Вероятность опасного состояния",expectedFraction:"Средняя доля поражённых",p95Fraction:"95-й процентиль поражения",expectedDamage:"Средний ущерб",excessDamage:"Каскадный ущерб",es95:"ES95",es95CI95Low:"ES95 нижняя граница",es95CI95High:"ES95 верхняя граница",tailSamples:"Эквивалентный объём хвоста",tailWarning:"Предупреждение о хвостовой оценке",wrongProbability:"Вероятность неверного решения",meanDeviation:"Среднее смещение",abstentionProbability:"Доля отказов",risk:"Нормированный риск",costWrong:"Цена неправильного решения",costRefuse:"Цена отказа",meanObservationAge:"Возраст наблюдения, такт (не задержка решения)",dangerCI95Low:"P опасности: нижняя 95%",dangerCI95High:"P опасности: верхняя 95%",dangerEvents:"Число опасных исходов",reductionDanger:"Снижение вероятности опасности",reductionDamage:"Снижение ожидаемого ущерба",pRaw:"p (исходное)",pHolm:"p (Холм)",holmReject05:"Значимо при FWER 5%",pRawDamage:"p ущерба (исходное)",pRawDanger:"p опасности (исходное)",pHolmDamage:"p ущерба (Холм)",pHolmDanger:"p опасности (Холм)",holmRejectDamage05:"Ущерб: FWER 5%",holmRejectDanger05:"Опасность: FWER 5%"};
function download(name,text,type){const blob=new Blob([text],{type}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);}
function ScientificGraph({result,metric}) {
 const rows=result.rows||[];const methods=[...new Set(rows.map(x=>x.method).filter(Boolean))],scenarios=[...new Set(rows.map(x=>x.scenario))];
 const chart=scenarios.map(s=>{const item={scenario:s};rows.filter(r=>r.scenario===s).forEach(x=>item[x.method]=x[metric]);return item;});
 if(!metric||!methods.length)return null;
 const isProbability=pctFields.has(metric);
 return <div className="r27-chart" role="img" aria-label={"Сравнение по показателю "+(metricNames[metric]||metric)}>
  <ResponsiveContainer width="100%" height={Math.max(310,scenarios.length*66+120)}>
   <BarChart layout="vertical" data={chart} margin={{top:10,right:30,bottom:18,left:12}} barGap={2}>
    <CartesianGrid stroke="#e3eaf2" strokeDasharray="3 3"/><XAxis type="number" domain={[0,"auto"]} tickFormatter={v=>formatStudyValue(metric,v)}/>
    <YAxis dataKey="scenario" type="category" width={208} tick={{fontSize:11}}/>
    <Tooltip formatter={(v,n)=>[formatStudyValue(metric,v),n]}/><Legend wrapperStyle={{fontSize:12}}/>
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
function ResultTable({rows}){if(!rows?.length)return null;const cols=Object.keys(rows[0]);return <div className="r27-table-scroll"><table className="r27-table"><thead><tr>{cols.map(col=><th key={col}>{metricNames[col]||col}</th>)}</tr></thead><tbody>{rows.map((row,i)=><tr key={i}>{cols.map(col=><td key={col}>{formatStudyValue(col,row[col])}</td>)}</tr>)}</tbody></table></div>;}
const KEY_STATS={
 uncertainty:[["correctUnconditional","Правильных решений"],["coverage","Покрытие"],["errorRate","Ошибочных решений"]],
 probgraph:[["dangerProbability","Опасных состояний"],["expectedFraction","Доля поражённых"],["p95Fraction","95-й процентиль"]],
 cascade:[["expectedDamage","Ожидаемый ущерб"],["dangerProbability","Опасных состояний"],["es95","ES95 худших потерь"]],
 misinformation:[["wrongProbability","Ошибочных решений"],["abstentionProbability","Отказов"],["meanExposedFraction","Информационный охват"]]
};
function ResearchKpis({studyId,result}){
 const rows=result?.rows||[], keys=KEY_STATS[studyId]||[];
 const config=result?.config||{};
 const items=studyId==="petri"
  ? [["Достижимость",rows[0]?.value??"—"],["Исследовано маркировок",rows[1]?.value??"—"],["Горизонт, тактов",result?config.steps:"—"],["Порог поражения",result?config.criticalCount:"—"]]
  : [["Число агентов",result?config.agents:"—"],["Прогонов/сценарий",result?config.runs:"—"],...keys.slice(0,2).map(([key,label])=>{
    const values=rows.map(row=>row[key]).filter(Number.isFinite);
    const average=values.length?values.reduce((a,b)=>a+b,0)/values.length:NaN;
    return [label,Number.isFinite(average)?(pctFields.has(key)?(100*average).toFixed(1)+"%":average.toFixed(3)):"—"];
  })];
 return <div className="kpi-grid r27-research-kpis">{items.map(([label,value],i)=>
  <ExperimentKpi key={label} label={label} value={value} note={result?(i>1&&studyId!=="petri"?"Среднее по строкам сравнения":"Воспроизводимый расчёт"):"После запуска эксперимента"} tone={i===3?"teal":"blue"}/>
 )}</div>;
}
export const ResearchStudy=forwardRef(function ResearchStudy({studyId,navigation,onRuntimeChange},actionsRef){
 const def=STUDY_DEFS.find(x=>x.id===studyId);
 const [config,setConfig]=useState({...def.defaults}),[result,setResult]=useState(null),
  [running,setRunning]=useState(false),[error,setError]=useState(""),[metric,setMetric]=useState(""),
  [lastCompletedAt,setLastCompletedAt]=useState(null),[studyProgress,setStudyProgress]=useState(null),
  [cacheHit,setCacheHit]=useState(false),runIdentity=useRef(0);
 useEffect(()=>{setConfig({...def.defaults});setResult(null);setError("");setMetric("");
  setStudyProgress(null);setCacheHit(false);},[def.id]);
 useEffect(()=>()=>{runIdentity.current++;void stopResearchBrowser();},[]);
 const previewReplay=useMemo(()=>{try{return buildResearchReplay(studyId,validateStudy(studyId,config),result||{});}catch{return null;}},[studyId,config,result]);
 const cancelCurrent=()=>{runIdentity.current++;void stopResearchBrowser().catch(()=>{});};
 const update=(k,v)=>{cancelCurrent();setRunning(false);setResult(null);setMetric("");setCacheHit(false);
  setStudyProgress(null);setConfig(old=>({...old,[k]:v}));};
 const start=()=>{
  try{
   const validated=validateStudy(studyId,config);
   if(running)return;
   const request=++runIdentity.current;
   setError("");setRunning(true);setCacheHit(false);
   setStudyProgress({message:"Проверка контрольной точки и запуск…",completed:0,total:1,percent:0});
   void runResearchBrowser(studyId,validated,progress=>{
    if(runIdentity.current===request)setStudyProgress(progress);
   }).then(terminal=>{
    if(runIdentity.current!==request)return;
    if(terminal.state==="stopped"){
     setError("Расчёт прерван. Подтверждённые контрольные точки сохранены; повторный запуск продолжит исследование.");
     return;
    }
    setResult(terminal.result);setMetric(terminal.result.chartKey||"");
    setLastCompletedAt(new Date());setCacheHit(Boolean(terminal.cache_hit));
    setStudyProgress({message:terminal.cache_hit?"Результат восстановлен из IndexedDB":"Все стадии завершены и сохранены",
     completed:1,total:1,percent:100});
   }).catch(e=>{if(runIdentity.current===request)setError(e.message||String(e));})
    .finally(()=>{if(runIdentity.current===request)setRunning(false);});
  }catch(e){setError(e.message||String(e));}
 };
 const stop=()=>{
  const request=++runIdentity.current;
  setRunning(false);
  void stopResearchBrowser().then(stopped=>{
   if(runIdentity.current===request&&stopped)
    setError("Расчёт остановлен. Завершённые стадии сохранены; повторный запуск продолжит расчёт.");
  }).catch(e=>{if(runIdentity.current===request)setError(e.message||String(e));});
 };
 const resetStudy=()=>{cancelCurrent();setRunning(false);setConfig({...def.defaults});setResult(null);
  setError("");setMetric("");setLastCompletedAt(null);setStudyProgress(null);setCacheHit(false);};
 const newStudySeed=()=>update("seed",Math.floor((Date.now()+Math.random()*100000)%2147483647));
 useImperativeHandle(actionsRef,()=>({start,stop,reset:resetStudy,newSeed:newStudySeed}));
 useEffect(()=>{onRuntimeChange?.({studyId,running,seed:config.seed,lastCompletedAt,hasResult:Boolean(result),
  steps:result?.config?.steps??config.steps??null,elapsedMs:result?.elapsedMs??null,
  rows:result?.rows?.length??0});},[studyId,running,config.seed,lastCompletedAt,Boolean(result),onRuntimeChange]);
 const opts=result?.rows?.length?Object.keys(result.rows[0]).filter(x=>x in metricNames):[];
 const theory=THEORY[studyId];
 const author=studyId==="petri"||studyId==="misinformation"?"Авторы · ктн Ушаков И.А. · ктн Харжевская А.В. · Егоров Е.В.":"Авторы · ктн Ушаков И.А. · Трофимова Н.А.";
 return <ExperimentLayout
  sidebar={<ResearchSettings studyId={studyId} config={config} onChange={update} onStart={start} onStop={stop} onReset={resetStudy} running={running}/>}
  navigation={navigation}
  studyId={studyId}
  authors={author}
  title={def.title}
  description={theory.goal}
  progress={<ExperimentProgress running={running} cacheHit={cacheHit} progress={studyProgress||(result?{message:"Расчёт завершён · "+def.short,completed:1,total:1,percent:100,eta_seconds:0}:{message:"Готов к запуску",completed:0,total:1,percent:0})}/>}
  error={error?<div className="error-banner" role="alert">{error}</div>:null}
 >
   <div className="r27-topology-full">
     <TopologyPlayback replay={result?.replay||previewReplay} compact/>
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
           <p>{result.verdict==="reachable"?"Найден контрпример достижения опасной маркировки.":result.verdict==="unreachable_within_bound"?"На заданном горизонте и при данной политике опасное состояние недостижимо; фронт поиска исчерпан.":"Полнота поиска не достигнута; вывод о недостижимости невозможен."}</p>
           <p><strong>Политика изоляции:</strong> {result.policyName==="ideal_mandatory_priority"?"Приоритетная, идеализированная: все выявленные агенты изолируются до передачи":"Необязательная, недетерминированная: EF учитывает и путь без изоляции"}. <strong>Зарегистрировано маркировок:</strong> {result.enqueued}; <strong>обработано:</strong> {result.processed}.</p>
           <ol>{(result.witness||[]).map((state,i)=><li key={i}>{state}</li>)}</ol>
           <p>Количество состояний по тактам: {result.statesByTime.join(" · ")}</p>
         </div>
       </section>:
       <div className="r27-study-comparison-grid">
       <section className="panel r27-comparison-panel">
         <header className="panel-header"><div><h2>Сравнение сценариев и методов</h2><p>Групповые показатели вычислительного эксперимента</p></div>
           <label className="r27-metric">Показатель <select value={metric} onChange={e=>setMetric(e.target.value)}>{opts.map(x=><option value={x} key={x}>{metricNames[x]}</option>)}</select></label>
         </header>
         <div className="panel-body"><ScientificGraph result={result} metric={metric}/></div>
       </section>
       <ScenarioComparisonMatrix result={result} metric={metric}/>
      </div>}
     <StudyVisualization result={result} metric={metric}/>
   </>:null}
     <ExperimentPanel title="Сводная таблица результатов" subtitle="Показатели расчётов по сценариям и методам" className="r27-summary-panel">
      {result?<ResultTable rows={result.rows}/>:<div className="r27-summary-empty">Таблица формируется после запуска вычислительного эксперимента.</div>}
     </ExperimentPanel>
   {result?.metricPassport?.length?<ExperimentPanel title="Паспорта ключевых показателей" subtitle={"Реализованная формула, знаменатель, единица измерения и правило для отсутствующих значений · "+result.metricPassportVersion}>
     <ResultTable rows={result.metricPassport}/>
     <p className="r27-note">Автоматический контроль арифметических инвариантов: {result.metricIntegrity?.valid?"пройден":"не пройден"}. Паспорта фиксируют реализованные оценщики, не являются независимой научной экспертизой.</p>
   </ExperimentPanel>:null}
   {result?.statisticsAudit?<ExperimentPanel title="Контроль статистических предпосылок" subtitle="Мощность, интервалы, множественные сравнения и границы научного вывода">
     <p className="r27-note">Арифметический контроль статистики: <strong>{result.statisticsAudit.valid?"пройден":"не пройден"}</strong>. Проверено сравнений в семье Холма: {result.statisticsAudit.holmFamilyChecked}. Ориентир R={result.statisticsAudit.illustrativeWilsonRunRequirement??"—"} соответствует полуширине 95%-го интервала Уилсона 0,05 при консервативном p≈0,5; это не универсальное требование к мощности конкретного эксперимента.</p>
     <p className="r27-note">Внешняя калибровка и независимая научная приёмка: <strong>не подтверждены</strong>. Интервалы описывают только вариацию внутри принятой синтетической модели.</p>
     {result.statisticsAudit.warnings?.length?<ul>{result.statisticsAudit.warnings.map((warning,i)=><li key={i}>{warning}</li>)}</ul>:null}
    </ExperimentPanel>:null}
   {result?.pairedEffects?.length? <ExperimentPanel title="Парные оценки эффектов (95% bootstrap)" subtitle={studyId==="cascade"?"Эффект = базовый ущерб/риск минус защищённый, при общей таблице случайных событий":"Эффект = риск базового режима − риск режима с η; одинаковые граф, источники и случайные события"}>
      <ResultTable rows={result.pairedEffects}/>
      <p className="r27-note">
      Множественные сравнения: {result.multipleTesting?.tested??0} из {result.multipleTesting?.planned??0} проверок,
      {result.multipleTesting?.correction||" поправка не выполнялась"}. Вывод о значимости возможен только по скорректированным p-значениям при условии обменности знаков парных разностей в рамках нулевой гипотезы.
      Показанные 95%-е bootstrap-интервалы не скорректированы на число сравнений и отражают только вариацию Монте-Карло. При малой выборке и редких событиях необходимы дополнительные независимые прогоны.
     </p>
    </ExperimentPanel>:null}
   {result?.scenarioMetrics?.length? <ExperimentPanel title="Информационный охват сценариев" subtitle="Общая характеристика распространения, не отдельного алгоритма принятия решений">
      <ResultTable rows={result.scenarioMetrics}/>
    </ExperimentPanel>:null}
   {result?.robustnessSensitivity?.length? <ExperimentPanel title="Чувствительность к параметру усечения" subtitle="Одинаковые случайные наблюдения для f=0–3 и k=0–3">
     <ResultTable rows={result.robustnessSensitivity}/>
     <p className="r27-note">Предварительное сравнение фиксированного числа усечений с каждой стороны. Никакой подбор по скрытым меткам нарушителя не выполняется. Статистическая значимость и практическая оптимальность выбора k не подтверждены.</p>
    </ExperimentPanel>:null}
   {result?<>

     <section className="panel r27-study-limits">
       <header className="panel-header"><div><h2>Интерпретация и экспорт</h2><p>Границы применимости и результаты воспроизводимых расчётов</p></div>
         <div className="r27-result-tools"><button type="button" onClick={()=>download("imas_"+studyId+"_"+result.config.seed+".csv",toCsv(result.rows),"text/csv;charset=utf-8")}>Скачать CSV</button><button type="button" onClick={()=>download("imas_"+studyId+"_"+result.config.seed+".json",JSON.stringify(result,null,2),"application/json;charset=utf-8")}>Скачать JSON</button>{result.sourceRunJournal?.complete?<button type="button" onClick={()=>download("imas_"+studyId+"_raw_"+result.config.seed+".json",JSON.stringify({modelVersion:result.modelVersion,config:result.config,journal:result.sourceRunJournal,
  rows:result.rows,pairedRuns:result.pairedRuns||null,pairedEffects:result.pairedEffects||null,
  statisticsAudit:result.statisticsAudit,metricIntegrity:result.metricIntegrity},null,2),"application/json;charset=utf-8")}>Скачать исходные прогоны</button>:null}{result.markingJournal?.complete?<button type="button" onClick={()=>download("imas_petri_markings_"+result.config.seed+".json",JSON.stringify({modelVersion:result.modelVersion,config:result.config,journal:result.markingJournal,
  edges:result.edges,witness:result.witness,statesByTime:result.statesByTime,verdict:result.verdict,
  statisticsAudit:result.statisticsAudit,metricIntegrity:result.metricIntegrity},null,2),"application/json;charset=utf-8")}>Скачать журнал маркировок</button>:null}</div>
       </header>
       <div className="panel-body">{result.sourceRunJournal?.complete?<p className="r27-note">Сформирован полный архив исходных прогонов: {result.sourceRunJournal.entries.length} реализаций. Исходные данные включают записи событий для E3/E5 либо наблюдения и истинные метки для E2/E6. Эталонные метки не передаются практическому алгоритму и используются только для верификации.</p>:null}
        {result.markingJournal?.complete?<p className="r27-note">Журнал маркировок: {result.markingJournal.records.length} обработанных состояний, {result.markingJournal.frontier.length} состояний во фронте. Полнота журнала означает полноту записи выполненного ограниченного поиска, а не автоматически полноту пространства достижимости.</p>:null}
        <p className="r27-note"><strong>Граница применимости.</strong> {result.limits}</p></div>
     </section>
   </>:<div className="empty r27-study-empty">Задайте параметры в боковом меню и запустите эксперимент. Математическая модель и ограничения изложены в единой справке.</div>}
 </ExperimentLayout>;
});
export function ResearchHelp({baselineArticle,baselineSections,onBack}){
 return <UnifiedHelp baselineArticle={baselineArticle} baselineSections={baselineSections} researchTheory={THEORY} onBack={onBack}/>;
}
