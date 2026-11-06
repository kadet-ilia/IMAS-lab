/**
 * UP-04: machine-readable scientific metric passports for all six IMAS-lab
 * experiments. These definitions describe the implemented estimators, not
 * theoretical guarantees or empirically calibrated reliability.
 */
export const METRIC_PASSPORT_VERSION="metric-passport-1.0";
const metric=(code,title,unit,formula,denominator,missing,source,scope="result")=>Object.freeze({
 code,title,unit,formula,denominator,missing,source,scope
});
export const METRIC_PASSPORTS=Object.freeze({
 trust:[
  metric("probability_correct","Доля правильных автоматических решений","fraction","sum_t 1(решение принято и |x_t−x*|≤δ) / T","T — все шаги, включая отказы","0 при отсутствии правильных решений","rows","method/run"),
  metric("decision_coverage","Доля принятых решений","fraction","sum_t 1(x_t определено)/T","T — все шаги","0 при всех отказах","rows","method/run"),
  metric("accuracy_accepted","Условная точность при выдаче решения","fraction","sum_t 1(правильное решение)/N_accepted","N_accepted — число выданных решений","null, если N_accepted=0","rows","method/run"),
  metric("rmse_to_truth","RMSE среди принятых решений","native_action","sqrt(sum_{accepted}(x_t−x*)²/N_accepted)","N_accepted","null при отсутствии решений","rows","method/run"),
  metric("detection_rate","Доля распознанных нарушителей","fraction","число нарушителей с изоляцией не раньше начала атаки / max(1,N_byzantine)","max(1,N_byzantine); при нуле нарушителей диагностика условная","0 при N_byzantine=0 (не является полнотой детектирования)","rows","run"),
   metric("mean_detection_delay_steps","Средняя задержка выявления после начала атаки","ticks","mean_{detected}(firstAttackIsolationAt−attack_start_step)","только нарушители, впервые изолированные после начала атаки","null при отсутствии обнаруженных нарушителей","rows","run"),
   metric("premature_byzantine_isolations","Предатаковые ложные изоляции","count","число латентных нарушителей с первой изоляцией до начала атаки","один прогон","0 при отсутствии предатаковых изоляций","rows","run"),
  metric("delivery_ratio","Накопленная доля доставленных сообщений","fraction","N_delivered/N_attempted","все попытки формирования сообщений","0 при отсутствии попыток","rows;network_series","run"),
  metric("message_balance","Баланс транспорта и свидетельств","messages","attempted−delivered−lost−dropped−expired−queued","все попытки","0 должен выполняться как инвариант","summary;network_series","run"),
  metric("nominal_band_rate","Попадание в условную номинальную полосу","fraction","sum_t 1(|x_t−x*|≤1.96σ/√n)/N_evaluable","шаги, где принято решение и есть честное эталонное наблюдение","null при отсутствии оцениваемых шагов","rows","method/run"),
  metric("simulation_wall_ms","Время полной симуляции","ms","performance.now()_end−performance.now()_start","один прогон","не определяется вне браузера","rows","run")
 ],
 uncertainty:[
  metric("coverage","Частота выданных решений","fraction","N_accepted/R","R — прогоны сценария","0 при всех отказах","rows","scenario/method"),
  metric("correctUnconditional","Безусловная доля правильных решений","fraction","N_correct/R","R — прогоны сценария","0 при отсутствии правильных решений","rows","scenario/method"),
  metric("accuracy","Точность среди принятых","fraction","N_correct/N_accepted","N_accepted","null при N_accepted=0","rows","scenario/method"),
  metric("errorRate","Безусловная частота ошибок","fraction","N_wrong/R","R — прогоны","0 при отсутствии ошибок","rows","scenario/method"),
  metric("meanObservationAge","Условный возраст сообщений","ticks","sum_age_for_accepted/N_accepted","принятые решения; возраст сообщения 1 либо 3 такта","null при N_accepted=0","rows","scenario/method")
 ],
 probgraph:[
  metric("dangerProbability","Вероятность опасного состояния","fraction","sum_r 1(infected_r/N≥q)/R","R — парные прогоны","0 при отсутствии опасных реализаций; Wilson CI обязателен","rows","scenario/method"),
  metric("expectedFraction","Средняя доля затронутых агентов","fraction","sum_r(infected_r/N)/R","R — прогоны","не допускается отсутствие прогонов","rows","scenario/method"),
  metric("p95Fraction","95-й квантиль доли поражения","fraction","Q_.95(infected_r/N)","R — прогоны","не определён при R=0","rows","scenario/method"),
  metric("reductionDanger","Парное снижение вероятности опасности","fraction","mean_r[1(danger_baseline)−1(danger_protected)]","R — парные прогоны с общей таблицей событий","p=null при R<2","pairedEffects","scenario/method")
 ],
 petri:[
  metric("verdict","Статус достижимости","enum","EF_{≤T} Unsafe по графу маркировок; reachable/unreachable_within_bound/inconclusive","конечное пространство маркировок в заданном горизонте T","inconclusive при неполном обходе","result","study"),
  metric("processed","Исследованные маркировки","count","число извлечений маркировок из фронта BFS","все обработанные состояния","0 при отсутствии обхода","result","study"),
  metric("enqueued","Зарегистрированные маркировки","count","мощность множества уникальных поставленных в очередь состояний","все достигнутые маркировки","0 до запуска","result","study"),
  metric("isolationPolicy","Политика контроллера","enum","0 — необязательная; 1 — идеализированная обязательная","нет статистического знаменателя","не допускается вне {0,1}","result","study")
 ],
 cascade:[
  metric("expectedDamage","Средний каскадный ущерб","synthetic_loss","sum_r(sum_i c_i·1(i поражён))/R","R — парные прогоны","не допускается R=0","rows","source/method"),
  metric("excessDamage","Дополнительный ущерб сверх прямого","synthetic_loss","mean_r[max(0,L_r−c_start)]","R — прогоны","0 при отсутствии каскада","rows","source/method"),
  metric("es95","Ожидаемые потери худших 5%","synthetic_loss","дробно-взвешенная верхняя 5%-я масса потерь / (0.05R)","0.05R — верхнехвостовая масса","хвост при 0.05R<10 ненадёжен","rows","source/method"),
  metric("dangerProbability","Частота критического ущерба","fraction","N_{L≥criticalDamage}/R","R — прогоны","0 при отсутствии событий; Wilson CI обязателен","rows","source/method"),
  metric("reductionDamage","Парное снижение среднего ущерба","synthetic_loss","mean_r(L_r^baseline−L_r^protected)","R — парные прогоны","p=null при R<2","pairedEffects","source")
 ],
 misinformation:[
  metric("wrongProbability","Безусловная частота неправильных решений","fraction","N_wrong/R","R — прогоны","0 при отсутствии ошибок","rows","method/scenario"),
  metric("correctProbability","Безусловная частота правильных решений","fraction","N_correct/R","R — прогоны","0 при отсутствии правильных","rows","method/scenario"),
  metric("abstentionProbability","Доля отказов","fraction","N_abstain/R","R — прогоны","0 при отсутствии отказов","rows","method/scenario"),
  metric("meanDeviation","Средний модуль смещения оценки","native_action","sum_r |xhat_r−theta_r|/R","R — прогоны, в том числе отказавшие","не допускается R=0","rows","method/scenario"),
  metric("risk","Условная нормированная цена ошибок и отказов","synthetic_loss","costWrong·wrongProbability + costRefuse·abstentionProbability","R — прогоны, без модели времени задержки","0 при нулевых исходах или ценах","rows","method/scenario"),
  metric("meanExposedFraction","Доля агентов с воздействием недостоверной информации","fraction","mean_r(|exposed_r|/N)","R — прогоны","не является метрикой алгоритма","scenarioMetrics","scenario")
 ]
});
export const passportForStudy=id=>{
 const passport=METRIC_PASSPORTS[id];
 if(!passport)throw Error("Неизвестная модель для паспорта метрик: "+id);
 return passport;
};
const approx=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=1e-9;
const inUnit=x=>Number.isFinite(x)&&x>=-1e-10&&x<=1+1e-10;
/** Independently replay only source graph uniforms, without reading research2027.js. */
function auditGraphSourceRuns(id,result,assert){
 const journal=result.sourceRunJournal,R=journal?.runsPerScenario,N=journal?.agents;
 const scenarios=id==="probgraph"?4:8;
 assert(journal?.complete===true&&journal?.schemaVersion===2&&journal.studyId===id,
  "graph journal: unsupported schema or incomplete archive");
 assert(Number.isInteger(R)&&R>0&&Number.isInteger(N)&&N>=3&&
  journal.scenarios===scenarios&&Array.isArray(journal.entries)&&journal.entries.length===scenarios*R,
  "graph journal: incomplete run set");
 if(!Array.isArray(journal?.entries)||journal.entries.length!==scenarios*R)return;
 const pairs=Array.isArray(result.pairedRuns)?result.pairedRuns:[];
 const seen=new Set();
 let eventCount=0;
 for(const record of journal.entries){
  const scenario=id==="probgraph"?record.scenarioIndex:record.source;
  const key=scenario+":"+record.run;
  assert(Number.isInteger(scenario)&&scenario>=0&&scenario<scenarios&&
   Number.isInteger(record.run)&&record.run>=0&&record.run<R&&!seen.has(key),
   "graph journal: duplicate or invalid run");
  seen.add(key);
  const edges=record.edges,tapes=record.eventTape,initial=id==="probgraph"?record.initialNodes:[record.initialNode];
  assert(Array.isArray(edges)&&Array.isArray(tapes)&&Array.isArray(initial)&&
   initial.length>0&&initial.every(v=>Number.isInteger(v)&&v>=0&&v<N)&&
   new Set(initial).size===initial.length,"graph journal: invalid graph/initialization");
  if(!Array.isArray(edges)||!Array.isArray(tapes)||!Array.isArray(initial))continue;
  const edgeSet=new Set();
  for(const [a,b] of edges){
   const e=a+":"+b;
   assert(Number.isInteger(a)&&Number.isInteger(b)&&a>=0&&b>=0&&a<N&&b<N&&a!==b&&
    !edgeSet.has(e),"graph journal: invalid or duplicate edge");
   edgeSet.add(e);
  }
  assert(tapes.length===(id==="probgraph"?result.config.steps:8)&&
   tapes.every(row=>Array.isArray(row)&&row.length===edges.length&&row.every(inUnit)),
   "graph journal: invalid random tape");
  if(!tapes.every(row=>Array.isArray(row)&&row.length===edges.length))continue;
  eventCount+=edges.length*tapes.length;
  const pair=pairs.find(x=>x.scenario===record.scenario&&x.run===record.run);
  assert(Boolean(pair)&&Array.isArray(pair?.methods),"graph journal: missing paired result");
  if(!pair)continue;
  assert(pair.methods.length===record.methodDefenses?.length,
   "graph journal: missing protection arm");
  for(let arm=0;arm<(record.methodDefenses||[]).length;arm++){
   const {method,defense}=record.methodDefenses[arm],actual=pair.methods[arm];
   assert(actual?.method===method&&approx(actual?.defense,defense),
    "graph journal: protection arm changed");
   const infection=new Set(initial);
   const p=Math.min(1,Math.max(0,(id==="probgraph"?result.config.spread*record.scenarioMultiplier:result.config.spread)*(1-defense)));
   for(const uniforms of tapes){
    const newNodes=[];
    for(let edge=0;edge<edges.length;edge++){
     const [from,to]=edges[edge];
     if(infection.has(from)&&!infection.has(to)&&uniforms[edge]<p)newNodes.push(to);
    }
    for(const node of newNodes)infection.add(node);
   }
   if(id==="probgraph"){
    const fraction=infection.size/N,danger=Number(fraction>=result.config.criticalFraction);
    assert(actual.infectedCount===infection.size&&approx(actual.finalFraction,fraction)&&
     actual.danger===danger,"E3 journal: result disagrees with source propagation");
   }else{
    const loss=[...infection].reduce((n,v)=>n+record.impactWeights[v],0);
    const danger=Number(loss>=record.criticalDamage);
    assert(actual.affectedCount===infection.size&&approx(actual.loss,loss)&&
     actual.danger===danger,"E5 journal: result disagrees with source cascade");
   }
  }
 }
 assert(seen.size===scenarios*R&&journal.edgeEventCount===eventCount&&eventCount<=journal.eventLimit,
  "graph journal: incomplete or truncated stochastic events");
}
export function auditResultMetrics(id,result){
 const issues=[],rows=result?.rows||[];
 const assert=(test,description)=>{if(!test)issues.push(description);};
 if(id==="trust"){
  const runRows=Array.isArray(result?.runs)?result.runs:Array.isArray(result?.raw_runs)?result.raw_runs:[];
  for(const r of runRows){
   assert(inUnit(r.probability_correct)&&inUnit(r.decision_coverage),"trust: invalid decision probability");
   assert(approx(r.decision_coverage+r.abstention_probability,1),"trust: coverage+refusals != 1");
   assert(r.probability_correct<=r.decision_coverage+1e-9,"trust: correct > accepted");
   assert(r.accuracy_accepted===null||inUnit(r.accuracy_accepted),"trust: invalid conditional accuracy");
  }
  if(result?.summary?.message_balance!==undefined)assert(result.summary.message_balance===0,"trust: message conservation");
  for(const state of result?.network_series||[])if(state.message_balance!==undefined)
   assert(state.message_balance===0,"trust: message conservation at tick "+state.step);
  if(Array.isArray(result?.message_ledger)){
   const fields=["attempted","delivered","lost","bandwidth_dropped","expired","pending"];
   for(const entry of result.message_ledger){
    for(const key of ["proposal","evidence","total"]){
     const x=entry[key];
     assert(x&&fields.every(k=>Number.isSafeInteger(x[k])&&x[k]>=0),
      "trust: invalid "+key+" message counts at tick "+entry.step);
     if(!x||!fields.every(k=>Number.isSafeInteger(x[k])&&x[k]>=0))continue;
     assert(x.attempted===x.delivered+x.lost+x.bandwidth_dropped+x.expired+x.pending,
      "trust: "+key+" conservation at tick "+entry.step);
    }
    if(entry.proposal&&entry.evidence&&entry.total)
     for(const field of fields)assert(entry.total[field]===entry.proposal[field]+entry.evidence[field],
      "trust: channel sum "+field+" at tick "+entry.step);
   }
   if(result?.summary?.communication_attempted!==undefined){
    const last=result.message_ledger.at(-1)?.total;
    assert(last&&last.attempted===result.summary.communication_attempted,
     "trust: final attempted messages differ from ledger");
   }
  }
  if(result?.source_event_log)
   assert(result.source_event_log.complete===true&&result.source_event_log.audit?.valid===true,
    "trust: invalid source-event journal audit");
 }else if(id==="uncertainty"){
  for(const r of rows){
   assert(inUnit(r.coverage)&&inUnit(r.correctUnconditional)&&inUnit(r.errorRate),"uncertainty: outside [0,1]");
   assert(approx(r.correctUnconditional+r.errorRate,r.coverage),"uncertainty: outcome accounting");
   assert(r.accuracy===null||approx(r.accuracy,r.correctUnconditional/r.coverage),"uncertainty: conditional accuracy");
  }
 }else if(id==="probgraph"||id==="cascade"){
  for(const r of rows){
   assert(inUnit(r.dangerProbability),"risk: danger probability outside [0,1]");
   assert(approx(r.dangerProbability,r.dangerEvents/r.runs),"risk: danger event count/denominator");
   if(id==="cascade"){
    assert(r.excessDamage>=-1e-9,"cascade: negative excess damage");
    assert(r.es95+1e-9>=r.expectedDamage,"cascade: tail mean below mean");
   }
  }
 }else if(id==="petri"){
  assert(["reachable","unreachable_within_bound","inconclusive"].includes(result.verdict),"petri: invalid verdict");
  assert(Number.isInteger(result.processed)&&Number.isInteger(result.enqueued)&&result.enqueued>=result.processed,"petri: invalid state count");
  assert([0,1].includes(result.isolationPolicy),"petri: invalid isolation policy");
 }else if(id==="misinformation"){
  for(const r of result.robustnessSensitivity||[]){
   assert(Number.isInteger(r.trim_each_side)&&r.trim_each_side>=0&&r.trim_each_side<=3,"E6 trim: invalid trimming count");
   assert([r.wrongProbability,r.correctProbability,r.abstentionProbability].every(inUnit),"E6 trim: invalid probability");
   assert(approx(r.wrongProbability+r.correctProbability+r.abstentionProbability,1),"E6 trim: outcome partition");
   assert(approx(r.risk,r.costWrong*r.wrongProbability+r.costRefuse*r.abstentionProbability),"E6 trim: risk identity");
  }
  for(const r of rows){
   assert([r.wrongProbability,r.correctProbability,r.abstentionProbability].every(inUnit),"E6: invalid outcome probability");
   assert(approx(r.wrongProbability+r.correctProbability+r.abstentionProbability,1),"E6: outcome partition");
   assert(approx(r.risk,r.costWrong*r.wrongProbability+r.costRefuse*r.abstentionProbability),"E6: cost-weighted risk");
  }
 }else throw Error("Неизвестная модель: "+id);
 if(result?.sourceRunJournal){
  if(id==="probgraph"||id==="cascade")auditGraphSourceRuns(id,result,assert);
  else{
  const j=result.sourceRunJournal,R=j.runsPerScenario,N=j.agents;
  assert(j.complete===true&&j.schemaVersion===1&&j.studyId===id&&j.scenarios===4,
   "source journal: incompatible or incomplete manifest");
  assert(Number.isInteger(R)&&R>0&&Number.isInteger(N)&&N>=3&&
   Array.isArray(j.entries)&&j.entries.length===4*R,
   "source journal: missing or truncated runs");
  if(Array.isArray(j.entries)&&j.entries.length===4*R&&R>0&&N>0){
   const ids=new Set(),counts=Array.from({length:4},()=>Array.from({length:3},()=>({right:0,wrong:0,refuse:0,deviation:0})));
   for(const e of j.entries){
    const index=id==="uncertainty"?e.scenarioIndex:e.compromised;
    const key=index+":"+e.run;
    assert(Number.isInteger(index)&&index>=0&&index<4&&
     Number.isInteger(e.run)&&e.run>=0&&e.run<R&&!ids.has(key),"source journal: missing or repeated run ID");
    ids.add(key);
    if(!Number.isInteger(index)||index<0||index>=4)continue;
    assert([1,-1].includes(e.truth)&&Array.isArray(e.methodEstimates)&&
     e.methodEstimates.length===3&&e.methodEstimates.every(Number.isFinite),"source journal: invalid truth or estimators");
    if(!Array.isArray(e.methodEstimates)||e.methodEstimates.length!==3)continue;
    if(id==="uncertainty"){
     assert(Array.isArray(e.messages)&&e.messages.length===N&&
      e.messages.every((m,i)=>m.agent===i+1&&(m.missing===true||
       m.missing===false&&Number.isFinite(m.x)&&[1,3].includes(m.age))),
      "E2 source journal: missing per-agent observation");
    }else if(id==="misinformation"){
     assert(Array.isArray(e.observations)&&e.observations.length===N&&
      e.observations.every((m,i)=>m.agent===i+1&&Number.isFinite(m.value))&&
      Array.isArray(e.eventTapes)&&e.eventTapes.length===3&&
      e.eventTapes.every(t=>Array.isArray(t)&&t.length===9&&t.every(inUnit))&&
      Array.isArray(e.trimEstimates)&&e.trimEstimates.length===4&&
      approx(e.trimEstimates[3],e.methodEstimates[2]),
      "E6 source journal: missing graph tape or observation");
    }
    const available=id==="uncertainty"?e.messages?.filter(m=>m.missing===false).length||0:N;
    assert(id!=="uncertainty"||available===e.observedCount,
     "E2 source journal: incorrect observed count");
    e.methodEstimates.forEach((estimate,k)=>{
     const c=counts[index][k],accepted=(id==="uncertainty"?available>=Math.ceil(N*.3):true)&&Math.abs(estimate)>=j.threshold;
     if(!accepted)c.refuse++;
     else if(Math.sign(estimate)===e.truth)c.right++;else c.wrong++;
     if(id==="misinformation")c.deviation+=Math.abs(estimate-e.truth);
    });
   }
   assert(ids.size===4*R,"source journal: missing pair identifiers");
   for(let si=0;si<4;si++)for(let k=0;k<3;k++){
    const row=rows[3*si+k],count=counts[si][k];
    assert(Boolean(row),"source journal: missing aggregated row");
    if(!row)continue;
    if(id==="uncertainty")assert(approx(row.coverage,(count.right+count.wrong)/R)&&
     approx(row.correctUnconditional,count.right/R)&&approx(row.errorRate,count.wrong/R),
     "E2 source journal: aggregate counts disagree");
    if(id==="misinformation")assert(approx(row.correctProbability,count.right/R)&&
     approx(row.wrongProbability,count.wrong/R)&&approx(row.abstentionProbability,count.refuse/R)&&
     approx(row.meanDeviation,count.deviation/R),
     "E6 source journal: aggregate counts disagree");
   }
  }
  }
 }
 if(result?.markingJournal){
  const j=result.markingJournal;
  assert(id==="petri"&&j.schemaVersion===1&&j.studyId==="petri"&&j.complete===true&&
   j.boundedByStateLimit===true&&j.verdict===result.verdict,
   "E4 journal: invalid bounded-search manifest");
  assert(Array.isArray(j.records)&&j.records.length===result.processed&&
   Array.isArray(j.frontier)&&j.frontier.length===result.enqueued-result.processed,
   "E4 journal: incomplete processed frontier");
  if(Array.isArray(j.records)){
   const times=Array(result.config.steps+1).fill(0);
   for(let i=0;i<j.records.length;i++){
    const x=j.records[i];
    assert(x.index===i&&Number.isInteger(x.mask)&&Number.isInteger(x.isolated)&&
     Number.isInteger(x.t)&&x.t>=0&&x.t<=result.config.steps&&
     Array.isArray(x.successors)&&typeof x.critical==="boolean",
     "E4 journal: invalid marking "+i);
    if(Number.isInteger(x.t)&&x.t>=0&&x.t<times.length)times[x.t]++;
   }
   assert(times.every((x,i)=>x===result.statesByTime[i]),
    "E4 journal: temporal count inconsistent");
  }
 }
 return {version:METRIC_PASSPORT_VERSION,valid:issues.length===0,checkedRows:rows.length,issues};
}
