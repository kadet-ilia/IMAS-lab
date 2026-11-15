/**
 * Single source of truth for the four estimators of E1 "Trust calculation".
 * The IDs must remain stable in saved JSON records and scientific tests.
 * Trimming is coordinate-wise for a scalar estimate; both trimmed methods
 * apply the same median-centred clipping and symmetric order-statistic trim.
 */
export const TRUST_METHOD_DEFINITIONS=Object.freeze([
 Object.freeze({id:"arithmetic_mean",label:"Арифметическое среднее",short:"Арифметическое",color:"#2672ff",usesTrust:false,usesTrimming:false}),
 Object.freeze({id:"trust_weighted_mean",label:"Среднее с учётом доверия",short:"С учётом доверия",color:"#079b91",usesTrust:true,usesTrimming:false}),
 Object.freeze({id:"trimmed_unweighted",label:"Покоординатное усечённое среднее без доверительной фильтрации (робастный метод)",short:"Усечённое без доверия",color:"#d18a31",usesTrust:false,usesTrimming:true}),
 Object.freeze({id:"proposed_robust",label:"Доверительно-усечённое среднее (комбинированный метод)",short:"Комбинированный",color:"#123a63",usesTrust:true,usesTrimming:true})
]);
export const TRUST_METHOD_IDS=Object.freeze(TRUST_METHOD_DEFINITIONS.map(item=>item.id));
export const TRUST_METHOD_LABELS=Object.freeze(Object.fromEntries(TRUST_METHOD_DEFINITIONS.map(item=>[item.id,item.label])));
export const TRUST_METHOD_SHORT_LABELS=Object.freeze(Object.fromEntries(TRUST_METHOD_DEFINITIONS.map(item=>[item.id,item.short])));
export const TRUST_METHOD_COLORS=Object.freeze(Object.fromEntries(TRUST_METHOD_DEFINITIONS.map(item=>[item.id,item.color])));
export function assertAllTrustMethods(rows,key="method"){
 const ids=new Set((rows||[]).map(row=>row?.[key]));
 if(ids.size!==TRUST_METHOD_IDS.length||TRUST_METHOD_IDS.some(id=>!ids.has(id)))
  throw Error("Несовпадение состава методов расчёта доверия: "+[...ids].join(", "));
 return true;
}
