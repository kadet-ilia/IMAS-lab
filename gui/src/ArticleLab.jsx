import React,{useEffect,useImperativeHandle,useState,forwardRef} from "react";
import {CartesianGrid,Legend,Line,LineChart,ResponsiveContainer,Tooltip,XAxis,YAxis} from "recharts";
import {ARTICLE_DEFAULTS,ARTICLE_PRESETS,ARTICLE_MODEL_VERSION,ARTICLE_METHODS,validateArticleConfig} from "./articleLabApi.js";
import {runArticleSeries,stopArticleSeries} from "./articleBrowserClient.js";
const LABELS={arithmetic_mean:"Обычное среднее",trust_mean:"Среднее после допуска",
 trimmed_mean:"Усечённое среднее",trust_trimmed_mean:"Доверительно-усечённое"};
const S={collusion:"Смещение и манипулирование доверием",trust:"Манипулирование доверием и смещение",
 subtle:"Малозаметное искажение",mask:"Маскировка качества",on_off:"Переключающееся поведение"};
const Q={synthetic:"Синтетическое качество q",computed:"Вычисляемое по (8)"};
const int=(v)=>Number.isFinite(v)?v.toLocaleString("ru-RU",{maximumFractionDigits:4}):"—";
function download(name,content,mime){const a=document.createElement("a"),url=URL.createObjectURL(new Blob([content],{type:mime}));a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
const CSV_COLUMNS=["method","runs","meanError","sdError","isolationFraction","meanIsolationTime","isolationTimeP95","falseIsolations","meanPsi","psiCI95Low","psiCI95High","psiPassRate","psiAboveOne","trimFallbacks"];
const russianCsv=v=>v===null||v===undefined?"":typeof v==="number"?String(v).replace(".",","):String(v);
function exportCsv(result){
 const lines=[CSV_COLUMNS.join(";"),...result.rows.map(row=>CSV_COLUMNS.map(k=>russianCsv(row[k])).join(";"))];
 download("imas-article-results.csv","\ufeff"+lines.join("\n"),"text/csv;charset=utf-8");
}
const ARTICLE_FIELDS=[
 ["n_agents","N, агентов",3,160,1],["n_byzantine","f, нарушителей",0,159,1],
 ["n_steps","T, тактов",1,500,1],["n_runs","R, прогонов",1,10000,1],
 ["attack_start_step","tₐ, начало атаки (с нуля)",0,499,1],
 ["attack_shift","Δ, амплитуда",0,100,0.1],["honest_noise_sigma","σ, шум",0,10,.01],
 ["trust_memory","λ, память",.01,.99,.01],
 ["trust_alpha","α, прямое доверие",0,1,.05],
 ["isolation_threshold","ϑ_iso, порог изоляции",0,1,.01],
 ["admission_threshold","ϑ_in, порог допуска",0,1,.01],
 ["isolation_patience","n_iso, подтверждения",1,100,1],
 ["trim_each_side","b, усечение с каждой стороны",0,79,1],
 ["honest_quality","q_h, честный агент",0,1,.01],
 ["byzantine_quality","q_a, нарушитель",0,1,.01],
 ["quality_sigma","σ_q, СКО качества",0,1,.01],
 ["reputation_eps","ε_E, регуляризация",0,1,.001],
 ["cusum_mu","μ_q, опорное качество",0,1,.01],
 ["cusum_limit","z_lim, порог накопления",0,100,.1],
 ["update_norm_bound","B_upd, норма обновления",.01,100,1],
 ["global_step","η, шаг обновления",.01,10,.05],
 ["operator_availability","a_op, доступность при передаче",0,1,.05],
 ["error_scale","e_max, шкала ошибки",.01,100,.1],
 ["psi_min","Ψ_min, порог",0,2,.01]
];
const NAMES=["χ₁","χ₂","χ₃","χ₄"];
export const ArticleLab=forwardRef(function ArticleLab({navigation,onRuntimeChange},ref){
 const [config,setConfig]=useState(()=>({...ARTICLE_DEFAULTS}));
 const [result,setResult]=useState(null),[error,setError]=useState(""),[progress,setProgress]=useState(null),
 [running,setRunning]=useState(false),[cacheHit,setCacheHit]=useState(false);
 const patch=(k,v)=>{setConfig(c=>({...c,[k]:v}));setResult(null);};
 const setVector=(k,index,v)=>setConfig(c=>({...c,[k]:c[k].map((x,i)=>i===index?v:x)}));
 const [view,setView]=useState("table2");
 let invalid="";
 try{validateArticleConfig(config);}catch(e){invalid=e.message;}
 useEffect(()=>{onRuntimeChange?.({running,seed:config.seed,steps:config.n_steps,
  hasResult:!!result,completed:progress?.completed||0,total:progress?.total||config.n_runs});},
  [running,config.seed,config.n_steps,config.n_runs,Boolean(result),progress?.completed,progress?.total]);
 const start=async()=>{
  if(running)return;
  setError("");setRunning(true);setProgress(null);
  try{
   const res=await runArticleSeries(config,setProgress);
   setResult(res.result);setCacheHit(res.cache_hit);
  }catch(e){setError(String(e.message||e));}
  finally{setRunning(false);}
 };
 const stop=()=>stopArticleSeries();
 const reset=()=>{if(running)stop();setConfig({...ARTICLE_DEFAULTS});setResult(null);setError("");setProgress(null);setCacheHit(false);};
 useImperativeHandle(ref,()=>({start,stop,reset,newSeed:()=>patch("seed",Math.floor(Math.random()*2147483647))}),[config,running]);
 const preset=name=>{
  if(running)return;
  setConfig(c=>({...c,...ARTICLE_PRESETS[name]}));setResult(null);setError("");setView(name);
 };
 const copy=async()=>{
  if(!result)return;
  const lines=[["Метод","Ошибка","СКО","Изоляция","Время","P95","Ψ_L","95 % ДИ"].join("\t"),
   ...result.rows.map(r=>[LABELS[r.method],int(r.meanError),int(r.sdError),int(r.isolationFraction),
    int(r.meanIsolationTime),int(r.isolationTimeP95),int(r.meanPsi),
    "["+int(r.psiCI95Low)+"; "+int(r.psiCI95High)+"]"].join("\t"))];
  try{await navigator.clipboard.writeText(lines.join("\n"));}catch(e){setError("Копирование недоступно: "+e.message);}
 };
 return <div className="article-workspace">
  {navigation}
  <div className="article-head"><h2>Модель статьи · формулы (1)–(21)</h2>
   <p>Векторная ИМАС с прямым доверием, репутацией, защитной изоляцией, безопасным выбором действий и парной оценкой Ψ_L. Версия {ARTICLE_MODEL_VERSION}.</p>
   <p className="article-warning">Параметры, отсутствующие в исходной статье, представлены как явные демонстрационные допущения. Совпадение ранее опубликованных чисел не предполагается без идентификации первоначального программного расчёта.</p>
  </div>
  <div className="article-grid">
   <aside className="article-settings">
    <h3>Конфигурация модели</h3>
    <label>Движок<select aria-label="Модель" value="article" disabled><option value="article">Статья (1–21) — imas-article</option></select></label>
    <div className="article-presets">
     {Object.entries({table2:"Таблица 2",table3:"Таблица 3",figure1:"Рисунок 1",psi:"Ψ_L"}).map(([id,title])=>
      <button type="button" key={id} disabled={running} className={view===id?"active":""} onClick={()=>preset(id)}>{title}</button>)}
    </div>
    <label>Сценарий<select value={config.attack_scenario} onChange={e=>patch("attack_scenario",e.target.value)}>
      {Object.entries(S).map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>
    <label>Качество взаимодействия<select value={config.quality_mode} onChange={e=>patch("quality_mode",e.target.value)}>
      {Object.entries(Q).map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>
    <label className="article-check"><input type="checkbox" checked={config.manipulate_reputation} onChange={e=>patch("manipulate_reputation",e.target.checked)}/> Манипулирование рекомендациями</label>
    <label className="article-check"><input type="checkbox" checked={config.cusum_enabled} onChange={e=>patch("cusum_enabled",e.target.checked)}/> Накопительный показатель z (14)</label>
    <div className="article-fields">{ARTICLE_FIELDS.map(([id,title,min,max,step])=>
     <label key={id}>{title}<input aria-label={title} type="number" min={min} max={max} step={step} value={config[id]}
      onChange={e=>patch(id,Number(e.target.value))}/></label>)}</div>
    <details><summary>Векторы, веса и наблюдения</summary>
     <label>Эталон x* (координаты через запятую)<input aria-label="Эталонный вектор" value={config.reference_vector.join("; ")}
      onChange={e=>{const a=e.target.value.split(/[;,\s]+/).filter(Boolean).map(x=>Number(x.replace(",",".")));setConfig(c=>({...c,reference_vector:a}));}}/></label>
     <label>Доля наблюдаемых компонент<input type="number" step=".05" min=".05" max="1" value={config.observation_fraction} onChange={e=>patch("observation_fraction",Number(e.target.value))}/></label>
     <p>β₁, β₂, β₃ (сумма 1)</p><div className="article-vector">{config.quality_weights.map((v,i)=><input key={i} aria-label={"β"+(i+1)} type="number" step=".05" value={v} onChange={e=>setVector("quality_weights",i,Number(e.target.value))}/>)}</div>
     <p>{NAMES.join(", ")}: веса γ (сумма 1)</p><div className="article-vector">{config.resilience_weights.map((v,i)=><input key={i} aria-label={"γ"+(i+1)} type="number" step=".05" value={v} onChange={e=>setVector("resilience_weights",i,Number(e.target.value))}/>)}</div>
     <label>Окно L<input type="number" min="1" max={config.n_steps} value={config.resilience_window} onChange={e=>patch("resilience_window",Number(e.target.value))}/></label>
    </details>
    <p className="article-param-note">Такты нумеруются с 0. Атака включается при t ≥ tₐ. При 2b ≥ размер допущенного множества на такте применяется медиана с регистрацией замещения.</p>
    {invalid?<p className="imas-validation-error" role="alert">{invalid}</p>:null}
    <button className="run-button" disabled={running||!!invalid} onClick={start}>Рассчитать · парные прогоны</button>
    {running?<button type="button" onClick={stop}>Остановить</button>:null}
   </aside>
   <main className="article-results">
    <h3>Результаты моделирования</h3>
    {error?<p role="alert" className="error-banner">{error}</p>:null}
    {progress?<p>Выполнено {progress.completed} из {progress.total} прогонов ({int(progress.percent)} %)</p>:null}
    {cacheHit?<p>Загружено из локального кэша по полной конфигурации и версии модели.</p>:null}
    {!result?<p>Для получения таблиц и графиков выберите конфигурацию и запустите вычисление.</p>:<>
     <div className="article-actions">
      <button onClick={()=>exportCsv(result)}>Скачать CSV</button>
      <button onClick={()=>download("imas-article-results.json",JSON.stringify(result,null,2),"application/json")}>Скачать JSON</button>
      <button onClick={copy}>Таблица для Word</button>
     </div>
     <div className="article-table-scroll"><table className="article-table">
      <thead><tr><th>Метод</th><th>Средняя ошибка</th><th>СКО</th><th>Изоляция</th><th>Время изоляции</th><th>P95</th><th>Ψ_L</th><th>95 % ДИ Ψ</th><th>Ψ ≥ Ψ_min</th><th>Ложные изоляции</th><th>Замещения Trim</th></tr></thead>
      <tbody>{result.rows.map(r=><tr key={r.method}>
       <th>{LABELS[r.method]}</th><td>{int(r.meanError)}</td><td>{int(r.sdError)}</td>
       <td>{int(r.isolationFraction)}</td><td>{int(r.meanIsolationTime)}</td><td>{int(r.isolationTimeP95)}</td>
       <td>{int(r.meanPsi)}</td><td>{int(r.psiCI95Low)}…{int(r.psiCI95High)}</td>
       <td>{int(r.psiPassRate)}</td><td>{int(r.falseIsolations)}</td><td>{r.trimFallbacks}</td>
      </tr>)}</tbody>
     </table></div>
     <p>Доля небезопасных решений: {result.rows[0]?.unsafeActions??0}. Прогонов с Ψ_L &gt; 1: {result.rows[0]?.psiAboveOne??0} (для первого метода).</p>
     <h3>Динамика ошибок · первый парный прогон</h3>
     <div className="article-chart"><ResponsiveContainer width="100%" height={320}><LineChart data={result.trajectory}>
      <CartesianGrid strokeDasharray="3 3"/><XAxis dataKey="step"/><YAxis/><Tooltip/><Legend/>
      {Object.entries(LABELS).map(([k,name],i)=><Line type="monotone" key={k} dataKey={k} name={name} stroke={["#2672ff","#079b91","#be8737","#7657c8"][i]} dot={false}/>)}
     </LineChart></ResponsiveContainer></div>
     <h3>Медианное доверие · первый прогон</h3>
     <div className="article-chart"><ResponsiveContainer width="100%" height={220}><LineChart data={result.trajectory}>
      <CartesianGrid strokeDasharray="3 3"/><XAxis dataKey="step"/><YAxis domain={[0,1]}/><Tooltip/>
      <Line dataKey="trustMedian" stroke="#123a63" name="med τ" dot={false}/>
     </LineChart></ResponsiveContainer></div>
     <details><summary>Паспорт показателей и допущения</summary>
      <pre>{JSON.stringify(result.metricPassport,null,2)}</pre>
      <p>Сид: {result.config.seed}; R: {result.completed_runs}; модель: {result.modelVersion}.</p>
     </details>
    </>}
   </main>
  </div>
 </div>;
});
