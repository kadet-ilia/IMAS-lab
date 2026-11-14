/**
 * Reproducible, piecewise attack intensity (1-based discrete simulation steps).
 * A phase is active on [start, next.start-1]; last phase ends at T.
 * For a nonconstant phase intensity is the initial value and endIntensity
 * is attained on its last step. Shapes are normalized to f(0)=0, f(1)=1.
 * Legacy {start,intensity} phases retain the former constant semantics.
 */
export const MAX_ATTACK_PHASES=5;
export const ATTACK_SHAPES=[
 {id:"constant",label:"Постоянная"},
 {id:"linear",label:"Линейное нарастание"},
 {id:"exponential",label:"Экспоненциальное"},
 {id:"parabolic",label:"Параболическое"},
 {id:"hyperbolic",label:"Гиперболическое"}
];
const shapes=new Set(ATTACK_SHAPES.map(x=>x.id));
const finite=x=>typeof x==="number"&&Number.isFinite(x);
const clamp=(x,lo,hi)=>Math.max(lo,Math.min(hi,x));
const roundStart=(x,t)=>clamp(Math.round(x),1,t);

export function defaultAttackPhases(steps,attackStart=20){
 const t=Math.max(1,Math.round(steps)),start=roundStart(attackStart,t);
 const candidates=[
  {start:1,intensity:0,profile:"constant"},
  {start,intensity:1,profile:"constant"},
  {start:roundStart(Math.max(start+1,Math.floor(t*.40)),t),intensity:0,profile:"constant"},
  {start:roundStart(Math.max(start+2,Math.floor(t*.58)),t),intensity:1.5,profile:"constant"},
  {start:roundStart(Math.max(start+3,Math.floor(t*.78)),t),intensity:0,profile:"constant"}
 ];
 const distinct=new Map();
 for(const p of candidates)if(!distinct.has(p.start)||p.start===1&&start===1)distinct.set(p.start,p);
 return [...distinct.values()].sort((a,b)=>a.start-b.start);
}

export function validateAttackPhases(phases,steps){
 if(!Number.isInteger(steps)||steps<1)throw Error("Профиль атаки: горизонт T должен быть положительным целым числом");
 if(!Array.isArray(phases)||!phases.length||phases.length>MAX_ATTACK_PHASES)
  throw Error("Профиль атаки: требуется от 1 до "+MAX_ATTACK_PHASES+" фаз");
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
 let index=-1;
 for(let i=0;i<phases.length;i++){if(phases[i].start>step)break;index=i;}
 if(index<0)return 0;
 const p=phases[index],profile=p.profile??"constant";
 if(profile==="constant")return p.intensity;
 const end= index+1<phases.length ? phases[index+1].start-1 : steps;
 if(!Number.isInteger(end)||end<p.start)throw Error("Для изменяемой интенсивности требуется корректный горизонт T");
 const u=end===p.start?1:(step-p.start)/(end-p.start);
 return p.intensity+((p.endIntensity??p.intensity)-p.intensity)*shapeFraction(u,profile);
}
