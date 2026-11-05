/**
 * Shared presentation-only units. Machine exports retain the original numeric
 * values (probabilities are [0,1]), never the formatted percent strings.
 */
export const FRACTION_METRICS=new Set([
 "correctUnconditional","accuracy","coverage","errorRate","dangerProbability",
 "expectedFraction","p95Fraction","wrongProbability","correctProbability",
 "abstentionProbability","meanExposedFraction","coverageCI95Low","coverageCI95High",
 "correctCI95Low","correctCI95High","accuracyCI95Low","accuracyCI95High",
 "errorCI95Low","errorCI95High","expectedFractionCI95Low","expectedFractionCI95High",
 "dangerCI95Low","dangerCI95High","wrongCI95Low","wrongCI95High",
 "abstentionCI95Low","abstentionCI95High",
 "reductionDanger","reductionDangerCI95Low","reductionDangerCI95High"
]);
export function formatStudyValue(metric,value){
 if(value===null||value===undefined||typeof value==="number"&&!Number.isFinite(value))return "—";
 if(typeof value==="number"){
  const numeric=FRACTION_METRICS.has(metric)?100*value:value;
  const rendered=Number.isInteger(numeric)?String(numeric):numeric.toLocaleString("ru-RU",{maximumFractionDigits:3});
  return FRACTION_METRICS.has(metric)?rendered+"%":rendered;
 }
 if(typeof value==="boolean")return value?"Да":"Нет";
 return String(value);
}
