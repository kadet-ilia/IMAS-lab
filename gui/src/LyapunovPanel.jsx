import React, {forwardRef,useEffect,useImperativeHandle,useRef,useState} from "react";
import {CartesianGrid,Line,LineChart,ReferenceLine,ResponsiveContainer,Tooltip,XAxis,YAxis,Legend} from "recharts";
import {ExperimentPanel as Panel,ExperimentKpi as Kpi} from "./ExperimentLayout.jsx";
import {defaultAttackPhases,validateLyapunovOptions,LYAPUNOV_STUDY_VERSION} from "./lyapunovStudy.js";

const METHODS=[
 ["arithmetic_mean","Арифметическое среднее","#2672ff"],
 ["trust_weighted_mean","Среднее с учётом доверия","#079b91"],
 ["proposed_robust","Робастный метод","#123a63"]
];
const n=(v,d=3)=>Number.isFinite(v)?v.toFixed(d):"—";
const percent=v=>Number.isFinite(v)?(v*100).toFixed(1)+"%":"—";
function download(name,body,type){
 const blob=new Blob([body],{type}),url=URL.createObjectURL(blob),link=document.createElement("a");
 link.href=url;link.download=name;link.click();URL.revokeObjectURL(url);
}
function PhaseEditor({phases,setPhases,steps,attackStart,disabled}){
 const edit=(index,key,value)=>setPhases(prev=>prev.map((p,i)=>i===index?{...p,[key]:value}:p));
 const add=()=>{
  const last=phases.at(-1).start;
  if(last<steps)setPhases(prev=>[...prev,{start:last+1,intensity:0}]);
 };
 return <Panel title="Динамическая активность атаки" subtitle="Множитель 0 — атака отключена; 1 — номинальное смещение; 2 — удвоенная амплитуда. Значение сохраняется до начала следующей фазы.">
  <div className="lyapunov-phase-grid">
   {phases.map((phase,i)=><div className="lyapunov-phase" key={i}>
    <label>Начало, шаг<input type="number" min={i?2:1} max={steps} step="1" disabled={disabled||i===0}
      value={phase.start} onChange={e=>edit(i,"start",e.target.value===""?NaN:Number(e.target.value))}/></label>
    <label>Интенсивность<input type="number" min="0" max="5" step=".1" disabled={disabled}
      value={phase.intensity} onChange={e=>edit(i,"intensity",e.target.value===""?NaN:Number(e.target.value))}/></label>
    {i>0?<button className="inline-action" type="button" disabled={disabled} onClick={()=>setPhases(prev=>prev.filter((_,j)=>i!==j))}>Удалить</button>:<span className="lyapunov-fixed-phase">Первая фаза</span>}
   </div>)}
  </div>
  <div className="action-controls lyapunov-phase-actions">
   <button className="secondary-button" type="button" disabled={disabled||phases.length>=30||phases.at(-1).start>=steps} onClick={add}>Добавить фазу</button>
   <button className="secondary-button" type="button" disabled={disabled} onClick={()=>setPhases(defaultAttackPhases(steps,attackStart))}>Типовой профиль on–off–усиление</button>
  </div>
 </Panel>;
}

const LyapunovPanel=forwardRef(function LyapunovPanel({config,onRuntimeChange},ref){
 const [phases,setPhases]=useState(()=>defaultAttackPhases(config.n_steps,config.attack_start_step));
 const [gain,setGain]=useState(.5);
 const [initialError,setInitialError]=useState(1);
 const [tolerance,setTolerance]=useState(.1);
 const [runs,setRuns]=useState(12);
 const [running,setRunning]=useState(false);
 const [workerStage,setWorkerStage]=useState("idle");
 const [progress,setProgress]=useState({completed:0,total:0});
 const [error,setError]=useState("");
 const [saved,setSaved]=useState(null);
 const workerRef=useRef(null);
 useEffect(()=>setPhases(defaultAttackPhases(config.n_steps,config.attack_start_step)),[config.n_steps,config.attack_start_step]);
 useEffect(()=>()=>{workerRef.current?.terminate();workerRef.current=null;},[]);
 const options={phases,gain,initialError,tolerance,runs};
 const signature=JSON.stringify({config,options});
 const result=saved?.signature===signature?saved.value:null;
 let valid=true,validationError="";
 try{validateLyapunovOptions(config,options);}catch(reason){valid=false;validationError=reason.message||String(reason);}
 const stop=()=>{
  workerRef.current?.terminate();workerRef.current=null;
  setRunning(false);setWorkerStage("stopped");setError("Расчёт остановлен пользователем. Частичные результаты не интерпретируются.");
 };
 const start=()=>{
  if(workerRef.current)return;
  try{validateLyapunovOptions(config,options);}
  catch(reason){setError(reason.message||String(reason));return;}
  setError("");setSaved(null);setRunning(true);setWorkerStage("launched");setProgress({completed:0,total:runs});
  const worker=new Worker(new URL("./lyapunovWorker.js",import.meta.url),{type:"module"});
  workerRef.current=worker;
  const runSignature=signature;
  worker.onmessage=event=>{
   if(workerRef.current!==worker)return;
   const message=event.data||{};
   if(message.type==="status")setWorkerStage(message.stage);
   if(message.type==="progress")setProgress({completed:message.completed,total:message.total});
   if(message.type==="result"||message.type==="error"){
    setWorkerStage(message.type);
    worker.terminate();workerRef.current=null;setRunning(false);
    if(message.type==="result"){setSaved({signature:runSignature,value:message.result});setProgress({completed:runs,total:runs});}
    else setError(message.message||"Ошибка вычислительного потока");
   }
  };
  worker.onerror=e=>{if(workerRef.current!==worker)return;worker.terminate();workerRef.current=null;setRunning(false);setError(e.message||"Ошибка вычислительного потока");};
  worker.postMessage({type:"run",config,options});
 };
 useImperativeHandle(ref,()=>({start,stop,reset:()=>{stop();setSaved(null);setError("");setPhases(defaultAttackPhases(config.n_steps,config.attack_start_step));}}));
 useEffect(()=>{
  onRuntimeChange?.({running,completed:progress.completed,total:progress.total,
    lastCompletedAt:result?new Date().toISOString():null,hasResult:Boolean(result)});
 },[running,progress.completed,progress.total,Boolean(result)]);
 const timeline=Array.from({length:config.n_steps},(_,i)=>({step:i+1,intensity:(()=>{
  let value=0;for(const p of phases)if(p.start<=i+1)value=p.intensity;else break;return value;
 })()}));
 const metrics=result?.summary||[];
 const proposed=metrics.find(x=>x.method==="proposed_robust");
 const nominal=result?.nominal;
 const firstTrace=result?.trace;
 const traceForGraph=firstTrace?Array.from({length:config.n_steps+1},(_,i)=>{
  const row={step:i};
  for(const [method] of METHODS){
   const v=firstTrace[method].points[i];
   row[method+"_deltaV"]=v.deltaV;
   row[method+"_e"]=v.e;
   row[method+"_V"]=Math.max(1e-16,v.V);
  }return row;
 }):[];
 const meanGraph=result?.series?.map(item=>{
  const row={...item};
  for(const [method] of METHODS)row[method+"_V_mean"]=Math.max(1e-16,item[method+"_V_mean"]);
  return row;
 })||[];
 return <div className="tab-stack lyapunov-study">
  <div className="tab-action"><div><h2>Устойчивость по Ляпунову и точность коллективных оценок</h2>
   <p>Связанная модель обратной связи с погрешностями решений из действующего ядра расчёта доверия. Фазы атаки задаются независимо по шагам.</p></div>
   <div className="action-controls">
    <button className="secondary-button" type="button" onClick={start} disabled={running||!valid}>Выполнить исследование</button>
    <button className="secondary-button" type="button" onClick={stop} disabled={!running}>Остановить</button>
   </div></div>
  <p className="r27-note"><strong>Цель:</strong> количественно сопоставить методы по точности решений и поведению замкнутой скалярной модели при произвольной заданной последовательности включения, выключения и усиления атаки. Числовые результаты иллюстрируют модель, а не доказывают устойчивость полной ИМАС.</p>
  <div className="lyapunov-inputs">
   <label>Коэффициент обратной связи k<input aria-label="Коэффициент обратной связи k" type="number" min=".01" max="1.99" step=".05" value={gain} onChange={e=>setGain(Number(e.target.value))} disabled={running}/></label>
   <label>Начальное отклонение e(0)<input aria-label="Начальное отклонение" type="number" min="-100" max="100" step=".1" value={initialError} onChange={e=>setInitialError(Number(e.target.value))} disabled={running}/></label>
   <label>Допуск по состоянию ε<input aria-label="Допуск по состоянию" type="number" min=".001" max="100" step=".01" value={tolerance} onChange={e=>setTolerance(Number(e.target.value))} disabled={running}/></label>
   <label>Число независимых прогонов R<input aria-label="Число прогонов устойчивости" type="number" min="1" max="200" step="1" value={runs} onChange={e=>setRuns(Number(e.target.value))} disabled={running}/></label>
  </div>
  <PhaseEditor phases={phases} setPhases={setPhases} steps={config.n_steps} attackStart={config.attack_start_step} disabled={running}/>
  <Panel title="Профиль атакующего воздействия" subtitle="Интенсивность воздействует на значения византийских предложений и достоверность свидетельств о поведении агентов.">
   <ResponsiveContainer width="100%" height={215}><LineChart data={timeline}><CartesianGrid strokeDasharray="3 3" vertical={false}/><XAxis dataKey="step" tick={{fontSize:10}}/><YAxis domain={[0,5]} tick={{fontSize:10}}/><Tooltip/><Line name="Множитель атаки" dataKey="intensity" stroke="#c75c4d" strokeWidth={2.4} dot={false} type="stepAfter" isAnimationActive={false}/></LineChart></ResponsiveContainer>
  </Panel>
  {!valid?<p role="alert" className="imas-validation-error">{validationError}</p>:null}
  {error?<p role="alert" className="error-banner">{error}</p>:null}
  {running?<p className="r27-note" role="status">Выполнено прогонов: {progress.completed} / {progress.total}. Состояние вычислительного потока: {workerStage}.</p>:null}
  {result?<React.Fragment>
   <div className="kpi-grid">
    <Kpi label="Номинальное сокращение |e|" value={n(nominal.rho,3)} note="ρ = |1 − k|, при отсутствии возмущений"/>
    <Kpi label="Точность робастного метода" value={percent(proposed?.correct_probability.mean)} note="Доля правильных решений, включая отказы"/>
    <Kpi label="RMSE коллективной оценки" value={n(proposed?.decision_rmse.mean,4)} note="Робастный метод, только принятые решения"/>
    <Kpi label="RMSE состояния объекта" value={n(proposed?.state_rmse.mean,4)} note="Относительно x*, все шаги"/>
   </div>
   <Panel title="Сравнение показателей достижения цели исследования" subtitle={"R="+result.runs.length+"; средние по независимым прогонам, интервалы ±1,96·s/√R (без поправки на множественность)." }>
    <div className="table-wrap large"><table><thead><tr>
     <th>Метод</th><th>P(прав.)</th><th>При атаке</th><th>При паузе</th><th>RMSE решения</th><th>RMSE состояния</th><th>|e(T)|</th><th>ΔV&gt;0 (доля)</th><th>Отказы</th>
    </tr></thead><tbody>{metrics.map(row=><tr key={row.method}>
     <td>{METHODS.find(x=>x[0]===row.method)?.[1]}</td><td>{percent(row.correct_probability.mean)}</td>
     <td>{percent(row.attack_on_correct.mean)}</td><td>{percent(row.attack_off_correct.mean)}</td>
     <td>{n(row.decision_rmse.mean,4)}</td><td>{n(row.state_rmse.mean,4)}</td><td>{n(row.final_abs_error.mean,4)}</td>
     <td>{percent(row.positive_delta_v_fraction.mean)}</td><td>{n(row.missing_decisions.mean,1)}</td>
    </tr>)}</tbody></table></div>
   </Panel>
   <Panel title="Диагностика устойчивости и ограниченности отклонений" subtitle="Описательные показатели выбранного горизонта; оценка ISS не доказывает устойчивость динамики доверия и всех компонентов ИМАС.">
    <div className="table-wrap large"><table><thead><tr><th>Метод</th><th>max ΔV</th><th>max |δ|</th><th>Радиус по выборке</th><th>Граница |e(T)|</th><th>Шаг установления</th></tr></thead><tbody>{metrics.map(row=><tr key={row.method}>
     <td>{METHODS.find(x=>x[0]===row.method)?.[1]}</td>
     <td>{n(row.max_delta_v.mean,5)}</td>
     <td>{n(row.max_observed_disturbance.mean,5)}</td>
     <td>{n(row.sampled_input_ultimate_radius.mean,5)}</td>
     <td>{n(row.sampled_iss_bound_final.mean,5)}</td>
     <td>{row.settling_step.n?n(row.settling_step.mean,1):"Не достигнуто"}</td>
    </tr>)}</tbody></table></div>
   </Panel>
   <Panel title="Точность коллективных решений в динамике" subtitle="RMSE на каждом шаге по R прогонам с выданными решениями. Пропуски означают, что решения не формировались.">
    <ResponsiveContainer width="100%" height={315}><LineChart data={result.series.slice(1)}><CartesianGrid strokeDasharray="3 3" vertical={false}/><XAxis dataKey="step" tick={{fontSize:10}}/><YAxis tick={{fontSize:10}}/><Tooltip/><Legend/>{METHODS.map(([id,label,color])=><Line key={id} name={label} type="monotone" dataKey={id+"_decision_rmse"} stroke={color} dot={false} connectNulls={false} strokeWidth={2} isAnimationActive={false}/>)}</LineChart></ResponsiveContainer>
   </Panel>
   <Panel title="Функция Ляпунова по методам" subtitle="Средняя V(t)=e(t)² по R прогонам; логарифмическая шкала, нулевые значения отображаются на уровне 10⁻¹⁶.">
    <ResponsiveContainer width="100%" height={360}><LineChart data={meanGraph}><CartesianGrid strokeDasharray="3 3" vertical={false}/><XAxis dataKey="step" tick={{fontSize:10}}/><YAxis scale="log" domain={[1e-16,"auto"]} tick={{fontSize:10}}/><Tooltip formatter={v=>n(v,8)}/><Legend/>{METHODS.map(([id,label,color])=><Line key={id} name={label} type="monotone" dataKey={id+"_V_mean"} stroke={color} dot={false} strokeWidth={2} isAnimationActive={false}/>)}</LineChart></ResponsiveContainer>
   </Panel>
   <Panel title="Отклонение состояния от целевого равновесия" subtitle="Первый прогон: положительное/отрицательное отклонение; пунктиром показан заданный допуск ±ε.">
    <ResponsiveContainer width="100%" height={315}><LineChart data={traceForGraph}><CartesianGrid strokeDasharray="3 3" vertical={false}/><XAxis dataKey="step" tick={{fontSize:10}}/><YAxis tick={{fontSize:10}}/><Tooltip/><Legend/><ReferenceLine y={tolerance} stroke="#8898a8" strokeDasharray="4 4"/><ReferenceLine y={-tolerance} stroke="#8898a8" strokeDasharray="4 4"/>{METHODS.map(([id,label,color])=><Line key={id} name={label} type="monotone" dataKey={id+"_e"} stroke={color} dot={false} strokeWidth={2} isAnimationActive={false}/>)}</LineChart></ResponsiveContainer>
   </Panel>
   <Panel title="Одношаговое изменение функции Ляпунова ΔV" subtitle="Первый прогон. Положительное ΔV указывает на рост V на данном шаге, но само по себе не является доказательством неустойчивости.">
    <ResponsiveContainer width="100%" height={310}><LineChart data={traceForGraph.slice(1)}><CartesianGrid strokeDasharray="3 3" vertical={false}/><XAxis dataKey="step" tick={{fontSize:10}}/><YAxis tick={{fontSize:10}}/><Tooltip/><Legend/><ReferenceLine y={0} stroke="#54677b"/>{METHODS.map(([id,label,color])=><Line key={id} name={label} type="monotone" dataKey={id+"_deltaV"} stroke={color} dot={false} strokeWidth={1.8} isAnimationActive={false}/>)}</LineChart></ResponsiveContainer>
   </Panel>
   <Panel title="Парные эффекты робастного метода относительно альтернатив" subtitle="Разность внутри одинаковых случайных реализаций; положительное значение соответствует улучшению.">
    <div className="table-wrap large"><table><thead><tr><th>Базовый метод</th><th>Показатель</th><th>Средний эффект</th><th>95%-й интервал</th><th>Пар</th></tr></thead><tbody>{result.comparison.map((x,i)=><tr key={i}>
     <td>{METHODS.find(m=>m[0]===x.baseline)?.[1]}</td><td>{x.metric}</td><td>{n(x.benefit.mean,5)}</td>
     <td>{x.benefit.ci95_half_width===null?"Не определён":n(x.benefit.mean-x.benefit.ci95_half_width,5)+" … "+n(x.benefit.mean+x.benefit.ci95_half_width,5)}</td>
     <td>{x.benefit.n}</td></tr>)}</tbody></table></div>
   </Panel>
   <Panel title="Условия интерпретации устойчивости">
    <p>В частной модели e(t+1) = (1−k)e(t) − kδ(t), где δ(t) — ошибка коллективной оценки из ядра доверия. При отказе в выдаче решения применяется удержание e(t+1)=e(t). V(t)=e(t)²; при δ=0 и 0&lt;k&lt;2 выполняется V(t+1)=(1−k)²V(t) и номинальная асимптотическая устойчивость.</p>
    <p>При произвольном ненулевом δ(t) точка e=0, как правило, перестаёт быть равновесием. Для принятых решений справедливо |e(t+1)| ≤ ρ|e(t)| + k|δ(t)|, ρ=|1−k|&lt;1. Это оценка вход–состояние (ISS) для введённой скалярной модели, а не доказательство устойчивости полного контура ИМАС.</p>
    <p>Радиус k·max|δ|/(1−ρ) построен по наблюдаемому максимуму возмущений выбранной выборки и не является гарантией на неопробованные атаки. Случаи отсутствия решений, ограничения на Sybil-модель, динамику доверия и неизвестные возмущения следует оценивать отдельно.</p>
    <div className="action-controls">
     <button type="button" className="secondary-button" onClick={()=>download("lyapunov-study.json",JSON.stringify(result,null,2),"application/json;charset=utf-8")}>Экспорт JSON</button>
     <button type="button" className="secondary-button" onClick={()=>{
      const header=["step","attack_intensity",...METHODS.flatMap(([id])=>[id+"_V_mean",id+"_e_mean",id+"_decision_rmse"])];
      const lines=[header.join(";"),...result.series.map(row=>header.map(key=>row[key]??"").join(";"))];
      download("lyapunov-trajectories.csv","\uFEFF"+lines.join("\n"),"text/csv;charset=utf-8");
     }}>Экспорт CSV</button>
    </div>
    <p className="r27-note">Версия расчёта: {LYAPUNOV_STUDY_VERSION}. Данные генерируются синтетической моделью и требуют независимой экспериментальной валидации.</p>
   </Panel>
  </React.Fragment>:<div className="empty">Задайте профиль активности атаки и запустите исследование для получения оценки точности и траекторий V(t), ΔV(t).</div>}
 </div>;
});
export default LyapunovPanel;
