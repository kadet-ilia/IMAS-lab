import React from "react";
import {CartesianGrid,Legend,Line,LineChart,ResponsiveContainer,Tooltip,XAxis,YAxis} from "recharts";
import {ARTICLE_PRESETS,ARTICLE_MODEL_VERSION,validateArticleConfig} from "./articleEngine.js";
import {verifyArticleClaims} from "./articleClaims.js";

const TITLES={arithmetic_mean:"Обычное среднее",trust_mean:"Среднее с доверительным допуском",trimmed_mean:"Усечённое среднее",trust_trimmed_mean:"Доверительно-усечённое"};
const SCENARIOS={collusion:"Согласованное смещение и рекомендации",trust:"Манипулирование репутацией",subtle:"Малозаметное искажение",mask:"Маскировка",on_off:"Чередование воздействия"};
const N=x=>Number.isFinite(x)?x.toLocaleString("ru-RU",{maximumFractionDigits:4}):"—";
const SETS=[
 ["n_agents","N — число агентов",3,160,1],["n_byzantine","f — число нарушителей",0,159,1],
 ["decision_dim","d — размерность решения",1,32,1],["n_steps","Число тактов T",1,500,1],
 ["n_runs","Число прогонов R",1,10000,1],["attack_start_step","Начало атаки tₐ (с нуля)",0,499,1],
 ["attack_shift","Смещение Δ",0,100,.1],["honest_noise_sigma","Шум σ",0,10,.01],
 ["trust_memory","Коэффициент памяти λ",.01,.99,.01],
 ["trust_alpha","Доля прямого доверия α",0,1,.01],
 ["isolation_threshold","Порог изоляции ϑ_iso",0,1,.01],
 ["admission_threshold","Порог допуска ϑ_in",0,1,.01],
 ["isolation_patience","Подтверждений n_iso",1,100,1],
 ["trim_each_side","Усечение b",0,79,1],
 ["honest_quality","Качество честных q_h",0,1,.01],
 ["byzantine_quality","Качество нарушителей q_a",0,1,.01],
 ["quality_sigma","СКО качества σ_q",0,1,.01],
 ["reputation_eps","Регуляризация ε_E",0,1,.001],
 ["cusum_mu","Накопление μ_q",0,1,.01],["cusum_limit","Порог z_lim",0,100,.1],
 ["update_norm_bound","Граница нормы B_upd",.01,100,1],
 ["global_step","Шаг обновления η",.01,10,.05],
 ["operator_availability","Доступность оператора a_op",0,1,.05],
 ["error_scale","Нормировка ошибки e_max",.01,100,.1],
 ["psi_min","Минимум Ψ_min",0,2,.01],
 ["on_off_period","Период on-off",1,500,1],
 ["on_off_attack_steps","Активных тактов периода",1,500,1]
];
export function ArticleTrustSettings({config,setConfig,running,preset,onPreset,claims,setClaims}){
 const update=(key,value)=>{setConfig(c=>({...c,[key]:value}));setClaims(null);};
 const updateVector=(key,i,v)=>update(key,config[key].map((old,j)=>i===j?v:old));
 let configError=null;try{validateArticleConfig(config);}catch(e){configError=e.message;}
 return <div className="article-trust-settings">
  <p className="article-warning">Режим imas-article-1.0.0: формулы (1)–(21). Неизвестные параметры статьи заданы демонстрационными значениями.</p>
  <div className="article-presets">
   {Object.entries({table2:"Таблица 2",table3:"Таблица 3",figure1:"Рисунок 1",psi:"Ψ_L"}).map(([key,label])=>
    <button type="button" key={key} disabled={running} className={preset===key?"active":""} onClick={()=>onPreset(key)}>{label}</button>)}
  </div>
  <fieldset disabled={running} className="article-parameter-fieldset">
   <label className="field">Сценарий атаки<select aria-label="Сценарий статьи" value={config.attack_scenario} onChange={e=>update("attack_scenario",e.target.value)}>
    {Object.entries(SCENARIOS).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
   <label className="field">Оценка качества<select aria-label="Режим качества" value={config.quality_mode} onChange={e=>update("quality_mode",e.target.value)}>
    <option value="synthetic">Синтетическая q</option><option value="computed">Вычисляемая по (8)</option>
   </select></label>
   <label className="bool-field"><input type="checkbox" checked={config.manipulate_reputation} onChange={e=>update("manipulate_reputation",e.target.checked)}/> Манипулирование доверием</label>
   <label className="bool-field"><input type="checkbox" checked={config.cusum_enabled} onChange={e=>update("cusum_enabled",e.target.checked)}/> Накопительный показатель (14)</label>
   <div className="article-fields">
    {SETS.map(([key,label,min,max,step])=><label className="field" key={key}>{label}<input type="number" aria-label={label} value={config[key]} min={min} max={max} step={step} onChange={e=>update(key,Number(e.target.value))}/></label>)}
   </div>
   <details className="advanced"><summary>Векторы, Hᵢ и веса β, γ</summary><div className="advanced-body">
    <label className="field">Эталонный вектор x* (через ;)<input aria-label="Эталонный вектор статьи"
      value={config.reference_vector.join("; ")} onChange={e=>{
       const v=e.target.value.split(";").map(x=>Number(x.trim().replace(",",".")));
       update("reference_vector",v);}}/></label>
    <label className="field">Доля наблюдаемых компонент Hᵢ<input type="number" min=".01" max="1" step=".05" value={config.observation_fraction} onChange={e=>update("observation_fraction",Number(e.target.value))}/></label>
    <p>Веса качества β₁–β₃ (сумма 1)</p><div className="article-vector">{config.quality_weights.map((v,i)=><input aria-label={"β"+(i+1)} key={i} type="number" step=".01" value={v} onChange={e=>updateVector("quality_weights",i,Number(e.target.value))}/>)}</div>
    <p>Веса киберустойчивости γ₁–γ₄ (сумма 1)</p><div className="article-vector">{config.resilience_weights.map((v,i)=><input aria-label={"γ"+(i+1)} key={i} type="number" step=".01" value={v} onChange={e=>updateVector("resilience_weights",i,Number(e.target.value))}/>)}</div>
    <label className="field">Окно измерения L<input type="number" min="1" max={config.n_steps} value={config.resilience_window} onChange={e=>update("resilience_window",Number(e.target.value))}/></label>
   </div></details>
  </fieldset>
  <p className="article-param-note">Такты t=0…T−1. Атака при t≥tₐ; t_iso=t_изол−tₐ+1. Для метода Trim при 2b≥|Kₜ| регистрируется замещение медианой.</p>
  <button type="button" disabled={running||Boolean(configError)} onClick={()=>setClaims(verifyArticleClaims(config))}>Проверка утверждений 1–2</button>
  {claims?<div className="article-claims" role="status"><strong>{claims.passed?"Контрольные примеры пройдены":"Имеются нарушения контрольных примеров"}</strong>
   {claims.checks.map((x,i)=><p key={i}>{x.name}: {x.observed??"не определено"} (ожидалось {x.expected??"—"}){x.checks?" / "+x.checks+" проверок":""}</p>)}
  </div>:null}
  {configError?<p className="imas-validation-error" role="alert">{configError}</p>:null}
 </div>;
}

function download(name,body,type){const href=URL.createObjectURL(new Blob([body],{type})),a=document.createElement("a");a.href=href;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(href),2000);}
const COLUMNS=["scenarioName","method","runs","meanError","sdError","isolationFraction","meanIsolationTime","isolationTimeP95","falseIsolations","meanPsi","psiCI95Low","psiCI95High","psiPassRate","psiAboveOne","trimFallbacks"];
export function ArticleTrustResults({result,progress,error,cacheHit,view,tab,running,onRun}){
 const table3=Boolean(result?.table3Rows);
 const rows=result?.rows||[];
 const csv=()=>download("imas-trust-article.csv","\ufeff"+[COLUMNS.join(";"),...rows.map(r=>COLUMNS.map(k=>r[k]===null?"":String(r[k]??"").replace(".",",")).join(";"))].join("\n"),"text/csv;charset=utf-8");
 const json=()=>download("imas-trust-article.json",JSON.stringify(result,null,2),"application/json");
 const copy=()=>navigator.clipboard?.writeText([["Метод","Ошибка","СКО","Изоляция","Время","P95","Ψ_L","95% ДИ"].join("\t"),...rows.map(r=>[
  r.scenarioName||TITLES[r.method],N(r.meanError),N(r.sdError),N(r.isolationFraction),N(r.meanIsolationTime),N(r.isolationTimeP95),N(r.meanPsi),N(r.psiCI95Low)+"–"+N(r.psiCI95High)].join("\t"))].join("\n"));
 return <div className="article-trust-results">
  <section className="panel r27-panel">
   <h3>{tab==="sensitivity"?"Сценарный анализ (таблица 3)":tab==="trace"?"Динамика доверия и решений":tab==="data"?"Результаты и первичные данные":"Статистические показатели методов"}</h3>
   <p>Движок {ARTICLE_MODEL_VERSION}; модель статьи (1–21). Базовый движок Beta/EigenTrust остаётся доступен в этом же эксперименте.</p>
   {error?<div className="error-banner" role="alert">{error}</div>:null}
   {progress?<p>Выполнено: {progress.overallCompleted??progress.completed} из {progress.overallTotal??progress.total} прогонов.</p>:null}
   {cacheHit?<p>Результаты восстановлены из отдельного версионированного кэша модели статьи.</p>:null}
   {!result?<><p>Запустите расчёт. При выборе режима «Чувствительность» вычисляются семь сценариев таблицы 3; другие вкладки используют четыре метода агрегации.</p>
    <button disabled={running} onClick={onRun}>Рассчитать модель статьи</button></>:<>
    <div className="article-actions"><button onClick={csv}>CSV</button><button onClick={json}>JSON</button><button onClick={copy}>Копировать таблицу для Word</button></div>
    <div className="article-table-scroll"><table className="article-table" aria-label="Результаты расчёта доверия по модели статьи">
     <thead><tr><th>{table3?"Сценарий":"Метод"}</th><th>Ошибка</th><th>СКО</th><th>Доля изолированных</th><th>Время</th><th>P95</th><th>Ψ_L</th><th>95 % ДИ Ψ</th><th>Ψ≥Ψ_min</th><th>Ложные изоляции</th><th>Замещения Trim</th></tr></thead>
     <tbody>{rows.map(r=><tr key={r.method}><th>{r.scenarioName||TITLES[r.method]}</th>
      <td>{N(r.meanError)}</td><td>{N(r.sdError)}</td><td>{N(r.isolationFraction)}</td>
      <td>{N(r.meanIsolationTime)}</td><td>{N(r.isolationTimeP95)}</td><td>{N(r.meanPsi)}</td>
      <td>{N(r.psiCI95Low)}…{N(r.psiCI95High)}</td><td>{N(r.psiPassRate)}</td>
      <td>{N(r.falseIsolations)}</td><td>{r.trimFallbacks}</td></tr>)}</tbody>
    </table></div>
    <p>Показатель Ψ_L не ограничивается единицей. Пороговые и накопительные изоляции, а также случаи замены Trim регистрируются отдельно.</p>
   </>}
  </section>
  {result&&tab!=="data"?<>
   <section className="panel r27-panel"><h3>Ошибка четырёх методов · средние траектории</h3>
    <div className="article-chart"><ResponsiveContainer width="100%" height={300}><LineChart data={result.trajectory}>
     <CartesianGrid strokeDasharray="3 3"/><XAxis dataKey="step"/><YAxis/><Tooltip/><Legend/>
     {Object.entries(TITLES).map(([key,title],i)=><Line key={key} dataKey={key} name={title} type="monotone" dot={false} stroke={["#2672ff","#079b91","#bd8549","#7657c8"][i]}/>)}
    </LineChart></ResponsiveContainer></div>
   </section>
   <section className="panel r27-panel"><h3>Медианное доверие по тактам</h3>
    <div className="article-chart"><ResponsiveContainer width="100%" height={230}><LineChart data={result.trajectory}>
     <CartesianGrid strokeDasharray="3 3"/><XAxis dataKey="step"/><YAxis domain={[0,1]}/><Tooltip/>
     <Line dataKey="trustMedian" name="med τ" stroke="#123a63" dot={false}/>
    </LineChart></ResponsiveContainer></div>
   </section>
  </>:null}
  {result&&tab==="data"?<section className="panel r27-panel"><h3>Паспорт показателей и полная конфигурация</h3>
   <pre style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{JSON.stringify({modelVersion:result.modelVersion,config:result.config,metricPassport:result.metricPassport},null,2)}</pre>
  </section>:null}
 </div>;
}
