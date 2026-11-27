import React,{useState} from "react";
import {ExperimentPanel} from "../ExperimentLayout.jsx";
import {analyzeBatch} from "./patternAnalysis.js";
import {batchPlan} from "./batchStudy.js";
const fmt=v=>v===null||v===undefined?"—":typeof v==="number"?v.toLocaleString("ru-RU",{maximumFractionDigits:6}):String(v);
const condition=r=>r.conditions.length?r.conditions.map(c=>c.factor+" "+(c.side==="low"?"≤":">")+" "+fmt(c.cut)).join(" ∧ "):"Вся область";
function save(r){const u=URL.createObjectURL(new Blob([JSON.stringify(r,null,2)],{type:"application/json"})),a=document.createElement("a");a.href=u;a.download="imas_e2_patterns.json";a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);}
export default function PatternPanel({records,config,complete}){
 const policies=[...new Set(records.flatMap(r=>r.summary.map(v=>v.policy)))],metrics=["loss","coverage","miss","false","failed","upperRisk","tight"].filter(k=>records.some(r=>r.summary.some(v=>Number.isFinite(v[k]))));
 const [metric,setMetric]=useState("loss"),[candidate,setCandidate]=useState(""),[baseline,setBaseline]=useState(""),[threshold,setThreshold]=useState("0.8"),[margin,setMargin]=useState("0"),[minN,setMinN]=useState("12"),[target,setTarget]=useState("0.75"),[seed,setSeed]=useState("20261127"),[report,setReport]=useState(null),[error,setError]=useState("");
 const cand=candidate||policies.at(-1)||"",base=baseline|| (policies.length>1?policies[0]:"__threshold");
 function run(){try{
  if(!complete)throw Error("Завершите серию");
  if(![threshold,margin,minN,target,seed].every(v=>v.trim()!==""&&Number.isFinite(Number(v)))||!Number.isInteger(+seed)||+seed<1||+seed>4294967295)throw Error("Проверьте числовые параметры");
  const direction=["coverage","tight"].includes(metric)?"higher":"lower";
  setReport(analyzeBatch(records,batchPlan(config),[config.factor,config.factor2],{metric,candidate:cand,baseline:base==="__threshold"?null:base,threshold:+threshold,direction,margin:+margin,minN:+minN,target:+target,seed:+seed,maxRules:5}));setError("");
 }catch(e){setReport(null);setError(e.message||String(e));}}
 const change=(setter,v)=>{setter(v);setReport(null);setError("");};
 return <ExperimentPanel title="Выявление закономерностей и контрпримеров" subtitle="Поиск правил на одной половине конфигураций, оценка фиксированных правил на другой">
 <p className="r27-note">Единица анализа — конфигурация, не повтор. Положительный эффект означает улучшение. Для уже рассчитанной серии проверка описательная, без p-значений. Подбор настроек после просмотра результатов не является независимой проверкой.</p>
 <div className="r27-result-tools"><label>Показатель <select aria-label="Показатель закономерности" value={metric} onChange={e=>change(setMetric,e.target.value)}>{metrics.map(k=><option key={k} value={k}>{({loss:"Потери",coverage:"Автоматизация",miss:"Пропуск",false:"Ложная реакция",failed:"Отказы",upperRisk:"Верхняя граница риска",tight:"Нижняя граница автоматизации"})[k]}</option>)}</select></label>
 <label>Исследуемая политика <select aria-label="Исследуемая политика" value={cand} onChange={e=>change(setCandidate,e.target.value)}>{policies.map(k=><option key={k}>{k}</option>)}</select></label>
 <label>Базовая политика <select aria-label="Базовая политика" value={base} onChange={e=>change(setBaseline,e.target.value)}><option value="__threshold">Заданный уровень метрики</option>{policies.map(k=><option key={k}>{k}</option>)}</select></label></div>
 <div className="r27-result-tools">{base==="__threshold"?<label>Уровень <input aria-label="Уровень метрики" type="number" step=".01" value={threshold} onChange={e=>change(setThreshold,e.target.value)}/></label>:null}
 <label>Минимальный эффект <input aria-label="Минимальный эффект" type="number" min="0" step=".01" value={margin} onChange={e=>change(setMargin,e.target.value)}/></label><label>Минимум конфигураций <input aria-label="Минимум конфигураций в правиле" type="number" min="2" step="1" value={minN} onChange={e=>change(setMinN,e.target.value)}/></label><label>Целевая доля успехов <input aria-label="Целевая доля успехов" type="number" min=".51" max=".99" step=".01" value={target} onChange={e=>change(setTarget,e.target.value)}/></label><label>Зерно разбиения <input aria-label="Зерно разбиения" type="number" min="1" value={seed} onChange={e=>change(setSeed,e.target.value)}/></label></div>
 <div className="r27-result-tools"><button type="button" disabled={!complete||!policies.length} onClick={run}>Выявить закономерности</button>{report?<button type="button" onClick={()=>save(report)}>Скачать анализ JSON</button>:null}</div>
 {error?<p role="alert">{error}</p>:null}
 {report?<><p>Поиск: {report.discoveryN}; проверка: {report.confirmationN}; рассмотрено правил: {report.examined}; отобрано: {report.rules.length}.</p><div className="r27-table-scroll"><table className="r27-table"><thead><tr>{["Правило","Поиск N","Средний эффект","Доля успехов","Проверка N","Средний эффект","Доля успехов","Исключений","Статус"].map((k,i)=><th key={i}>{k}</th>)}</tr></thead><tbody>{report.rules.map(r=><tr key={r.id}>{[condition(r),r.discovery.n,r.discovery.mean,r.discovery.fraction,r.confirmation.n,r.confirmation.mean,r.confirmation.fraction,r.exceptions.length,({insufficient:"Недостаточно данных",descriptive_support:"Описательно воспроизведено",not_reproduced:"Не воспроизведено"})[r.status]].map((v,i)=><td key={i}>{fmt(v)}</td>)}</tr>)}</tbody></table></div>
 <h4>Контрпримеры и случаи ниже минимального эффекта</h4><div className="r27-table-scroll"><table className="r27-table"><thead><tr>{["Правило","Конфигурация",...report.axes,"Эффект","Тип"].map(k=><th key={k}>{k}</th>)}</tr></thead><tbody>{report.rules.flatMap(r=>r.exceptions).slice(0,200).map((v,i)=><tr key={i}>{[v.rule,v.case,...report.axes.map(k=>v[k]),v.gain,({opposite:"Обратный эффект",tie:"Нулевой эффект",below_margin:"Ниже порога"})[v.kind]].map((x,j)=><td key={j}>{fmt(x)}</td>)}</tr>)}</tbody></table></div><p className="r27-note">До 200 строк на экране. Полный протокол, разбиение, условия и зерна — в экспорте анализа. {report.warning}</p></>:null}
 </ExperimentPanel>;
}
