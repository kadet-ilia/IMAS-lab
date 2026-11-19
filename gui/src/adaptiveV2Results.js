/**
 * Read-only v2 archive verifier and filter helpers.
 * Hashes are archival identifiers, NOT signatures/authenticated provenance.
 * Historical methods and runtime calculations are not touched here.
 */
import {v2CampaignDesign,V2_CAMPAIGN_MODES,
 E1A_V2_CAMPAIGN_VERSION} from "./adaptiveV2CampaignProtocol.js";

export const V2_RESULT_METHODS=Object.freeze([
 {value:"regime_aware_v2_discrete",prefix:"v2Discrete",label:"v2 дискретный"},
 {value:"regime_aware_v2_blend",prefix:"v2Blend",label:"v2 смешивание"},
 {value:"regime_aware",prefix:"v1",label:"v1 дискретный"},
 {value:"risk_aware",prefix:"risk",label:"Рискоориентированный"},
 {value:"adaptive",prefix:"adaptive",label:"Исходный адаптивный"}
]);
const finite=Number.isFinite;
const hash=x=>typeof x==="string"&&/^[0-9a-f]{64}$/i.test(x);
const near=(a,b)=>Math.abs(a-b)<=1e-9*Math.max(1,Math.abs(a),Math.abs(b));
export function validateV2ImportedSummary(result){
 if(!result||typeof result!=="object"||Array.isArray(result)||
  result.protocol!==E1A_V2_CAMPAIGN_VERSION||
  !["smoke","train","holdout"].includes(result.stage))
  throw Error("V2: неподдерживаемый научный архив");
 const plan=v2CampaignDesign(),fixed=plan.stages[result.stage];
 if(![result.fingerprint,result.planHash,result.sourceHash].every(hash)||
   result.cells!==fixed.length||
   result.wholeRunPairs!==fixed.reduce((s,c)=>s+c.runs,0)||
   result.modelExecutions!==result.wholeRunPairs*V2_CAMPAIGN_MODES.length||
   !Array.isArray(result.conditions)||result.conditions.length!==fixed.length)
  throw Error("V2: неполный или противоречивый факторный протокол");
 for(let i=0;i<fixed.length;i++){
  const expected=fixed[i],actual=result.conditions[i];
  if(!actual||["stage","id","strategy","law","schedule","evidence",
   "f","ordinal","seed","runs"].some(k=>actual[k]!==expected[k]))
   throw Error("V2: недопустимая факторная конфигурация "+i);
  if(!finite(actual.controlRmse)||!finite(actual.activeTicks)||
   actual.activeTicks<0||actual.activeTicks>48)
   throw Error("V2: неверные исходные метрики");
  for(const method of V2_RESULT_METHODS){
   const p=method.prefix;
   if(![actual[p+"Delta"],actual[p+"CiLow"],
    actual[p+"CiHigh"],actual[p+"Switches"],
    actual[p+"LossDelta"]].every(finite)||
    actual[p+"CiLow"]>actual[p+"CiHigh"])
    throw Error("V2: неисправные значения метода "+p);
  }
  if(result.stage==="holdout"&&
    (![actual.signFlipP,actual.holmP].every(finite)||
     actual.signFlipP<0||actual.holmP<actual.signFlipP||actual.holmP>1))
   throw Error("V2: отсутствует корректировка множественных испытаний");
 }
 for(const method of V2_RESULT_METHODS){
  const p=method.prefix;
  const average=result.conditions.reduce((s,c)=>s+c[p+"Delta"],0)/fixed.length;
  if(!finite(result.overall?.[method.value]?.meanCellDelta)||
    !near(result.overall[method.value].meanCellDelta,average))
   throw Error("V2: не совпадает среднее исследовательских конфигураций");
 }
 return result;
}
export function v2FilteredResults(summary,{strategy="all",law="all",
 evidence="all",f="all"}={}){
 return summary.conditions.filter(c=>
  (strategy==="all"||c.strategy===strategy)&&
  (law==="all"||c.law===law)&&
  (evidence==="all"||c.evidence===evidence)&&
  (f==="all"||String(c.f)===f));
}
export function v2ResearchOverview(summary,method="regime_aware_v2_discrete",filters={}){
 const field=V2_RESULT_METHODS.find(x=>x.value===method);
 if(!field)throw Error("V2: неопределённый сравниваемый метод");
 const rows=v2FilteredResults(summary,filters);
 const values=rows.map(c=>c[field.prefix+"Delta"]);
 return {cells:rows.length,meanDelta:values.length?
  values.reduce((s,v)=>s+v,0)/values.length:null,
  better:values.filter(v=>v<0).length,
  worse:values.filter(v=>v>0).length,
  ties:values.filter(v=>v===0).length,
  meanSwitches:rows.length?
   rows.reduce((s,c)=>s+c[field.prefix+"Switches"],0)/rows.length:null};
}
