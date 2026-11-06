import {wilson95,holmAdjusted} from "./statistics2027.js";

/** Prospective normal-approximation design; not an observed/post-hoc power claim. */
export function planPairedBinaryPrecision({minimumEffect,discordance,alpha=.05,targetPower=.8}){
 if(!Number.isFinite(minimumEffect)||minimumEffect<=0||minimumEffect>1||
  !Number.isFinite(discordance)||discordance<minimumEffect||discordance>1||
  alpha!==.05||targetPower!==.8)
  throw Error("План мощности: задайте 0<Δ≤P(discordance)≤1; реализованы только α=0,05 и мощность=0,8");
 const variance=discordance-minimumEffect**2;
 const zCritical=1.959963984540054,zPower=.8416212335729143;
 return {method:"prospective-normal-approximation-for-paired-binary-differences",
  alpha,targetPower,minimumEffect,assumedDiscordance:discordance,
  requiredPairs:Math.max(2,Math.ceil((zCritical+zPower)**2*variance/minimumEffect**2)),
  warning:"Оценка числа пар зависит от заранее заданных Δ и discordance; не подтверждает фактическую мощность теста перестановки и требует независимого пилотного исследования."};
}
export function worstCaseWilsonPrecision(targetHalfWidth=.05){
 if(!(targetHalfWidth>0&&targetHalfWidth<.5))
  throw Error("Требуемая полуширина доверительного интервала должна быть в (0;0,5)");
 let lo=1,hi=1000000;
 while(lo<hi){
  const mid=Math.floor((lo+hi)/2),ci=wilson95(Math.floor(mid/2),mid);
  if((ci.upper-ci.lower)/2<=targetHalfWidth)hi=mid;else lo=mid+1;
 }
 return {requiredIndependentRuns:lo,targetHalfWidth,method:"worst-case-Wilson-95"};
}
/** Automated statistical contract check; does not establish external model validity. */
export function auditResearchInference(id,c,result){
 const n=c.runs,issues=[],warnings=[];
 const assert=(ok,message)=>{if(!ok)issues.push(message);};
 const limited=id!=="petri";
 const metrics=result.rows||[];
 if(limited){
  if(n<30)warnings.push("R<30: нормальные интервалы математического ожидания могут быть неточными");
  const lowCount=metrics.filter(row=>Number.isFinite(row.dangerEvents)&&row.dangerEvents<10);
  if(lowCount.length)warnings.push(lowCount.length+" строк с менее чем 10 событиями опасного состояния: интервалы широкие");
  if(id==="cascade"&&n*.05<10)
   warnings.push("ES95: менее 10 эквивалентных наблюдений верхних 5% — низкая устойчивость хвостовой оценки");
  if(id==="uncertainty"||id==="misinformation")
   warnings.push("Качество измерено на синтетических данных; внешняя калибровка не предоставлена");
 }
 let adjustedChecks=0;
 if(id==="probgraph"||id==="cascade"){
  const effects=result.pairedEffects||[];
  const raw=id==="probgraph"?effects.filter(x=>x.pRaw!==null).map(x=>x.pRaw):
   effects.flatMap(x=>[x.pRawDamage,x.pRawDanger].filter(p=>p!==null));
  const correction=holmAdjusted(raw);
  const observed=id==="probgraph"?effects.filter(x=>x.pRaw!==null).map(x=>x.pHolm):
   effects.flatMap(x=>[x.pHolmDamage,x.pHolmDanger].filter(p=>p!==null));
  assert(correction.length===observed.length&&correction.every((p,i)=>
   Number.isFinite(observed[i])&&Math.abs(observed[i]-p)<=1e-12),
   "Holm: скорректированные p не соответствуют единой семье сравнений");
  assert(result.multipleTesting?.tested===correction.length &&
   result.multipleTesting?.correction==="Holm-FWER-0.05",
   "Holm: число проверок или метод не согласованы с результатом");
  adjustedChecks=correction.length;
  warnings.push("p-тест перестановки знаков требует обменности знаков парных разностей при H0; общие случайные события не доказывают эту предпосылку");
  warnings.push("95%-е интервалы отдельных эффектов не скорректированы на множественные сравнения");
 }
 if(id==="petri"){
  warnings.push("Логический вердикт E4 не является p-значением и не зависит от мощности Монте-Карло");
  if(result.verdict==="inconclusive")
   warnings.push("Предел маркировок достигнут: недостижимость опасного состояния не доказана");
 }
 return {schemaVersion:1,scope:"internal-numerical-uncertainty-only",
  modelExternallyCalibrated:false,independentlyScientificallyAccepted:false,
  runCount:n,holmFamilyChecked:adjustedChecks,
  illustrativeWilsonHalfWidth:.05,
  illustrativeWilsonRunRequirement:limited?worstCaseWilsonPrecision(.05).requiredIndependentRuns:null,
  warnings,issues,valid:issues.length===0};
}
