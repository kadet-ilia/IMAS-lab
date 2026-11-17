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

export const LOCAL_PLANT_VERSION="e1a-scalar-robust-measurement-barrier-1.1.0-control-attribution";
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
 plantLocalActionMaxStep:0.25
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
  ["plantLocalActionMaxStep",1e-8,10,false]
 ])numeric(p,key,lo,hi,int);
 for(const k of ["plantPartition","plantGuardEnabled"])
  if(typeof p[k]!=="boolean")throw Error("Локальный объект: неверный тип "+k);
 if(!["ring","complete"].includes(p.plantTopology)||
  !["local_action","local_decision","local_sensor"].includes(p.plantControlMode)||
  !["barrier_zero","trusted_sensor"].includes(p.plantFallbackPolicy))
  throw Error("Локальный объект: недопустимый дискретный режим");
 const S=p.plantSafeBound,W=p.plantDisturbanceBound,V=p.plantSensorBound;
 if(p.plantByzantine>=p.plantAgents/2||p.plantInitialMagnitude>S||
  W>=S||V>=S||p.plantTransportTTL<p.plantTransportDelay||
  p.plantAttackStart>p.plantSteps||
  p.plantPartitionStart>p.plantPartitionEnd||
  (p.plantPartition&&p.plantPartitionEnd>p.plantSteps)||
  p.plantGuardThreshold+p.plantGuardHysteresis>=1)
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
 let abstentions=0,overrides=0,acceptedCount=0,usedLocalCount=0,accumSquared=0;
 let activeHonestUnits=0,issViolations=0;
 const q=Math.abs(A-B*K);
 const bound=states.map(Math.abs);
 for(let step=1;step<=p.plantSteps;step++){
  const partition=p.plantPartition&&step>=p.plantPartitionStart&&
   step<=p.plantPartitionEnd;
  const {labels,adjacency}=localPlantAdjacency(n,p.plantTopology,partition);
  transport.networkStep({step,labels,adjacency,active});
  const trueSensors=states.map((x,i)=>
   clamp(x+p.plantSensorBound*draw(p,runIndex,0x702,step,i),-S,S));
  const telemetry=trueSensors.map((y,i)=>faulty[i]&&step>=p.plantAttackStart?
   clamp(y+p.plantAttackBias,-S,S):y);
  const decisions=transport.onProposals({
   step,values:telemetry,reputation,active,faulty});
  const hist=transport.getDiagnostic().history.at(-1);
  const actions=hist.autonomousActions;
  const before=[...states],current=[],next=[];
  for(let i=0;i<n;i++){
   const accepted=!faulty[i]&&finite(decisions[i]);
   const estimate=accepted?(localMode?actions[i]:decisions[i]):null;
   const inputControl=computeRobustSafetyControl({
    measurement:trueSensors[i],estimate,accepted},p);
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
    emittedValue:telemetry[i],accepted,
    localDecision:decisions[i],localAction:actions?.[i]??null,
    control:inputControl.control,requested:inputControl.requested,
    controlSource:inputControl.source,
    safeLo:inputControl.lo,safeHi:inputControl.hi,
    safetyOverride:inputControl.overridden,
    refused:inputControl.refused,disturbance,
    stateAfter:updated,V:updated*updated,
    issOneStepBound:oneStepBound,issRecursiveBound:propagated};
   current.push(row);records.push(row);next.push(updated);
   if(!faulty[i]){
    activeHonestUnits++;accumSquared+=updated*updated;
    if(accepted)acceptedCount++;
    if(inputControl.refused)abstentions++;
    if(inputControl.acceptedLocal)usedLocalCount++;
    if(inputControl.overridden)overrides++;
   }
  }
  transport.afterEvidenceTransport({step,sharedCapacity:p.plantCapacity,
   e1Used:0,decisionUsed:0});
  const history=transport.getDiagnostic().history.at(-1);
  rows.push({step,partition,meanHonestV:mean(current.filter(x=>x.honest).map(x=>x.V)),
   maxAbsoluteState:Math.max(...next.map(Math.abs)),
   honestCoverage:current.filter(x=>x.honest&&x.accepted).length/
    (n-p.plantByzantine),
   honestLocalControlFraction:current.filter(x=>x.honest&&
    x.controlSource==="local").length/(n-p.plantByzantine),
   fallbackCount:current.filter(x=>x.honest&&x.refused).length,
   overrideCount:current.filter(x=>x.honest&&x.safetyOverride).length,
   transmitted:history.localUsed,received:history.receivedThisStep,
   slotsUsed:history.totalUsed,slotsAvailable:history.sharedCapacity});
  states=next;
 }
 const link=transport.getDiagnostic();
 if(link.generated!==link.delivered+link.lost+link.blocked+
  link.expired+link.superseded+link.pending||
  link.history.some(h=>h.totalUsed>h.sharedCapacity))
  throw Error("Локальный объект: неверный баланс сетевых сообщений");
 return {version:LOCAL_PLANT_VERSION,options:p,run:runIndex,
  initial,final:[...states],
  metrics:{honestStateRmse:Math.sqrt(accumSquared/activeHonestUnits),
   honestMeanFinalV:mean(records.filter(r=>r.step===p.plantSteps&&r.honest).map(r=>r.V)),
   // Diagnostic neighbor decision availability is not equivalent to
   // physical control use, notably for the local_sensor baseline.
   honestCoverage:acceptedCount/activeHonestUnits,
   honestLocalControlFraction:usedLocalCount/activeHonestUnits,
   honestFallbackFraction:abstentions/activeHonestUnits,
   honestBarrierOverrideFraction:overrides/activeHonestUnits,
   maxAbsoluteState:Math.max(...records.map(r=>Math.abs(r.stateAfter))),
   safetyViolations:0,issViolations,
   nominalContractionFactor:q,nominalContractive:q<1},
  rows,records,transport:link,
  methodology:"Separate synthetic physical/logical closed loop. Controller uses trusted bounded-error sensor and causally delivered messages, never true state or oracle. All actuators assumed to enforce independent robust safety barrier even if telemetry is compromised. No physical hardware or Byzantine consensus guarantee."};
}
