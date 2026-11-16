import React from "react";
import {Bar,BarChart,CartesianGrid,Legend,Line,LineChart,ReferenceLine,ResponsiveContainer,Tooltip,XAxis,YAxis} from "recharts";
import {ExperimentPanel as Panel} from "./ExperimentLayout.jsx";
import {TRUST_GOAL_EVIDENCE as E} from "./trustGoalEvidenceData.js";

const fmt=(x,d=4)=>Number.isFinite(x)?x.toLocaleString("ru-RU",{minimumFractionDigits:d,maximumFractionDigits:d}):"—";
const pct=x=>Number.isFinite(x)?fmt(100*x,2)+" %":"—";
const accuracyChart=E.accuracy.map(row=>({scenario:row.scenario,
 ...Object.fromEntries(E.methods.map((m,i)=>[m.id,row.rmse[i]]))}));
const detectionNote="Доля обнаружения и среднее время изоляции относятся к общему контроллеру, а не к одному из четырёх агрегаторов.";

/**
 * An inspectable, immutable archive of numerical results; not a dynamic
 * simulation, not a claim of universal stability of the full IMAS.
 */
export default function TrustGoalEvidence(){
 return <section aria-labelledby="trust-goal-study" className="tab-stack" data-trust-goal-model={E.modelVersion}>
  <div className="tab-action"><div>
   <h2 id="trust-goal-study">7. ВЫЧИСЛИТЕЛЬНЫЙ ЭКСПЕРИМЕНТ</h2>
   <p><strong>Цель исследования:</strong> повышение устойчивости и точности коллективных оценок, формируемых интеллектуальной мультиагентной системой поддержки принятия решений защищённых ИС СН, в условиях деструктивных воздействий на часть её агентов.</p>
   <p className="r27-note">Архив фиксированных вычислительных серий от {E.measuredOn}; параметры боковой панели не изменяют эти опубликованные результаты. Для нового эксперимента воспользуйтесь элементами управления ниже.</p>
  </div></div>

  <Panel title="7.1. Условия и критерии исследования"
   subtitle={"Действующее скалярное ядро "+E.modelVersion+"; парное сравнение методов"}>
   <p>N = {E.nAgents}; f = {E.nBad} ({fmt(100*E.nBad/E.nAgents,2)} %); T = {E.nSteps}; начало атаки — такт {E.attackStart}; R = {E.mainRuns} независимых прогонов на сценарий; seed = {E.seed}; k = {E.trim}; σ = {fmt(E.noise,2)}; δ = {fmt(E.delta,2)}; порог изоляции — {fmt(E.isolationThreshold,2)}. Контроль штатного режима и отдельное сравнение k = 2 и k = 4 выполнены при R = {E.controlRuns}.</p>
   <p><strong>Точность:</strong> RMSE по выданным оценкам и P(правильное решение) по всем тактам, включая отказы. <strong>Устойчивость:</strong> D = RMSE при атаке / RMSE в штатном режиме. Чем ближе D к 1, тем меньше деградация точности при фиксированной атаке. Это оценка робастности решений, не доказательство устойчивости всей ИМАС по Ляпунову.</p>
   <p className="r27-note">Выполнена одномерная специализация; эксперимент не подтверждает непосредственно четырёхмерную постановку в статье. Сетевые потери и задержки отключены. RMSE вычисляется по шагам 11–70 как средняя по прогонным RMSE, а не как объединённая RMSE.</p>
  </Panel>

  <Panel title="7.2. Исследование точности коллективных оценок" subtitle="Согласованные входные наблюдения для четырёх методов; R = 60 для каждого сценария">
   <ResponsiveContainer width="100%" height={350}><BarChart data={accuracyChart} margin={{top:12,right:12,left:-6,bottom:12}}>
    <CartesianGrid stroke="#e6eaef" strokeDasharray="3 3" vertical={false}/>
    <XAxis dataKey="scenario" tick={{fontSize:10}}/><YAxis tick={{fontSize:10}}/>
    <Tooltip formatter={v=>fmt(v,4)}/><Legend wrapperStyle={{fontSize:10}}/>
    {E.methods.map(m=><Bar key={m.id} dataKey={m.id} name={m.short} fill={m.color} isAnimationActive={false}/>)}
   </BarChart></ResponsiveContainer>
   <p className="r27-note">Диаграмма: RMSE, условные единицы. Ниже отдельно приведена доля правильных решений, чтобы различать качество и покрытие оценок.</p>
   <div className="table-wrap large"><table><thead><tr><th>Сценарий</th><th>Метод</th><th>RMSE</th><th>Правильные оценки</th><th>Покрытие</th></tr></thead><tbody>
     {E.accuracy.flatMap(a=>E.methods.map((m,i)=><tr key={a.id+"-"+m.id}><td>{a.scenario}</td><td>{m.short}</td>
      <td>{fmt(a.rmse[i])}</td><td>{pct(a.probability[i])}</td><td>100 %</td></tr>))}
   </tbody></table></div>
   <p>При согласованном воздействии комбинированный метод уменьшил RMSE с 0,4269 до 0,0659 относительно арифметического среднего (в 6,48 раза); P(правильное решение) увеличилась с 64,78 до 86,72 %. При k = f = 4 невзвешенное и доверительно-усечённое средние практически совпадают.</p>
  </Panel>

  <Panel title="7.3. Динамика ошибок при начале атаки" subtitle="Постоянное смещение; средний модуль ошибки по 60 прогонам; только фактически сохранённые выборочные такты">
   <ResponsiveContainer width="100%" height={320}><LineChart data={E.sampledTrajectory} margin={{top:12,right:16,left:0,bottom:14}}>
    <CartesianGrid stroke="#e6eaef" strokeDasharray="3 3" vertical={false}/><XAxis dataKey="step" type="number" domain={[1,70]} tick={{fontSize:10}}/><YAxis tick={{fontSize:10}}/>
    <Tooltip formatter={v=>fmt(v)} /><Legend wrapperStyle={{fontSize:10}}/><ReferenceLine x={E.attackStart} stroke="#b54545" strokeDasharray="4 3"/>
    {E.methods.map(m=><Line key={m.id} type="linear" dataKey={m.id} name={m.short} stroke={m.color} dot={{r:2}} strokeWidth={m.id==="proposed_robust"?2.4:1.7} isAnimationActive={false}/>)}
   </LineChart></ResponsiveContainer>
   <p className="r27-note">Линии соединяют выборочные наблюдаемые такты; промежуточные такты в этом архивном графике не представлены. Начало деструктивного воздействия отмечено пунктиром.</p>
  </Panel>

  <Panel title="7.4. Исследование устойчивости коллективных оценок" subtitle="Согласованная атака против штатного режима; 40 прогонов на конфигурацию, k = 4">
   <ResponsiveContainer width="100%" height={300}><BarChart data={E.robustness} margin={{top:12,right:16,left:4,bottom:8}}>
    <CartesianGrid stroke="#e6eaef" strokeDasharray="3 3" vertical={false}/><XAxis dataKey="method" tick={{fontSize:10}}/><YAxis tick={{fontSize:10}}/>
    <Tooltip formatter={v=>fmt(v,3)}/><Bar dataKey="degradation" name="D = RMSEатака / RMSEштат" fill="#123a63" isAnimationActive={false}/>
   </BarChart></ResponsiveContainer>
   <div className="table-wrap large"><table><thead><tr><th>Метод</th><th>RMSE: штатно</th><th>RMSE: атака</th><th>D</th></tr></thead><tbody>
    {E.robustness.map(a=><tr key={a.method}><td>{a.method}</td><td>{fmt(a.baseline,5)}</td><td>{fmt(a.attacked,5)}</td><td>{fmt(a.degradation,3)}</td></tr>)}
   </tbody></table></div>
   <p>Деградация при воздействии на четыре из 21 агента составила около 1,45 раза у робастных методов против 9,90 раза у арифметического среднего. Это подтверждает преимущество робастного агрегирования по сохранению точности в проверенных условиях.</p>
  </Panel>

  <Panel title="7.5. Проверка вклада доверительного взвешивания" subtitle="Дополнительная серия: R = 40, согласованная атака f = 4 при k = 2 и k = 4">
   <div className="table-wrap large"><table><thead><tr><th>Метод</th><th>k=2, RMSE</th><th>k=2, Pправ.</th><th>k=4, RMSE</th><th>k=4, Pправ.</th></tr></thead><tbody>
    {E.trimSensitivity.map(a=><tr key={a.method}><td>{a.method}</td><td>{fmt(a.k2rmse)}</td><td>{pct(a.k2p)}</td><td>{fmt(a.k4rmse)}</td><td>{pct(a.k4p)}</td></tr>)}
   </tbody></table></div>
   <p>При k = 2 доверительное взвешивание снизило RMSE на 16,7 % относительно усечённого невзвешенного среднего и повысило долю правильных оценок на 4,79 процентного пункта. При k = 4 дополнительного преимущества в этих данных не выявлено; k = 2 меньше числа нарушителей и не удовлетворяет достаточному условию полного отсечения искажений.</p>
  </Panel>

  <Panel title="7.6. Обнаружение нарушителей и ограничения выводов">
   <div className="table-wrap large"><table><thead><tr><th>Сценарий</th><th>Доля изолированных нарушителей</th><th>Средняя задержка, тактов</th><th>Ложные изоляции</th></tr></thead><tbody>
    {E.accuracy.map(a=><tr key={a.id}><td>{a.scenario}</td><td>{pct(a.detection)}</td><td>{fmt(a.delay,2)}</td><td>{a.falseIsolations}</td></tr>)}
   </tbody></table></div>
   <p className="r27-note">{detectionNote} Показатель времени равен среднему времени первой изоляции обнаруженных агентов после фактического начала воздействия, а не сроку гарантированного обнаружения.</p>
   <p><strong>Вывод:</strong> точность коллективных оценок и её устойчивость к четырём синтетическим воздействиям повышены относительно незащищённых средних. Универсальное преимущество комбинированного метода над усечённым не установлено. При on–off-атаке изоляция нарушителей отсутствовала. Не доказаны ни устойчивость полной ИМАС по Ляпунову, ни эксплуатационная эффективность на реальных данных защищённых ИС СН.</p>
  </Panel>
 </section>;
}
