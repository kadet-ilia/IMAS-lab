import React,{forwardRef,useEffect,useImperativeHandle,useRef,useState} from "react";
import {CartesianGrid,Line,LineChart,Legend,ReferenceLine,ResponsiveContainer,Tooltip,XAxis,YAxis} from "recharts";
import {ExperimentPanel as Panel,ExperimentKpi as Kpi,ExperimentParameterTooltip as Info} from "./ExperimentLayout.jsx";
import {ADAPTIVE_DEFAULTS,ADAPTIVE_METHODS,validateAdaptiveOptions} from "./adaptiveDecisionEngine.js";
import {validateAdaptiveStudy} from "./adaptiveExperiment.js";
import {runAdaptiveBrowser,stopAdaptiveBrowser,loadAdaptiveCheckpoint} from "./adaptiveBrowserClient.js";
import {ATTACK_SHAPES,defaultAttackPhases,attackIntensityAt} from "./attackProfiles.js";
import {ADAPTIVE_ATTACK_STRATEGIES,ADAPTIVE_EVIDENCE_MODELS} from "./adaptiveScenario.js";

const num=(x,places=4)=>Number.isFinite(x)?x.toFixed(places):"—";
const percent=x=>Number.isFinite(x)?(100*x).toFixed(1)+"%":"—";
function download(name,data,type="application/json;charset=utf-8"){
 const url=URL.createObjectURL(new Blob([data],{type}));
 const link=document.createElement("a");link.href=url;link.download=name;link.click();URL.revokeObjectURL(url);
}
function NumberOption({label,title,value,min,max,step,onChange,disabled}){
 return <label><span className="lyapunov-field-label">{label} <Info text={title}/></span>
  <input aria-label={label} type="number" min={min} max={max} step={step} value={value}
   onChange={e=>onChange(Number(e.target.value))} disabled={disabled}/></label>;
}
const AdaptiveDecisionPanel=forwardRef(function AdaptiveDecisionPanel({config,onRuntimeChange,onStudyResult},ref){
 const [options,setOptions]=useState(()=>({...ADAPTIVE_DEFAULTS,runs:12,
  phases:defaultAttackPhases(config.n_steps,config.attack_start_step)}));
 const [running,setRunning]=useState(false);
 const [progress,setProgress]=useState({completed:0,total:12,percent:0});
 const [saved,setSaved]=useState(null);
 const [error,setError]=useState("");
 const [warning,setWarning]=useState("");
 const [cacheHit,setCacheHit]=useState(false);
 const [stage,setStage]=useState("idle");
 const activeRef=useRef(false),generation=useRef(0);
 const signature=JSON.stringify({config,options});
 const result=saved?.signature===signature?saved.result:null;
 const set=(key,value)=>setOptions(o=>({...o,[key]:value}));
 const updatePhase=(index,key,value)=>setOptions(o=>({
  ...o,phases:o.phases.map((p,i)=>i===index?{...p,[key]:value}:p)
 }));
 let validationError="";
 try{validateAdaptiveStudy(config,options);}catch(reason){validationError=reason.message||String(reason);}
 useEffect(()=>()=>{generation.current++;void stopAdaptiveBrowser();},[]);
 useEffect(()=>{
  if(validationError||activeRef.current||result)return;
  let cancelled=false;
  loadAdaptiveCheckpoint(config,options).then(record=>{
   if(cancelled||activeRef.current||!record)return;
   setProgress({completed:record.completedRuns,total:options.runs,
    percent:100*record.completedRuns/options.runs});
   if(record.result){setSaved({signature,result:record.result});setCacheHit(true);setStage("cached");onStudyResult?.(record.result);}
   else{setWarning("Найдена контрольная точка: "+record.completedRuns+" / "+options.runs+" прогонов. Запуск продолжит расчёт.");}
  }).catch(err=>{if(!cancelled)setWarning("Ошибка локального кэша E1-А: "+(err.message||String(err)));});
  return ()=>{cancelled=true;};
 },[signature,Boolean(result)]);
 const stop=()=>{void stopAdaptiveBrowser();setStage("stopping");};
 const start=async()=>{
  if(activeRef.current)return;
  try{validateAdaptiveStudy(config,options);}catch(reason){setError(reason.message||String(reason));return;}
  activeRef.current=true;const token=++generation.current,requestedSignature=signature;
  setRunning(true);setError("");setWarning("");setStage("computing");setSaved(null);setCacheHit(false);
  setProgress({completed:0,total:options.runs,percent:0});
  try{
   const terminal=await runAdaptiveBrowser(config,options,p=>{
    if(generation.current===token)setProgress(p);
   });
   if(generation.current!==token)return;
   if(terminal.state==="completed"){
    setSaved({signature:requestedSignature,result:terminal.result});
    setCacheHit(Boolean(terminal.cacheHit));setStage("complete");
    onStudyResult?.(terminal.result);
   }else{
    setStage("stopped");setWarning("Расчёт остановлен. Завершённые прогоны сохранены в IndexedDB; повторный запуск продолжит серию.");
   }
  }catch(reason){if(generation.current===token){setError(reason.message||String(reason));setStage("error");}}
  finally{if(generation.current===token){activeRef.current=false;setRunning(false);}}
 };
 const reset=()=>{
  stop();generation.current++;activeRef.current=false;setRunning(false);
  setSaved(null);setCacheHit(false);setWarning("");setError("");setStage("idle");
  setOptions({...ADAPTIVE_DEFAULTS,runs:12,
   phases:defaultAttackPhases(config.n_steps,config.attack_start_step)});
 };
 useImperativeHandle(ref,()=>({start,stop,reset}));
 useEffect(()=>{onRuntimeChange?.({running,completed:progress.completed,total:progress.total,
  percent:progress.percent,cacheHit:Boolean(result)&&cacheHit,hasResult:Boolean(result),stage});},
  [running,progress.completed,progress.total,progress.percent,cacheHit,Boolean(result),stage]);
 const trace=result?.trace||[],summary=result?.summary||[],paired=result?.paired||[];
 const methodState=result?.runs?.[0]?.methodStates||null;
 const coupledTrace=methodState?trace.map((row,i)=>({
  step:row.step,trimmedIsolation:methodState.trimmed_unweighted[i].isolated_agents,
  combinedIsolation:methodState.proposed_robust[i].isolated_agents,
  adaptiveIsolation:methodState.adaptive_robust[i].isolated_agents,
  trimmedReputation:methodState.trimmed_unweighted[i].mean_reputation,
  combinedReputation:methodState.proposed_robust[i].mean_reputation,
  adaptiveReputation:methodState.adaptive_robust[i].mean_reputation
 })):[];
 const adaptive=summary.find(x=>x.method==="adaptive_robust");
 const baseline=summary.find(x=>x.method==="trimmed_unweighted");
 const comparable=paired.find(x=>x.baseline==="trimmed_unweighted");
 const currentPhase=options.phases||[];
 const addPhase=()=>{
  const last=currentPhase.at(-1),next=(last?.start??0)+Math.max(1,config.attack_start_step);
  if(next>config.n_steps){setWarning("Нет места для следующей фазы. Увеличьте горизонт T.");return;}
  set("phases",[...currentPhase,{start:next,intensity:0,profile:"constant"}]);setWarning("");
 };
 const prepareCsv=()=>{
  const keys=["step","attack_intensity","truth","trimmed_unweighted","proposed_robust",
   "adaptive_unweighted","adaptive_weighted","adaptive_robust",
   "alpha","k","nEffective","readiness","disagreement","outlierCount","available","retained","weightConcentration"];
  const rows=[keys.join(";"),...trace.map(row=>keys.map(k=>row[k]??"").join(";"))];
  download("imas-adaptive-trajectory.csv",rows.join("\n"),"text/csv;charset=utf-8");
 };
 return <div className="tab-stack">
  <div className="tab-action">
   <div className="tab-action-description">
    <h2>Адаптивное формирование коллективных решений (E1-А)</h2>
    <p>Сравнение исходных доверительно-усечённых методов E1 с адаптивным агрегатором на одних и тех же предложениях, репутациях и сообщениях.</p>
    <p><strong>Область исследования:</strong> сравнение оценивателей при общем контуре либо раздельных контуров с обратной связью по решению. Раздельные контуры требуют поведенческих свидетельств и отключённых сетевых ограничений. Устойчивость относится только к вспомогательному скалярному объекту.</p>
   </div>
   <div className="action-controls">
    <button className="secondary-button" type="button" disabled={running||Boolean(validationError)} onClick={start}>Выполнить исследование</button>
    <button className="secondary-button" type="button" disabled={!running} onClick={stop}>Остановить</button>
   </div>
  </div>
  <Panel title="Адаптивное правило и робастное усечение" subtitle="Новый метод рассчитывается отдельно от четырёх неизменённых методов E1.">
   <div className="lyapunov-inputs">
    <label>Режим сравнительного исследования
     <select aria-label="Режим сравнительного исследования" disabled={running}
      value={options.comparisonMode}
      onChange={e=>setOptions(o=>({...o,comparisonMode:e.target.value,
       evidenceModel:e.target.value==="decision_feedback"&&o.evidenceModel==="legacy"
        ?"behavior_linked":o.evidenceModel}))}>
      <option value="estimator_only">Общий контур: сравнение агрегаторов</option>
      <option value="decision_feedback">Раздельные контуры: влияние решения на доверие</option>
     </select>
    </label>
    <label>Режим коэффициента α
     <select aria-label="Режим коэффициента alpha" disabled={running} value={options.alphaMode}
      onChange={e=>set("alphaMode",e.target.value)}>
      <option value="adaptive">Адаптивный</option><option value="fixed">Постоянный</option><option value="off">Без доверительного взвешивания</option>
     </select></label>
    <NumberOption label="Постоянное α" title="Используется только в режиме постоянного коэффициента." value={options.fixedAlpha} min={0} max={1} step={0.05} onChange={v=>set("fixedAlpha",v)} disabled={running}/>
    <label>Порядок обработки оценок
     <select aria-label="Порядок усечения" disabled={running} value={options.trimMode} onChange={e=>set("trimMode",e.target.value)}>
      <option value="source_first">Сначала усечение исходных значений</option>
      <option value="legacy_clip_first">Сначала медианное ограничение</option>
     </select></label>
    <label className="lyapunov-field-label"><input type="checkbox" disabled={running} checked={options.adaptiveTrim}
     onChange={e=>set("adaptiveTrim",e.target.checked)}/> Адаптивное число усечений k</label>
    <NumberOption label="Постоянное k" title="Для нового агрегатора; оставляем исходный k неизменным при сравнении с E1." value={options.trimEachSide??config.trim_each_side} min={0} max={159} step={1} disabled={running||options.adaptiveTrim} onChange={v=>set("trimEachSide",v)}/>
    <NumberOption label="Максимальное адаптивное k" title="Верхняя граница симметричного усечения при выявленных экстремальных предложениях." value={options.maxAdaptiveTrim} min={0} max={159} step={1} disabled={running||!options.adaptiveTrim} onChange={v=>set("maxAdaptiveTrim",v)}/>
    <NumberOption label="Порог выбросов" title="Множитель робастного MAD для диагностики экстремальных наблюдений." value={options.outlierThreshold} min={0.1} max={100} step={0.25} disabled={running||!options.adaptiveTrim} onChange={v=>set("outlierThreshold",v)}/>
    <NumberOption label="Показатель весов γ" title="Изменяет выраженность различий репутаций перед нормировкой." value={options.gamma} min={0} max={5} step={0.1} disabled={running} onChange={v=>set("gamma",v)}/>
    <NumberOption label="Верхний вес wmax" title="Предел концентрации влияния отдельного агента." value={options.maxWeight} min={0.05} max={5} step={0.05} disabled={running} onChange={v=>set("maxWeight",v)}/>
    <NumberOption label="Минимальная эффективная доля" title="Нормированный эффективный размер выборки управляет степенью доверительного смешивания." value={options.minimumEffectiveFraction} min={0.01} max={1} step={0.05} disabled={running} onChange={v=>set("minimumEffectiveFraction",v)}/>
    <NumberOption label="Штраф за расхождение" title="Экспоненциальное уменьшение α при расхождении взвешенного и невзвешенного решений." value={options.disagreementPenalty} min={0} max={100} step={0.25} disabled={running} onChange={v=>set("disagreementPenalty",v)}/>
    <NumberOption label="Окно подготовки доверия" title="Количество завершённых шагов для достижения полной эвристической готовности. НЕ является статистической калибровкой доверия." value={options.warmupSteps} min={1} max={50000} step={1} disabled={running} onChange={v=>set("warmupSteps",v)}/>
    <NumberOption label="Повторения R" title="Число независимых прогонов с одинаковой общей экзогенной реализацией для всех сравниваемых оценивателей." value={options.runs} min={1} max={200} step={1} disabled={running} onChange={v=>set("runs",v)}/>
    <NumberOption label="Коэффициент обратной связи" title="Только для вспомогательной скалярной модели, не является параметром основной ИМАС." value={options.feedbackGain} min={0.01} max={1.99} step={0.05} disabled={running} onChange={v=>set("feedbackGain",v)}/>
   </div>
   <p className="r27-note">Коэффициент α — проверяемая эвристика: готовность истории свидетельств × ограничение концентрации весов × штраф за расхождение двух агрегаторов. Он не является апостериорной вероятностью честности.</p>
  </Panel>
  <Panel title="Временной сценарий атаки и фазовое расписание">
   <label>Временной сценарий воздействия
    <select aria-label="Сценарий адаптивного исследования" disabled={running} value={options.scenario} onChange={e=>set("scenario",e.target.value)}>
     <option value="dynamic">Динамическое смещение с фазами</option>
     <option value="static_bias">Постоянное смещение</option>
     <option value="subtle_bias">Скрытое смещение</option>
     <option value="on_off">Периодическая атака</option>
     <option value="collusion">Согласованное смещение</option>
    </select></label>
   {options.scenario==="dynamic"?<>
    <div className="lyapunov-phase-grid">{currentPhase.map((p,i)=><div className="lyapunov-phase" key={i}>
     <div className="lyapunov-phase-heading"><strong>Фаза {i+1}</strong>
      {i>0?<button type="button" className="inline-action" disabled={running} onClick={()=>set("phases",currentPhase.filter((_,j)=>j!==i))}>Удалить</button>:null}</div>
     <label>Начало, шаг <input type="number" aria-label={"Начало фазы E1-А "+(i+1)} min={1} max={config.n_steps} disabled={running||i===0} value={p.start} onChange={e=>updatePhase(i,"start",Number(e.target.value))}/></label>
     <label>Закон изменения <select aria-label={"Закон фазы E1-А "+(i+1)} disabled={running} value={p.profile??"constant"} onChange={e=>updatePhase(i,"profile",e.target.value)}>
      {ATTACK_SHAPES.map(s=><option key={s.id} value={s.id}>{s.label}</option>)}
     </select></label>
     <label>Начальная интенсивность <input type="number" min={0} max={5} step={0.1} disabled={running} value={p.intensity} onChange={e=>updatePhase(i,"intensity",Number(e.target.value))}/></label>
     {(p.profile??"constant")!=="constant"?<label>Конечная интенсивность <input type="number" min={0} max={5} step={0.1} disabled={running} value={p.endIntensity??p.intensity} onChange={e=>updatePhase(i,"endIntensity",Number(e.target.value))}/></label>:null}
    </div>)}</div>
    <div className="action-controls">
     <button type="button" className="secondary-button" disabled={running} onClick={addPhase}>Добавить фазу</button>
     <button type="button" className="secondary-button" disabled={running} onClick={()=>set("phases",defaultAttackPhases(config.n_steps,config.attack_start_step))}>Сбросить расписание</button>
    </div>
    <ResponsiveContainer width="100%" height={160}><LineChart data={Array.from({length:config.n_steps},(_,i)=>({
     step:i+1,intensity:validationError?null:attackIntensityAt(i+1,currentPhase,config.n_steps)
    }))}><CartesianGrid stroke="#e6eaef" strokeDasharray="3 3"/><XAxis dataKey="step"/><YAxis domain={[0,5]}/>
     <Tooltip/><Line name="Интенсивность атаки" type="stepAfter" dataKey="intensity" dot={false} stroke="#c13f62" isAnimationActive={false}/></LineChart></ResponsiveContainer>
   </>:<p className="r27-note">Используется базовая генерация указанного сценария E1; фазовый редактор доступен в режиме динамического воздействия.</p>}
  </Panel>
  <Panel title="Модель поведения нарушителей и доверительных свидетельств" subtitle="Стратегия поведения задаётся независимо от временного профиля активности. Скрытые метки доступны только генератору событий.">
   <div className="lyapunov-inputs">
    <label>Стратегия поведения нарушителей
     <select aria-label="Стратегия поведения нарушителей" disabled={running} value={options.attackStrategy}
      onChange={e=>setOptions(o=>({...o,attackStrategy:e.target.value,
       evidenceModel:e.target.value==="reputation_boost"&&o.evidenceModel==="legacy"?"behavior_linked":o.evidenceModel}))}>
      {ADAPTIVE_ATTACK_STRATEGIES.map(x=><option key={x.id} value={x.id}>{x.label}</option>)}
     </select>
    </label>
    <label>Модель доверительных свидетельств
     <select aria-label="Модель доверительных свидетельств" disabled={running} value={options.evidenceModel}
      onChange={e=>set("evidenceModel",e.target.value)}>
      {ADAPTIVE_EVIDENCE_MODELS.map(x=><option key={x.id} value={x.id}>{x.label}</option>)}
     </select>
    </label>
    <NumberOption label="Смещение согласованной атаки" title="Модуль общего смещения предложений нарушителей относительно модельного эталона. Истина применяется генератором событий, а не оценивателем." value={options.coordinatedBias} min={0} max={100} step={0.1} disabled={running||!["coordinated","pulsed","reputation_boost"].includes(options.attackStrategy)} onChange={v=>set("coordinatedBias",v)}/>
    <NumberOption label="Малозаметное смещение" title="Модуль искажения предложения нарушителя в малозаметном режиме." value={options.stealthBias} min={0} max={100} step={0.05} disabled={running||options.attackStrategy!=="stealth"} onChange={v=>set("stealthBias",v)}/>
    <NumberOption label="Шум атакующих предложений" title="СКО дополнительного случайного отклонения при формировании атакующих предложений." value={options.attackNoiseSigma} min={0} max={10} step={0.005} disabled={running||options.attackStrategy==="legacy"} onChange={v=>set("attackNoiseSigma",v)}/>
    <NumberOption label="Период атаки" title="Продолжительность полного цикла периодического поведения." value={options.attackPeriod} min={1} max={500} step={1} disabled={running||options.attackStrategy!=="pulsed"} onChange={v=>set("attackPeriod",v)}/>
    <NumberOption label="Активных шагов в периоде" title="Первые d тактов из каждого периода заняты воздействием." value={options.attackDuty} min={1} max={500} step={1} disabled={running||options.attackStrategy!=="pulsed"} onChange={v=>set("attackDuty",v)}/>
    <NumberOption label="Длительность накопления репутации" title="Число начальных шагов, когда скомпрометированные агенты отправляют корректные предложения перед переходом к атаке." value={options.reputationWarmup} min={0} max={50000} step={1} disabled={running||options.attackStrategy!=="reputation_boost"} onChange={v=>set("reputationWarmup",v)}/>
    <NumberOption label="Порог согласованности свидетельств" title="Масштаб отклонения наблюдения от медианы остальных доступных предложений; не используется эталонная истина." value={options.evidenceTolerance} min={0.000001} max={100} step={0.05} disabled={running||options.evidenceModel==="legacy"} onChange={v=>set("evidenceTolerance",v)}/>
    <NumberOption label="Шум свидетельства" title="СКО дополнительного шума оценки поведения." value={options.evidenceNoiseSigma} min={0} max={1} step={0.005} disabled={running||options.evidenceModel==="legacy"} onChange={v=>set("evidenceNoiseSigma",v)}/>
    <NumberOption label="Искажение свидетельств нарушителем" title="Степень подмены оценок наблюдателя: 0 — без подмены, 1 — полностью согласованная ложная оценка." value={options.witnessCorruption} min={0} max={1} step={0.05} disabled={running||options.evidenceModel==="legacy"} onChange={v=>set("witnessCorruption",v)}/>
    <NumberOption label="Корреляция свидетельств" title="Доля общего случайного возмущения для оценок одного объекта разными наблюдателями." value={options.evidenceCorrelation} min={0} max={1} step={0.05} disabled={running||options.evidenceModel!=="correlated_witnesses"} onChange={v=>set("evidenceCorrelation",v)}/>
    <NumberOption label="Запаздывание наблюдений, шагов" title="Свидетельства вычисляются по доставленным предложениям прошлых тактов. Это задержка источника наблюдения, а не эмуляция транспортной задержки свидетельства." value={options.evidenceLag} min={0} max={500} step={1} disabled={running||options.evidenceModel!=="lagged_observation"} onChange={v=>set("evidenceLag",v)}/>
   </div>
   <p className="r27-note">В новом режиме свидетельство является ограниченной оценкой согласованности наблюдения с другими доставленными предложениями, а не апостериорной вероятностью честности. При отсутствии информации возвращается нейтральная оценка 0,5. Согласованная группа нарушителей может сместить опорную медиану.</p>
  </Panel>
  {validationError?<p role="alert" className="imas-validation-error">{validationError}</p>:null}
  {error?<p role="alert" className="imas-validation-error">{error}</p>:null}
  {warning?<p role="status" className="r27-note">{warning}</p>:null}
  <p className="r27-note" role="status">Состояние: {stage} · завершено {progress.completed} из {progress.total} прогонов ({num(progress.percent,1)}%){cacheHit?" · локальный кэш":""}</p>
  {result?<React.Fragment>
   <div className="kpi-grid">
    <Kpi label="RMSE адаптивного метода" value={num(adaptive?.rmse.mean,5)} note="Среднее RMSE по независимым прогонам"/>
    <Kpi label="RMSE обычного усечения" value={num(baseline?.rmse.mean,5)} note="Исторический контроль E1"/>
    <Kpi label="Парный эффект ΔRMSE" value={num(comparable?.mean,5)} note="Адаптивный − исходный, отрицательное лучше"/>
    <Kpi label="Победы / проигрыши" value={(comparable?.wins??0)+" / "+(comparable?.losses??0)} note={"По "+(comparable?.n??0)+" парным прогонам"}/>
   </div>
   <Panel title="Коллективные решения" subtitle="Первая случайная реализация; истина отображается только для научной диагностики.">
    <ResponsiveContainer width="100%" height={350}><LineChart data={trace}>
     <CartesianGrid stroke="#e6eaef" strokeDasharray="3 3"/><XAxis dataKey="step" tick={{fontSize:10}}/><YAxis tick={{fontSize:10}}/>
     <Tooltip formatter={v=>num(v,4)}/><Legend/>
     <ReferenceLine y={config.desired_action} stroke="#626e7d" strokeDasharray="5 5" label="Эталон"/>
     {ADAPTIVE_METHODS.filter(m=>["trimmed_unweighted","proposed_robust","adaptive_robust"].includes(m.id))
      .map(m=><Line key={m.id} dataKey={m.id} name={m.label} stroke={m.color}
       strokeWidth={m.id==="adaptive_robust"?3:2} dot={false} isAnimationActive={false}/>)}
    </LineChart></ResponsiveContainer>
   </Panel>
   <Panel title="Динамика параметров адаптации" subtitle="Эвристическая степень использования доверительных весов α(t) и симметричное усечение k(t).">
    <ResponsiveContainer width="100%" height={280}><LineChart data={trace}>
     <CartesianGrid stroke="#e6eaef" strokeDasharray="3 3"/><XAxis dataKey="step"/><YAxis yAxisId="left" domain={[0,1]}/><YAxis yAxisId="right" orientation="right"/>
     <Tooltip formatter={v=>num(v,4)}/><Legend/>
     <Line yAxisId="left" dataKey="alpha" name="α(t)" stroke="#c13f62" dot={false} strokeWidth={2} isAnimationActive={false}/>
     <Line yAxisId="right" dataKey="k" name="k(t)" stroke="#123a63" dot={false} isAnimationActive={false}/>
    </LineChart></ResponsiveContainer>
    <p className="r27-note">Диагностические переменные N_eff, readiness, disagreement и outlierCount включены в выгружаемую пошаговую трассу.</p>
   </Panel>
   <Panel title="Итоговые показатели по методам" subtitle="RMSE и MAE рассчитаны условно по принятым решениям, P(прав.) — по всем тактам, включая отказы.">
    <div className="table-wrap"><table><thead><tr><th>Метод</th><th>RMSE</th><th>MAE</th><th>P(прав.)</th><th>Покрытие</th><th>P95 |ошибки|</th><th>RMSE состояния</th></tr></thead>
     <tbody>{summary.map(s=><tr key={s.method}><td>{ADAPTIVE_METHODS.find(m=>m.id===s.method)?.label||s.method}</td>
      <td>{num(s.rmse.mean,5)}</td><td>{num(s.mae.mean,5)}</td><td>{percent(s.probability_correct.mean)}</td>
      <td>{percent(s.decision_coverage.mean)}</td><td>{num(s.p95_abs_error.mean,5)}</td><td>{num(s.state_rmse.mean,5)}</td>
     </tr>)}</tbody></table></div>
   </Panel>
   <Panel title="Парные сравнения RMSE" subtitle="Интервалы — нормальная аппроксимация 95% по независимым разностям, без поправки на множественные проверки.">
    <div className="table-wrap"><table><thead><tr><th>Контрольный метод</th><th>ΔRMSE</th><th>95%-й интервал</th><th>Выигрыши</th><th>Проигрыши</th></tr></thead>
     <tbody>{paired.map(p=><tr key={p.baseline}><td>{ADAPTIVE_METHODS.find(m=>m.id===p.baseline)?.label}</td>
      <td>{num(p.mean,5)}</td><td>{p.ci95_half_width===null?"—":num(p.mean-p.ci95_half_width,5)+" … "+num(p.mean+p.ci95_half_width,5)}</td>
      <td>{p.wins}</td><td>{p.losses}</td></tr>)}</tbody></table></div>
   </Panel>
   <React.Fragment>
   {methodState?<Panel title="Независимая динамика доверия и изоляции" subtitle="Методоспецифические контуры получают одинаковые ключевые внешние случайные события, но формируют собственные репутации, изоляцию и решения.">
    <ResponsiveContainer width="100%" height={290}><LineChart data={coupledTrace}>
     <CartesianGrid stroke="#e6eaef" strokeDasharray="3 3"/><XAxis dataKey="step"/>
     <YAxis yAxisId="isolation" orientation="left" allowDecimals={false}/><YAxis yAxisId="reputation" orientation="right" domain={[0,1]}/>
     <Tooltip formatter={v=>num(v,4)}/><Legend/>
     <Line dataKey="trimmedIsolation" name="Изоляция: усечённое" yAxisId="isolation" stroke="#d18a31" dot={false} isAnimationActive={false}/>
     <Line dataKey="combinedIsolation" name="Изоляция: комбинированное" yAxisId="isolation" stroke="#123a63" dot={false} isAnimationActive={false}/>
     <Line dataKey="adaptiveIsolation" name="Изоляция: адаптивное" yAxisId="isolation" stroke="#c13f62" dot={false} isAnimationActive={false}/>
     <Line dataKey="adaptiveReputation" name="Средняя репутация: адаптивное" yAxisId="reputation" stroke="#079b91" dot={false} strokeDasharray="4 3" isAnimationActive={false}/>
    </LineChart></ResponsiveContainer>
    <p className="r27-note">Режим отражает модельную обратную связь «решение → свидетельства → доверие и изоляция» и не является доказательством устойчивости ИМАС; распространение решений по сетевым компонентам не реализовано.</p>
    <div className="table-wrap"><table><thead><tr><th>Метод</th><th>Среднее число изолированных агентов</th><th>Средняя репутация</th></tr></thead><tbody>
     {summary.map(x=><tr key={x.method}><td>{ADAPTIVE_METHODS.find(m=>m.id===x.method)?.label||x.method}</td>
      <td>{num(x.mean_isolated_agents?.mean,3)}</td><td>{num(x.mean_reputation?.mean,3)}</td>
     </tr>)}
    </tbody></table></div>
   </Panel>:null}
   <Panel title="Диагностика генератора событий" subtitle="Показатели относятся к первому прогону и не используются адаптивным оценивателем.">
    <div className="table-wrap"><table><thead><tr><th>Показатель</th><th>Значение</th></tr></thead><tbody>
     <tr><td>Стратегия атакующего</td><td>{result.options.attackStrategy}</td></tr>
     <tr><td>Модель свидетельств</td><td>{result.options.evidenceModel}</td></tr>
     <tr><td>Сгенерировано модифицированных предложений</td><td>{result.runs[0].scenarioDiagnostics?.generatedAttackProposals??0}</td></tr>
     <tr><td>Оценено синтетических свидетельств</td><td>{result.runs[0].scenarioDiagnostics?.behaviorEvidenceGenerated??0}</td></tr>
     <tr><td>Нейтральные свидетельства (нет наблюдений)</td><td>{result.runs[0].scenarioDiagnostics?.uninformativeEvidence??0}</td></tr>
     <tr><td>Модифицировано свидетельств нарушителями</td><td>{result.runs[0].scenarioDiagnostics?.maliciousWitnessed??0}</td></tr>
     <tr><td>Свидетельства по устаревшим наблюдениям</td><td>{result.runs[0].scenarioDiagnostics?.laggedObservationCount??0}</td></tr>
    </tbody></table></div>
   </Panel>
   </React.Fragment>
   <Panel title="Полный протокол вычислений и экспорт">
    <p>JSON содержит конфигурацию, версии моделей, расписание фаз, значения показателей каждого прогона, диагностические переменные и траектории вспомогательной обратной связи. CSV содержит трассу первого прогона.</p>
    <div className="action-controls">
     <button type="button" className="secondary-button" onClick={()=>download("imas-adaptive-complete-study.json",JSON.stringify(result,null,2))}>Скачать полный JSON</button>
     <button type="button" className="secondary-button" onClick={prepareCsv}>Скачать CSV первого прогона</button>
    </div>
   </Panel>
   <p className="r27-note">Результаты относятся к модельной скалярной задаче при общей политике доверия и изоляции. Положительная динамика показателя не подтверждает устойчивость полной ИМАС. Формула α является гипотезой и подлежит независимой проверке.</p>
  </React.Fragment>:<div className="empty">Настройте адаптивный алгоритм, фазы атак и выполните исследование. Результаты исходного E1 сохраняются без изменений.</div>}
 </div>;
});
export default AdaptiveDecisionPanel;
