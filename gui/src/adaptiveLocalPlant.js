/**
 * E1-A sidecar physical/logical scalar plant: independent of the legacy E1
 * simulator. Unlike the previous local-action MESSAGE loop, true state x(t)
 * now produces a trusted bounded-noise measurement, controls are chosen from
 * delivered neighbor information, and the plant evolves to x(t+1).
 *
 * Only the plant integrator receives the true state. The safety barrier
 * receives a TRUSTED measurement and a public sensor-error bound, not x(t),
 * Byzantine labels, future packets, or the research target.
 *
 * This is a minimal certified invariant-set example, NOT a field-ready
 * cyber-defence model or a Byzantine agreement proof.
 */
import {createRng} from "./trustEngine.js";
import {createLocalTransport} from "./adaptiveLocalTransport.js";
import {createCertifiedPlantObserver,scheduledSensorFault,shieldCertifiedInterval,SENSOR_FAULT_OBSERVER_VERSION} from "./adaptiveLocalPlantSensorFaults.js";
import {createCrossSensorTransport,projectCrossReport,fuseCrossCertificates,CROSS_SENSOR_VERSION} from "./adaptiveLocalCrossSensing.js";

export const LOCAL_PLANT_VERSION="e1a-scalar-robust-plant-1.5.0-cross-sensing-orbital-visibility";
export const LOCAL_PLANT_DEFAULTS=Object.freeze({
 plantSeed:731101,
 plantAgents:8,
 plantByzantine:2,
 plantSteps:24,
 plantSafeBound:2,
 plantA:1.04,
 plantB:0.4,
 plantK:0.8,
 plantControlLimit:1.2,
 plantDisturbanceBound:0.04,
 plantSensorBound:0.04,
 plantInitialMagnitude:1.2,
 plantTopology:"ring",
 plantPartition:false,
 plantPartitionStart:9,
 plantPartitionEnd:16,
 plantCapacity:24,
 plantTransportDelay:1,
 plantTransportTTL:5,
 plantTransportLoss:0.02,
 plantAttackStart:4,
 plantAttackBias:0.9,
 plantControlMode:"local_action", // local_action | local_decision | local_sensor
 plantFallbackPolicy:"barrier_zero", // barrier_zero | trusted_sensor
 plantGuardEnabled:true,
 plantGuardThreshold:0.4,
 plantGuardHysteresis:0.12,
 plantGuardMinEvidence:2,
 plantConsensusRelaxation:0.8,
 plantLocalActionGain:0.5,
 plantLocalActionMaxStep:0.25,
 // Off by default: a sensor fault has to be explicitly scheduled.
 plantSensorFaultMode:"nominal", // nominal | dropout | degraded
 plantSensorFaultFraction:0.5, // first ceil(fraction*honestCount) agents
 plantSensorFaultStart:8,
 plantSensorFaultEnd:12,
 plantDegradedSensorBound:0.3,
 // Optional independent authenticated physical remote sensors. Disabled
 // by default; their packets compete for the same plant network capacity.
 plantCrossEnabled:false,
 // A SYNTHETIC physical capability assumption distinct from packet edges.
 // Keep the old ideal communication-edge proxy unless explicitly opted in.
 plantCrossObservationMode:"network_proxy", // network_proxy | range_geometry | orbital_visibility
 plantCrossGeometryRadius:1,
 plantCrossMaxRange:2,
 plantCrossDistanceErrorSlope:0,
 // Normalized SYNTHETIC 3D circular trajectories, NOT an orbital propagator.
 plantCrossOrbitRadius:2,
 plantCrossCentralBodyRadius:1,
 plantCrossOrbitPlanes:2,
 plantCrossOrbitInclination:0.7,
 plantCrossOrbitAngularRate:0.15,
 plantCrossPointingMode:"omnidirectional", // omnidirectional | prograde
 plantCrossPointingHalfAngle:Math.PI,
 plantCrossOrbitPositionError:0,
 plantCrossOrbitPointingError:0,
 // Public certified UPPER bound on bad authenticated reporter identities.
 // Deliberately separate from simulator-only actual Byzantine membership.
 plantCrossFaultBudget:2,
 plantCrossBound:0.08,
 plantCrossDelay:1,
 plantCrossTTL:5,
 plantCrossLoss:0.02,
 plantCrossBandwidthFraction:0.5,
 plantCertificationPenalty:10 // synthetic terminal loss if horizon is not certified
});
const finite=Number.isFinite;
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
const mean=a=>a.length?a.reduce((s,v)=>s+v,0)/a.length:null;
const eps=1e-10;
function numeric(p,key,lo,hi,integer=false){
 const v=p[key];
 if(!finite(v)||v<lo||v>hi||(integer&&!Number.isInteger(v)))
  throw Error("Локальный объект: недопустимый параметр "+key);
}
export function validateLocalPlantOptions(input={}){
 if(!input||typeof input!=="object"||Array.isArray(input))
  throw Error("Локальный объект: параметры должны быть объектом");
 const p={...LOCAL_PLANT_DEFAULTS,...input};
 for(const [key,lo,hi,int] of [
  ["plantSeed",0,2147483647,true],["plantAgents",4,32,true],
  ["plantByzantine",0,16,true],["plantSteps",4,500,true],
  ["plantSafeBound",0.1,10,false],["plantA",0,2,false],
  ["plantB",1e-8,2,false],["plantK",0,3,false],
  ["plantControlLimit",1e-8,10,false],
  ["plantDisturbanceBound",0,2,false],["plantSensorBound",0,2,false],
  ["plantInitialMagnitude",0,10,false],
  ["plantPartitionStart",1,500,true],["plantPartitionEnd",1,500,true],
  ["plantCapacity",0,100000,true],
  ["plantTransportDelay",1,50,true],["plantTransportTTL",1,500,true],
  ["plantTransportLoss",0,1,false],
  ["plantAttackStart",1,500,true],["plantAttackBias",0,10,false],
  ["plantGuardThreshold",0.01,0.95,false],
  ["plantGuardHysteresis",0,0.8,false],
  ["plantGuardMinEvidence",1,500,true],
  ["plantConsensusRelaxation",0,1,false],
  ["plantLocalActionGain",0,1,false],
  ["plantLocalActionMaxStep",1e-8,10,false],
  ["plantSensorFaultFraction",0,1,false],
  ["plantSensorFaultStart",1,500,true],
  ["plantSensorFaultEnd",1,500,true],
  ["plantDegradedSensorBound",0,10,false],
  ["plantCrossOrbitRadius",0.01,100,false],
  ["plantCrossCentralBodyRadius",0,100,false],
  ["plantCrossOrbitPlanes",1,32,true],
  ["plantCrossOrbitInclination",0,Math.PI/2,false],
  ["plantCrossOrbitAngularRate",0,Math.PI,false],
  ["plantCrossPointingHalfAngle",0,Math.PI,false],
  ["plantCrossOrbitPositionError",0,10,false],
  ["plantCrossOrbitPointingError",0,Math.PI,false],
  ["plantCrossGeometryRadius",0.001,100,false],
  ["plantCrossMaxRange",0,200,false],
  ["plantCrossDistanceErrorSlope",0,10,false],
  ["plantCrossFaultBudget",0,31,true],
  ["plantCrossBound",0,10,false],["plantCrossDelay",1,50,true],
  ["plantCrossTTL",1,500,true],["plantCrossLoss",0,1,false],
  ["plantCrossBandwidthFraction",0,1,false],
  ["plantCertificationPenalty",0,1000000,false]
 ])numeric(p,key,lo,hi,int);
 for(const k of ["plantPartition","plantGuardEnabled","plantCrossEnabled"])
  if(typeof p[k]!=="boolean")throw Error("Локальный объект: неверный тип "+k);
 if(!["network_proxy","range_geometry","orbital_visibility"].includes(
  p.plantCrossObservationMode))
  throw Error("Локальный объект: неизвестная модель измерительной доступности");
 if(!["omnidirectional","prograde"].includes(p.plantCrossPointingMode))
  throw Error("Локальный объект: неизвестный режим наведения внешнего датчика");
 if(!["ring","complete"].includes(p.plantTopology)||
  !["local_action","local_decision","local_sensor"].includes(p.plantControlMode)||
  !["barrier_zero","trusted_sensor"].includes(p.plantFallbackPolicy)||
  !["nominal","dropout","degraded"].includes(p.plantSensorFaultMode))
  throw Error("Локальный объект: недопустимый дискретный режим");
 const S=p.plantSafeBound,W=p.plantDisturbanceBound,V=p.plantSensorBound;
 if(p.plantByzantine>=p.plantAgents/2||p.plantInitialMagnitude>S||
  W>=S||V>=S||p.plantTransportTTL<p.plantTransportDelay||
  p.plantAttackStart>p.plantSteps||
  p.plantPartitionStart>p.plantPartitionEnd||
  (p.plantPartition&&p.plantPartitionEnd>p.plantSteps)||
  p.plantGuardThreshold+p.plantGuardHysteresis>=1||
  p.plantSensorFaultStart>p.plantSensorFaultEnd||
  (p.plantSensorFaultMode!=="nominal"&&p.plantSensorFaultEnd>p.plantSteps)||
  p.plantCrossBound>=S||p.plantCrossTTL<p.plantCrossDelay||
  (p.plantCrossObservationMode==="range_geometry"&&
   p.plantCrossBound+2*p.plantCrossGeometryRadius*
    p.plantCrossDistanceErrorSlope>=S)||
  (p.plantCrossObservationMode==="orbital_visibility"&&(
   p.plantAgents%p.plantCrossOrbitPlanes!==0||
   p.plantCrossCentralBodyRadius>=p.plantCrossOrbitRadius||
   p.plantCrossOrbitPositionError>=
    p.plantCrossOrbitRadius-p.plantCrossCentralBodyRadius||
   p.plantCrossBound+
    (2*p.plantCrossOrbitRadius+2*p.plantCrossOrbitPositionError)*
    p.plantCrossDistanceErrorSlope>=S))||
  (p.plantCrossEnabled&&(p.plantCrossBandwidthFraction<=0||
   p.plantCrossFaultBudget<p.plantByzantine||
   p.plantCrossFaultBudget>=p.plantAgents))||
  p.plantDegradedSensorBound>=S||
  (p.plantSensorFaultMode==="degraded"&&
   p.plantDegradedSensorBound<p.plantSensorBound)||
  (p.plantSensorFaultMode!=="nominal"&&
   p.plantCertificationPenalty<=S*S))
  throw Error("Локальный объект: несовместимые границы или горизонт");
 // Sufficient robust viability for EVERY admissible x and bounded sensor
 // uncertainty; actual barrier intersection is still checked every tick.
 if(p.plantA*S-p.plantB*p.plantControlLimit+W>S+eps||
  p.plantA*V>S-W+eps)
  throw Error("Локальный объект: невозможна гарантированная инвариантность");
 return Object.freeze(p);
}
/**
 * Safety controller: NO true plant state or oracle input by construction.
 * For all x in [y-V,y+V]∩[-S,S] and |w|<=W, projection guarantees
 * |a*x+b*u+w|<=S, if the certified feasible set is nonempty.
 */
export function computeRobustSafetyControl(input,options={}){
 const p=validateLocalPlantOptions(options);
 const {measurement,estimate=null,accepted=false}=input??{};
 const S=p.plantSafeBound,V=p.plantSensorBound,W=p.plantDisturbanceBound;
 if(!finite(measurement)||measurement< -S||measurement>S||
  typeof accepted!=="boolean"||
  (accepted&&p.plantControlMode!=="local_sensor"&&
   (!finite(estimate)||estimate< -S||estimate>S)))
  throw Error("Локальный объект: неверное доступное контроллеру наблюдение");
 const minX=Math.max(-S,measurement-V),maxX=Math.min(S,measurement+V);
 const lo=Math.max(-p.plantControlLimit,
  (-S+W-p.plantA*minX)/p.plantB);
 const hi=Math.min(p.plantControlLimit,
  (S-W-p.plantA*maxX)/p.plantB);
 if(lo>hi+eps)throw Error("Локальный объект: пустое множество безопасного управления");
 const mode=p.plantControlMode;
 const fromLocal=mode!=="local_sensor"&&accepted;
 const fallback=mode!=="local_sensor"&&!accepted;
 const source=fromLocal?"local":mode==="local_sensor"?
  "trusted_sensor":p.plantFallbackPolicy;
 const target=fromLocal?estimate:measurement;
 // Refusal is not silently converted into an accepted collective decision.
 const requested=fromLocal||mode==="local_sensor"||
  (fallback&&p.plantFallbackPolicy==="trusted_sensor")?
  -p.plantK*target:0;
 const control=clamp(requested,lo,hi);
 return Object.freeze({control,requested,lo,hi,
  xMin:minX,xMax:maxX,source,acceptedLocal:fromLocal,
  refused:fallback,overridden:Math.abs(control-requested)>eps,
  diagnosticEstimate:target});
}
/** Plant integrator owns the truth; no clamping of x(t+1) is permitted. */
export function advanceScalarPlant({state,control,disturbance},options={}){
 const p=validateLocalPlantOptions(options);
 const S=p.plantSafeBound,W=p.plantDisturbanceBound;
 if(!finite(state)||Math.abs(state)>S+eps||
  !finite(control)||Math.abs(control)>p.plantControlLimit+eps||
  !finite(disturbance)||Math.abs(disturbance)>W+eps)
  throw Error("Локальный объект: неверное состояние, управление или возмущение");
 const next=p.plantA*state+p.plantB*control+disturbance;
 if(!finite(next)||Math.abs(next)>S+eps)
  throw Error("Локальный объект: нарушена инвариантность безопасного множества");
 return next;
}
export function localPlantAdjacency(n,topology,partition=false){
 if(!Number.isInteger(n)||n<4||n>32||
  !["ring","complete"].includes(topology)||typeof partition!=="boolean")
  throw Error("Локальный объект: некорректная топология");
 const labels=Array.from({length:n},(_,i)=>partition&&i>=Math.floor(n/2)?1:0);
 const adjacency=Array.from({length:n},(_,i)=>Array.from({length:n},(_,j)=>
  i!==j&&labels[i]===labels[j]&&
  (topology==="complete"||Math.abs(i-j)===1||Math.abs(i-j)===n-1)));
 return {labels,adjacency};
}
const draw=(p,runIndex,salt,step,node)=>
 createRng(p.plantSeed,runIndex,salt,step,node).random()*2-1;
/**
 * Closed physical loop: x_t -> trusted sensor y_t -> neighbor estimator ->
 * bounded requested u_t -> robust measurement-based safety barrier ->
 * x_(t+1). The network uses x_t-derived emissions ONLY on later ticks.
 */
export function simulateLocalPlant(input={},runIndex=0){
 const p=validateLocalPlantOptions(input);
 if(!Number.isInteger(runIndex)||runIndex<0||runIndex>100000)
  throw Error("Локальный объект: недопустимый индекс реализации");
 const n=p.plantAgents,S=p.plantSafeBound,A=p.plantA,B=p.plantB,K=p.plantK;
 const faulty=Array.from({length:n},(_,i)=>i>=n-p.plantByzantine);
 const active=Array(n).fill(true),reputation=Array(n).fill(.5);
 const localMode=p.plantControlMode==="local_action";
 const transport=createLocalTransport({
  seed:p.plantSeed,n_agents:n,n_sybil_agents:0,
  safe_action_min:-S,safe_action_max:S
 },{
  localTransportEnabled:true,localTransportDelaySteps:p.plantTransportDelay,
  localTransportMaxAgeSteps:p.plantTransportTTL,
  localTransportLossProbability:p.plantTransportLoss,
  localConsensusTrim:0,localConsensusRelaxation:p.plantConsensusRelaxation,
  localConsensusMinWeight:0.05,
  localAutonomyEnabled:true,localAutonomyEvidenceTolerance:0.45,
  localAutonomyMinNeighbors:1,localAutonomyDecay:0.95,
  localAutonomyGuardEnabled:p.plantGuardEnabled,
  localAutonomyGuardThreshold:p.plantGuardThreshold,
  localAutonomyGuardHysteresis:p.plantGuardHysteresis,
  localAutonomyGuardMinEvidence:p.plantGuardMinEvidence,
  localAutonomyActionFeedbackEnabled:localMode,
  localAutonomyActionGain:p.plantLocalActionGain,
  localAutonomyActionMaxStep:p.plantLocalActionMaxStep
 },runIndex);
 let states=Array.from({length:n},(_,i)=>{
  const sign=i%2?1:-1,scale=.75+.25*(draw(p,runIndex,0x701,0,i)+1)/2;
  return sign*p.plantInitialMagnitude*scale;
 });
 const initial=[...states],records=[],rows=[];
 const cross=p.plantCrossEnabled?createCrossSensorTransport(p,runIndex):null;
 const crossBudget=cross?Math.floor(p.plantCapacity*p.plantCrossBandwidthFraction):0;
 const controlTape=[];
 // The opt-in cross-sensor channel never changes the original nominal path.
 const faultEnabled=p.plantSensorFaultMode!=="nominal";
 const observer=faultEnabled||cross?createCertifiedPlantObserver(n,p):null;
 let certificateFailure=null,sensorDropoutUnits=0,sensorDegradedUnits=0;
 let abstentions=0,overrides=0,acceptedCount=0,usedLocalCount=0,accumSquared=0;
 let activeHonestUnits=0,issViolations=0;
 let crossSupported=0,crossRefined=0,crossReporterSum=0;
 const q=Math.abs(A-B*K);
 const bound=states.map(Math.abs);
 for(let step=1;step<=p.plantSteps;step++){
  const partition=p.plantPartition&&step>=p.plantPartitionStart&&
   step<=p.plantPartitionEnd;
  const {labels,adjacency}=localPlantAdjacency(n,p.plantTopology,partition);
  transport.networkStep({step,labels,adjacency,active});
  if(cross)cross.networkStep({time:step,active,adjacency});
  // Fault schedule is a SIMULATOR input. The estimator only receives
  // a real reading or an explicitly labelled prediction midpoint.
  // It never receives x(t) or an oracle-generated replacement reading.
  const status=states.map((_,i)=>faultEnabled?
   scheduledSensorFault(step,i,p):"nominal");
  const accuracy=status.map(kind=>kind==="dropout"?null:
   kind==="degraded"?p.plantDegradedSensorBound:p.plantSensorBound);
  const trueSensors=states.map((x,i)=>accuracy[i]===null?null:
   clamp(x+accuracy[i]*draw(p,runIndex,0x702,step,i),-S,S));
  let certified=null,crossDetails=null,crossReceived=null;
  if(observer){
   try{certified=observer.observe({
    time:step,readings:trueSensors,bounds:accuracy});
   }catch(e){
    if(e.code!=="CERTIFICATION_LOST")throw e;
    certificateFailure={step,node:null,reason:e.reason,phase:"sensor_consistency"};
    break;
   }
   if(cross){
    crossReceived=cross.read({time:step});
    const received=crossReceived,fused=[];
    crossDetails=[];
    for(let i=0;i<n;i++){
     try{
      const reports=received[i].map(r=>projectCrossReport(
       r,step,controlTape,p));
      const result=fuseCrossCertificates(certified[i],reports,
       p.plantCrossFaultBudget,p);
      fused.push(result.interval);crossDetails.push(result);
     }catch(e){
      if(e.code!=="CERTIFICATION_LOST")throw e;
      certificateFailure={step,node:i,reason:e.reason,phase:"cross_fusion"};
      break;
     }
    }
    if(certificateFailure)break;
    certified=fused;
   }
  }
  const telemetry=trueSensors.map((y,i)=>{
   const own=finite(y)?y:(certified[i].min+certified[i].max)/2;
   return faulty[i]&&step>=p.plantAttackStart?
    clamp(own+p.plantAttackBias,-S,S):own;
  });
  const decisions=transport.onProposals({
   step,values:telemetry,reputation,active,faulty});
  const hist=transport.getDiagnostic().history.at(-1);
  const actions=hist.autonomousActions;
  const before=[...states],current=[],next=[],controls=[];
  for(let i=0;i<n;i++){
   const accepted=!faulty[i]&&finite(decisions[i]);
   const estimate=accepted?(localMode?actions[i]:decisions[i]):null;
   let inputControl;
   if(!observer){
    inputControl=computeRobustSafetyControl({
     measurement:trueSensors[i],estimate,accepted},p);
   }else{
    const available=finite(trueSensors[i]),kind=p.plantControlMode;
    const fromLocal=kind!=="local_sensor"&&accepted;
    const fallback=kind!=="local_sensor"&&!accepted;
    const center=(certified[i].min+certified[i].max)/2;
    const target=fromLocal?estimate:available?trueSensors[i]:center;
    // A missing trusted reading MUST NOT be replaced by a false small-V
    // measurement. The model prediction only supplies a requested action.
    const requested=(fromLocal||kind==="local_sensor"||
     (fallback&&p.plantFallbackPolicy==="trusted_sensor"))?
     -K*target:0;
    let shield;
    try{
     shield=shieldCertifiedInterval({interval:certified[i],requested},p);
    }catch(e){
     if(e.code!=="CERTIFICATION_LOST")throw e;
     certificateFailure={step,node:i,reason:e.reason,phase:"control_feasibility",
      certifiedInterval:certified[i]};
     break;
    }
    const source=fromLocal?"local":
     !available?"prediction_fallback":
     kind==="local_sensor"?"trusted_sensor":p.plantFallbackPolicy;
    inputControl={...shield,
     source,refused:fallback||(!available&&kind==="local_sensor"),
     acceptedLocal:fromLocal,diagnosticEstimate:target,
     xMin:certified[i].min,xMax:certified[i].max};
   }
   const disturbance=p.plantDisturbanceBound*draw(p,runIndex,0x703,step,i);
   const updated=advanceScalarPlant({
    state:before[i],control:inputControl.control,disturbance},p);
   const observerError=Math.abs(before[i]-inputControl.diagnosticEstimate);
   const residual=Math.abs(inputControl.control+
    K*inputControl.diagnosticEstimate);
   const oneStepBound=q*Math.abs(before[i])+B*K*observerError+
    B*residual+Math.abs(disturbance);
   const propagated=q*bound[i]+B*K*observerError+
    B*residual+p.plantDisturbanceBound;
   if(Math.abs(updated)>oneStepBound+eps||Math.abs(updated)>propagated+eps)
    throw Error("Локальный объект: нарушена аналитическая оценка ISS");
   bound[i]=propagated;
   const row={step,node:i,honest:!faulty[i],partition,
    stateBefore:before[i],trustedSensor:trueSensors[i],
    sensorStatus:status[i],sensorBound:accuracy[i],
    measurementOrigin:finite(trueSensors[i])?"trusted":"prediction",
    certifiedInterval:certified?{...certified[i]}:null,
    emittedValue:telemetry[i],accepted,
    localDecision:decisions[i],localAction:actions?.[i]??null,
    control:inputControl.control,requested:inputControl.requested,
    controlSource:inputControl.source,
    safeLo:inputControl.lo,safeHi:inputControl.hi,
    safetyOverride:inputControl.overridden,
    refused:inputControl.refused,disturbance,
    stateAfter:updated,V:updated*updated,
    issOneStepBound:oneStepBound,issRecursiveBound:propagated,
    ...(cross?{crossReports:crossReceived[i].map(r=>({
     source:r.source,target:r.target,emitted:r.emitted,
     arrived:r.arrived,value:r.value})),
     crossReporters:crossDetails[i].reporters,
     crossRequiredSupport:crossDetails[i].requiredSupport,
     crossSupported:crossDetails[i].supported,
     crossRefined:crossDetails[i].refined}: {})};
   current.push(row);next.push(updated);controls.push(inputControl.control);
  }
  if(certificateFailure)break; // No partly computed plant tick is recorded.
  if(observer){
   try{observer.advance({time:step,current:certified,controls});}
   catch(e){
    if(e.code!=="CERTIFICATION_LOST")throw e;
    certificateFailure={step,node:null,reason:e.reason,phase:"interval_forecast"};
    break;
   }
  }
  records.push(...current);
  for(const row of current)if(row.honest){
   activeHonestUnits++;accumSquared+=row.V;
   if(row.accepted)acceptedCount++;
   if(row.refused)abstentions++;
   if(row.controlSource==="local")usedLocalCount++;
   if(row.safetyOverride)overrides++;
   if(row.sensorStatus==="dropout")sensorDropoutUnits++;
   if(row.sensorStatus==="degraded")sensorDegradedUnits++;
   if(cross){
    if(row.crossSupported)crossSupported++;
    if(row.crossRefined)crossRefined++;
    crossReporterSum+=row.crossReporters;
   }
  }
  transport.afterEvidenceTransport({step,sharedCapacity:p.plantCapacity-crossBudget,
   e1Used:0,decisionUsed:0});
  if(cross){
   cross.emit({time:step,states:before,active,faulty,budget:crossBudget});
   controlTape.push([...controls]);
  }
  const history=transport.getDiagnostic().history.at(-1);
  const crossHistory=cross?.getDiagnostic().history.at(-1);
  rows.push({step,partition,meanHonestV:mean(current.filter(x=>x.honest).map(x=>x.V)),
   maxAbsoluteState:Math.max(...next.map(Math.abs)),
   honestCoverage:current.filter(x=>x.honest&&x.accepted).length/
    (n-p.plantByzantine),
   honestLocalControlFraction:current.filter(x=>x.honest&&
    x.controlSource==="local").length/(n-p.plantByzantine),
   fallbackCount:current.filter(x=>x.honest&&x.refused).length,
   dropoutCount:current.filter(x=>x.honest&&x.sensorStatus==="dropout").length,
   degradedCount:current.filter(x=>x.honest&&x.sensorStatus==="degraded").length,
   intervalWidthMean:certified?mean(certified.filter((_,i)=>!faulty[i])
    .map(x=>x.max-x.min)):null,
   overrideCount:current.filter(x=>x.honest&&x.safetyOverride).length,
   transmitted:history.localUsed,received:history.receivedThisStep,
   slotsUsed:history.totalUsed+(crossHistory?.sent??0),
   slotsAvailable:p.plantCapacity,
   ...(cross?{crossSent:crossHistory.sent,
    crossReceived:crossHistory.received,
    crossBudget,localBudget:history.sharedCapacity}: {})});
  states=next;
 }
 const link=transport.getDiagnostic();
 const crossLink=cross?.getDiagnostic()??null;
 if(crossLink&&(crossLink.generated!==crossLink.delivered+
   crossLink.lost+crossLink.blocked+crossLink.expired+
   crossLink.superseded+crossLink.pending||
   rows.some(r=>r.slotsUsed>r.slotsAvailable||
    r.crossSent>r.crossBudget)))
  throw Error("Локальный объект: неверный общий бюджет перекрёстных измерений");
 if(link.generated!==link.delivered+link.lost+link.blocked+
  link.expired+link.superseded+link.pending||
  link.history.some(h=>h.totalUsed>h.sharedCapacity))
  throw Error("Локальный объект: неверный баланс сетевых сообщений");
 const complete=!certificateFailure&&rows.length===p.plantSteps;
 return {version:LOCAL_PLANT_VERSION,observerVersion:observer?
   SENSOR_FAULT_OBSERVER_VERSION:null,
  crossSensorVersion:cross?CROSS_SENSOR_VERSION:null,
  options:p,run:runIndex,status:complete?"completed":"certification_lost",
  completedSteps:rows.length,certificateFailure,
  observer:observer?.getDiagnostic()??null,
  initial,final:[...states],
  metrics:{honestStateRmse:complete?Math.sqrt(accumSquared/activeHonestUnits):null,
   honestMeanFinalV:complete?mean(records.filter(
    r=>r.step===p.plantSteps&&r.honest).map(r=>r.V)):null,
   // Predeclared full-horizon loss, accounting for all aborts without
   // choosing only successful trajectories. Penalty is an explicit assumption.
   fixedHorizonLoss:complete?accumSquared/activeHonestUnits:p.plantCertificationPenalty,
   certificationLost:complete?0:1,completedFraction:rows.length/p.plantSteps,
   // Diagnostic neighbor decision availability is not equivalent to
   // physical control use, notably for the local_sensor baseline.
   honestCoverage:activeHonestUnits?acceptedCount/activeHonestUnits:null,
   honestLocalControlFraction:activeHonestUnits?usedLocalCount/activeHonestUnits:null,
   honestFallbackFraction:activeHonestUnits?abstentions/activeHonestUnits:null,
   honestSensorDropoutFraction:activeHonestUnits?
    sensorDropoutUnits/activeHonestUnits:null,
   honestSensorDegradedFraction:activeHonestUnits?
    sensorDegradedUnits/activeHonestUnits:null,
   honestBarrierOverrideFraction:activeHonestUnits?overrides/activeHonestUnits:null,
   maxAbsoluteState:records.length?
    Math.max(...records.map(r=>Math.abs(r.stateAfter))):null,
   ...(cross?{honestCrossSupportedFraction:activeHonestUnits?
    crossSupported/activeHonestUnits:null,
    honestCrossRefinementFraction:activeHonestUnits?
     crossRefined/activeHonestUnits:null,
    meanCrossReportersPerHonestStep:activeHonestUnits?
     crossReporterSum/activeHonestUnits:null}:{}),
   safetyViolations:0,issViolations,
   nominalContractionFactor:q,nominalContractive:q<1},
  rows,records,transport:link,
  ...(cross?{crossTransport:crossLink}:{}),
  methodology:"Standalone synthetic scalar plant. Missing own sensors use model-predicted certified intervals. Optional authenticated PHYSICAL remote sensors measure neighboring target states with certified individual error. Only delayed packets enter the conservative m-f support hull; intervals propagate via actual executed controls. Remote transmissions consume a reserved share of the SAME capacity. Authentication, honest remote instruments and published bounds, f and model are assumed. Unsafe certificates fail closed; incomplete episodes pay the full-horizon penalty. This is not Byzantine agreement or field-ready closed-loop control."};
}
