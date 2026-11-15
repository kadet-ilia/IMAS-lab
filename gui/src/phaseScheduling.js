/**
 * Phase timeline and model horizon rules shared by UI, validation and tests.
 * T_basis is the last manually selected number of steps, not the already
 * automatically expanded horizon; this prevents exponential re-expansion.
 */
export const MAX_STABILITY_STEPS=50000;
export function phaseGap(value){
 if(!Number.isInteger(value)||value<1)throw Error("Время начала атаки должно быть положительным целым числом");
 return value;
}
export function expandedHorizon(count,basis){
 if(!Number.isInteger(count)||count<1)throw Error("Число фаз должно быть положительным");
 if(!Number.isInteger(basis)||basis<1)throw Error("Опорное T должно быть положительным целым числом");
 const total=count*basis+1;
 if(!Number.isSafeInteger(total)||total>MAX_STABILITY_STEPS)
  throw Error("Расчётный горизонт "+total+" превышает технический предел "+MAX_STABILITY_STEPS+" шагов. Уменьшите вручную T или опорную длительность.");
 return total;
}
export function addAttackPhase(phases,attackStart,basis){
 if(!Array.isArray(phases)||!phases.length)throw Error("Не задано расписание фаз");
 const gap=phaseGap(attackStart),last=phases[phases.length-1];
 if(!Number.isInteger(last.start))throw Error("Исправьте начало последней фазы");
 const start=last.start+gap,steps=expandedHorizon(phases.length+1,basis);
 if(start>steps)throw Error("Новая фаза начинается после расчётного горизонта T; измените опорное T");
 return {phases:[...phases,{start,intensity:0,profile:"constant"}],steps};
}
export function validatePhaseGaps(phases,attackStart){
 const gap=phaseGap(attackStart);
 for(let i=1;i<phases.length;i++)
  if(phases[i].start-phases[i-1].start<gap)
   throw Error("Фаза "+(i+1)+": начало должно отстоять от предыдущей не менее чем на "+gap+" шагов");
 return true;
}
