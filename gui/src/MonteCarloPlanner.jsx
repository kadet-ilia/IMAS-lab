import React,{useMemo,useState} from "react";
import {planMonteCarlo} from "./monteCarloPlanning.js";

/** Statistical planning only: changes R on explicit click, never re-runs a model. */
export function MonteCarloPlanner({studyId,runs,onChangeRuns,maxRuns=10000}){
 const [halfWidth,setHalfWidth]=useState(.05),[delta,setDelta]=useState(.05),[discordance,setDiscordance]=useState(.2);
 const planning=useMemo(()=>{try{return {value:planMonteCarlo({studyId,runs,targetHalfWidth:halfWidth,minimumEffect:delta,discordance})};}
  catch(e){return {error:e.message||String(e)};}},[studyId,runs,halfWidth,delta,discordance]);
 const data=planning.value;
 return <section className="r27-mc-planner" aria-label="Планирование Монте-Карло">
  <h3>Планирование Монте-Карло</h3>
  <p>Определение R до эксперимента по желаемой точности вероятности и отдельно по минимально важному парному эффекту.</p>
  <label>Полуширина 95%-го ДИ
   <select aria-label="Целевая точность Монте-Карло" value={halfWidth} onChange={e=>setHalfWidth(Number(e.target.value))}>
    <option value=".1">±10 п. п.</option><option value=".05">±5 п. п.</option><option value=".03">±3 п. п.</option>
    <option value=".02">±2 п. п.</option><option value=".01">±1 п. п.</option>
   </select>
  </label>
  <div className="r27-mc-planner-inputs">
   <label>Парный эффект Δ
    <input aria-label="Минимальный эффект Монте-Карло" type="number" min=".001" max="1" step=".01" value={delta} onChange={e=>setDelta(Number(e.target.value))}/>
   </label>
   <label>Доля несовпадений пар
    <input aria-label="Доля дискордантных пар" type="number" min=".001" max="1" step=".01" value={discordance} onChange={e=>setDiscordance(Number(e.target.value))}/>
   </label>
  </div>
  {planning.error?<p role="alert" className="r27-note">{planning.error}</p>:<>
   <p className="r27-note">Текущее R={runs}; максимальная полуширина 95%-го ДИ: ±{(100*data.worstCaseHalfWidth).toFixed(2)} п. п.
    {data.precisionGoalMet?" — заданная точность достигнута.":" — необходимо увеличить число прогонов."}</p>
   <div className="r27-mc-plan-buttons">
    <button type="button" disabled={data.requiredRunsForPrecision>maxRuns||data.requiredRunsForPrecision===runs} onClick={()=>onChangeRuns(data.requiredRunsForPrecision)}>
     R={data.requiredRunsForPrecision} по точности
    </button>
    <button type="button" disabled={data.requiredPairsForComparison>maxRuns||data.requiredPairsForComparison===runs} onClick={()=>onChangeRuns(data.requiredPairsForComparison)}>
     R={data.requiredPairsForComparison} по парному эффекту
    </button>
   </div>
   {data.requiredRunsForPrecision>maxRuns||data.requiredPairsForComparison>maxRuns?
    <p className="r27-note">Часть расчётных рекомендаций превышает разрешённый предел R={maxRuns}; результат автоматически не сокращается.</p>:null}
   {data.tailUnderTen?<p className="r27-note">Для ES95 при текущем R приходится менее 10 эквивалентных наблюдений верхнего хвоста. Оценка неустойчива.</p>:null}
  </>}
  <p className="r27-note">Оценки предполагают независимость полных прогонов, α=0,05, мощность 0,8 и заданную до расчёта дискордантность; не обосновывают частоту реальных угроз и не гарантируют точность редких событий.</p>
 </section>;
}
