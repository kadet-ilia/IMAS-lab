import React from "react";
import {STUDY_DEFS} from "./research2027.js";

const PARAMETERS={
 agents:["N — число агентов","Число моделируемых агентов. Для двух графов риска количество вершин фиксировано структурой исследовательской постановки.",3,100,1],
 runs:["R — число прогонов","Число независимых реализаций Монте-Карло. Для ограниченного анализа достижимости сетей Петри выполняется один формальный поиск.",1,10000,1],
 seed:["Начальное зерно генератора","Воспроизводимая псевдослучайная последовательность.",-2147483648,2147483647,1],
 signalNoise:["σ — СКО шума наблюдений","Стандартное отклонение ошибки локального наблюдения.",0,5,.01],
 loss:["pₘ — потеря сообщения","Базовая вероятность пропуска наблюдения.",0,1,.01],
 corruption:["pₐ — искажение сообщения","Вероятность формирования искажённого значения.",0,1,.01],
 threshold:["δ — порог уверенности","Минимальная абсолютная величина коллективной оценки для автоматического решения.",0,2,.01],
 edgeProbability:["pₑ — вероятность связи","Вероятность появления ориентированного ребра.",0,1,.01],
 spread:["pₛ — вероятность распространения","Вероятность передачи нарушения по ребру на одном такте.",0,1,.01],
 steps:["T — горизонт, тактов","Число модельных временных тактов.",1,20,1],
 criticalFraction:["q — опасная доля","Минимальная доля поражённых агентов, соответствующая опасному состоянию.",0,1,.01],
 detectionDelay:["τ — задержка изоляции","Первый такт, после которого доступен переход изоляции.",0,20,1],
 criticalCount:["K — критическое число","Число поражённых агентов для критической маркировки.",1,100,1],
 stateLimit:["M — предел маркировок","Максимальное количество состояний для ограниченной проверки.",100,200000,100],
 lossScale:["k — масштаб ущерба","Масштаб условных потерь. Не является валютной единицей.",0,100,.1],
 defenseFactor:["η — эффективность защиты","Коэффициент снижения интенсивности распространения.",0,1,.01],
 noise:["σ — СКО шума оценок","Стандартное отклонение исходных оценок агентов.",0,5,.01],
 attackBias:["b — смещение нарушителя","Модуль смещения предложений скомпрометированных агентов.",0,10,.1]
};

const GROUPS={
 uncertainty:[
  ["Основные параметры",["agents","runs"]],
  ["Неопределённость наблюдений",["signalNoise","loss","corruption"]],
  ["Принятие решений",["threshold"]],
 ],
 probgraph:[
  ["Основные параметры",["agents","runs"]],
  ["Граф взаимодействий",["edgeProbability","steps"]],
  ["Сценарий распространения",["spread","criticalFraction"]],
 ],
 petri:[
  ["Основные параметры",["agents","runs"]],
  ["Маркировки и переходы",["steps","criticalCount","detectionDelay"]],
  ["Формальная верификация",["stateLimit"]],
 ],
 cascade:[
  ["Основные параметры",["agents","runs"]],
  ["Каскадные воздействия",["spread","lossScale"]],
  ["Защитные меры",["defenseFactor"]],
 ],
 misinformation:[
  ["Основные параметры",["agents","runs"]],
  ["Компрометация и распространение",["spread","attackBias"]],
  ["Согласование решений",["noise","threshold"]],
 ]
};

function ResearchField({name,value,onChange,disabled=false}){
 const [title,description,min,max,step]=PARAMETERS[name]||[name,"",undefined,undefined,1];
 return <label className="field r27-setting-field">
   <span className="field-label"><span>{title}</span><span tabIndex={0} className="parameter-tooltip" aria-label={description}>ⓘ<span role="tooltip">{description}</span></span></span>
   <input aria-label={title} type="number" min={name==="criticalCount"?1:min} max={name==="criticalCount"?undefined:max} step={step} value={Number.isFinite(value)?value:""} disabled={disabled} onChange={e=>onChange(name,e.target.value===""?NaN:Number(e.target.value))}/>
   {disabled?<small>Фиксированная конфигурация исследовательского графа</small>:null}
 </label>;
}
export function ResearchSettings({studyId,config,onChange,onStart,onStop,onReset,running}){
 const def=STUDY_DEFS.find(s=>s.id===studyId);
 const groups=GROUPS[studyId]||[];
 const fixed=(studyId==="cascade"||studyId==="misinformation");
 const entries=(fields)=><>{fields.map((key)=><ResearchField key={key} name={key} value={config[key]} disabled={(fixed&&key==="agents")||(studyId==="petri"&&key==="runs")} onChange={onChange}/>)}</>;
 return <aside className="sidebar r27-unified-settings">
  <div className="sidebar-scroll">
   <h2>Параметры эксперимента</h2>
   <p className="r27-settings-intro">{def?.short||""}. Параметры используются при воспроизводимом модельном расчёте.</p>
   {groups.map(([title,fields],index)=><div key={title} className={index===0?"r27-first-settings":"sidebar-section"}>
    <h3>{title}</h3>{entries(fields)}
   </div>)}
   <details className="advanced"><summary>Статистика и вычисления</summary><div className="advanced-body">
     <ResearchField name="seed" value={config.seed} onChange={onChange}/>
     <p className="r27-note">Результаты являются синтетическими и не характеризуют защищённость конкретного объекта.</p>
   </div></details>
   <details className="advanced"><summary>Дополнительно</summary><div className="advanced-body">
     <p className="r27-note">Условия моделирования и границы применимости приведены в единой справке. При изменении параметров результаты предыдущего расчёта сбрасываются.</p>
     <button type="button" className="r27-settings-reset" disabled={running} onClick={onReset}>Восстановить параметры по умолчанию</button>
   </div></details>
  </div>
  <div className="r27-sidebar-actions">
   <button type="button" className="run-button" disabled={running} onClick={onStart}>{running?"Выполняется…":"▶ Запустить эксперимент"}</button>
   {running?<button type="button" className="r27-settings-stop" onClick={onStop}>Остановить расчёт</button>:null}
  </div>
 </aside>;
}
