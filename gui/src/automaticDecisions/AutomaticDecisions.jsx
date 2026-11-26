import {ExtendedStudyPanel} from "./ExtendedStudyPanel.jsx";
import {MonteCarloPanel} from "./MonteCarloPanel.jsx";
import React,{forwardRef,useEffect,useImperativeHandle,useMemo,useRef,useState} from "react";
import {BarChart,Bar,LineChart,Line,CartesianGrid,XAxis,YAxis,Tooltip,Legend,ResponsiveContainer,ReferenceLine,ErrorBar} from "recharts";
import {ExperimentLayout,ExperimentPanel,ExperimentKpi,ExperimentParameterTooltip,ExperimentProgress} from "../ExperimentLayout.jsx";
import {VERSION,DEFAULTS,METHODS,SCENARIOS,geometry,validate,units,theta,radius,laws} from "./kernel.js";
import {summarize} from "./statistics.js";
import {parseFixture,keyFor,load,save,remove} from "./storage.js";
export const TITLE="Модель распределённой поддержки принятия решений интеллектуальными агентами по обеспечению кибербезопасности в условиях неопределённости и информационной зависимости агентов";
const AUTHOR="Автор · ктн Ушаков И.А.";
const SERIES={fixed:"Основное сравнение",matched:"Равная автоматизация",cost:"Стоимость эскалации",sensitivity:"Объём калибровки",validity:"Статистические гарантии",validation:"Независимая валидация",control:"Контроль реализации",all:"Все серии статьи"};
const LABEL={scenario:"Сценарий",method:"Метод",coverage:"Автоматизация",loss:"Ожидаемые потери",miss:"Пропуск угрозы",false:"Ложное реагирование",posterior_mass:"Покрытие интервалом",width:"Ширина интервала",nominal:"Номинальная автоматизация",lower:"Исходная граница",lower_tight:"Уточнённая граница",risk_violation_mass:"Нарушение ограничения риска",calibration_included:"Калибровочный закон в множестве",assumptionsValid:"Условия сертификата",n:"Объём M",rep:"Калибровка",reps:"Повторов",cost:"Цена эскалации",crossing_coverage:"Масса допуска пересекающих порог интервалов",baseline:"Базовый метод",difference:"Разность потерь",upper:"Верхняя граница ДИ",family:"Число контрастов",exact_coverage:"Точная автоматизация",mc_coverage:"Монте-Карло",exact_loss:"Точные потери",mc_loss:"Потери Монте-Карло",se:"Стандартная ошибка",size:"Запросов",box_lp_error:"Ошибка LP M9",l1_lp_error:"Ошибка LP L1",sampled_min_coverage:"Минимум по допустимым законам"};
const NAMES={3:"Независимая",4:"Групповая",6:"Предлагаемая",7:"Минимакс",8:"Бета-биномиальная",9:"Робастная покомпонентная",10:"Эталон",11:"Смесь"};
const COLORS={3:"#2164ba",4:"#0a947b",6:"#db6b38",7:"#7955a8",8:"#5d8eaa",9:"#9b7946",10:"#6e7786",11:"#ad647b"};
const FRACTIONS=new Set(["coverage","miss","false","posterior_mass","nominal","lower","lower_tight","risk_violation_mass","calibration_included","crossing_coverage","exact_coverage","mc_coverage","sampled_min_coverage"]);
const fmt=(v,d=6)=>typeof v==="number"&&Number.isFinite(v)?v.toLocaleString("ru-RU",{maximumFractionDigits:d}):"—";
const format=(k,v,table)=>v==null?"—":k==="scenario"?"S"+v:k==="method"||k==="baseline"?"M"+v:k==="assumptionsValid"?(v?"Выполнены":"Нарушены"):typeof v==="number"?(k.endsWith("_error")?v.toExponential(3):FRACTIONS.has(k)&&!(table==="paired"&&k==="lower")?fmt(v*100,4)+" %":fmt(v)):String(v);
function Field({label,value,onChange,disabled,min,max,step=1,note}){return <label className="field r27-setting-field"><span className="field-label"><span>{label}</span><ExperimentParameterTooltip text={note}/></span><input aria-label={label} type="number" min={min} max={max} step={step} value={Number.isFinite(value)?value:""} disabled={disabled} onChange={e=>onChange(e.target.value===""?NaN:Number(e.target.value))}/></label>;}
function Choice({label,value,onChange,disabled,choices}){return <label className="field r27-setting-field"><span className="field-label">{label}</span><select aria-label={label} value={value} onChange={e=>onChange(e.target.value)} disabled={disabled}>{choices.map(([v,n])=><option key={v} value={v}>{n}</option>)}</select></label>;}
function Settings({c,update,running,start,stop,reset,clear,loadFile,fixtureHash}){
 const locked=running||c.mode==="article";
 let dimension="—";try{dimension=geometry(validate(c)).size.toLocaleString("ru-RU");}catch{}
 const f=(k,label,min,max,step,note)=><Field key={k} label={label} min={min} max={max} step={step} value={c[k]} onChange={v=>update(k,v)} disabled={locked} note={note}/>;
 return <aside className="sidebar r27-unified-settings"><div className="sidebar-scroll">
  <h2>Параметры эксперимента</h2>
  <Choice label="Режим исследования" value={c.mode} disabled={running} onChange={v=>update("mode",v)} choices={[["article","Воспроизведение статьи"],["custom","Пользовательское исследование"]]}/>
  <Choice label="Экспериментальная серия" value={c.series} disabled={running} onChange={v=>update("series",v)} choices={Object.entries(SERIES)}/>
  {c.mode==="custom"?<Choice label="Сценарий" value={c.scenario} disabled={running} onChange={v=>update("scenario",+v)} choices={SCENARIOS.map((v,i)=>[i+1,"S"+(i+1)+" — "+v])}/>:<p className="r27-note">Фиксированные параметры публикации. Первичные частоты формируются независимым эталоном Python.</p>}
  <div className="sidebar-section"><h3>Информационные группы</h3><p className="r27-note">{c.groups.reduce((a,b)=>a+b,0)} агентов · {dimension} конфигураций</p>
  {c.groups.map((n,g)=><details className="advanced" key={g}><summary>Группа {g+1} · {n} агентов</summary><div className="advanced-body">
   <Field label={"n"+(g+1)+" — число агентов"} value={n} min={2} max={30} disabled={locked} onChange={v=>update("groups",c.groups.map((a,i)=>i===g?v:a))}/>
   {[0,1].map(x=><Field key={x} label={"u"+(g+1)+x+" — P(Y=1 | X="+x+")"} value={c.u[x][g]} min={0} max={1} step={.01} disabled={locked} onChange={v=>update("u",c.u.map((a,i)=>i===x?a.map((p,j)=>j===g?v:p):a))}/>)}
   <Field label={"ρ"+(g+1)+" — базовая корреляция"} value={c.rho[g]} min={0} max={1} step={.01} disabled={locked} onChange={v=>update("rho",c.rho.map((a,i)=>i===g?v:a))}/>
   <p className="r27-note">Радиус L1: {fmt(radius(c,n,c.m))}</p>
  </div></details>)}</div>
  <div className="sidebar-section"><h3>Калибровка и статистика</h3>
   {f("m","M — наблюдений на условный закон",1,1000000,1,"Частоты полного группового счётчика, отдельно для каждого состояния.")}
   {f("reps","R — число калибровок",1,100,1,"Независимые калибровки, а не число перечисленных конфигураций.")}
   {f("seed","Начальное зерно генератора",1,4294967295,1)}
   {f("prior","π — вероятность угрозы",.000001,.999999,.01)}
   {f("alpha","α — вероятность ошибки",.000001,.999999,.01)}
   {f("target","γ — требуемая автоматизация",0,1,.01)}
  </div>
  <div className="sidebar-section"><h3>Матрица потерь</h3>
   {f("b","b — пропуск угрозы",.000001,1000,.1)}
   {f("f","f — ложное реагирование",.000001,1000,.1)}
   {f("d","d — правильное реагирование",0,1000,.1)}
   {f("c","c — цена эскалации",0,1000,.05)}
   <p className="r27-note">Порог предпочтения: {fmt(theta(c))}; критическая цена: {fmt(c.b*theta(c))} усл. ед.</p>
  </div>
  <details className="advanced"><summary>Воспроизводимость</summary><div className="advanced-body">
   <label className="field"><span>Импорт первичных частот статьи (JSON)</span><input type="file" accept=".json,application/json" disabled={running} onChange={e=>{if(e.target.files?.[0])loadFile(e.target.files[0]);e.target.value="";}}/></label>
   <p className="r27-note">{fixtureHash?"SHA-256: "+fixtureHash.slice(0,16)+"…":"В режиме статьи используется встроенный проверяемый эталонный набор. Импорт — резервный способ загрузки."}</p>
   <button type="button" className="r27-settings-reset" onClick={clear} disabled={running}>Удалить сохранённую серию</button>
   <button type="button" className="r27-settings-reset" onClick={reset} disabled={running}>Восстановить параметры по умолчанию</button>
  </div></details>
 </div><button type="button" className="run-button" onClick={start} disabled={running}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.8 18.4 12 7 19.2Z" fill="none" stroke="currentColor" strokeWidth="1.8"/></svg>{running?"Выполняется…":"Запустить эксперимент"}</button>{running?<button type="button" className="r27-settings-stop" onClick={stop}>Остановить расчёт</button>:null}</aside>;
}
function Table({rows,table}){if(!rows?.length)return <div className="r27-summary-empty">Результаты появятся после завершения расчёта.</div>;const cols=[...new Set(rows.flatMap(Object.keys))];return <div className="r27-table-scroll"><table className="r27-table"><thead><tr>{cols.map(k=><th key={k}>{table==="paired"&&k==="lower"?"Нижняя граница ДИ":LABEL[k]||k}</th>)}</tr></thead><tbody>{rows.map((r,i)=><tr key={i}>{cols.map(k=><td key={k}>{format(k,r[k],table)}</td>)}</tr>)}</tbody></table></div>;}
function Topology({groups,sample,onExportSvg}){
 const [stage,setStage]=useState(3);useEffect(()=>setStage(3),[sample]);const action=sample?["Продолжить наблюдение","Защитное реагирование","Передать оператору"][sample.action]:"—";
 const [playing,setPlaying]=useState(false);useEffect(()=>{if(!playing)return;const t=setInterval(()=>setStage(v=>{if(v>=3){setPlaying(false);return v;}return v+1;}),750);return ()=>clearInterval(t);},[playing]);
 const phases=["Локальные оценки","Групповые счётчики","Апостериорный интервал","Рекомендация"];
 return <section className="r27-replay r27-replay-compact" aria-label="Информационная структура ИМАС"><div className="r27-replay-heading"><div><h3>Информационная структура ИМАС</h3><p>Этапы одного цикла формирования рекомендации, не временная динамика атаки.</p></div><div className="r27-replay-heading-actions"><strong>Этап {stage+1}/4</strong>{onExportSvg?<button className="r27-export-control" type="button" onClick={onExportSvg}>SVG</button>:null}</div></div>
 <div className="r27-playback-figure"><svg viewBox="0 0 550 320" className="r27-playback-svg" role="img" aria-label="Три информационные группы и отдельный координатор">
  {groups.map((n,g)=>{const x=7+g*181,cols=6,delta=23;const [m,k]=sample?.pairs[g]||[0,0];return <g key={g}><rect x={x} y="8" width="174" height="163" rx="7" fill="#f7fbff" stroke="#95abc0"/><text x={x+87} y="24" fontSize="12" fontWeight="700" fill="#224766" textAnchor="middle">Группа {g+1} · n={n}</text>
  {Array.from({length:Math.max(0,Math.min(30,n||0))},(_,i)=>{const px=x+28+(i%cols)*delta,py=43+Math.floor(i/cols)*22;const state=!sample?"не рассчитано":i<k?"1":i<m?"0":"нет сообщения";return <g key={i}><circle cx={px} cy={py} r="9" fill={!sample?"#e3e8ed":i<k?"#0a947b":i<m?"#6ca6df":"#e3e8ed"} stroke="#638199"/><text x={px} y={py+3} textAnchor="middle" fontSize="8" fill="#1c344d">{i+1}</text><title>{state}</title></g>;})}
  <text x={x+87} y="158" textAnchor="middle" fontSize="12" fill="#224766">{stage>=1&&sample?"m="+m+", k="+k:"m=—, k=—"}</text><path d={"M"+(x+87)+" 171 V188 L275 202"} stroke="#95abc0" strokeWidth="1.5" fill="none"/></g>;})}
  <rect x="142" y="202" width="266" height="49" rx="7" fill="#e3eff8" stroke="#6ca6df"/><text x="275" y="219" textAnchor="middle" fontSize="12" fontWeight="700" fill="#224766">Координационный агент (отдельный)</text><text x="275" y="238" textAnchor="middle" fontSize="12" fill="#224766">{stage>=2&&sample?"p ∈ ["+fmt(sample.lo,4)+"; "+fmt(sample.hi,4)+"]":"p ∈ [—; —]"}</text><path d="M275 251 V267" stroke="#95abc0"/><rect x="112" y="268" width="326" height="36" rx="6" stroke="#95abc0" fill={sample&&stage===3&&sample.action===2?"#fff1d9":"#f2f7fb"}/><text x="275" y="290" textAnchor="middle" fontSize="12" fill="#224766">{stage===3?action:phases[stage]}</text>
 </svg></div>
 <div className="r27-playback-controls"><button type="button" onClick={()=>{setStage(0);setPlaying(false);}}>В начало</button><button type="button" className="r27-play-main" aria-label={playing?"Пауза":"Воспроизвести"} onClick={()=>{if(stage===3&&!playing)setStage(0);setPlaying(v=>!v);}}>{playing?"Пауза":"Воспроизвести"}</button><input type="range" aria-label="Выбор этапа" min="0" max="3" value={stage} onChange={e=>{setStage(+e.target.value);setPlaying(false);}}/></div>
 <p className="r27-note">{sample?"S"+sample.scenario+", калибровка "+(sample.rep+1)+": W₀="+fmt(sample.risk0)+"; W₁="+fmt(sample.risk1)+". Одна реально перечисленная конфигурация. Порядок окраски агентов условен: модель хранит счётчики.":"После расчёта отображается конкретная перечисленная конфигурация; до расчёта только структура групп."}</p></section>;
}
function Matrix({rows,metric}){const ss=[...new Set(rows.map(r=>r.scenario))].filter(Number.isFinite),mm=[...new Set(rows.map(r=>r.method))].filter(Number.isFinite),values=rows.map(r=>r[metric]).filter(Number.isFinite),max=Math.max(...values,1e-15);
 return <ExperimentPanel title="Сравнительная матрица по сценариям и методам" subtitle={LABEL[metric]||metric} className="r27-panel r27-comparison-matrix">{ss.length&&mm.length?<div className="r27-table-scroll"><table className="r27-table"><thead><tr><th>Сценарий</th>{mm.map(m=><th key={m}>M{m}</th>)}</tr></thead><tbody>{ss.map(s=><tr key={s}><th>S{s}</th>{mm.map(m=>{const v=rows.find(r=>r.scenario===s&&r.method===m)?.[metric];return <td key={m} style={{background:Number.isFinite(v)?"rgba(24,104,173,"+(.07+.43*Math.max(0,v)/max)+")":undefined}}>{format(metric,v)}</td>;})}</tr>)}</tbody></table></div>:<p className="r27-summary-empty">Сравнительные показатели появятся после расчёта соответствующей серии.</p>}</ExperimentPanel>;
}
function SeriesChart({rows,metric,axis="scenario",line=false,critical=null,methods=METHODS}){
 const ids=[...new Set(rows.map(r=>r[axis]))].sort((a,b)=>a-b);const ms=[...new Set(rows.map(r=>r.method))].filter(m=>methods.includes(m));
 const data=ids.map(id=>({x:axis==="scenario"?"S"+id:id,...Object.fromEntries(ms.map(m=>["M"+m,rows.find(r=>r[axis]===id&&r.method===m)?.[metric]??null]))}));const Chart=line?LineChart:BarChart,Series=line?Line:Bar;
 return <ResponsiveContainer width="100%" height={285}><Chart data={data}><CartesianGrid strokeDasharray="3 3" stroke="#e0e8f0"/><XAxis dataKey="x" type={axis==="scenario"?"category":"number"} domain={["dataMin","dataMax"]} tick={{fontSize:11}}/><YAxis domain={FRACTIONS.has(metric)?[0,1]:[0,"auto"]} tickFormatter={v=>FRACTIONS.has(metric)?fmt(v*100,1)+"%":fmt(v,2)}/><Tooltip formatter={(v,n)=>[format(metric,v),n]}/><Legend/>{critical!==null?<ReferenceLine x={critical} stroke="#7955a8" strokeDasharray="4 3" label="c*"/>:null}{ms.map(m=><Series key={m} dataKey={"M"+m} name={"M"+m+" — "+NAMES[m]} fill={COLORS[m]} stroke={COLORS[m]} strokeWidth={2} strokeDasharray={m===10?"5 3":undefined} isAnimationActive={false}/>)}</Chart></ResponsiveContainer>;
}
function MultiChart({rows,axis,fields,line=false}){const Chart=line?LineChart:BarChart,Series=line?Line:Bar;const colors=["#2164ba","#7955a8","#0a947b","#db6b38"];
 return <ResponsiveContainer width="100%" height={270}><Chart data={rows.map(r=>({...r,x:axis==="scenario"?"S"+r[axis]+(r.assumptionsValid===false?"*":""):r[axis]}))}><CartesianGrid strokeDasharray="3 3" stroke="#e0e8f0"/><XAxis dataKey="x" type={axis==="scenario"?"category":"number"} domain={["dataMin","dataMax"]}/><YAxis domain={fields.every(k=>FRACTIONS.has(k))?[0,1]:[0,"auto"]} tickFormatter={v=>fields.every(k=>FRACTIONS.has(k))?fmt(v*100,1)+"%":fmt(v,3)}/><Tooltip formatter={(v,n)=>[format(fields.find(k=>LABEL[k]===n)||n,v),n]}/><Legend/>{fields.map((f,i)=><Series key={f} dataKey={f} name={LABEL[f]} fill={colors[i]} stroke={colors[i]} strokeWidth={2} isAnimationActive={false}/>)}</Chart></ResponsiveContainer>;
}
function download(name,text,mime){const url=URL.createObjectURL(new Blob([text],{type:mime})),a=document.createElement("a");a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function csv(rows){const cols=[...new Set(rows.flatMap(Object.keys))],escape=x=>'"'+String(x??"").replaceAll('"','""')+'"';return "\ufeff"+cols.join(";")+"\n"+rows.map(r=>cols.map(k=>escape(r[k])).join(";")).join("\n");}
const passports=[
 ["Автоматизация","Σ P(o)·P(допуск|o)","Все запросы"],
 ["Ожидаемые потери","b·miss + f·false + d·TP + c·(1−coverage)","Условные единицы на запрос"],
 ["Пропуск угрозы","Σ πP(o|1)·P(a₀,допуск|o)","Все запросы, не только угрозы"],
 ["Ложное реагирование","Σ (1−π)P(o|0)·P(a₁,допуск|o)","Все запросы"],
 ["Покрытие интервалом","Σ P(o)·1{p истинное ∈ [p−,p+]}","Масса наблюдений, не частота калибровок"],
 ["Ширина","Σ P(o)·(p+−p−)","Средняя по тестовому закону"],
 ["Гарантируемая доля","max(0, γ̂−D, γ̂−d₁−R≥2)","При принятых допущениях, уровень 1−α"],
 ["Нарушение риска","Σ P(o)·1{допуск и истинный риск>c}","Все запросы"]];
const GeneralDecisions=forwardRef(function GeneralDecisions({navigation,onRuntimeChange,onExportSvg},ref){
 const [c,setC]=useState(DEFAULTS),[records,setRecords]=useState(null),[running,setRunning]=useState(false),[progress,setProgress]=useState(null),[error,setError]=useState(""),[last,setLast]=useState(null),[elapsed,setElapsed]=useState(null),[loaded,setLoaded]=useState(null),[metric,setMetric]=useState("loss"),[shown,setShown]=useState("fixed"),[scenario,setScenario]=useState(3),[method,setMethod]=useState(6),[methods,setMethods]=useState(METHODS);
 const worker=useRef(null),generation=useRef(0),lastKey=useRef(null),currentLoaded=useRef(null),busy=useRef(false);
 const stop=()=>{generation.current++;worker.current?.terminate();worker.current=null;busy.current=false;setRunning(false);setError("Расчёт остановлен. Сохранены завершённые калибровки.");};
 useEffect(()=>()=>{generation.current++;worker.current?.terminate();busy.current=false;},[]);
 const change=(next)=>{generation.current++;worker.current?.terminate();worker.current=null;busy.current=false;setRunning(false);setC(next);setRecords(null);setError("");setProgress(null);setLast(null);setElapsed(null);};
 const update=(k,v)=>change(k==="mode"&&v==="article"?{...DEFAULTS,series:c.series}:({...c,[k]:v}));
 const reset=()=>change(DEFAULTS);
 const newSeed=()=>change({...c,mode:"custom",seed:Math.max(1,Math.floor(Math.random()*4294967295))});
 const importFixture=async(file)=>{try{const data=await parseFixture(await file.text());currentLoaded.current=data;setLoaded(data);setError("");setRecords(null);setProgress(null);}catch(e){setError(e.message||String(e));}};
 const ensureFixture=async()=>{if(currentLoaded.current)return currentLoaded.current;const base=import.meta.env.BASE_URL;const [response,manifest]=await Promise.all([fetch(base+"e2-fixtures.json",{cache:"no-cache"}),fetch(base+"e2-fixtures.sha256",{cache:"no-cache"})]);if(!response.ok||!manifest.ok)throw Error("Эталонные ресурсы не опубликованы. Обновите сборку стенда или импортируйте JSON.");const type=response.headers.get("content-type")||"";const raw=await response.text();if(type.includes("text/html")||raw.trimStart().startsWith("<"))throw Error("Сервер вернул HTML вместо эталонного JSON. Требуется повторное развёртывание полной сборки.");let data;try{data=await parseFixture(raw);const expected=(await manifest.text()).trim();if(!/^[a-f0-9]{64}$/.test(expected)||data.hash!==expected)throw Error("SHA-256 не совпадает");}catch(e){throw Error("Не удалось проверить эталонный набор: "+e.message+"; обновите сборку или импортируйте JSON.");}currentLoaded.current=data;setLoaded(data);return data;};
 const clear=async()=>{try{const hash=c.mode==="article"?(await ensureFixture()).hash:null,key=await keyFor(c,hash);await remove(key);setRecords(null);setProgress(null);setLast(null);setError("");}catch(e){setError(e.message||String(e));}};
 const start=async()=>{
  if(busy.current)return;busy.current=true;const id=++generation.current,startTime=performance.now();
  setRunning(true);setError("");setRecords(null);setProgress({message:"Подготовка E2",completed:0,total:1,percent:0});
  try{
   const config=validate(c),data=config.mode==="article"?await ensureFixture():null,key=await keyFor(config,data?.hash),plan=units(config);lastKey.current=key;
   const saved=await load(key,config)||[];if(generation.current!==id)return;
   const finish=(r,cache=false)=>{if(generation.current!==id)return;setRecords(r);const s=summarize(r,config.alpha);setShown(s.tables[config.series]?config.series:Object.keys(s.tables)[0]||"fixed");setScenario(config.mode==="custom"?config.scenario:config.series==="cost"||config.series==="sensitivity"?3:config.series==="validation"?2:3);setMethod(6);setMetric("loss");setLast(new Date());setElapsed(performance.now()-startTime);setProgress({message:cache?"Результат восстановлен из IndexedDB":"Все стадии завершены и сохранены",completed:plan.length,total:plan.length,percent:100});worker.current?.terminate();worker.current=null;busy.current=false;setRunning(false);};
   if(saved.length===plan.length){finish(saved,true);return;}
   setProgress({message:"Вычисление калибровок",completed:saved.length,total:plan.length,percent:100*saved.length/plan.length});
   const w=new Worker(new URL("./worker.js",import.meta.url),{type:"module"});worker.current=w;
   const fail=e=>{if(generation.current!==id)return;w.terminate();worker.current=null;busy.current=false;setError(String(e.message||e));setRunning(false);};
   w.onerror=fail;
   w.onmessage=async({data:msg})=>{if(generation.current!==id)return;try{if(msg.type==="error")throw Error(msg.error);if(msg.type==="done"){finish(saved);return;}if(msg.type!=="record"||msg.index!==saved.length+1||JSON.stringify(msg.record.unit)!==JSON.stringify(plan[saved.length]))throw Error("Нарушена последовательность расчёта");
    saved.push(msg.record);await save(key,saved);if(generation.current!==id)return;setProgress({message:"Завершено калибровок: "+saved.length+" / "+plan.length,completed:saved.length,total:plan.length,percent:100*saved.length/plan.length});w.postMessage({type:"continue",index:saved.length});
   }catch(e){fail(e);}};
   w.postMessage({type:"start",config,fixture:data?.fixture||null,index:saved.length});
  }catch(e){if(generation.current===id){busy.current=false;setError(e.message||String(e));setRunning(false);}}
 };
 useImperativeHandle(ref,()=>({start,stop,reset,newSeed}));
 useEffect(()=>{onRuntimeChange?.({studyId:"uncertainty",running,seed:c.seed,lastCompletedAt:last,hasResult:!!records,steps:progress?.completed??0,elapsedMs:elapsed});},[running,c.seed,last,records,progress,elapsed,onRuntimeChange]);
 const result=useMemo(()=>records?summarize(records,c.alpha):null,[records,c.alpha]),tables=result?.tables||{},rows=tables[shown]||[],comparison=(tables[shown]||[]).some(r=>r.method!=null&&r.scenario!=null)?rows:tables.fixed||tables.matched||tables.validation||[],sample=records?.find(r=>r.unit.s===scenario&&r.unit.series!=="sensitivity")?.sample||records?.find(r=>r.unit.s===scenario)?.sample||null;
 const kr=(tables.fixed||tables.matched||tables.validation||[]).find(r=>r.scenario===scenario&&r.method===method),vr=tables.validity?.find(r=>r.scenario===scenario);
 const costR=tables.cost?.filter(r=>r.method===method&&Math.abs(r.cost-c.c)<1e-10)[0],sensR=tables.sensitivity?.find(r=>r.n===c.m),kpi=kr||costR||(method===6?sensR||vr:null);
 const payload=()=>({id:"uncertainty",modelVersion:VERSION,title:TITLE,author:AUTHOR,config:c,fixtureHash:c.mode==="article"?loaded?.hash:null,elapsedMs:elapsed,records,raw:result.raw,tables:result.tables,metricIntegrity:{valid:true,scope:"runtime arithmetic checks; independent acceptance separate"},limits:"Synthetic; assumptions fail in S4/S7/S8"});
 return <ExperimentLayout studyId="uncertainty" navigation={navigation} authors={AUTHOR} title={TITLE} description="Статистически обоснованное формирование коллективных рекомендаций при информационной зависимости и неполноте наблюдений." sidebar={<Settings c={c} update={update} running={running} start={start} stop={stop} reset={reset} clear={clear} loadFile={importFixture} fixtureHash={loaded?.hash}/>} progress={<ExperimentProgress running={running} progress={progress}/>} error={error?<div className="error-banner" role="alert">{error}</div>:null}>
 <div className="r27-study-topline"><div className="r27-topology-full"><Topology groups={c.groups} sample={sample} onExportSvg={onExportSvg}/></div><Matrix rows={comparison} metric={metric}/></div>
 <div className="kpi-grid r27-research-kpis">{[["Автоматизация",kpi?.coverage,"Доля автоматических действий","coverage"],["Ожидаемые потери",kpi?.loss,"Условные единицы на запрос","loss"],["Гарантируемая автоматизация",method===6?(vr?.assumptionsValid===false?null:vr?.lower_tight??sensR?.lower_tight):null,vr?.assumptionsValid===false?"Допущения нарушены":"Уточнённая нижняя граница M6","lower_tight"],["Покрытие интервалом",method===6?vr?.posterior_mass:null,"По тестовому закону M6","posterior_mass"]].map(([label,value,note,k],i)=><ExperimentKpi key={label} label={label} value={format(k,value)} note={note} tone={i===3?"teal":"blue"}/>)}</div>
 {result?<section className="panel r27-study-summary"><header className="panel-header"><div><h2>Основные результаты исследования</h2><p>Сценарий, метод и исследовательская серия</p></div></header><div className="panel-body">
 <div className="r27-meta"><span>{records.length} калибровок</span><span>{VERSION}</span><span>{c.mode==="article"?"Первичные частоты NumPy":"Пользовательский Xorshift32"}</span><span>{fmt(elapsed/1000,2)} с</span></div>
 <div className="r27-buttons"><Choice label="Сценарий KPI" value={scenario} onChange={v=>setScenario(+v)} choices={SCENARIOS.map((v,i)=>[i+1,"S"+(i+1)+" — "+v])}/><Choice label="Метод KPI" value={method} onChange={v=>setMethod(+v)} choices={METHODS.map(m=>[m,"M"+m+" — "+NAMES[m]])}/><Choice label="Таблица результатов" value={shown} onChange={setShown} choices={Object.keys(tables).map(k=>[k,SERIES[k]||({paired:"Парные контрасты",monte_carlo:"Контроль Монте-Карло",certificate_checks:"Контроль сертификатов"})[k]||k])}/></div>
 {vr?.assumptionsValid===false?<p className="r27-note"><strong>Сертификат для тестового закона неприменим.</strong> S4/S7/S8 нарушают исходные предпосылки; значения границ номинальные.</p>:null}
 {vr?.assumptionsValid&&method===6?<p className="r27-note">Цель γ={fmt(c.target*100,2)}%: {vr.lower_tight>=c.target?"номинальная уточнённая граница достигает цели":"номинальная уточнённая граница ниже цели"}; показана средняя по калибровкам, не сертификат конкретной калибровки.</p>:null}
 </div></section>:null}
 <ExperimentPanel title="Сводная таблица результатов" subtitle={SERIES[shown]||shown} className="r27-summary-panel"><Table rows={rows} table={shown}/></ExperimentPanel>
 {result?<><ExperimentPanel title="Сравнение сценариев и методов" subtitle="Показатели из текущей серии; M10 — недоступный эксплуатационный эталон"><Choice label="Показатель" value={metric} onChange={setMetric} choices={["loss","coverage","miss","false"].map(k=>[k,LABEL[k]])}/><div className="r27-buttons">{METHODS.map(m=><label key={m}><input type="checkbox" checked={methods.includes(m)} onChange={e=>setMethods(a=>e.target.checked?[...a,m]:a.filter(x=>x!==m))}/> M{m}</label>)}</div>{comparison.length?<SeriesChart rows={comparison} metric={metric} methods={methods}/>:<p className="r27-note">Для сравнения сценариев запустите основную или сопоставимую серию.</p>}</ExperimentPanel>
 <div className="r27-analytics">
 {tables.validity?<><ExperimentPanel title="Автоматизация и нижние границы" subtitle="* нарушение предпосылок; номинальные оценки" className="r27-panel"><MultiChart rows={tables.validity} axis="scenario" fields={["coverage","lower","lower_tight"]}/></ExperimentPanel><ExperimentPanel title="Покрытие интервалом и нарушения риска" subtitle="Массы наблюдений; * стресс-сценарии" className="r27-panel"><MultiChart rows={tables.validity} axis="scenario" fields={["posterior_mass","risk_violation_mass"]}/></ExperimentPanel></>:null}
 {tables.cost?<><ExperimentPanel title="Автоматизация при изменении цены эскалации" className="r27-panel"><SeriesChart rows={tables.cost} metric="coverage" axis="cost" line critical={c.b*theta(c)}/></ExperimentPanel><ExperimentPanel title="Ожидаемые потери при изменении цены эскалации" className="r27-panel"><SeriesChart rows={tables.cost} metric="loss" axis="cost" line critical={c.b*theta(c)}/></ExperimentPanel></>:null}
 {tables.sensitivity?<><ExperimentPanel title="Влияние объёма калибровки на автоматизацию" className="r27-panel"><MultiChart rows={tables.sensitivity} axis="n" fields={["coverage","lower","lower_tight"]} line/></ExperimentPanel><ExperimentPanel title="Потери и ширина интервала" className="r27-panel"><MultiChart rows={tables.sensitivity} axis="n" fields={["loss","width"]} line/></ExperimentPanel></>:null}
 </div>
 {tables.paired?<ExperimentPanel title="Парные разности потерь" subtitle="Стьюдент, семейный уровень 1−α, поправка Бонферрони"><ResponsiveContainer width="100%" height={300}><BarChart data={tables.paired.map(r=>({...r,x:"S"+r.scenario+"/M"+r.baseline,err:r.lower==null?[0,0]:[r.difference-r.lower,r.upper-r.difference]}))}><CartesianGrid strokeDasharray="3 3"/><XAxis dataKey="x" tick={{fontSize:9}}/><YAxis/><Tooltip/><ReferenceLine y={0} stroke="#6e7786"/><Bar dataKey="difference" fill="#2164ba" isAnimationActive={false}><ErrorBar dataKey="err" direction="y" width={3}/></Bar></BarChart></ResponsiveContainer><Table rows={tables.paired} table="paired"/></ExperimentPanel>:null}
 <ExperimentPanel title="Паспорта ключевых показателей" subtitle="Определения, знаменатели, единицы измерения"><Table rows={passports.map(([indicator,formula,denominator])=>({indicator,formula,denominator}))}/><p className="r27-note">Встроенный контроль арифметических инвариантов пройден; это не независимая эксплуатационная валидация.</p></ExperimentPanel>
 <ExperimentPanel title="Интерпретация и экспорт" subtitle="Первичные калибровки и вычисленные результаты"><div className="r27-result-tools"><button type="button" onClick={()=>download("imas_e2_"+shown+".csv",csv(rows),"text/csv;charset=utf-8")}>Скачать CSV</button><button type="button" onClick={()=>download("imas_e2_"+c.seed+".json",JSON.stringify(payload()),"application/json")}>Скачать JSON</button><button type="button" onClick={()=>download("imas_e2_primary.json",JSON.stringify({version:VERSION,config:c,records:records.map(r=>({unit:r.unit,counts:r.counts,validation:r.validation})),fixtureHash:loaded?.hash}),"application/json")}>Скачать исходные калибровки</button>{c.mode==="article"&&loaded?<button type="button" onClick={()=>download("e2-fixtures.json",JSON.stringify(loaded.fixture),"application/json")}>Скачать эталонный набор</button>:null}</div><p className="r27-note">Синтетические данные. При равной автоматизации тестовый закон используется только для аналитического сравнения. Валидационная серия настраивается на независимой выборке. Контроль LP в режиме статьи использует решения независимого Python LP; в пользовательском режиме он не выполняется.</p></ExperimentPanel>
 </>:null}</ExperimentLayout>;
});

const E2_MODES=[["general","Общее"],["mc","Монте-Карло"],["sensitivity","Чувствительность"],["robustness","Устойчивость"],["optimization","Оптимизация"],["dynamics","Динамика"],["queue","СМО"],["data","Данные"]];
export const AutomaticDecisions=forwardRef(function AutomaticDecisions(props,ref){
 const [mode,setMode]=useState("general"),[mcExtended,setMcExtended]=useState(false),[busy,setBusy]=useState(false),actions=useRef(null);
 const onRuntime=React.useCallback(value=>{setBusy(Boolean(value.running));props.onRuntimeChange?.(value);},[props.onRuntimeChange]);
 useImperativeHandle(ref,()=>({start:()=>actions.current?.start(),stop:()=>actions.current?.stop(),reset:()=>actions.current?.reset(),newSeed:()=>actions.current?.newSeed()}),[]);
 const navigation=React.isValidElement(props.navigation)?React.cloneElement(props.navigation,{},React.Children.map(props.navigation.props.children,child=>{
  if(!React.isValidElement(child)||child.props.className!=="r27-mode-tabs")return child;
  return React.cloneElement(child,{},E2_MODES.map(([id,name])=><button type="button" key={id} className={"r27-mode-tab"+(id===mode?" active":"")} aria-pressed={id===mode} disabled={busy} title={name} onClick={()=>setMode(id)}>{name}</button>));
 })):props.navigation;
 return mode==="mc"?(mcExtended?<ExtendedStudyPanel key="mcExtended" {...props} mode="mcExtended" onSwitchMC={()=>setMcExtended(false)} navigation={navigation} onRuntimeChange={onRuntime} title={TITLE} author={AUTHOR} ref={actions}/>:<MonteCarloPanel {...props} onSwitchMC={()=>setMcExtended(true)} navigation={navigation} onRuntimeChange={onRuntime} title={TITLE} author={AUTHOR} ref={actions}/>):mode==="general"?<GeneralDecisions {...props} navigation={navigation} onRuntimeChange={onRuntime} ref={actions}/>:<ExtendedStudyPanel key={mode} {...props} mode={mode} navigation={navigation} onRuntimeChange={onRuntime} title={TITLE} author={AUTHOR} ref={actions}/>;
});
