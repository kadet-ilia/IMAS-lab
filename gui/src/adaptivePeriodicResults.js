/**
 * Read-only M5-B periodic correlation results browser.
 * Imported summaries are untrusted; hashes are descriptive metadata only.
 */
import {periodicCampaignDesign,E1A_PERIODIC_VERSION}
 from "./adaptivePeriodicCampaignProtocol.js";

export const PERIODIC_RESULT_MODES=Object.freeze([
 Object.freeze({id:"discrete",label:"Режимный выбор E1-А",field:"meanDeltaDiscreteCombined"}),
 Object.freeze({id:"risk",label:"Рискоориентированный E1-А",field:"meanDeltaRiskCombined"}),
 Object.freeze({id:"adaptive",label:"Исходный адаптивный E1-А",field:"meanDeltaAdaptiveCombined"})
]);
const finite=Number.isFinite;
const isHash=s=>typeof s==="string"&&/^[a-f0-9]{64}$/i.test(s);
const approx=(a,b)=>Math.abs(a-b)<=1e-10*Math.max(1,Math.abs(a),Math.abs(b));
export function validateImportedPeriodicSummary(x){
 const design=periodicCampaignDesign();
 if(!x||typeof x!=="object"||Array.isArray(x)||
  x.protocol!==E1A_PERIODIC_VERSION||
  !["smoke","exploratory","confirmatory"].includes(x.stage))
  throw Error("Неизвестный протокол периодической серии");
 const expected=design.stages[x.stage];
 if(!Array.isArray(x.conditions)||x.conditions.length!==expected.length||
    x.conditionsCount!==expected.length)
  throw Error("Неполная факторная серия");
 if(![x.sourceSha256,x.designSha256,x.fingerprint].every(isHash))
  throw Error("В сводке отсутствуют идентификаторы кода и протокола");
 const n=expected.reduce((sum,c)=>sum+c.runs,0);
 if(x.cellRuns!==n||x.individualSimulations!==3*n)
  throw Error("Число вычислений не соответствует зафиксированному плану");
 for(let i=0;i<expected.length;i++){
  const c=x.conditions[i],planned=expected[i];
  if(!c||c.id!==planned.id||c.stage!==x.stage||c.runs!==planned.runs||
   c.seed!==planned.seed||c.strategy!==planned.strategy||
   c.law!==planned.law||c.schedule!==planned.schedule||
   c.f!==planned.f||c.correlation!==planned.correlation||
   c.period!==planned.period||c.dutyFraction!==planned.dutyFraction||
   c.attackDuty!==planned.attackDuty)
   throw Error("Противоречивые или незафиксированные факторы ячейки "+i);
  if(!finite(c.combinedRmse)||!finite(c.combinedLoss))
   throw Error("Отсутствует ошибка исторического E1");
  for(const mode of PERIODIC_RESULT_MODES){
   const suffix=mode.id==="risk"?"Risk":mode.id==="adaptive"?"Adaptive":"Discrete";
   const value=c[mode.field],lo=c["ci"+suffix+"Low"],
    hi=c["ci"+suffix+"High"];
   if(![value,lo,hi].every(finite)||lo>hi||
      value<lo-1e-8||value>hi+1e-8)
    // Point estimates need not lie inside bootstrap percentile intervals
    // for skewed data: reject only missing, reversed or non-finite intervals.
    if(![value,lo,hi].every(finite)||lo>hi)
     throw Error("Некорректные значения RMSE / bootstrap-интервала "+c.id);
  }
 }
 for(const mode of PERIODIC_RESULT_MODES){
  const means=x.conditions.map(c=>c[mode.field]);
  const overall=x.overall?.[mode.id]?.meanDeltaRmse;
  if(!finite(overall)||!approx(overall,
    means.reduce((a,b)=>a+b,0)/means.length))
   throw Error("Не совпадает сводный эффект "+mode.id);
 }
 return x;
}
export function periodicModeOverview(summary,mode="discrete"){
 const spec=PERIODIC_RESULT_MODES.find(m=>m.id===mode);
 if(!spec)throw Error("Неизвестный оцениваемый метод");
 const values=summary.conditions.map(x=>x[spec.field]);
 if(!values.length)throw Error("Отсутствуют условия для сравнений");
 return {meanDelta:values.reduce((s,v)=>s+v,0)/values.length,
  better:values.filter(v=>v<0).length,worse:values.filter(v=>v>0).length,
  equal:values.filter(v=>v===0).length,count:values.length};
}
export function periodicFilteredConditions(summary,{
 strategy="all",law="all",schedule="all",correlation="all",f="all"
}={}){
 return summary.conditions.filter(c=>
  (strategy==="all"||c.strategy===strategy)&&
  (law==="all"||c.law===law)&&
  (schedule==="all"||c.schedule===schedule)&&
  (correlation==="all"||String(c.correlation)===correlation)&&
  (f==="all"||String(c.f)===f));
}
