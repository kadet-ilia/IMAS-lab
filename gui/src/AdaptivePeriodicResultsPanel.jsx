import React,{useState} from "react";
import {ExperimentPanel as Panel,ExperimentKpi as Kpi}
 from "./ExperimentLayout.jsx";
import {PERIODIC_RESULT_MODES,validateImportedPeriodicSummary,
 periodicModeOverview,periodicFilteredConditions} from "./adaptivePeriodicResults.js";

const fmt=(n,d=5)=>Number.isFinite(n)?n.toFixed(d):"—";
const label={pulsed:"Периодическое поведение",coordinated:"Согласованное смещение"};
const stages={smoke:"Техническая проверка",exploratory:"Поисковая серия",
 confirmatory:"Заранее зафиксированная проверочная серия"};
const select=(name,value,change,choices)=><label key={name}>
 <span className="lyapunov-field-label">{name}</span>
 <select value={value} onChange={e=>change(e.target.value)}
  aria-label={name}>
  {choices.map(item=><option key={item.value} value={item.value}>{item.label}</option>)}
 </select></label>;
const choices=values=>[{value:"all",label:"Все"},...values.map(v=>({
 value:String(v),label:String(v)}))];
const effectClass=n=>n<0?"adaptive-fkl-better":n>0?"adaptive-fkl-worse":"adaptive-fkl-equal";

export default function AdaptivePeriodicResultsPanel(){
 const [summary,setSummary]=useState(null),[error,setError]=useState("");
 const [filename,setFilename]=useState("");
 const [mode,setMode]=useState("discrete");
 const [strategy,setStrategy]=useState("all"),[law,setLaw]=useState("all");
 const [schedule,setSchedule]=useState("all");
 const [correlation,setCorrelation]=useState("all"),[f,setF]=useState("all");
 async function load(event){
  const file=event.target.files?.[0];
  if(!file)return;
  setSummary(null);setError("");setFilename("");
  try{
   if(file.size>18_000_000)throw Error("Файл превышает 18 МБ");
   const record=validateImportedPeriodicSummary(JSON.parse(await file.text()));
   setSummary(record);setFilename(file.name);
   setStrategy("all");setLaw("all");setSchedule("all");
   setCorrelation("all");setF("all");
  }catch(e){setError(e.message||String(e));}
  finally{event.target.value="";}
 }
 const overview=summary?periodicModeOverview(summary,mode):null;
 const shown=summary?periodicFilteredConditions(summary,{
  strategy,law,schedule,correlation,f}):[];
 const field=PERIODIC_RESULT_MODES.find(x=>x.id===mode)?.field;
 const suffix=mode==="risk"?"Risk":mode==="adaptive"?"Adaptive":"Discrete";
 const meanShown=shown.length?shown.reduce((v,x)=>v+x[field],0)/shown.length:null;
 return <Panel title="Периодическое поведение и корреляция свидетельств — М5-Б"
  subtitle="Только чтение зафиксированных синтетических данных; стратегия pulsed и закон интенсивности pulsed — самостоятельные экспериментальные факторы.">
  <div className="adaptive-fkl-inputs">
   <label className="adaptive-fkl-upload">
    <span className="lyapunov-field-label">Архивная сводка М5-Б (JSON)</span>
    <input type="file" accept=".json,application/json" onChange={load}
     aria-label="Загрузить архив М5-Б JSON"/>
   </label>
   <label><span className="lyapunov-field-label">Сравниваемый метод</span>
    <select value={mode} onChange={e=>setMode(e.target.value)}
     aria-label="Метод периодического факторного исследования">
     {PERIODIC_RESULT_MODES.map(m=><option key={m.id} value={m.id}>{m.label}</option>)}
    </select></label>
  </div>
  {error?<p role="alert" className="imas-validation-error">{error}</p>:null}
  {!summary?<p className="r27-note">Загрузите <code>exploratory-summary.json</code>, <code>confirmatory-summary.json</code> или <code>smoke-summary.json</code> из архива GitHub Actions для исследования М5-Б. Раздел не запускает вычисления и не подключается автоматически к GitHub.</p>:<>
   <p className="r27-note" role="status">{stages[summary.stage]} · {summary.conditionsCount} ячеек · {summary.cellRuns} полных ячейко-прогонов · {summary.individualSimulations} запусков модели · {filename}</p>
   <div className="kpi-grid">
    <Kpi label="Среднее ΔRMSE" value={fmt(overview.meanDelta,6)} note="По полному фиксированному плану: метод − комбинированный E1"/>
    <Kpi label="Ячейки с улучшением" value={overview.better+" / "+overview.count} note="Средняя парная разность RMSE отрицательна"/>
    <Kpi label="Ячейки с ухудшением" value={overview.worse+" / "+overview.count} note="Ухудшения не исключаются из анализа"/>
    <Kpi label="Отпечаток программы" value={summary.sourceSha256.slice(0,12)} note="Метаданные файла, не криптографическая подпись"/>
   </div>
   <div className="adaptive-fkl-inputs">
    {select("Поведение",strategy,setStrategy,[
     {value:"all",label:"Все"},...["coordinated","pulsed"].map(v=>({value:v,label:label[v]}))])}
    {select("Закон интенсивности",law,setLaw,choices([...new Set(summary.conditions.map(x=>x.law))]))}
    {select("Расписание",schedule,setSchedule,choices([...new Set(summary.conditions.map(x=>x.schedule))]))}
    {select("Корреляция свидетельств",correlation,setCorrelation,choices([...new Set(summary.conditions.map(x=>x.correlation))]))}
    {select("Нарушителей f",f,setF,choices([...new Set(summary.conditions.map(x=>x.f))]))}
   </div>
   <p className="r27-note">Фильтр: {shown.length} конфигураций · средняя ΔRMSE = {fmt(meanShown,6)}. Для согласованного поведения период P и duty неприменимы; ячейки с разными P/duty в этой группе не создаются. Изменение среднего при фильтрации не доказывает причинную зависимость.</p>
   <div className="table-wrap">
    <table aria-label="Исследованные параметры периодических кибервоздействий">
     <thead><tr><th>Стратегия</th><th>Закон</th><th>Фазы</th><th>f</th><th>Корр.</th>
      <th>P</th><th>Duty</th><th>R</th><th>RMSE E1</th><th>ΔRMSE</th>
      <th>95% bootstrap</th></tr></thead>
     <tbody>{shown.map(x=><tr key={x.id}>
      <td>{label[x.strategy]}</td><td>{x.law}</td><td>{x.schedule}</td>
      <td>{x.f}</td><td>{fmt(x.correlation,2)}</td>
      <td>{x.period??"—"}</td><td>{x.dutyFraction===null?"—":(100*x.dutyFraction)+"%"}</td>
      <td>{x.runs}</td><td>{fmt(x.combinedRmse)}</td>
      <td className={effectClass(x[field])}>{fmt(x[field],6)}</td>
      <td>{fmt(x["ci"+suffix+"Low"],6)} … {fmt(x["ci"+suffix+"High"],6)}</td>
     </tr>)}</tbody>
    </table>
   </div>
   <p className="r27-note">Разности рассчитаны относительно неизменённого комбинированного E1. Bootstrap-интервалы описательные и не скорректированы на множественные сравнения. Загруженный JSON не имеет проверяемой браузером подписи; сверяйте SHA и источник с оригинальным артефактом GitHub Actions. Данные синтетические и не доказывают киберустойчивость всей ИМАС.</p>
  </>}
 </Panel>;
}
