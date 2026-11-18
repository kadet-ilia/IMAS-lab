import React,{forwardRef,useEffect,useImperativeHandle,useRef,useState} from "react";
import {CartesianGrid,Line,LineChart,Legend,ReferenceLine,ResponsiveContainer,Tooltip,XAxis,YAxis} from "recharts";
import {ExperimentPanel as Panel,ExperimentKpi as Kpi,ExperimentParameterTooltip as Info} from "./ExperimentLayout.jsx";
import {ADAPTIVE_DEFAULTS,ADAPTIVE_METHODS,validateAdaptiveOptions} from "./adaptiveDecisionEngine.js";
import {validateAdaptiveStudy} from "./adaptiveExperiment.js";
import {runAdaptiveBrowser,stopAdaptiveBrowser,loadAdaptiveCheckpoint} from "./adaptiveBrowserClient.js";
import {ATTACK_SHAPES,defaultAttackPhases,attackIntensityAt} from "./attackProfiles.js";
import {ADAPTIVE_ATTACK_STRATEGIES,ADAPTIVE_EVIDENCE_MODELS} from "./adaptiveScenario.js";
import AdaptiveFklResultsPanel from "./AdaptiveFklResultsPanel.jsx";
import AdaptivePeriodicResultsPanel from "./AdaptivePeriodicResultsPanel.jsx";
import AdaptiveStudyAnalyticsPanel from "./AdaptiveStudyAnalyticsPanel.jsx";
import {projectAdaptiveAttackExposure} from "./adaptiveExposureDiagnostics.js";

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
 const autonomousTrace=result?.runs?.[0]?.scenarioDiagnosticsByMethod?.
  adaptive_robust?.localTransport?.history?.map(h=>({
   step:h.step,coverage:h.autonomousCoverage,trust:h.autonomousMeanTrust,
   freshUpdates:h.autonomousTrustUpdates,refusals:h.autonomousRefusals
  }))??[];
 const coupledTrace=methodState?trace.map((row,i)=>({
  step:row.step,trimmedIsolation:methodState.trimmed_unweighted[i].isolated_agents,
  combinedIsolation:methodState.proposed_robust[i].isolated_agents,
  adaptiveIsolation:methodState.adaptive_robust[i].isolated_agents,
  trimmedReputation:methodState.trimmed_unweighted[i].mean_reputation,
  combinedReputation:methodState.proposed_robust[i].mean_reputation,
  adaptiveReputation:methodState.adaptive_robust[i].mean_reputation,
  adaptiveReferenceCoverage:methodState.adaptive_robust[i].decision_reference_coverage,
  adaptiveRoutingHops:methodState.adaptive_robust[i].decision_hops_routed,
  adaptiveSharedUtilization:methodState.adaptive_robust[i].decision_shared_utilization,
  adaptiveBorrowed:methodState.adaptive_robust[i].decision_borrowed_slots,
  adaptiveReleasedToE1:methodState.adaptive_robust[i].decision_released_to_e1_slots,
  adaptiveLocalSpread:methodState.adaptive_robust[i].local_consensus_spread,
  adaptiveLocalComponents:methodState.adaptive_robust[i].local_consensus_component_count,
  adaptiveLocalMessages:methodState.adaptive_robust[i].local_consensus_messages,
  adaptiveLocalNeighborReadings:methodState.adaptive_robust[i].local_link_neighbor_readings,
  adaptiveLocalLinkTransmissions:methodState.adaptive_robust[i].local_link_transmissions,
  adaptiveLocalLinkSharedUtilization:methodState.adaptive_robust[i].local_link_shared_utilization,
  adaptiveLocalLinkHonestSpread:methodState.adaptive_robust[i].local_link_honest_spread,
  trimmedReferenceCoverage:methodState.trimmed_unweighted[i].decision_reference_coverage,
  combinedReferenceCoverage:methodState.proposed_robust[i].decision_reference_coverage
 })):[];
 const adaptive=summary.find(x=>x.method==="adaptive_robust");
 const baseline=summary.find(x=>x.method==="trimmed_unweighted");
 const combined=summary.find(x=>x.method==="proposed_robust");
 const comparable=paired.find(x=>x.baseline==="proposed_robust");
 const comparableTrimmed=paired.find(x=>x.baseline==="trimmed_unweighted");
 const regimeTrace=trace.map(row=>({...row,
  expertCombined:row.policyWeights?.proposed_robust??null,
  expertAdaptive:row.policyWeights?.adaptive??null,
  expertRisk:row.policyWeights?.risk_aware??null}));
 const currentPhase=options.phases||[];
 let attackExposure=null;
 if(!validationError&&options.scenario==="dynamic"){
  try{attackExposure=projectAdaptiveAttackExposure(options,config.n_steps);}
  catch{attackExposure=null;}
 }
 const addPhase=()=>{
  const last=currentPhase.at(-1),next=(last?.start??0)+Math.max(1,config.attack_start_step);
  if(next>config.n_steps){setWarning("Нет места для следующей фазы. Увеличьте горизонт T.");return;}
  set("phases",[...currentPhase,{start:next,intensity:0,profile:"constant"}]);setWarning("");
 };
 const prepareCsv=()=>{
  const keys=["step","attack_intensity","truth","trimmed_unweighted","proposed_robust",
   "adaptive_unweighted","adaptive_weighted","adaptive_robust",
   "alpha","k","nEffective","readiness","disagreement","outlierCount","available","retained","weightConcentration","riskContrast","riskPairs","riskWeightVote","riskLossPlain","riskLossWeighted",
   "regimeSelected","regimeState","evidenceQualityScore","regimeInnovation",
   "regimeCusum","policySwitches","policyPairs",
   "expertCombined","expertAdaptive","expertRisk"];
  const rows=[keys.join(";"),...regimeTrace.map(row=>keys.map(k=>row[k]??"").join(";"))];
  download("imas-adaptive-trajectory.csv",rows.join("\n"),"text/csv;charset=utf-8");
 };
 return <div className="tab-stack adaptive-study">
  <div className="tab-action">
   <div className="tab-action-description">
    <h2>Адаптивное формирование коллективных решений (E1-А)</h2>
    <p>Сравнение исходных доверительно-усечённых методов E1 с адаптивным агрегатором на одних и тех же предложениях, репутациях и сообщениях.</p>
    <p><strong>Область исследования:</strong> сравнение оценивателей при общем контуре либо раздельных контуров с обратной связью по решению. Раздельные контуры требуют поведенческих свидетельств. Для decision_feedback сеть отключается; network_feedback и network_routed используют сетевые ограничения с различной детальностью распространения решения. Устойчивость относится только к вспомогательному скалярному объекту.</p>
   </div>
   <div className="action-controls">
    <button className="secondary-button" type="button" disabled={running||Boolean(validationError)} onClick={start}>Выполнить исследование</button>
    <button className="secondary-button" type="button" disabled={!running} onClick={stop}>Остановить</button>
   </div>
  </div>
  <Panel title="Адаптивное правило и робастное усечение" subtitle="Новый метод рассчитывается отдельно от четырёх неизменённых методов E1.">
   <div className="lyapunov-inputs adaptive-inputs">
    <div className="adaptive-group-title">Режим исследования и сетевое взаимодействие</div>
    <label className="adaptive-wide-field">Режим сравнительного исследования
     <select aria-label="Режим сравнительного исследования" disabled={running}
      value={options.comparisonMode}
      onChange={e=>setOptions(o=>({...o,comparisonMode:e.target.value,
       evidenceModel:e.target.value!=="estimator_only"&&o.evidenceModel==="legacy"
        ?"behavior_linked":o.evidenceModel}))}>
      <option value="estimator_only">Общий контур: сравнение агрегаторов</option>
      <option value="decision_feedback">Раздельные контуры: мгновенная обратная связь, без сети</option>
      <option value="network_feedback">Раздельные контуры: доставка решений по компонентам сети</option>
      <option value="network_routed">Раздельные контуры: маршрутизация решений по рёбрам, общий бюджет</option>
     </select>
    </label>
    {["network_feedback","network_routed"].includes(options.comparisonMode)?<React.Fragment>
     <p className="r27-note">Для обоих сетевых режимов включите «Учитывать сетевые ограничения» в боковой панели. В network_feedback решение публикуется условно в компоненте без маршрута; в network_routed выполняется пошаговая маршрутизация по фактическим рёбрам и строгое резервирование общего лимита сообщений E1. Вычисление решения остаётся централизованным; распределённый консенсус не реализован.</p>
     <NumberOption label="Источник решения (индекс от 0)" title="Выбранный агент выступает источником публикации центрально рассчитанного решения. Если он недоступен или изолирован, передача не производится." value={options.decisionOriginAgent} min={0} max={159} step={1} disabled={running} onChange={v=>set("decisionOriginAgent",v)}/>
     <NumberOption label="Задержка доставки решения, шагов" title="Задержка не меньше одного шага; свидетельство никогда не использует недоставленное будущее решение." value={options.decisionDelaySteps} min={1} max={50} step={1} disabled={running} onChange={v=>set("decisionDelaySteps",v)}/>
     <NumberOption label="Вероятность потери решения" title="В режиме network_feedback потери учитываются по адресным публикациям в отдельном канале; в network_routed — независимо для каждого перехода по ребру из общей квоты." value={options.decisionLossProbability} min={0} max={1} step={0.05} disabled={running} onChange={v=>set("decisionLossProbability",v)}/>
     <NumberOption label="Срок актуальности решения, шагов" title="Не может быть меньше задержки; устаревшее или сетево недоступное решение не влияет на свидетельства." value={options.decisionMaxStalenessSteps} min={1} max={500} step={1} disabled={running} onChange={v=>set("decisionMaxStalenessSteps",v)}/>
     {options.comparisonMode==="network_routed"?<React.Fragment>
      <NumberOption label="Доля пропускной способности для решений" title="Целевая гарантированная квота floor(C·f) пересылок/шаг. В статическом варианте фиксирована, в заимствующем — динамически уменьшается до числа уже ожидающих маршрутизируемых пакетов." value={options.decisionBandwidthFraction} min={0} max={1} step={0.05} disabled={running} onChange={v=>set("decisionBandwidthFraction",v)}/>
      <label className="adaptive-wide-field">Политика использования общей полосы
       <select aria-label="Политика использования общей полосы" disabled={running} value={options.decisionBandwidthPolicy}
        onChange={e=>set("decisionBandwidthPolicy",e.target.value)}>
        <option value="static">Статическое резервирование (исходная модель)</option>
        <option value="opportunistic">Двустороннее заимствование свободных слотов</option>
        <option value="local_floor">Гарантированная квота соседских сообщений</option>
       </select>
      </label>
      <p className="r27-note">В режиме opportunistic часть незанятой полосы заимствуется поэтапно. В режиме local_floor резервируются доля маршрутизируемых решений и спросо-ограниченная квота причинных соседских сообщений; остаток передаётся E1, после чего свободные слоты могут использовать соседские сообщения. Для local_floor включите диагностику и причинный локальный транспорт.</p>
     </React.Fragment>:null}
    </React.Fragment>:null}
    {["network_feedback","network_routed"].includes(options.comparisonMode)?<React.Fragment>
     <label className="adaptive-checkbox"><input type="checkbox" checked={options.localConsensusPilot} disabled={running}
      onChange={e=>setOptions(o=>({...o,
       localConsensusPilot:e.target.checked,
       localTransportEnabled:e.target.checked?o.localTransportEnabled:false,
       localAutonomyEnabled:e.target.checked?o.localAutonomyEnabled:false,
       localAutonomyGuardEnabled:e.target.checked?o.localAutonomyGuardEnabled:false,
       localAutonomyActionFeedbackEnabled:e.target.checked?o.localAutonomyActionFeedbackEnabled:false}))}/>
      Диагностика локального согласования агентов по физическим рёбрам
     </label>
     {options.localConsensusPilot?<React.Fragment>
      <NumberOption label="Раунды локального обмена" value={options.localConsensusRounds}
       min={0} max={20} step={1} disabled={running} onChange={v=>set("localConsensusRounds",v)}/>
      <NumberOption label="Усечение соседних оценок" value={options.localConsensusTrim}
       min={0} max={40} step={1} disabled={running} onChange={v=>set("localConsensusTrim",v)}/>
      <NumberOption label="Коэффициент локального обновления" value={options.localConsensusRelaxation}
       min={0} max={1} step={0.05} disabled={running} onChange={v=>set("localConsensusRelaxation",v)}/>
      <p className="r27-note">Исходная диагностическая модель выполняет мгновенные идеальные раунды соседского обмена без сетевых затрат. Она сохранена как контрольное приближение.</p>
      <label className="adaptive-checkbox"><input type="checkbox" checked={options.localTransportEnabled} disabled={running}
       onChange={e=>setOptions(o=>({...o,localTransportEnabled:e.target.checked,
        localAutonomyEnabled:e.target.checked?o.localAutonomyEnabled:false,
        localAutonomyGuardEnabled:e.target.checked?o.localAutonomyGuardEnabled:false,
        localAutonomyActionFeedbackEnabled:e.target.checked?o.localAutonomyActionFeedbackEnabled:false}))}/>
       Причинные соседские сообщения (остаточная полоса или гарантированная квота)
      </label>
      {options.localTransportEnabled?<React.Fragment>
       <label className="adaptive-checkbox"><input type="checkbox" checked={options.localAutonomyEnabled} disabled={running}
        onChange={e=>setOptions(o=>({...o,
         localAutonomyEnabled:e.target.checked,
         localAutonomyGuardEnabled:e.target.checked?o.localAutonomyGuardEnabled:false,
         localAutonomyActionFeedbackEnabled:e.target.checked?o.localAutonomyActionFeedbackEnabled:false}))}/>
        Независимые локальные решения и персональное доверие к соседям (пилот)
       </label>
       {options.localAutonomyEnabled?<React.Fragment>
        <NumberOption label="Порог сопоставимости соседских оценок"
         title="Параметр масштаба расхождения доставленного сообщения с собственным наблюдением агента на шаге отправки сообщения. Без эталона истины."
         value={options.localAutonomyEvidenceTolerance} min={0.001} max={100} step={0.05}
         disabled={running} onChange={v=>set("localAutonomyEvidenceTolerance",v)}/>
        <NumberOption label="Коэффициент памяти локального доверия"
         title="Экспоненциальное ослабление собственной направленной истории доверия к нейтральному априорному значению 0,5."
         value={options.localAutonomyDecay} min={0} max={1} step={0.05}
         disabled={running} onChange={v=>set("localAutonomyDecay",v)}/>
        <NumberOption label="Минимум доставленных соседских оценок"
         title="При меньшем числе своевременных доставленных оценок агент отказывается от коллективного решения, но для запуска обмена может передать собственное исходное предложение."
         value={options.localAutonomyMinNeighbors} min={0} max={159} step={1}
         disabled={running} onChange={v=>set("localAutonomyMinNeighbors",v)}/>
        <label className="adaptive-checkbox"><input type="checkbox" checked={options.localAutonomyGuardEnabled} disabled={running}
         onChange={e=>set("localAutonomyGuardEnabled",e.target.checked)}/>
         Локальная защитная фильтрация недостоверных соседских оценок (пилот)
        </label>
        {options.localAutonomyGuardEnabled?<React.Fragment>
         <NumberOption label="Порог локального исключения соседа"
          title="Ниже этого уровня персонального доверия сосед временно исключается из локальной агрегации после достаточного числа новых свидетельств."
          value={options.localAutonomyGuardThreshold} min={0.01} max={0.95} step={0.05}
          disabled={running} onChange={v=>set("localAutonomyGuardThreshold",v)}/>
         <NumberOption label="Гистерезис повторного допуска"
          title="Разница между порогами исключения и повторного допуска; сумма с порогом исключения должна быть меньше 1."
          value={options.localAutonomyGuardHysteresis} min={0} max={0.5} step={0.05}
          disabled={running} onChange={v=>set("localAutonomyGuardHysteresis",v)}/>
         <NumberOption label="Минимум новых свидетельств для защитного действия"
          title="Гарантирует, что отдельное случайное расхождение не приводит к немедленному исключению."
          value={options.localAutonomyGuardMinEvidence} min={1} max={500} step={1}
          disabled={running} onChange={v=>set("localAutonomyGuardMinEvidence",v)}/>
         <p className="r27-note">Локальное исключение действует только в оценивателе данного агента. При изменении доверия повторный допуск возможен по новым пакетам. Физические соединения и глобальная изоляция E1 не изменяются; возможны ложные исключения честных соседей.</p>
        </React.Fragment>:null}
        <label className="adaptive-checkbox"><input type="checkbox" checked={options.localAutonomyActionFeedbackEnabled} disabled={running}
         onChange={e=>set("localAutonomyActionFeedbackEnabled",e.target.checked)}/>
         Замкнутый контур локальных действий и соседских сообщений (пилот)
        </label>
        {options.localAutonomyActionFeedbackEnabled?<React.Fragment>
         <NumberOption label="Коэффициент перехода локального действия"
          title="Множитель отклонения нового локального решения от ранее применённого собственного действия."
          value={options.localAutonomyActionGain} min={0} max={1} step={0.05}
          disabled={running} onChange={v=>set("localAutonomyActionGain",v)}/>
         <NumberOption label="Максимальный шаг локального действия"
          title="Абсолютное ограничение изменения принятого локального действия за один активный такт."
          value={options.localAutonomyActionMaxStep} min={0.001} max={100} step={0.05}
          disabled={running} onChange={v=>set("localAutonomyActionMaxStep",v)}/>
         <label>Действие при отказе от локального решения
          <select aria-label="Действие при отказе от локального решения" disabled={running}
           value={options.localAutonomyActionRefusalPolicy}
           onChange={e=>set("localAutonomyActionRefusalPolicy",e.target.value)}>
           <option value="hold">Удерживать последнее действие</option>
           <option value="observe">Вернуться к собственному наблюдению</option>
          </select>
         </label>
         <p className="r27-note">Принятое локальное действие отправляется соседям только после расчёта текущего такта. Отказ не считается принятым решением; для обмена отправляется собственное наблюдение. Контур не воздействует на физический объект, центральную изоляцию или свидетельства E1.</p>
        </React.Fragment>:null}
        <NumberOption label="Стоимость отказа от локального решения"
         title="Постфактум штраф за каждый такт честного активного агента без принятого решения, в единицах квадрата ошибки. На локальный алгоритм не влияет."
         value={options.localAutonomyRefusalPenalty} min={0} max={10000} step={0.1}
         disabled={running} onChange={v=>set("localAutonomyRefusalPenalty",v)}/>
        <p className="r27-note">Доверие Tᵢⱼ рассчитывается отдельно каждым агентом по его собственным историческим наблюдениям и фактически доставленным сообщениям непосредственных соседей. Глобальная репутация E1 не используется локальным решателем. Отказ отличается от первичного сообщения. Полученные решения пока не воздействуют на центральный контур свидетельств и изоляции.</p>
       </React.Fragment>:null}
       {options.comparisonMode==="network_routed"&&options.decisionBandwidthPolicy==="local_floor"?<NumberOption
        label="Доля общей полосы для локальных сообщений"
        title="Максимум floor(C·f_local) гарантированных передач за такт при наличии текущего достижимого соседского спроса. Сумма с квотой решений не должна превышать 1."
        value={options.localTransportBandwidthFraction} min={0} max={1} step={0.05}
        disabled={running} onChange={v=>set("localTransportBandwidthFraction",v)}/>:null}
       <NumberOption label="Задержка соседского сообщения, шагов" value={options.localTransportDelaySteps}
        min={1} max={50} step={1} disabled={running} onChange={v=>set("localTransportDelaySteps",v)}/>
       <NumberOption label="Потери соседских сообщений" value={options.localTransportLossProbability}
        min={0} max={1} step={0.05} disabled={running} onChange={v=>set("localTransportLossProbability",v)}/>
       <NumberOption label="Максимальный возраст соседского сообщения, шагов" value={options.localTransportMaxAgeSteps}
        min={1} max={500} step={1} disabled={running} onChange={v=>set("localTransportMaxAgeSteps",v)}/>
       <p className="r27-note">Каждый активный агент рассчитывает локальную оценку только по своему текущему предложению и ранее доставленным однопереходным сообщениям непосредственных соседей. Передача происходит в конце такта через остаточные слоты; в local_floor заранее выделяется ограниченная квота для существующего соседского спроса; учитываются потери, задержки, TTL, разрывы рёбер и баланс сообщений. Сетевые пакеты не заменяют центральное решение и не управляют доверительным контуром. Это диагностический режим с низким приоритетом, а не протокол византийского согласования.</p>
      </React.Fragment>:null}
      <p className="r27-note">Оба диагностических расчёта не изменяют центральное решение E1-А, свидетельства, изоляцию и маршрутизацию и не доказывают византийский консенсус.</p>
     </React.Fragment>:null}
    </React.Fragment>:null}
    <div className="adaptive-group-title">Коэффициент смешивания и историческая оценка риска</div>
    <label className="adaptive-wide-field">Режим коэффициента α
     <select aria-label="Режим коэффициента alpha" disabled={running} value={options.alphaMode}
      onChange={e=>set("alphaMode",e.target.value)}>
      <option value="adaptive">Адаптивный (исходная эвристика)</option><option value="risk_aware">Рискоориентированный (историческая проверка)</option><option value="regime_aware">По наблюдаемому режиму (экспериментальный)</option><option value="fixed">Постоянный</option><option value="off">Без доверительного взвешивания</option>
     </select></label>
    <NumberOption label="Постоянное α" title="Используется только в режиме постоянного коэффициента." value={options.fixedAlpha} min={0} max={1} step={0.05} onChange={v=>set("fixedAlpha",v)} disabled={running||options.alphaMode!=="fixed"}/>
    {["risk_aware","regime_aware"].includes(options.alphaMode)?<React.Fragment>
     <NumberOption label="Память риска β" title="Экспоненциальная память прошлых относительных ошибок двух агрегаторов при прогнозе следующей наблюдаемой медианы." value={options.riskDecay} min={0} max={0.9999} step={0.05} disabled={running} onChange={v=>set("riskDecay",v)}/>
     <NumberOption label="Чувствительность к риску" title="Величина воздействия разности прошлых безоракульных оценок риска на коэффициент α." value={options.riskSensitivity} min={0} max={40} step={0.5} disabled={running} onChange={v=>set("riskSensitivity",v)}/>
     <NumberOption label="Минимум пар наблюдений" title="Не менее указанного числа пар соседних тактов перед включением исторически обученного веса." value={options.riskMinimumPairs} min={1} max={5000} step={1} disabled={running} onChange={v=>set("riskMinimumPairs",v)}/>
     <NumberOption label="Ограничение относительной ошибки" title="Ограничение нормированных невязок для робастной экспоненциальной оценки прогнозного риска." value={options.riskLossCap} min={0.1} max={1000} step={0.5} disabled={running} onChange={v=>set("riskLossCap",v)}/>
     <NumberOption label="Регуляризация риска" title="Положительная регуляризация знаменателя разности исторических ошибок." value={options.riskFloor} min={0.000001} max={100} step={0.01} disabled={running} onChange={v=>set("riskFloor",v)}/>
     <NumberOption label="Априорный вес" title="Доля взвешенной оценки до накопления достаточной предиктивной истории." value={options.riskPrior} min={0} max={1} step={0.05} disabled={running} onChange={v=>set("riskPrior",v)}/>
    </React.Fragment>:null}
    {options.alphaMode==="regime_aware"?<React.Fragment>
     <div className="adaptive-group-title">Диагностика изменений и политика выбора оценивателя</div>
     <label className="adaptive-wide-field">Правило выбора
      <select aria-label="Правило выбора оценивателя" disabled={running} value={options.regimeSelectionMode}
       onChange={e=>set("regimeSelectionMode",e.target.value)}>
       <option value="discrete">Дискретный выбор с гистерезисом</option>
       <option value="blend">Причинное смешивание трёх оценивателей</option>
      </select>
     </label>
     <NumberOption label="Минимум пар для выбора" title="Только завершённые прогнозные пары; до накопления истории используется комбинированный контроль E1." value={options.regimeMinimumPairs} min={1} max={5000} step={1} disabled={running} onChange={v=>set("regimeMinimumPairs",v)}/>
     <NumberOption label="Подготовка детектора, тактов" value={options.regimeMinHistory} min={2} max={1000} step={1} disabled={running} onChange={v=>set("regimeMinHistory",v)}/>
     <NumberOption label="Порог изменения режима" title="Нормированное изменение наблюдений, а не идентификатор типа атаки." value={options.regimeChangeThreshold} min={0.05} max={100} step={0.05} disabled={running} onChange={v=>set("regimeChangeThreshold",v)}/>
     <NumberOption label="Память детектора EWMA" value={options.regimeDecay} min={0} max={0.9999} step={0.05} disabled={running} onChange={v=>set("regimeDecay",v)}/>
     <NumberOption label="Интервал между изменениями, шагов" value={options.regimeCooldown} min={0} max={1000} step={1} disabled={running} onChange={v=>set("regimeCooldown",v)}/>
     <NumberOption label="Минимальная пригодность свидетельств" title="Эвристика полноты, концентрации и модельной задержки. Не является вероятностью честности." value={options.regimeMinimumQuality} min={0} max={1} step={0.05} disabled={running} onChange={v=>set("regimeMinimumQuality",v)}/>
     <NumberOption label="Минимум между переключениями" value={options.regimeHoldSteps} min={0} max={1000} step={1} disabled={running||options.regimeSelectionMode!=="discrete"} onChange={v=>set("regimeHoldSteps",v)}/>
     <NumberOption label="Преимущество для переключения" value={options.regimeSwitchMargin} min={0} max={100} step={0.01} disabled={running||options.regimeSelectionMode!=="discrete"} onChange={v=>set("regimeSwitchMargin",v)}/>
     <NumberOption label="Память оценки экспертов" value={options.regimeLossDecay} min={0} max={0.9999} step={0.05} disabled={running} onChange={v=>set("regimeLossDecay",v)}/>
     <NumberOption label="Ограничение невязки" value={options.regimeLossCap} min={0.1} max={1000} step={0.5} disabled={running} onChange={v=>set("regimeLossCap",v)}/>
     <NumberOption label="Температура смешивания" value={options.regimeTemperature} min={0.000001} max={100} step={0.05} disabled={running||options.regimeSelectionMode!=="blend"} onChange={v=>set("regimeTemperature",v)}/>
     <p className="r27-note">Исследовательская политика без доступа к эталону и меткам нарушителей. Сравнивается согласованность прошлых решений с текущей наблюдаемой медианой, которая сама может подвергаться атаке. Выводы о превосходстве не установлены.</p>
    </React.Fragment>:null}
    <div className="adaptive-group-title">Робастное усечение и весовые коэффициенты</div>
    <label className="adaptive-wide-field">Порядок обработки оценок
     <select aria-label="Порядок усечения" disabled={running} value={options.trimMode} onChange={e=>set("trimMode",e.target.value)}>
      <option value="source_first">Сначала усечение исходных значений</option>
      <option value="legacy_clip_first">Сначала медианное ограничение</option>
     </select></label>
    <label className="lyapunov-field-label adaptive-checkbox"><input type="checkbox" disabled={running} checked={options.adaptiveTrim}
     onChange={e=>set("adaptiveTrim",e.target.checked)}/> Адаптивное число усечений k</label>
    <NumberOption label="Постоянное k" title="Для нового агрегатора; оставляем исходный k неизменным при сравнении с E1." value={options.trimEachSide??config.trim_each_side} min={0} max={159} step={1} disabled={running||options.adaptiveTrim} onChange={v=>set("trimEachSide",v)}/>
    <NumberOption label="Максимальное адаптивное k" title="Верхняя граница симметричного усечения при выявленных экстремальных предложениях." value={options.maxAdaptiveTrim} min={0} max={159} step={1} disabled={running||!options.adaptiveTrim} onChange={v=>set("maxAdaptiveTrim",v)}/>
    <NumberOption label="Порог выбросов" title="Множитель робастного MAD для диагностики экстремальных наблюдений." value={options.outlierThreshold} min={0.1} max={100} step={0.25} disabled={running||!options.adaptiveTrim} onChange={v=>set("outlierThreshold",v)}/>
    <NumberOption label="Показатель весов γ" title="Изменяет выраженность различий репутаций перед нормировкой." value={options.gamma} min={0} max={5} step={0.1} disabled={running} onChange={v=>set("gamma",v)}/>
    <NumberOption label="Верхний вес wmax" title="Предел концентрации влияния отдельного агента." value={options.maxWeight} min={0.05} max={5} step={0.05} disabled={running} onChange={v=>set("maxWeight",v)}/>
    <NumberOption label="Минимальная эффективная доля" title="Нормированный эффективный размер выборки управляет степенью доверительного смешивания." value={options.minimumEffectiveFraction} min={0.01} max={1} step={0.05} disabled={running} onChange={v=>set("minimumEffectiveFraction",v)}/>
    <NumberOption label="Штраф за расхождение" title="Экспоненциальное уменьшение α при расхождении взвешенного и невзвешенного решений." value={options.disagreementPenalty} min={0} max={100} step={0.25} disabled={running} onChange={v=>set("disagreementPenalty",v)}/>
    <NumberOption label="Окно подготовки доверия" title="Количество завершённых шагов для достижения полной эвристической готовности. НЕ является статистической калибровкой доверия." value={options.warmupSteps} min={1} max={50000} step={1} disabled={running} onChange={v=>set("warmupSteps",v)}/>
    <div className="adaptive-group-title">Параметры эксперимента</div>
    <NumberOption label="Повторения R" title="Число независимых прогонов с одинаковой общей экзогенной реализацией для всех сравниваемых оценивателей." value={options.runs} min={1} max={200} step={1} disabled={running} onChange={v=>set("runs",v)}/>
    <NumberOption label="Штраф за отказ (квадрат ошибки)" title="Заранее заданная потеря при отсутствии решения на такте. Не включается в условный RMSE." value={options.decisionRefusalPenalty} min={0} max={10000} step={0.1} disabled={running} onChange={v=>set("decisionRefusalPenalty",v)}/>
    <NumberOption label="Коэффициент обратной связи" title="Только для вспомогательной скалярной модели, не является параметром основной ИМАС." value={options.feedbackGain} min={0.01} max={1.99} step={0.05} disabled={running} onChange={v=>set("feedbackGain",v)}/>
   </div>
   <p className="r27-note">В исходном режиме α — эвристика готовности истории, размера эффективной выборки и расхождения решений. В рискоориентированном режиме на такте t сравниваются решения такта t−1 с медианой доступных сообщений такта t; этот показатель прогнозного согласия не использует эталонную истину и не является калиброванным риском ошибки или вероятностью честности. Оба правила требуют независимой проверки. Новый режим выбора оценивателей также использует только причинную историю и остаётся экспериментальным. Отсутствие решения учитывается отдельным штрафом в безусловной потере.</p>
  </Panel>
  <Panel title="Временной сценарий атаки и фазовое расписание" className="adaptive-phases-panel">
   <label className="adaptive-scenario-field">Временной сценарий воздействия
    <select aria-label="Сценарий адаптивного исследования" disabled={running} value={options.scenario} onChange={e=>set("scenario",e.target.value)}>
     <option value="dynamic">Динамическое смещение с фазами</option>
     <option value="static_bias">Постоянное смещение</option>
     <option value="subtle_bias">Скрытое смещение</option>
     <option value="on_off">Периодическая атака</option>
     <option value="collusion">Согласованное смещение</option>
    </select></label>
   {options.scenario==="dynamic"?<>
    <div className="lyapunov-phase-grid adaptive-phase-grid" aria-label="Фазы динамической атаки">{currentPhase.map((p,i)=><div className="lyapunov-phase adaptive-phase" key={i}>
     <div className="lyapunov-phase-heading"><strong>Фаза {i+1}</strong>
      {i>0?<button type="button" className="inline-action" disabled={running} onClick={()=>set("phases",currentPhase.filter((_,j)=>j!==i))}>Удалить</button>:null}</div>
     <label>Начало, шаг <input type="number" aria-label={"Начало фазы E1-А "+(i+1)} min={1} max={config.n_steps} disabled={running||i===0} value={p.start} onChange={e=>updatePhase(i,"start",Number(e.target.value))}/></label>
     <label>Закон изменения <select aria-label={"Закон фазы E1-А "+(i+1)} disabled={running} value={p.profile??"constant"} onChange={e=>updatePhase(i,"profile",e.target.value)}>
      {ATTACK_SHAPES.map(s=><option key={s.id} value={s.id}>{s.label}</option>)}
     </select></label>
     <label>Начальная интенсивность <input type="number" min={0} max={5} step={0.1} disabled={running} value={p.intensity} onChange={e=>updatePhase(i,"intensity",Number(e.target.value))}/></label>
     {(p.profile??"constant")!=="constant"?<label>Конечная интенсивность <input type="number" min={0} max={5} step={0.1} disabled={running} value={p.endIntensity??p.intensity} onChange={e=>updatePhase(i,"endIntensity",Number(e.target.value))}/></label>:null}
    </div>)}</div>
    <div className="action-controls adaptive-phase-actions">
     <button type="button" className="secondary-button" disabled={running} onClick={addPhase}>Добавить фазу</button>
     <button type="button" className="secondary-button" disabled={running} onClick={()=>set("phases",defaultAttackPhases(config.n_steps,config.attack_start_step))}>Сбросить расписание</button>
    </div>
    <ResponsiveContainer width="100%" height={160}><LineChart data={attackExposure?.points??[]}>
     <CartesianGrid stroke="#e6eaef" strokeDasharray="3 3"/><XAxis dataKey="step"/><YAxis domain={[0,5]}/><Tooltip/><Legend/>
     <Line name="Номинальная интенсивность" type="stepAfter" dataKey="intensity" dot={false} stroke="#c13f62" isAnimationActive={false}/>
     <Line name="Фактическая активность стратегии" type="stepAfter" dataKey="actualIntensity" dot={false} stroke="#079b91" isAnimationActive={false}/>
    </LineChart></ResponsiveContainer>
    {attackExposure?<p className={attackExposure.zeroEffectiveExposure?"imas-validation-error":"r27-note"} role={attackExposure.zeroEffectiveExposure?"alert":"status"}>
     Активных тактов по расписанию: {attackExposure.effectiveActiveSteps} из {config.n_steps}; номинально интенсивность была положительной на {attackExposure.nominalActiveSteps} тактах.
     {attackExposure.zeroEffectiveExposure?" Предупреждение: выбранные временные фазы и период поведения не пересекаются; эксперимент не содержит активного воздействия нарушителей.":""}
     {" "}Показана расчётная активность генератора, а не успешность кибератаки или доставка сообщений.
    </p>:null}
   </>:<p className="r27-note">Используется базовая генерация указанного сценария E1; фазовый редактор доступен в режиме динамического воздействия.</p>}
  </Panel>
  <Panel title="Модель поведения нарушителей и доверительных свидетельств" subtitle="Стратегия поведения задаётся независимо от временного профиля активности. Скрытые метки доступны только генератору событий.">
   <div className="lyapunov-inputs adaptive-inputs">
    <div className="adaptive-group-title">Параметры стратегии нападения</div>
    <label className="adaptive-wide-field">Стратегия поведения нарушителей
     <select aria-label="Стратегия поведения нарушителей" disabled={running} value={options.attackStrategy}
      onChange={e=>setOptions(o=>({...o,attackStrategy:e.target.value,
       evidenceModel:e.target.value==="reputation_boost"&&o.evidenceModel==="legacy"?"behavior_linked":o.evidenceModel}))}>
      {ADAPTIVE_ATTACK_STRATEGIES.map(x=><option key={x.id} value={x.id}>{x.label}</option>)}
     </select>
    </label>
    <label className="adaptive-wide-field">Модель доверительных свидетельств
     <select aria-label="Модель доверительных свидетельств" disabled={running} value={options.evidenceModel}
      onChange={e=>set("evidenceModel",e.target.value)}>
      {ADAPTIVE_EVIDENCE_MODELS.map(x=><option key={x.id} value={x.id}>{x.label}</option>)}
     </select>
    </label>
    <div className="adaptive-group-title">Параметры атакующего воздействия</div>
    <NumberOption label="Смещение согласованной атаки" title="Модуль общего смещения предложений нарушителей относительно модельного эталона. Истина применяется генератором событий, а не оценивателем." value={options.coordinatedBias} min={0} max={100} step={0.1} disabled={running||!["coordinated","pulsed","reputation_boost"].includes(options.attackStrategy)} onChange={v=>set("coordinatedBias",v)}/>
    <NumberOption label="Малозаметное смещение" title="Модуль искажения предложения нарушителя в малозаметном режиме." value={options.stealthBias} min={0} max={100} step={0.05} disabled={running||options.attackStrategy!=="stealth"} onChange={v=>set("stealthBias",v)}/>
    <NumberOption label="Шум атакующих предложений" title="СКО дополнительного случайного отклонения при формировании атакующих предложений." value={options.attackNoiseSigma} min={0} max={10} step={0.005} disabled={running||options.attackStrategy==="legacy"} onChange={v=>set("attackNoiseSigma",v)}/>
    <NumberOption label="Период атаки" title="Продолжительность полного цикла периодического поведения." value={options.attackPeriod} min={1} max={500} step={1} disabled={running||options.attackStrategy!=="pulsed"} onChange={v=>set("attackPeriod",v)}/>
    <NumberOption label="Активных шагов в периоде" title="Первые d тактов из каждого периода заняты воздействием." value={options.attackDuty} min={1} max={500} step={1} disabled={running||options.attackStrategy!=="pulsed"} onChange={v=>set("attackDuty",v)}/>
    <NumberOption label="Длительность накопления репутации" title="Число начальных шагов, когда скомпрометированные агенты отправляют корректные предложения перед переходом к атаке." value={options.reputationWarmup} min={0} max={50000} step={1} disabled={running||options.attackStrategy!=="reputation_boost"} onChange={v=>set("reputationWarmup",v)}/>
    <div className="adaptive-group-title">Параметры свидетельств и наблюдений</div>
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
    <Kpi label="RMSE комбинированного E1" value={num(combined?.rmse.mean,5)} note="Основной контроль новых методов"/>
     <Kpi label="RMSE усечённого E1" value={num(baseline?.rmse.mean,5)} note={"Дополнительный контроль; ΔRMSE "+num(comparableTrimmed?.mean,5)}/>
    <Kpi label="Парный эффект ΔRMSE" value={num(comparable?.mean,5)} note="E1-А − комбинированный E1; отрицательное лучше"/>
    <Kpi label="Победы / проигрыши" value={(comparable?.wins??0)+" / "+(comparable?.losses??0)} note={"По "+(comparable?.n??0)+" парным прогонам"}/>
   </div>
   <AdaptiveStudyAnalyticsPanel study={result}/>
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
   {options.localAutonomyEnabled&&autonomousTrace.length?<Panel
    title="Независимые локальные решения агентов (пилот)"
    subtitle="Первый прогон: причинный обмен соседскими сообщениями и персональные оценки доверия; центральный E1 не заменён.">
    <div className="kpi-grid">
     <Kpi label="Доля сформированных локальных решений" value={percent(adaptive?.mean_local_autonomous_coverage?.mean)}
      note="Относительно активных агентов на всех тактах"/>
     <Kpi label="RMSE всех локальных решений" value={num(adaptive?.mean_local_autonomous_rmse?.mean,5)}
      note="Включая имитационные решения нарушителей; только постфактум"/>
     <Kpi label="RMSE локальных решений честных агентов" value={num(adaptive?.mean_local_autonomous_honest_rmse?.mean,5)}
      note="Только принятые решения — возможна селекция по отказам"/>
     <Kpi label="Безусловная потеря честных агентов" value={num(adaptive?.mean_local_autonomous_honest_unconditional_loss?.mean,5)}
      note="Все активные агент-такты, при отказе применяется заданный штраф"/>
     {options.localAutonomyActionFeedbackEnabled?<React.Fragment>
      <Kpi label="MSE локально применённых действий" value={num(adaptive?.mean_local_autonomous_honest_action_mse?.mean,5)}
       note="Включая удержание либо собственное наблюдение при отказе"/>
      <Kpi label="Переходы локальных действий" value={num(adaptive?.mean_local_autonomous_action_updates?.mean,1)}
       note="Количество принятых обновлений локального контура"/>
     </React.Fragment>:null}
     <Kpi label="Обновления направленного доверия" value={num(adaptive?.mean_local_autonomous_trust_updates?.mean,1)}
      note="По уникальным впервые доставленным соседским сообщениям"/>
     {options.localAutonomyGuardEnabled?<React.Fragment>
      <Kpi label="Исключённые соседские оценки" value={num(adaptive?.mean_local_autonomous_guard_exclusions?.mean,1)}
       note="Общее число отклонённых локальных наблюдений"/>
      <Kpi label="Исключения честных соседей" value={num(adaptive?.mean_local_autonomous_guard_honest_exclusions?.mean,1)}
       note="Постфактум оценка по скрытым меткам синтетической модели"/>
     </React.Fragment>:null}
    </div>
    <ResponsiveContainer width="100%" height={240}><LineChart data={autonomousTrace}>
     <CartesianGrid stroke="#e6eaef" strokeDasharray="3 3"/><XAxis dataKey="step"/>
     <YAxis domain={[0,1]}/><Tooltip formatter={v=>num(v,4)}/><Legend/>
     <Line dataKey="coverage" name="Доля локальных решений" stroke="#079b91"
      dot={false} isAnimationActive={false}/>
     <Line dataKey="trust" name="Средняя локальная оценка доверия" stroke="#123a63"
      dot={false} isAnimationActive={false}/>
    </LineChart></ResponsiveContainer>
    <p className="r27-note">Безусловная потеря включает отказы; RMSE принятых решений — нет. Замкнутый локальный обмен действиями не моделирует физический объект или глобальную защиту E1 и не доказывает византийский консенсус.</p>
   </Panel>:null}
   <Panel title="Динамика параметров адаптации" subtitle="Эвристическая степень использования доверительных весов α(t) и симметричное усечение k(t).">
    <ResponsiveContainer width="100%" height={280}><LineChart data={trace}>
     <CartesianGrid stroke="#e6eaef" strokeDasharray="3 3"/><XAxis dataKey="step"/><YAxis yAxisId="left" domain={[0,1]}/><YAxis yAxisId="right" orientation="right"/>
     <Tooltip formatter={v=>num(v,4)}/><Legend/>
     <Line yAxisId="left" dataKey="alpha" name="α(t)" stroke="#c13f62" dot={false} strokeWidth={2} isAnimationActive={false}/>
     <Line yAxisId="right" dataKey="k" name="k(t)" stroke="#123a63" dot={false} isAnimationActive={false}/>
    </LineChart></ResponsiveContainer>
    <p className="r27-note">Диагностические переменные N_eff, readiness, disagreement и outlierCount включены в выгружаемую пошаговую трассу. В режиме оценки риска дополнительно сохраняются парная разность накопленных прогнозных потерь, количество доступных пар, исторические риски и выбор доверительных весов.</p>
    {options.alphaMode==="risk_aware"?<ResponsiveContainer width="100%" height={230}><LineChart data={trace}>
     <CartesianGrid stroke="#e6eaef" strokeDasharray="3 3"/><XAxis dataKey="step"/><YAxis domain={[-1,1]}/>
     <Tooltip formatter={v=>num(v,5)}/><Legend/>
     <Line dataKey="riskContrast" name="Нормированная разность прогнозных ошибок" stroke="#8c56a5" dot={false} isAnimationActive={false}/>
    </LineChart></ResponsiveContainer>:null}
   </Panel>
   {options.alphaMode==="regime_aware"&&regimeTrace.length?<Panel title="Диагностика выбора оценивателя"
    subtitle="Вес и выбор экспертов по причинной истории наблюдаемых сообщений; не классификация атак и не калиброванная вероятность риска.">
    <div className="kpi-grid">
     <Kpi label="Последний выбранный метод" value={regimeTrace.at(-1)?.regimeSelected??"—"} note="Дискретный выбор либо смешивание"/>
     <Kpi label="Переключений" value={regimeTrace.at(-1)?.policySwitches??0} note="По первому прогону"/>
     <Kpi label="Зарегистрировано смен режима" value={regimeTrace.filter(x=>x.regimeState==="change_detected").length} note="Статистические события, не метки нарушителей"/>
     <Kpi label="Пригодность свидетельств" value={num(regimeTrace.at(-1)?.evidenceQualityScore,3)} note="Синтетическая эвристика, не вероятность честности"/>
    </div>
    <ResponsiveContainer width="100%" height={250}><LineChart data={regimeTrace}>
     <CartesianGrid stroke="#e6eaef" strokeDasharray="3 3"/><XAxis dataKey="step"/><YAxis domain={[0,1]}/>
     <Tooltip formatter={v=>num(v,4)}/><Legend/>
     <Line dataKey="expertCombined" name="Вес комбинированного E1" stroke="#123a63" dot={false} isAnimationActive={false}/>
     <Line dataKey="expertAdaptive" name="Вес исходного E1-А" stroke="#c13f62" dot={false} isAnimationActive={false}/>
     <Line dataKey="expertRisk" name="Вес рискоориентированного E1-А" stroke="#079b91" dot={false} isAnimationActive={false}/>
    </LineChart></ResponsiveContainer>
    <ResponsiveContainer width="100%" height={185}><LineChart data={regimeTrace}>
     <CartesianGrid stroke="#e6eaef" strokeDasharray="3 3"/><XAxis dataKey="step"/><YAxis domain={[0,1]}/>
     <Tooltip formatter={v=>num(v,4)}/><Legend/>
     <Line dataKey="evidenceQualityScore" name="Пригодность свидетельств" stroke="#8c56a5" dot={false} isAnimationActive={false}/>
    </LineChart></ResponsiveContainer>
    <div className="table-wrap"><table><thead><tr>
     <th>Шаг</th><th>Режим</th><th>Оцениватель</th><th>Пригодность</th><th>Инновация</th>
    </tr></thead><tbody>{regimeTrace.slice(-12).map(x=><tr key={x.step}>
     <td>{x.step}</td><td>{x.regimeState??"—"}</td><td>{x.regimeSelected??"—"}</td>
     <td>{num(x.evidenceQualityScore,4)}</td><td>{num(x.regimeInnovation,4)}</td>
    </tr>)}</tbody></table></div>
    <p className="r27-note">Режим экспериментальный. При недостатке информации, смене наблюдаемого режима или низкой пригодности свидетельств применяется контрольное комбинированное E1. Оценки экспертов сопоставляются с последующей наблюдаемой медианой, которая уязвима к согласованному смещению. Универсальное превосходство не установлено.</p>
   </Panel>:null}
   <Panel title="Итоговые показатели по методам" subtitle="RMSE и MAE — по принятым решениям. Безусловная потеря включает заданный штраф отказа; P(прав.) — по всем тактам.">
    <div className="table-wrap"><table><thead><tr><th>Метод</th><th>RMSE</th><th>MAE</th><th>P(прав.)</th><th>Покрытие</th><th>Безусловная потеря</th><th>Отказы</th><th>P95 |ошибки|</th><th>RMSE состояния</th></tr></thead>
     <tbody>{summary.map(s=><tr key={s.method}><td>{ADAPTIVE_METHODS.find(m=>m.id===s.method)?.label||s.method}</td>
      <td>{num(s.rmse.mean,5)}</td><td>{num(s.mae.mean,5)}</td><td>{percent(s.probability_correct.mean)}</td>
      <td>{percent(s.decision_coverage.mean)}</td><td>{num(s.unconditional_decision_loss?.mean,5)}</td><td>{num(s.refusals?.mean,1)}</td><td>{num(s.p95_abs_error.mean,5)}</td><td>{num(s.state_rmse.mean,5)}</td>
     </tr>)}</tbody></table></div>
   </Panel>
   <Panel title="Парные сравнения RMSE" subtitle="Интервалы — нормальная аппроксимация 95%, не скорректированная на множественность. Двусторонний sign-flip p скорректирован Холмом для четырёх контрастов при R≥2. Выводы остаются исследовательскими.">
    <div className="table-wrap"><table><thead><tr><th>Контрольный метод</th><th>ΔRMSE</th><th>95%-й интервал</th><th>p (sign-flip)</th><th>p (Холм)</th><th>Выигрыши</th><th>Проигрыши</th></tr></thead>
     <tbody>{[...paired].sort((a,b)=>Number(b.baseline==="proposed_robust")-Number(a.baseline==="proposed_robust")).map(p=><tr key={p.baseline}><td>{ADAPTIVE_METHODS.find(m=>m.id===p.baseline)?.label}</td>
      <td>{num(p.mean,5)}</td><td>{p.ci95_half_width===null?"—":num(p.mean-p.ci95_half_width,5)+" … "+num(p.mean+p.ci95_half_width,5)}</td>
      <td>{num(p.p_value,5)}</td><td>{num(p.p_holm,5)}</td><td>{p.wins}</td><td>{p.losses}</td></tr>)}</tbody></table></div>
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
    {["network_feedback","network_routed"].includes(options.comparisonMode)?<>
     <ResponsiveContainer width="100%" height={225}><LineChart data={coupledTrace}>
      <CartesianGrid stroke="#e6eaef" strokeDasharray="3 3"/><XAxis dataKey="step"/>
      <YAxis domain={[0,1]}/><Tooltip formatter={v=>num(v,4)}/><Legend/>
      <Line dataKey="adaptiveReferenceCoverage" name="Доступность решения: адаптивное" stroke="#c13f62" dot={false} isAnimationActive={false}/>
      <Line dataKey="combinedReferenceCoverage" name="Доступность решения: комбинированное" stroke="#123a63" dot={false} isAnimationActive={false}/>
      <Line dataKey="trimmedReferenceCoverage" name="Доступность решения: усечённое" stroke="#d18a31" dot={false} isAnimationActive={false}/>
     </LineChart></ResponsiveContainer>
     <p className="r27-note">Доступность — доля активных агентов компоненты источника с актуальной записью доставленного решения к началу такта. {options.comparisonMode==="network_routed"?"Пересылка по каждому ребру расходует одну единицу из заранее зарезервированной доли общего бюджета E1; недостающие слоты вызывают очереди.":"При компонентной публикации канал имеет отдельный бюджет и не моделирует маршрутизацию по рёбрам."}</p>
     <div className="table-wrap"><table><thead><tr><th>Метод</th><th>Средняя доступность решения</th><th>Доставлено</th><th>Потеряно</th><th>Недоставлено при разрыве сети</th></tr></thead><tbody>
      {summary.map(x=><tr key={x.method}><td>{ADAPTIVE_METHODS.find(m=>m.id===x.method)?.label||x.method}</td>
       <td>{percent(x.mean_decision_reference_coverage?.mean)}</td>
       <td>{result.runs[0].scenarioDiagnosticsByMethod?.[x.method]?.decisionChannel?.delivered??0}</td>
       <td>{result.runs[0].scenarioDiagnosticsByMethod?.[x.method]?.decisionChannel?.lost??0}</td>
       <td>{result.runs[0].scenarioDiagnosticsByMethod?.[x.method]?.decisionChannel?.blocked??0}</td>
      </tr>)}
     </tbody></table></div>
     {options.comparisonMode==="network_routed"?<>
      <ResponsiveContainer width="100%" height={225}><LineChart data={coupledTrace}>
       <CartesianGrid stroke="#e6eaef" strokeDasharray="3 3"/><XAxis dataKey="step"/>
       <YAxis yAxisId="util" domain={[0,1]}/><YAxis yAxisId="hop" orientation="right" allowDecimals={false}/>
       <Tooltip formatter={v=>num(v,4)}/><Legend/>
       <Line dataKey="adaptiveSharedUtilization" yAxisId="util" name="Общая загрузка каналов E1 + решения" stroke="#0b7c9a" dot={false} isAnimationActive={false}/>
       <Line dataKey="adaptiveRoutingHops" yAxisId="hop" name="Маршрутизированные переходы/такт" stroke="#8f50a2" dot={false} isAnimationActive={false}/>
       {options.decisionBandwidthPolicy==="opportunistic"?<>
        <Line dataKey="adaptiveBorrowed" yAxisId="hop" name="Заимствовано решениями у E1" stroke="#bf5c3d" dot={false} isAnimationActive={false}/>
        <Line dataKey="adaptiveReleasedToE1" yAxisId="hop" name="Высвобождено для E1" stroke="#37854c" dot={false} isAnimationActive={false}/>
       </>:null}
      </LineChart></ResponsiveContainer>
      <p className="r27-note">При static E1 получает C−floor(C·f), решения получают floor(C·f) без перераспределения. При opportunistic предварительный резерв снижается до числа ожидающих маршрутизируемых пакетов, после обслуживания E1 решения занимают свободные слоты. Во всех случаях U_E+U_D≤C; маршруты пересчитываются на каждом промежуточном узле, обрыв ребра приводит к потере без ретрансляции. Это последовательный планировщик по текущему графу, не оптимальная распределённая передача.</p>
      {options.decisionBandwidthPolicy==="opportunistic"?<div className="table-wrap"><table><thead><tr><th>Метод</th><th>Среднее заимствование решениями, сообщ./шаг</th><th>Среднее высвобождение для E1, сообщ./шаг</th></tr></thead><tbody>
       {summary.map(x=><tr key={x.method}><td>{ADAPTIVE_METHODS.find(m=>m.id===x.method)?.label||x.method}</td>
        <td>{num(x.mean_borrowed_decision_slots?.mean,3)}</td>
        <td>{num(x.mean_released_to_e1_slots?.mean,3)}</td>
       </tr>)}
      </tbody></table></div>:null}
     </>:null}
    </>:null}
    {options.localConsensusPilot?<React.Fragment>
     <ResponsiveContainer width="100%" height={230}><LineChart data={coupledTrace}>
      <CartesianGrid stroke="#e6eaef" strokeDasharray="3 3"/><XAxis dataKey="step"/>
      <YAxis yAxisId="spread"/><YAxis yAxisId="components" orientation="right" allowDecimals={false}/>
      <Tooltip formatter={v=>num(v,4)}/><Legend/>
      <Line dataKey="adaptiveLocalSpread" name="Максимальный разброс честных оценок в компоненте" yAxisId="spread" stroke="#9a45a5" dot={false} isAnimationActive={false}/>
      <Line dataKey="adaptiveLocalComponents" name="Число активных компонент" yAxisId="components" stroke="#236f8b" dot={false} isAnimationActive={false}/>
     </LineChart></ResponsiveContainer>
     <div className="table-wrap"><table><thead><tr><th>Метод</th><th>Средний разброс честных локальных оценок</th><th>Число компонент</th><th>Условных соседских сообщений за шаг</th></tr></thead><tbody>
      {summary.map(x=><tr key={x.method}>
       <td>{ADAPTIVE_METHODS.find(m=>m.id===x.method)?.label||x.method}</td>
       <td>{num(x.mean_local_consensus_spread?.mean,5)}</td>
       <td>{num(x.mean_local_consensus_components?.mean,2)}</td>
       <td>{num(x.mean_local_consensus_messages?.mean,2)}</td>
      </tr>)}
     </tbody></table></div>
     <p className="r27-note">Разброс и число условных передач в таблице выше относятся к идеальным синхронным обменам, не включённым в общий бюджет E1. Синтетические метки нарушителей используются только генератором и постфактум-расчётом разброса, но не обновлением оценки честного агента.</p>
     {options.localTransportEnabled?<React.Fragment>
      <ResponsiveContainer width="100%" height={220}><LineChart data={coupledTrace}>
       <CartesianGrid stroke="#e6eaef" strokeDasharray="3 3"/><XAxis dataKey="step"/>
       <YAxis yAxisId="count" allowDecimals={false}/>
       <YAxis yAxisId="util" orientation="right" domain={[0,1]}/>
       <Tooltip formatter={v=>num(v,4)}/><Legend/>
       <Line dataKey="adaptiveLocalNeighborReadings" name="Прочитано ранее доставленных соседских значений" yAxisId="count" stroke="#4d78b7" dot={false} isAnimationActive={false}/>
       <Line dataKey="adaptiveLocalLinkTransmissions" name="Однопереходные передачи за такт" yAxisId="count" stroke="#af6f2c" dot={false} isAnimationActive={false}/>
       <Line dataKey="adaptiveLocalLinkSharedUtilization" name="Общая загрузка E1, решений и соседских сообщений" yAxisId="util" stroke="#15765c" dot={false} isAnimationActive={false}/>
      </LineChart></ResponsiveContainer>
      <div className="table-wrap"><table><thead><tr><th>Метод</th><th>Соседские значения/шаг</th><th>Реальные передачи/шаг</th><th>Средняя общая загрузка</th><th>Разброс честных локальных оценок</th></tr></thead><tbody>
       {summary.map(x=><tr key={x.method}>
        <td>{ADAPTIVE_METHODS.find(m=>m.id===x.method)?.label||x.method}</td>
        <td>{num(x.mean_local_link_neighbor_readings?.mean,3)}</td>
        <td>{num(x.mean_local_link_transmissions?.mean,3)}</td>
        <td>{percent(x.mean_local_link_shared_utilization?.mean)}</td>
        <td>{num(x.mean_local_link_honest_spread?.mean,5)}</td>
       </tr>)}
      </tbody></table></div>
      <p className="r27-note">Проверяются равенство N_gen=N_delivered+N_lost+N_blocked+N_expired+N_superseded+N_pending и неравенство U_E1+U_decision+U_local≤C на каждом такте. Соседский обмен использует исключительно свободные слоты; при насыщении сети он может не состояться вообще.</p>
     </React.Fragment>:null}
    </React.Fragment>:null}
    <p className="r27-note">Показана модельная связь «решение → свидетельства → доверие и изоляция». network_feedback ограничивает доставку решения компонентами, а network_routed добавляет кратчайшие маршруты и либо статическое, либо динамически перераспределяемое резервирование общего лимита передач. Оба варианта не выполняют распределённое вычисление решения; доказательство устойчивости ИМАС отсутствует. Устойчивость всей ИМАС не доказана.</p>
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
   <p className="r27-note">Результаты относятся к модельной скалярной задаче. Режим сравнения: estimator_only, decision_feedback без сети, network_feedback с компонентной публикацией либо network_routed с многопереходной маршрутизацией и резервированием общего бюджета. Наличие малых p-значений не подтверждает состоятельность модели угроз и требует независимой подтверждающей серии. Функция V=e² не доказывает устойчивость полной ИМАС.</p>
  </React.Fragment>:<div className="empty">Настройте адаптивный алгоритм, фазы атак и выполните исследование. Результаты исходного E1 сохраняются без изменений.</div>}
  <AdaptiveFklResultsPanel/>
  <AdaptivePeriodicResultsPanel/>
 </div>;
});
export default AdaptiveDecisionPanel;
