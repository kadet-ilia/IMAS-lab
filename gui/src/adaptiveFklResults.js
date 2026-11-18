/**
 * Read-only browser exploration of archived E1-A FKL scientific summaries.
 * Imported JSON is untrusted; metadata is descriptive and NOT a signature.
 */
import {E1A_FKL_VERSION,E1A_FKL_F,E1A_FKL_K,E1A_FKL_LAG} from "./adaptiveFklProtocol.js";

export const E1A_FKL_FIELD_OPTIONS=Object.freeze([
 Object.freeze({id:"discrete",label:"Режимный выбор (дискретный)",key:"meanDeltaDiscreteCombined"}),
 Object.freeze({id:"blend",label:"Режимное смешивание",key:"meanDeltaBlendCombined"}),
 Object.freeze({id:"adaptive",label:"Исходная адаптация E1-А",key:"meanDeltaAdaptiveCombined"}),
 Object.freeze({id:"risk",label:"Рискоориентированная адаптация",key:"meanDeltaRiskCombined"})
]);
const stageSize={smoke:3,exploratory:80,confirmatory:16};
const finite=Number.isFinite;
function isHash(value){return typeof value==="string"&&/^[a-f0-9]{64}$/i.test(value);}
export function validateImportedFklSummary(doc){
 if(doc===null||typeof doc!=="object"||Array.isArray(doc)||
    doc.protocol!==E1A_FKL_VERSION||!Object.hasOwn(stageSize,doc.stage))
  throw Error("Неподдерживаемый тип протокола факторного исследования");
 if(doc.cells!==stageSize[doc.stage]||!Array.isArray(doc.conditions)||
    doc.conditions.length!==doc.cells)
  throw Error("Неполный или несовместимый архив факторного исследования");
 if(!isHash(doc.fingerprint)||!isHash(doc.designSha256)||!isHash(doc.sourceSha256))
  throw Error("В архиве отсутствуют идентификаторы научного протокола");
 const ids=new Set();
 for(const c of doc.conditions){
  if(!c||!E1A_FKL_F.includes(c.f)||!E1A_FKL_K.includes(c.k)||
    !E1A_FKL_LAG.includes(c.lag)||!Number.isInteger(c.R)||c.R<1||
    c.stage!==doc.stage||c.id!=="f"+c.f+"__k"+c.k+"__lag"+c.lag||
    ids.has(c.id)||!finite(c.meanCombinedRmse))
   throw Error("Противоречивые или повторяющиеся условия исследования");
  for(const {key} of E1A_FKL_FIELD_OPTIONS)
   if(!finite(c[key]))throw Error("Отсутствует конечная оценка эффекта "+key);
  ids.add(c.id);
 }
 for(const field of ["cellRuns","individualPolicyRuns"]){
  if(!Number.isInteger(doc[field])||doc[field]<1)
   throw Error("В архиве отсутствует объём вычислений "+field);
 }
 const expectedRuns=doc.conditions.reduce((s,c)=>s+c.R,0);
 if(doc.cellRuns!==expectedRuns||doc.individualPolicyRuns!==4*expectedRuns)
  throw Error("Протокол не согласован с числом прогонов");
 return doc;
}
export function fklEffectAt(summary,f,k,lag,modeId){
 const mode=E1A_FKL_FIELD_OPTIONS.find(x=>x.id===modeId);
 if(!mode)throw Error("Неизвестный сравниваемый алгоритм");
 const cell=summary.conditions.find(c=>c.f===f&&c.k===k&&c.lag===lag);
 return cell?{cell,value:cell[mode.key]}:null;
}
export function fklModeOverview(summary,modeId){
 const mode=E1A_FKL_FIELD_OPTIONS.find(x=>x.id===modeId);
 if(!mode)throw Error("Неизвестный режим");
 const values=summary.conditions.map(c=>c[mode.key]);
 return {mode:modeId,count:values.length,
  meanCellWeightedDelta:values.reduce((a,b)=>a+b,0)/values.length,
  better:values.filter(x=>x<0).length,
  worse:values.filter(x=>x>0).length,
  equal:values.filter(x=>x===0).length};
}
