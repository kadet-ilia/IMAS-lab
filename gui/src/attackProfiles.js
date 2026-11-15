/**
 * Reproducible, piecewise attack intensity (1-based discrete simulation steps).
 * A phase is active on [start, next.start-1]; last phase ends at T.
 * There is no fixed phase-count limit: at most T different phase starts fit
 * in a discrete simulation of T steps.
 * For a nonconstant phase intensity is the initial value and endIntensity
 * is attained on its last step. Shapes are normalized to f(0)=0, f(1)=1.
 * Legacy {start,intensity} phases retain the former constant semantics.
 */
export const ATTACK_SHAPES=[
 {id:"constant",label:"Постоянная"},
 {id:"linear",label:"Линейное"},
 {id:"exponential",label:"Экспоненциальное"},
 {id:"parabolic",label:"Параболическое"},
 {id:"hyperbolic",label:"Гиперболическое"}
];
const shapes=new Set(ATTACK_SHAPES.map(x=>x.id));
const finite=x=>typeof x==="number"&&Number.isFinite(x);
const clamp=(x,lo,hi)=>Math.max(lo,Math.min(hi,x));
const roundStart=(x,t)=>clamp(Math.round(x),1,t);

export function defaultAttackPhases(steps,attackStart=20){
 const t=Math.max(1,Math.round(steps)),gap=Math.max(1,Math.round(attackStart));
 // Equidistant initial boundaries allow automatic T=(M+1)*gap after additions.
 // Intensities retain the original on/off/increase/off scenario.
 const intensity=[0,1,0,1.5,0],phases=[];
 for(let i=0;i<intensity.length;i++){
  const start=1+i*gap;
  if(start>t)break;
  phases.push({start,intensity:intensity[i],profile:"constant"});
 }
 return phases;
}

export function validateAttackPhases(phases,steps){
 if(!Number.isInteger(steps)||steps<1)throw Error("Профиль атаки: горизонт T должен быть положительным целым числом");
 if(!Array.isArray(phases)||!phases.length)
  throw Error("Профиль атаки: требуется хотя бы одна фаза");
 if(phases.length>steps)
  throw Error("Профиль атаки: число фаз не может превышать горизонт T");
 let previous=0;
 const normalized=phases.map((p,i)=>{
  if(!p||!Number.isInteger(p.start)||p.start<=previous||p.start>steps)
   throw Error("Профиль атаки: начала фаз должны возрастать и лежать в пределах 1…T (фаза "+(i+1)+")");
  previous=p.start;
  const profile=p.profile??"constant",intensity=p.intensity,endIntensity=profile==="constant"?intensity:(p.endIntensity??intensity);
  if(!shapes.has(profile))throw Error("Профиль атаки: неизвестная форма изменения интенсивности (фаза "+(i+1)+")");
  if(!finite(intensity)||intensity<0||intensity>5||!finite(endIntensity)||endIntensity<0||endIntensity>5)
   throw Error("Профиль атаки: начальная и конечная интенсивности должны лежать в пределах 0…5");
  return {start:p.start,intensity,profile,endIntensity};
 });
 if(normalized[0].start!==1)throw Error("Профиль атаки: первая фаза должна начинаться с шага 1");
 return normalized;
}

export function shapeFraction(u,profile){
 const x=clamp(u,0,1);
 switch(profile){
  case "constant":return 0;
  case "linear":return x;
  case "exponential":return Math.expm1(4*x)/Math.expm1(4);
  case "parabolic":return x*x;
  case "hyperbolic":return 5*x/(1+4*x);
  default:throw Error("Неизвестная форма атаки: "+profile);
 }
}

export function attackIntensityAt(step,phases,steps){
 if(!Number.isInteger(step)||step<1)return 0;
 let low=0,high=phases.length-1,index=-1;
 while(low<=high){const mid=(low+high)>>>1;if(phases[mid].start<=step){index=mid;low=mid+1;}else high=mid-1;}
 if(index<0)return 0;
 const p=phases[index],profile=p.profile??"constant";
 if(profile==="constant")return p.intensity;
 const end= index+1<phases.length ? phases[index+1].start-1 : steps;
 if(!Number.isInteger(end)||end<p.start)throw Error("Для изменяемой интенсивности требуется корректный горизонт T");
 const u=end===p.start?1:(step-p.start)/(end-p.start);
 return p.intensity+((p.endIntensity??p.intensity)-p.intensity)*shapeFraction(u,profile);
}
