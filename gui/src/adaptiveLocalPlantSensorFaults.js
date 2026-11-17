/**
 * E1-A certified set-valued local observer and safety shield for an unavailable
 * or explicitly degraded own sensor.  NO truth, Byzantine labels, attacks or
 * future observations enter these functions. A publicly certified model
 * x(t+1)=a*x(t)+b*u(t)+w(t), |w|<=W, a>=0, b>0, is assumed.
 *
 * A lost measurement is NOT replaced with a fictitiously accurate sample.
 * If the state interval becomes nonviable for the available actuator,
 * the algorithm fails closed instead of clamping the physical state.
 */
export const SENSOR_FAULT_OBSERVER_VERSION="e1a-interval-observer-1.0.0";
const finite=Number.isFinite;
const clamp=(x,lo,hi)=>Math.max(lo,Math.min(hi,x));
const EPS=1e-10;
function loss(reason){
 const e=new Error("Локальный объект: утрачена сертификация безопасного управления: "+reason);
 e.code="CERTIFICATION_LOST";
 e.reason=reason;
 return e;
}
function bounds(interval,p){
 if(!interval||!finite(interval.min)||!finite(interval.max)||
  interval.min>interval.max||interval.min < -p.plantSafeBound-EPS||
  interval.max>p.plantSafeBound+EPS)
  throw Error("Локальный объект: некорректный сертифицированный интервал");
}
/** Deterministic public test schedule. No labels are sent to the controller. */
export function scheduledSensorFault(step,node,p){
 if(!Number.isSafeInteger(step)||step<1||!Number.isSafeInteger(node)||
  node<0||node>=p.plantAgents)
  throw Error("Локальный объект: неверный адрес или такт отказа датчика");
 const selected=node<Math.ceil((p.plantAgents-p.plantByzantine)*
  p.plantSensorFaultFraction);
 return selected&&p.plantSensorFaultMode!=="nominal"&&
  step>=p.plantSensorFaultStart&&step<=p.plantSensorFaultEnd?
  p.plantSensorFaultMode:"nominal";
}
/**
 * Uses only the previous interval, an authenticated measurement and an
 * explicitly declared error bound. Missing measurements contribute no
 * information, so the prior interval is kept unchanged.
 */
export function refineCertifiedInterval({prior,measurement=null,errorBound=null},p){
 bounds(prior,p);
 if(measurement===null){
  if(errorBound!==null)throw Error("Локальный объект: пропущено измерение при указанной точности");
  return Object.freeze({...prior});
 }
 if(!finite(measurement)||!finite(errorBound)||errorBound<0||
  errorBound>=p.plantSafeBound||
  Math.abs(measurement)>p.plantSafeBound+EPS)
  throw Error("Локальный объект: недостоверный сертификат измерения");
 const min=Math.max(prior.min,-p.plantSafeBound,measurement-errorBound);
 const max=Math.min(prior.max,p.plantSafeBound,measurement+errorBound);
 if(min>max+EPS)throw loss("измерение не совместимо с прогнозируемым множеством");
 if(min>max)throw loss("численно пустое пересечение интервалов");
 return Object.freeze({min,max});
}
/** Exact robust-control interval for the independently known state set. */
export function shieldCertifiedInterval({interval,requested},p){
 bounds(interval,p);
 if(!finite(requested))throw Error("Локальный объект: неопределённая команда");
 const lo=Math.max(-p.plantControlLimit,
  (-p.plantSafeBound+p.plantDisturbanceBound-p.plantA*interval.min)/p.plantB);
 const hi=Math.min(p.plantControlLimit,
  (p.plantSafeBound-p.plantDisturbanceBound-p.plantA*interval.max)/p.plantB);
 if(lo>hi+EPS)throw loss("ограничения исполнительного средства несовместимы с интервалом");
 if(lo>hi)throw loss("численно пустой интервал управления");
 const control=clamp(requested,lo,hi);
 return Object.freeze({control,requested,lo,hi,overridden:Math.abs(control-requested)>EPS});
}
/** Prediction uses applied u and worst-case w; there is no state clipping. */
export function forecastCertifiedInterval({interval,control},p){
 bounds(interval,p);
 if(!finite(control)||Math.abs(control)>p.plantControlLimit+EPS)
  throw Error("Локальный объект: неверный исполненный управляющий сигнал");
 const min=p.plantA*interval.min+p.plantB*control-p.plantDisturbanceBound;
 const max=p.plantA*interval.max+p.plantB*control+p.plantDisturbanceBound;
 if(min < -p.plantSafeBound-EPS||max>p.plantSafeBound+EPS)
  throw loss("прогноз выходит за безопасное множество");
 return Object.freeze({min,max});
}
export function createCertifiedPlantObserver(n,p){
 if(!Number.isInteger(n)||n<1||n!==p.plantAgents)
  throw Error("Локальный объект: неверное число датчиков наблюдателя");
 const initial=Object.freeze({min:-p.plantInitialMagnitude,
  max:p.plantInitialMagnitude});
 let intervals=Array.from({length:n},()=>initial),step=0;
 const observe=({time,readings,bounds:accuracy})=>{
  if(!Number.isInteger(time)||time!==step+1||
   !Array.isArray(readings)||!Array.isArray(accuracy)||
   readings.length!==n||accuracy.length!==n)
   throw Error("Локальный объект: нарушена последовательность измерений");
  // Atomic prevalidation: no internal interval mutates on an invalid input.
  const refined=intervals.map((prior,i)=>refineCertifiedInterval({
   prior,measurement:readings[i],errorBound:accuracy[i]},p));
  return Object.freeze(refined);
 };
 const advance=({time,current,controls})=>{
  if(!Number.isInteger(time)||time!==step+1||
   !Array.isArray(current)||current.length!==n||
   !Array.isArray(controls)||controls.length!==n)
   throw Error("Локальный объект: неверный переход наблюдателя");
  const next=current.map((interval,i)=>forecastCertifiedInterval({
   interval,control:controls[i]},p));
  intervals=next;step=time;
  return Object.freeze(next);
 };
 return Object.freeze({observe,advance,getDiagnostic:()=>({
  completedSteps:step,predictionIntervals:intervals.map(i=>({...i})),
  role:"trusted_set_valued_observer_no_oracle"})});
}
