/**
 * The UI's minimum interval ("Время начала атаки (шаг)") sets the
 * duration used to automatically size the simulation horizon.
 *
 * For M configured phases and interval A, T=(M+1)*A.
 * A is never the current n_steps: multiplying the already-expanded T
 * by M on every addition caused the previously reported 2801-step error.
 * Users can independently edit n_steps and every phase start manually.
 */
export const MAX_STABILITY_STEPS=50000;
export function phaseGap(value){
 if(!Number.isInteger(value)||value<1)throw Error("Время начала атаки должно быть положительным целым числом");
 return value;
}
export function expandedHorizon(count,interval){
 if(!Number.isInteger(count)||count<1)throw Error("Число фаз должно быть положительным");
 const gap=phaseGap(interval);
 const total=(count+1)*gap;
 if(!Number.isSafeInteger(total)||total>MAX_STABILITY_STEPS)
  throw Error("Расчётный горизонт "+total+" превышает технический предел "+MAX_STABILITY_STEPS+" шагов. Уменьшите число фаз или интервал между ними.");
 return total;
}
export function addAttackPhase(phases,attackStart){
 if(!Array.isArray(phases)||!phases.length)throw Error("Не задано расписание фаз");
 const gap=phaseGap(attackStart),last=phases[phases.length-1];
 if(!Number.isInteger(last.start))throw Error("Исправьте начало последней фазы");
 const start=last.start+gap,steps=expandedHorizon(phases.length+1,gap);
 if(start>steps)throw Error("Начало новой фазы "+start+" превышает автоматически рассчитанный горизонт "+steps+". Измените вручную начала предыдущих фаз либо время начала атаки.");
 return {phases:[...phases,{start,intensity:0,profile:"constant"}],steps};
}
export function validatePhaseGaps(phases,attackStart){
 const gap=phaseGap(attackStart);
 for(let i=1;i<phases.length;i++)
  if(phases[i].start-phases[i-1].start<gap)
   throw Error("Фаза "+(i+1)+": начало должно отстоять от предыдущей не менее чем на "+gap+" шагов");
 return true;
}
