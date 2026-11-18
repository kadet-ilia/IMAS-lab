import React,{useState} from "react";
import {ExperimentPanel as Panel,ExperimentKpi as Kpi} from "./ExperimentLayout.jsx";
import {E1A_FKL_F,E1A_FKL_K,E1A_FKL_LAG} from "./adaptiveFklProtocol.js";
import {E1A_FKL_FIELD_OPTIONS,validateImportedFklSummary,
 fklEffectAt,fklModeOverview} from "./adaptiveFklResults.js";

const format=(value,digits=5)=>Number.isFinite(value)?value.toFixed(digits):"—";
const effectClass=value=>value<0?"adaptive-fkl-better":value>0?"adaptive-fkl-worse":"adaptive-fkl-equal";
const symbol=value=>value<0?"↓":value>0?"↑":"=";

export default function AdaptiveFklResultsPanel(){
 const [summary,setSummary]=useState(null);
 const [error,setError]=useState("");
 const [filename,setFilename]=useState("");
 const [lag,setLag]=useState(0);
 const [mode,setMode]=useState("discrete");
 async function open(event){
  const file=event.target.files?.[0];
  if(!file)return;
  setSummary(null);setFilename("");setError("");
  try{
   if(file.size>15_000_000)throw Error("Файл превышает допустимый объём 15 МБ");
   const record=validateImportedFklSummary(JSON.parse(await file.text()));
   setSummary(record);setFilename(file.name);
   setLag(record.conditions[0]?.lag??0);
  }catch(reason){setError(reason.message||String(reason));}
  finally{event.target.value="";}
 }
 const overview=summary?fklModeOverview(summary,mode):null;
 const cells=summary?.conditions.filter(x=>x.lag===lag)??[];
 const lagRows=summary&&Array.isArray(summary.lagContrasts)?
  summary.lagContrasts.filter(x=>x.to===lag):[];
 const stageLabels={smoke:"Предварительная проверка",exploratory:"Поисковая серия",confirmatory:"Предварительно зафиксированная проверочная серия"};
 return <Panel title="Факторная чувствительность f × k × L"
  subtitle="Исследовательский анализ численных результатов по первичным данным: загрузка summary.json из GitHub Actions; не связан с текущим одиночным прогоном.">
  <div className="adaptive-fkl-inputs">
   <label className="adaptive-fkl-upload">
    <span className="lyapunov-field-label">Загрузить сводку факторной серии (JSON)</span>
    <input type="file" accept=".json,application/json" onChange={open}
     aria-label="Загрузить факторный архив JSON"/>
   </label>
   <label>
    <span className="lyapunov-field-label">Сравниваемый алгоритм</span>
    <select value={mode} onChange={e=>setMode(e.target.value)} aria-label="Сравниваемый алгоритм факторного исследования">
     {E1A_FKL_FIELD_OPTIONS.map(x=><option key={x.id} value={x.id}>{x.label}</option>)}
    </select>
   </label>
   <label>
    <span className="lyapunov-field-label">Запаздывание свидетельств L, тактов</span>
    <select value={lag} onChange={e=>setLag(Number(e.target.value))} aria-label="Задержка свидетельств для карты">
     {E1A_FKL_LAG.map(x=><option key={x} value={x}>{x}</option>)}
    </select>
   </label>
  </div>
  {error?<p className="imas-validation-error" role="alert">{error}</p>:null}
  {!summary?<p className="r27-note">Ожидается файл <code>exploratory-summary.json</code>, <code>confirmatory-summary.json</code> или <code>smoke-summary.json</code> из полного научного архива. Данные не загружаются автоматически с GitHub; расчёт в текущей вкладке не запускается.</p>:<>
   <p className="r27-note" role="status">{stageLabels[summary.stage]} · {summary.cells} конфигураций · {summary.cellRuns} прогонов по ячейкам · {summary.individualPolicyRuns} расчётов оценивателей · файл {filename}.</p>
   <div className="kpi-grid">
    <Kpi label="Средний ΔRMSE по ячейкам" value={format(overview.meanCellWeightedDelta,6)} note="Выбранный метод − комбинированное E1; меньше — лучше"/>
    <Kpi label="Ячеек с уменьшением ошибки" value={overview.better+" / "+overview.count} note="По среднему RMSE полных независимых прогонов"/>
    <Kpi label="Ячеек с увеличением ошибки" value={overview.worse+" / "+overview.count} note="Ухудшения не исключаются из отчёта"/>
    <Kpi label="Программный отпечаток" value={summary.sourceSha256.slice(0,12)} note="Идентификатор по утверждению загруженного файла"/>
   </div>
   <p className="r27-note">Эффект — средняя по прогонам разность RMSE относительно исторического комбинированного E1, а не улучшение абсолютного RMSE при изменении числа нарушителей. Знак минус означает меньшую ошибку. Разные ячейки с одинаковыми f и индексом прогона используют общие ключи случайности и статистически зависимы.</p>
   <div className="table-wrap">
    <table className="adaptive-fkl-map" aria-label="Тепловая карта чувствительности по числу нарушителей и усечению">
     <thead><tr><th>Нарушители f / усечение k</th>{E1A_FKL_K.map(k=><th key={k}>k = {k}</th>)}</tr></thead>
     <tbody>{E1A_FKL_F.map(f=><tr key={f}><th scope="row">f = {f}</th>
      {E1A_FKL_K.map(k=>{
       const effect=fklEffectAt(summary,f,k,lag,mode);
       return <td key={k} className={effect?"adaptive-fkl-cell "+effectClass(effect.value):"adaptive-fkl-cell"}
        title={effect?"f="+f+", k="+k+", L="+lag+": ΔRMSE="+format(effect.value,7)+", R="+effect.cell.R:"Сценарий не включён в выбранную серию"}>
        {effect?<><span aria-hidden="true">{symbol(effect.value)} </span>{format(effect.value,5)}</>:"—"}
       </td>;
      })}
     </tr>)}</tbody>
    </table>
   </div>
   {cells.length?<div className="table-wrap">
    <table aria-label="Условия и величины ошибки по выбранному запаздыванию">
     <thead><tr><th>f</th><th>k</th><th>R</th><th>RMSE E1</th><th>ΔRMSE</th><th>95%-й bootstrap-интервал</th></tr></thead>
     <tbody>{cells.map(x=>{
      const part=mode==="adaptive"?"Adaptive":mode==="risk"?"Risk":mode==="blend"?"Blend":"Discrete";
      return <tr key={x.id}><td>{x.f}</td><td>{x.k}</td><td>{x.R}</td>
       <td>{format(x.meanCombinedRmse)}</td>
       <td>{format(x["meanDelta"+part+"Combined"])}</td>
       <td>{format(x["ci"+part+"Low"])} … {format(x["ci"+part+"High"])}</td>
      </tr>;
     })}</tbody>
    </table>
   </div>:<p className="r27-note">Для выбранной задержки нет конфигураций.</p>}
   {lag>0&&lagRows.length?<p className="r27-note">Для этого L доступны парные факторные контрасты относительно L=0 при фиксированных f, k и индексе случайной реализации; смотрите полный JSON для чисел и интервалов. Они рассчитаны для дискретного режима и контрольного E1.</p>:null}
   <p className="r27-note">Загруженные локальные данные не имеют проверяемой браузером электронной подписи; SHA-256 в файле является метаданными, а не подтверждением его происхождения. Интервалы условны для синтетических фиксированных сценариев и не скорректированы на множественность. Для научного вывода сверяйте оригинальный архив, версию кода и протокол экспериментальной серии.</p>
  </>}
 </Panel>;
}
