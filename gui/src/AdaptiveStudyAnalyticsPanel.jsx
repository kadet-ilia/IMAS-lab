import React,{useMemo,useState} from "react";
import {CartesianGrid,ReferenceLine,ResponsiveContainer,Scatter,ScatterChart,
 Tooltip,XAxis,YAxis} from "recharts";
import {ExperimentPanel as Panel,ExperimentKpi as Kpi}
 from "./ExperimentLayout.jsx";
import {
 adaptiveRunComparisonRows,adaptivePhaseComparison,adaptivePhaseRows,
 adaptivePolicyEventRows,summarizeAdaptiveComparison,adaptiveRecordsCsv,
 adaptiveReproductionManifest,
 ADAPTIVE_RUN_EXPORT_FIELDS,ADAPTIVE_PHASE_EXPORT_FIELDS,
 ADAPTIVE_EVENT_EXPORT_FIELDS
} from "./adaptiveStudyDiagnostics.js";

const fmt=(x,d=6)=>Number.isFinite(x)?x.toFixed(d):"—";
function download(name,content,type="text/csv;charset=utf-8"){
 const url=URL.createObjectURL(new Blob([content],{type}));
 const link=document.createElement("a");link.href=url;link.download=name;
 link.click();URL.revokeObjectURL(url);
}
export default function AdaptiveStudyAnalyticsPanel({study}){
 const [baseline,setBaseline]=useState("proposed_robust");
 const [metric,setMetric]=useState("rmse");
 const derived=useMemo(()=>{
  try{
   const rows=adaptiveRunComparisonRows(study,baseline);
   const compare=summarizeAdaptiveComparison(rows,metric);
   const phases=adaptivePhaseComparison(study,baseline);
   return {rows,compare,phases,error:null};
  }catch(error){return {error:error.message||String(error)};}
 },[study,baseline,metric]);
 if(derived.error)return <Panel title="Анализ парных ошибок и фаз">
  <p className="imas-validation-error" role="alert">{derived.error}</p>
 </Panel>;
 const {rows,compare,phases}=derived;
 const key=metric==="rmse"?"deltaRmse":"deltaLoss";
 const points=rows.filter(x=>Number.isFinite(x[key]))
  .map(row=>({run:row.run+1,delta:row[key]}));
 const control=baseline==="proposed_robust"?
  "Комбинированное E1":"Обычное усечение E1";
 const exportRows=()=>download("imas-e1a-paired-runs-"+baseline+".csv",
  adaptiveRecordsCsv(rows,ADAPTIVE_RUN_EXPORT_FIELDS));
 const exportPhases=()=>download("imas-e1a-phase-metrics.csv",
  adaptiveRecordsCsv(adaptivePhaseRows(study),ADAPTIVE_PHASE_EXPORT_FIELDS));
 const exportEvents=()=>download("imas-e1a-all-run-policy-events.csv",
  adaptiveRecordsCsv(adaptivePolicyEventRows(study),ADAPTIVE_EVENT_EXPORT_FIELDS));
 const exportManifest=()=>download("imas-e1a-reproduction-manifest.json",
  JSON.stringify(adaptiveReproductionManifest(study,rows),null,2),
  "application/json;charset=utf-8");
 return <Panel title="Сравнительный анализ полных прогонов и фаз"
  subtitle="Парные показатели по полным независимым прогонам; такты внутри прогона не считаются отдельными репликациями.">
  <div className="adaptive-fkl-inputs">
   <label><span className="lyapunov-field-label">Контрольный оцениватель</span>
    <select value={baseline} onChange={e=>setBaseline(e.target.value)}
     aria-label="Контрольный алгоритм парного сравнения">
     <option value="proposed_robust">Комбинированное E1 — основной</option>
     <option value="trimmed_unweighted">Усечённое E1 — дополнительный</option>
    </select></label>
   <label><span className="lyapunov-field-label">Показатель разности</span>
    <select value={metric} onChange={e=>setMetric(e.target.value)}
     aria-label="Показатель парного сравнения">
     <option value="rmse">RMSE по принятым решениям</option>
     <option value="unconditional_decision_loss">Безусловная потеря со штрафом отказа</option>
    </select></label>
  </div>
  <div className="kpi-grid">
   <Kpi label="Средняя парная разность" value={fmt(compare.meanDelta)}
    note={"E1-А − "+control+"; отрицательное значение лучше"}/>
   <Kpi label="95%-й интервал" value={fmt(compare.ci95Low,5)+" … "+fmt(compare.ci95High,5)}
    note="Нормальная аппроксимация; условная, без поправки на множественность"/>
   <Kpi label="Улучшения / ухудшения" value={compare.wins+" / "+compare.losses}
    note={"Равенств "+compare.ties+"; пар "+compare.nPaired+" из "+compare.nRuns}/>
   <Kpi label="Прогоны без активной атаки" value={compare.zeroAttackRuns}
    note="Нулевая фактическая интенсивность, но возможны ошибки фонового процесса"/>
  </div>
  <p className="r27-note">{compare.warning}. Выбор контрольного метода и метрики изменяет только постфактум-аналитику, а не результаты моделирования. Если решения отсутствуют, RMSE не подменяется нулём; для этого случая предусмотрена безусловная потеря.</p>
  {points.length?<ResponsiveContainer width="100%" height={250}>
   <ScatterChart margin={{top:12,right:22,bottom:12,left:12}}>
    <CartesianGrid stroke="#e6eaef" strokeDasharray="3 3"/>
    <XAxis type="number" dataKey="run" name="Прогон" domain={[1,Math.max(2,rows.length)]}
     allowDecimals={false}/>
    <YAxis type="number" dataKey="delta" name="Парная разность"
     tickFormatter={x=>fmt(x,3)} width={75}/>
    <ReferenceLine y={0} stroke="#64748b" strokeDasharray="4 4"/>
    <Tooltip cursor={{strokeDasharray:"3 3"}} formatter={x=>fmt(x,7)}/>
    <Scatter name="Δ по прогону" data={points} fill="#c13f62"/>
   </ScatterChart>
  </ResponsiveContainer>:<p className="r27-note">Не определено ни одной парной разности для выбранной условной метрики.</p>}
  <div className="table-wrap"><table aria-label="Фазовые парные показатели по целым прогонам">
   <thead><tr><th>Фаза</th><th>Прогонов с фазой</th>
    <th>Пар с определённым RMSE</th><th>ΔRMSE</th>
    <th>95%-й интервал ΔRMSE</th><th>Δ безусловной потери</th></tr></thead>
   <tbody>{phases.map(p=><tr key={p.phase}>
    <td>{p.phase==="attack_active"?"Активная атака":"Без активной атаки"}</td>
    <td>{p.nRunsWithPhase}</td><td>{p.nPairedRmse}</td>
    <td>{fmt(p.meanDeltaRmse)}</td>
    <td>{fmt(p.ci95Low,5)} … {fmt(p.ci95High,5)}</td>
    <td>{fmt(p.meanDeltaLoss)}</td>
   </tr>)}</tbody>
  </table></div>
  <p className="r27-note">Раздельные фазовые RMSE — средние парных разностей, рассчитанных внутри каждого полного прогона, а не ошибка по объединённым тактам. Фаза без активной атаки может включать окно, в котором поведенческий цикл подавил номинальное воздействие. Для режимов с обратной связью прогонные контуры различных методов могут иметь разные репутации и потоки наблюдений.</p>
  <div className="table-wrap"><table aria-label="Показатели отдельных прогонов">
   <thead><tr><th>Прогон</th><th>Активных тактов</th><th>Подавлено</th>
    <th>ΔRMSE</th><th>Δ потери</th><th>Покрытие Е1-А</th><th>Переключений</th></tr></thead>
   <tbody>{rows.slice(0,40).map(x=><tr key={x.run}>
    <td>{x.run+1}</td><td>{x.activeSteps}</td><td>{x.suppressedSteps}</td>
    <td>{fmt(x.deltaRmse)}</td><td>{fmt(x.deltaLoss)}</td>
    <td>{fmt(x.coverageAdaptive,3)}</td><td>{x.switches??"—"}</td>
   </tr>)}</tbody>
  </table></div>
  {rows.length>40?<p className="r27-note">Показаны первые 40 прогонов; полный набор доступен в CSV.</p>:null}
  <div className="action-controls">
   <button type="button" className="secondary-button" onClick={exportRows}>Парные прогоны CSV</button>
   <button type="button" className="secondary-button" onClick={exportPhases}>Фазовые метрики CSV</button>
   <button type="button" className="secondary-button" onClick={exportEvents}>Все такты диагностики CSV</button>
   <button type="button" className="secondary-button" onClick={exportManifest}>Паспорт воспроизводимости JSON</button>
  </div>
  <p className="r27-note">Паспорт сохраняет конфигурацию, версии моделей, режим сравнения и идентификаторы прогонов, но не удостоверяет происхождение исходного программного кода. Данные являются синтетическими; малые интервалы Монте-Карло не означают доказанной практической киберустойчивости.</p>
 </Panel>;
}
