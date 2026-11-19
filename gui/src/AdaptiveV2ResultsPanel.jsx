import React,{useState} from "react";
import {ExperimentPanel as Panel,ExperimentKpi as Kpi}
 from "./ExperimentLayout.jsx";
import {validateV2ImportedSummary,V2_RESULT_METHODS,
 v2FilteredResults,v2ResearchOverview} from "./adaptiveV2Results.js";

const fmt=(x,d=6)=>Number.isFinite(x)?x.toFixed(d):"—";
const stageLabels={smoke:"Технический прогон",train:"Поисковое исследование",
 holdout:"Новая независимая проверочная серия"};
const selection=(label,current,onChange,values)=><label>
 <span className="lyapunov-field-label">{label}</span>
 <select aria-label={label} value={current} onChange={e=>onChange(e.target.value)}>
  <option value="all">Все</option>
  {values.map(x=><option key={x} value={String(x)}>{x}</option>)}
 </select>
</label>;
export default function AdaptiveV2ResultsPanel(){
 const [summary,setSummary]=useState(null),[error,setError]=useState("");
 const [filename,setFilename]=useState("");
 const [mode,setMode]=useState("regime_aware_v2_discrete");
 const [strategy,setStrategy]=useState("all"),[law,setLaw]=useState("all");
 const [evidence,setEvidence]=useState("all"),[f,setF]=useState("all");
 async function importFile(event){
  const file=event.target.files?.[0];if(!file)return;
  setSummary(null);setError("");setFilename("");
  try{
   if(file.size>20_000_000)throw Error("Файл больше 20 МБ");
   const data=validateV2ImportedSummary(JSON.parse(await file.text()));
   setSummary(data);setFilename(file.name);
   setStrategy("all");setLaw("all");setEvidence("all");setF("all");
  }catch(err){setError(err.message||String(err));}
  finally{event.target.value="";}
 }
 const selected=V2_RESULT_METHODS.find(x=>x.value===mode);
 const filters={strategy,law,evidence,f};
 const data=summary?v2FilteredResults(summary,filters):[];
 const stat=summary?v2ResearchOverview(summary,mode,filters):null;
 const field=selected?.prefix??"v2Discrete";
 return <Panel title="Исследование режима v2: сравнительные эффекты и границы применимости"
  subtitle="Импорт только научного архива. Данные синтетические; выбор варианта в этой панели не меняет настроек оценки в эксперименте.">
  <div className="adaptive-fkl-inputs">
   <label><span className="lyapunov-field-label">Сводный JSON из GitHub Actions v2</span>
    <input type="file" accept=".json,application/json" onChange={importFile}
     aria-label="Загрузить исследование v2 JSON"/></label>
   <label><span className="lyapunov-field-label">Сравниваемый алгоритм</span>
    <select value={mode} onChange={e=>setMode(e.target.value)}
     aria-label="Алгоритм сравнения v2">
     {V2_RESULT_METHODS.map(m=><option key={m.value} value={m.value}>{m.label}</option>)}
    </select></label>
  </div>
  {error?<p className="imas-validation-error" role="alert">{error}</p>:null}
  {!summary?<p className="r27-note">Для просмотра загрузите из GitHub Actions файл <code>train-summary.json</code>, <code>holdout-summary.json</code> или <code>smoke-summary.json</code>. Система проверит состав, порядок и показатели ячеек относительно зафиксированного плана. Метаданные SHA сами по себе не аутентифицируют источник.</p>:<>
   <p className="r27-note" role="status">{stageLabels[summary.stage]} · {summary.cells} ячеек · {summary.wholeRunPairs} парных реализаций · {summary.modelExecutions} вычислений · {filename}</p>
   <div className="adaptive-fkl-inputs">
    {selection("Стратегия поведения",strategy,setStrategy,[...new Set(summary.conditions.map(x=>x.strategy))])}
    {selection("Закон интенсивности",law,setLaw,[...new Set(summary.conditions.map(x=>x.law))])}
    {selection("Модель свидетельств",evidence,setEvidence,[...new Set(summary.conditions.map(x=>x.evidence))])}
    {selection("Нарушители f",f,setF,[...new Set(summary.conditions.map(x=>x.f))])}
   </div>
   <div className="kpi-grid">
    <Kpi label="Средняя ΔRMSE" value={fmt(stat.meanDelta)}
     note="По показанным фиксированным ячейкам: метод − исходный combined E1"/>
    <Kpi label="Улучшения / ухудшения" value={stat.better+" / "+stat.worse}
     note={"Равенств "+stat.ties+"; из "+stat.cells+" ячеек"}/>
    <Kpi label="Среднее число смен" value={fmt(stat.meanSwitches,3)}
     note="По ячейкам, с нулевыми случаями в знаменателе"/>
    <Kpi label="Хеш исходников" value={summary.sourceHash.slice(0,12)}
     note="Идентификатор версии, не криптографическая подпись файла"/>
   </div>
   <div className="table-wrap"><table aria-label="Эффекты моделей v2 по факторам">
    <thead><tr><th>Поведение</th><th>Закон</th><th>Расписание</th>
     <th>Свидетельства</th><th>f</th><th>R</th><th>Атакующих тактов</th>
     <th>RMSE E1</th><th>ΔRMSE</th><th>Bootstrap 95%</th>
     <th>Смены</th><th>Δ безусловной потери</th></tr></thead>
    <tbody>{data.map(c=><tr key={c.id}>
     <td>{c.strategy}</td><td>{c.law}</td><td>{c.schedule}</td>
     <td>{c.evidence}</td><td>{c.f}</td><td>{c.runs}</td>
     <td>{fmt(c.activeTicks,1)}</td><td>{fmt(c.controlRmse)}</td>
     <td>{fmt(c[field+"Delta"])}</td>
     <td>{fmt(c[field+"CiLow"])} … {fmt(c[field+"CiHigh"])}</td>
     <td>{fmt(c[field+"Switches"],2)}</td>
     <td>{fmt(c[field+"LossDelta"])}</td>
    </tr>)}</tbody>
   </table></div>
   {summary.stage==="holdout"?<p className="r27-note">В архиве независимого исследования sign-flip и Holm вычислены для 12 предварительно фиксированных контрастов дискретной v2 к E1. Sign-flip требует обменности знаков под нулевой гипотезой; эта предпосылка должна проверяться отдельно.</p>:null}
   <p className="r27-note">Значения ΔRMSE отрицательны при улучшении. Интервалы bootstrap описательные, не скорректированы за множественные поисковые сравнения и не оценивают неопределённость реальной модели угроз. Отсутствие смены оценивателя не означает успешной адаптации. Безусловная потеря учитывает предварительно объявленную цену отказа.</p>
  </>}
 </Panel>;
}
