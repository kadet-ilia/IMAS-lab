/**
 * E1-A, research-only geometry around a spherical occluding body.
 * Positions and time are synthetic normalized units, not satellite ephemeris.
 * True positions and pointing must lie within PUBLIC deterministic bounds.
 */
const TAU=2*Math.PI,EPS=1e-10;
const dot=(a,b)=>a.reduce((s,x,k)=>s+x*b[k],0);
const norm=a=>Math.sqrt(dot(a,a));
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));

export function syntheticOrbitState(index,time,p){
 const n=p.plantAgents,K=p.plantCrossOrbitPlanes;
 if(!Number.isInteger(index)||index<0||index>=n||
  !Number.isInteger(time)||time<1||
  !Number.isInteger(K)||K<1||n%K!==0)
  throw Error("Орбитальная видимость: неверная эпоха или индекс");
 const per=n/K,plane=Math.floor(index/per);
 const O=TAU*plane/K,t=TAU*(index%per)/per+
  p.plantCrossOrbitAngularRate*(time-1);
 const cO=Math.cos(O),sO=Math.sin(O),ct=Math.cos(t),st=Math.sin(t),
  ci=Math.cos(p.plantCrossOrbitInclination),
  si=Math.sin(p.plantCrossOrbitInclination);
 const unit=[cO*ct-sO*ci*st,sO*ct+cO*ci*st,si*st];
 const prograde=[-cO*st-sO*ci*ct,-sO*st+cO*ci*ct,si*ct];
 return Object.freeze({
  position:Object.freeze(unit.map(v=>v*p.plantCrossOrbitRadius)),
  prograde:Object.freeze(prograde),plane
 });
}

/**
 * Robust rejection:
 * |d_true| <= |d_nom|+2epsilon_r, and every point on a true
 * segment deviates by at most epsilon_r from the nominal segment.
 * The conservative LOS direction error is bounded by
 * asin(min(1,2epsilon_r/(d_nom-2epsilon_r))).
 */
export function syntheticOrbitVisibility(source,target,time,p){
 if(source===target)
  throw Error("Орбитальная видимость: идентичные источник и объект");
 const a=syntheticOrbitState(source,time,p);
 const b=syntheticOrbitState(target,time,p);
 const diff=b.position.map((v,i)=>v-a.position[i]);
 const d=norm(diff),er=p.plantCrossOrbitPositionError;
 const maxTrueDistance=d+2*er;
 const rangeAllowed=d>2*er+EPS&&
  maxTrueDistance<=p.plantCrossMaxRange+EPS;
 const q=d>EPS?clamp(-dot(a.position,diff)/(d*d),0,1):0;
 const closest=norm(a.position.map((v,i)=>v+q*diff[i]));
 const occultationFree=closest>p.plantCrossCentralBodyRadius+er+EPS;
 const directionError=d>2*er+EPS?
  Math.asin(clamp(2*er/(d-2*er),0,1)):Math.PI/2;
 const angle=d>EPS?
  Math.acos(clamp(dot(a.prograde,diff)/d,-1,1)):Math.PI;
 const pointingAllowed=p.plantCrossPointingMode==="omnidirectional"||
  angle+directionError+p.plantCrossOrbitPointingError<=
   p.plantCrossPointingHalfAngle+EPS;
 const bound=p.plantCrossBound+
  p.plantCrossDistanceErrorSlope*maxTrueDistance;
 if(!Number.isFinite(bound)||bound<0||bound>=p.plantSafeBound)
  throw Error("Орбитальная видимость: некорректная измерительная граница");
 return Object.freeze({
  eligible:rangeAllowed&&occultationFree&&pointingAllowed,
  distance:d,errorBound:bound,rangeAllowed,occultationFree,
  pointingAllowed,closest,nominalAngle:angle,
  directionError,maxTrueDistance,time,
  sourcePlane:a.plane,targetPlane:b.plane
 });
}
