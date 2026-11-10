import {wilson95} from "./statistics2027.js";
import {worstCaseWilsonPrecision,planPairedBinaryPrecision} from "./researchStatisticalAudit.js";

/** Prospective run-number planning, not post-hoc "observed power" or field calibration. */
export function planMonteCarlo({runs,targetHalfWidth=.05,minimumEffect=.05,discordance=.2,studyId="uncertainty"}){
 if(!Number.isInteger(runs)||runs<1||runs>1000000)throw Error("R должно быть целым и положительным");
 if(!["trust","uncertainty","probgraph","cascade","misinformation"].includes(studyId))
  throw Error("Формальная достижимость E4 не требует статистического планирования Монте-Карло");
 const wilson=worstCaseWilsonPrecision(targetHalfWidth);
 const paired=planPairedBinaryPrecision({minimumEffect,discordance});
 const midpoint=wilson95(Math.floor(runs/2),runs);
 const actualHalfWidth=(midpoint.upper-midpoint.lower)/2;
 return {studyId,runs,targetHalfWidth,minimumEffect,discordance,
  requiredRunsForPrecision:wilson.requiredIndependentRuns,
  requiredPairsForComparison:paired.requiredPairs,
  worstCaseHalfWidth:actualHalfWidth,
  precisionGoalMet:actualHalfWidth<=targetHalfWidth+1e-12,
  expectedTailEquivalents:studyId==="cascade"?.05*runs:null,
  tailUnderTen:studyId==="cascade"&&.05*runs<10,
  precisionMethod:wilson.method,powerMethod:paired.method,
  assumptions:"Одна независимая реализация — один прогон. Для сравнения Δ и discordance предполагаются заранее, а не оцениваются по полученному p. Интервалы описывают только вариацию Монте-Карло; нет оценки модельной ошибки, редких событий или внешней калибровки."};
}
