import {DEFAULT_OPERATORS,validateHeterogeneousQueue,heterogeneousQueue} from "./heterogeneousQueue.js";
import {DEFAULT_AGENTS,validateDynamicPomdp,dynamicPomdp} from "./dynamicPomdp.js";
import {validateStructure,structureStudy,dynamicStructure} from "./structureOptimization.js";
import {rareStudy,validateRare} from "./rareEvents.js";
import {monitorStudy,monitorSummary,validateMonitor} from "./adequacyMonitor.js";
import {dependenceStudy,validateDependence} from "./dependenceRobust.js";
import {batchPlan,batchEvaluate,batchSummary} from "./batchStudy.js";
import {validateInteraction,interactionPlan,interactionPoint,interactionSummary} from "./interactionStudy.js";
import {alternatives,validateAlternatives} from "./alternativeRisk.js";
import {adaptiveNext,validateAdaptiveNext} from "./adaptiveNext.js";
import {optimalStopping,validateStopping} from "./optimalStopping.js";
import {closedQueue,validateClosedQueue,jointPlan,jointSummary} from "./closedLoopQueue.js";
import {candidateConfigs,evaluateDesign} from "./designOptimization.js";
import {advancedMC,validateAdvancedMC} from "./advancedMC.js";
import {BASE,EXT_VERSION,validateExt,uniformGroups,seedFor,spaceSize,lawsExt,calibration,tables,point,select,loss,exactExt,simulateExt,sampler,mixLaw,groupGeometry,l1Radius,draw} from "./extendedModel.js";
import {random,multinomial,extrem} from "./kernel.js";
import {studentCritical} from "./statistics.js";
const seq=n=>Array.from({length:n},(_,i)=>i),sum=a=>a.reduce((s,v)=>s+v,0),mean=a=>sum(a)/a.length,clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const integer=(v,a,b)=>Number.isInteger(v)&&v>=a&&v<=b,real=(v,a,b)=>Number.isFinite(v)&&v>=a&&v<=b;
const fail=()=>{throw Error("Некорректные параметры серии");};
export const STUDY_VERSION="E2.29-experimental-v1";
export const FACTORS={prior:{label:"π",min:.01,max:.8},c:{label:"c",min:0,max:3},m:{label:"M",min:100,max:100000},rhoScale:{label:"Множитель ρ",min:0,max:1},drop:{label:"Пропуски",min:0,max:.9}};
const METRICS=["coverage","loss","lower","tight","upperRisk","posteriorMass","violation","width","identityGap"];
export const EXTRA_DEFAULTS={...BASE,experiment:"grid",pomdpHorizon:4,p01:.08,p10:.12,transitionRadius:.03,pomdpAgents:DEFAULT_AGENTS,structSearch:"exact",structMax:4,structBlock:200,structTest:1000,structReps:1,structRiskWeight:1,structCoverageWeight:.25,structDependenceWeight:.5,structCostWeight:.05,structPeriod:200,structDwell:400,structReconf:5,structHysteresis:.01,interactionLaw:"shock",rhoFrom:0,rhoTo:.9,dropFrom:0,dropTo:.9,interactionLevels:5,batchTarget:"exact",batchDesign:"grid",batchN:128,batchWorkers:2,batchStress:.5,depBound:.2,depN:5000,factor:"rhoScale",factor2:"drop",from:0,to:1,from2:0,to2:.8,levels:5,levels2:5,sobolN:12,stress:"drift",eta:0,groupsMin:2,groupsMax:4,agentsMin:2,agentsMax:5,agentCost:1,groupCost:2,requiredCoverage:.7,riskLimit:.8,mcVariant:"standard",rareTilt:2,rareDefensive:.25,mcN:10000,mcBatch:1000,mcAlpha:.05,mcTolerance:0,mcImportance:false,mcProposal:.5,mcExact:false,steps:1000,window:150,delay:20,updateEvery:25,changeAt:.5,shift:.7,waitCost:.03,rounds:4,shortWindow:50,forgetting:.98,adaptiveReps:3,monitorStress:"driftAll",monitorRef:4000,monitorReps:5,monitorMin:100,alarmAlpha:.05,queryBudget:6,queryCost:.03,safetyRisk:1.5,queueExperiment:"stationary",operatorSpec:DEFAULT_OPERATORS,reserveOn:4,reserveOff:1,queueHorizon:8,queueWarmup:1,peakMultiplier:3,peakStart:.3,peakEnd:.6,queueCapacity:50,queuePriority:true,priorityThreshold:.5,feedbackGain:2,queueWaitCost:1,failureCost:2,queueOperatorLoss:1.25,operatorMin:2,operatorMax:4,priceMin:.8,priceMax:1.4,priceLevels:2,gainMin:0,gainMax:2,gainLevels:2,operatorCost:1,failureLimit:.05,arrival:120,service:8,operators:3,gammaSource:"model",gamma:.85,deadline:.5,arrivals:5000,warmup:500,queueReps:5,classSpec:null,trainFraction:.6,iidTest:false,discoverGroups:false,discoveryFraction:.5,groupThreshold:.05,groupMethod:"complete",groupMaxSize:50,dirichletMass:1,riskCalN:2000,autoRiskTarget:.1,riskLevels:41,riskAlpha:.05,calibrationMode:"complete",selectionGamma:2,emIterations:300,emTolerance:1e-8,approxLarge:true,designSpec:[{name:"Базовая",groups:[9,7,5]},{name:"Компактная",groups:[5,4,3]},{name:"Расширенная",groups:[10,8,6,4]}]};
function grid(a,b,n,round=false){return [...new Set(seq(n).map(i=>{const v=a+(b-a)*i/(n-1);return round?Math.round(v):v;}))];}
function range(a,b,n,f){if(!FACTORS[f]||!integer(n,2,15)||!real(a,FACTORS[f].min,FACTORS[f].max)||!real(b,a,FACTORS[f].max)||(f==="m"&&(!Number.isInteger(a)||!Number.isInteger(b))))fail();return grid(a,b,n,f==="m");}
function baseFor(raw){return validateExt({...raw,stress:"none",eta:0});}
function compact(r){return Object.fromEntries(["size","coverage","loss","miss","false","posteriorMass","width","violation","nomCoverage","nomLoss","lower","tight","upperRisk","assumptionsValid","identityGap","radii","counts"].filter(k=>r[k]!==undefined).map(k=>[k,r[k]]));}
export function validateStudy(mode,raw){
 const c={...EXTRA_DEFAULTS,...raw},base=baseFor(c);
 if(!["sensitivity","robustness","optimization","dynamics","queue","data","mcExtended","batch"].includes(mode))fail();
 if(mode==="batch"){batchPlan(c);return {...c,...base};}
 if(mode==="mcExtended"&&c.mcVariant==="rare")return validateRare({...c,...base,stress:c.stress});
 if(mode==="mcExtended")return validateAdvancedMC({...c,stress:c.stress==="all"?"none":c.stress});
 if(mode==="sensitivity"){
  if(!["grid","two","sobol","morris","families","scale","alternatives","interaction","riskBounds"].includes(c.experiment))fail();
  if(["grid","two"].includes(c.experiment)){range(c.from,c.to,c.levels,c.factor);if(c.experiment==="two"){if(c.factor===c.factor2)fail();range(c.from2,c.to2,c.levels2,c.factor2);if(c.levels*c.levels2*c.reps>450)throw Error("Не более 450 расчётов за серию");}}
  if(["sobol","morris"].includes(c.experiment)&&!integer(c.sobolN,4,64))fail();
  if(["alternatives","riskBounds"].includes(c.experiment))validateAlternatives(c);
  if(c.experiment==="interaction")validateInteraction(c);
  if(c.experiment==="scale"&&(!integer(c.mcN,1000,50000)||!integer(c.groupsMax,1,20)||!integer(c.agentsMax,2,50)))fail();
 }
 if(mode==="robustness"&&(!["drift","cross","mnar","nonexchangeable","biasedMask","contamination","all","dependenceRobust"].includes(c.stress)||!integer(c.levels,2,11)||c.levels*c.reps*(c.stress==="all"?6:1)>450))fail();
 if(mode==="robustness"&&c.stress==="dependenceRobust")validateDependence(c);
 if(mode==="optimization"&&(!["grid","heterogeneous","multiclass","structure"].includes(c.experiment)||!real(c.requiredCoverage,0,1)||!real(c.riskLimit,0,1000)||!real(c.agentCost,0,1000)||!real(c.groupCost,0,1000)||!integer(c.groupsMin,1,8)||!integer(c.groupsMax,c.groupsMin,8)||!integer(c.agentsMin,2,20)||!integer(c.agentsMax,c.agentsMin,20)||!integer(c.mcN,1000,50000)))fail();
 if(mode==="optimization"&&c.experiment==="structure")validateStructure(c);
 if(mode==="optimization"&&c.experiment==="heterogeneous"){if(typeof c.approxLarge!=="boolean")fail();candidateConfigs(c,c.designSpec);}
 if(mode==="dynamics"&&(!["adaptive","sequential","weighted","optimal","monitor","regroup","pomdp"].includes(c.experiment)||!integer(c.steps,100,20000)||!integer(c.window,20,2000)||!integer(c.delay,0,2000)||!integer(c.updateEvery,1,1000)||!real(c.changeAt,.1,.9)||!real(c.shift,0,1)||!integer(c.rounds,2,20)||!real(c.waitCost,0,1000)))fail();
 if(mode==="dynamics"&&c.experiment==="weighted")validateAdaptiveNext(c);
 if(mode==="dynamics"&&c.experiment==="monitor")validateMonitor(c);
 if(mode==="dynamics"&&c.experiment==="regroup")validateStructure(c,true);
 if(mode==="dynamics"&&c.experiment==="optimal")validateStopping(c);
 if(mode==="dynamics"&&c.experiment==="pomdp")validateDynamicPomdp(c);
 if(mode==="queue"&&(!real(c.arrival,.01,100000)||!real(c.service,.01,100000)||!integer(c.operators,1,100)||!["model","lower","manual"].includes(c.gammaSource)||!real(c.gamma,0,1)||!real(c.deadline,0,10000)||!integer(c.arrivals,100,100000)||!integer(c.warmup,0,c.arrivals-2)||!integer(c.queueReps,1,30)))fail();
 if(mode==="queue"){if(!["stationary","closed","joint","heterogeneous"].includes(c.queueExperiment))fail();if(c.queueExperiment!=="stationary")validateClosedQueue(c);if(c.queueExperiment==="joint")jointPlan(c);if(c.queueExperiment==="heterogeneous")validateHeterogeneousQueue(c);}
 if(mode==="data"&&(!["complete","partial","identified"].includes(c.calibrationMode)||!real(c.selectionGamma,1,10000)||!integer(c.emIterations,1,1000)||!real(c.emTolerance,1e-12,.01)))fail();
 if(mode==="data"&&(!real(c.trainFraction,.1,.9)||typeof c.iidTest!=="boolean"||typeof c.discoverGroups!=="boolean"||!real(c.discoveryFraction,.1,.9)||!real(c.groupThreshold,1e-8,1)||!["complete","components"].includes(c.groupMethod)||!integer(c.groupMaxSize,1,50)))fail();
 return {...c,...base,stress:c.stress,experiment:c.experiment};
}
export function studyPlan(mode,raw){
 const c=validateStudy(mode,raw),units=[];
 if(mode==="batch")return batchPlan(c);
 if(mode==="mcExtended"){for(let rep=0;rep<c.reps;rep++)units.push({kind:c.mcVariant==="rare"?"rareMC":"advancedMC",rep});}
 else if(mode==="sensitivity"){
  if(c.experiment==="interaction")units.push(...interactionPlan(c));
  else if(["alternatives","riskBounds"].includes(c.experiment)){for(let rep=0;rep<c.reps;rep++)units.push({kind:"alternatives",rep});}
  else if(c.experiment==="scale"){for(const B of [...new Set([1,2,3,5,10,20,c.groupsMax].filter(v=>v<=c.groupsMax))])units.push({kind:"scale",B,n:c.agentsMax});}
  else if(c.experiment==="sobol"){
   // Independent uniform inputs: prior, price, correlation multiplier and missingness.
   // Fixed calibration seed across design points: conditional sensitivity to parameters.
   const names=["prior","c","rhoScale","drop"],r=random(seedFor(c.seed,10001));
   const vector=()=>Object.fromEntries(names.map(k=>[k,FACTORS[k].min+r()*(FACTORS[k].max-FACTORS[k].min)]));
   for(let i=0;i<c.sobolN;i++){const a=vector(),b=vector();units.push({kind:"sobol",i,tag:"A",values:a},{kind:"sobol",i,tag:"B",values:b});for(const k of names)units.push({kind:"sobol",i,tag:k,values:{...a,[k]:b[k]}});}
  }else if(c.experiment==="morris"){
   const names=["prior","c","rhoScale","drop"],r=random(seedFor(c.seed,10002)),delta=2/3;
   for(let i=0;i<c.sobolN;i++){const direction=names.map(()=>r()<.5?-1:1),z=Object.fromEntries(names.map((k,j)=>[k,(r()<.5?0:1/3)+(direction[j]<0?delta:0)])),order=names.slice();for(let k=order.length-1;k>0;k--){const j=Math.floor(r()*(k+1));[order[k],order[j]]=[order[j],order[k]];}
    const values=()=>Object.fromEntries(names.map(k=>[k,FACTORS[k].min+z[k]*(FACTORS[k].max-FACTORS[k].min)]));units.push({kind:"sobol",i,tag:"start",values:values(),step:0});
    for(let j=0;j<order.length;j++){const k=order[j],d=direction[names.indexOf(k)]*delta;z[k]=clamp(z[k]+d,0,1);units.push({kind:"sobol",i,tag:k,values:values(),step:j+1,delta:d});}
   }
  }else if(c.experiment==="families"){for(const family of ["l1","box","wasserstein","kl","moments"])for(let rep=0;rep<c.reps;rep++)units.push({kind:"exact",family,rep,x:family});}
  else for(const x of range(c.from,c.to,c.levels,c.factor))for(const y of c.experiment==="two"?range(c.from2,c.to2,c.levels2,c.factor2):[null])for(let rep=0;rep<c.reps;rep++)units.push({kind:"exact",x,y,rep,values:{[c.factor]:x,...(y===null?{}:{[c.factor2]:y})}});
 }else if(mode==="robustness"){
  if(c.stress==="dependenceRobust"){for(const x of grid(0,1,c.levels))for(let rep=0;rep<c.reps;rep++)units.push({kind:"dependenceRobust",x,rep});return units;}
  for(const stress of c.stress==="all"?["drift","cross","mnar","nonexchangeable","biasedMask","contamination"]:[c.stress])for(const x of grid(0,1,c.levels))for(let rep=0;rep<c.reps;rep++)units.push({kind:"exact",stress,x,rep});
 }else if(mode==="optimization"&&c.experiment==="structure"){for(let rep=0;rep<c.structReps;rep++)units.push({kind:"structure",rep});
 }else if(mode==="optimization"&&c.experiment==="heterogeneous"){for(const spec of candidateConfigs(c,c.designSpec))units.push({kind:"heterogeneous",spec});
 }else if(mode==="optimization"&&c.experiment==="grid"){
  for(let B=c.groupsMin;B<=c.groupsMax;B++)for(let n=c.agentsMin;n<=c.agentsMax;n++)units.push({kind:"candidate",B,n});
 }else if(mode==="queue"){if(c.queueExperiment==="joint")units.push(...jointPlan(c));else for(let rep=0;rep<c.queueReps;rep++)units.push({kind:c.queueExperiment==="heterogeneous"?"heterogeneousQueue":c.queueExperiment==="closed"?"closedQueue":"queue",rep});}
 else if(mode==="dynamics"&&c.experiment==="regroup"){for(let rep=0;rep<c.structReps;rep++)for(const shift of [0,1])units.push({kind:"regroup",rep,shift});}
 else if(mode==="dynamics"&&c.experiment==="monitor"){for(let rep=0;rep<c.monitorReps;rep++)for(const shift of [...new Set([0,c.shift])])units.push({kind:"monitor",rep,shift});}
 else if(mode==="dynamics"&&c.experiment==="weighted"){for(let rep=0;rep<c.adaptiveReps;rep++)for(const shift of [...new Set([0,c.shift])])units.push({kind:"weighted",rep,shift});}
 else units.push({kind:mode==="optimization"?"multiclass":mode==="dynamics"?c.experiment:mode});
 if(!units.length)fail();
 return units;
}
export function evaluateUnit(mode,raw,unit,total=1){
 const c=validateStudy(mode,raw),base=baseFor(c),t0=performance.now();
 if(unit.kind==="dependenceRobust")return {...dependenceStudy(base,unit),ms:performance.now()-t0};
 if(unit.kind==="batch")return batchEvaluate(base,unit);
 if(unit.kind==="exact"||unit.kind==="sobol"){
  const conf={...base,...unit.values,...(unit.family?{family:unit.family}:{}),...(unit.stress?{stress:unit.stress,eta:unit.x}:{}),seed:seedFor(c.seed,unit.rep??0)};
  const r=exactExt(conf);return {unit,modelConfig:r.config,...compact(r),ms:performance.now()-t0};
 }
 if(unit.kind==="heterogeneous")return evaluateDesign(base,unit,total);
 if(unit.kind==="candidate"){
  // Confidence adjustment across the entire prespecified finite design (one calibration per candidate).
  const conf={...base,...uniformGroups(unit.B,unit.n,base),alpha:c.alpha/total,seed:seedFor(c.seed,unit.B*100+unit.n)},cost=unit.B*c.groupCost+unit.B*unit.n*c.agentCost;
  if(spaceSize(conf)>300000)return {unit,modelConfig:conf,size:spaceSize(conf),agents:unit.B*unit.n,cost,status:"not_evaluated",ms:0};
  const r=exactExt(conf),feasible=r.tight>=c.requiredCoverage&&r.upperRisk<=c.riskLimit;
  return {unit,modelConfig:conf,agents:unit.B*unit.n,cost,status:feasible?"feasible":"not_certified",...compact(r),ms:performance.now()-t0};
 }
 if(unit.kind==="scale"){
  const conf={...base,...uniformGroups(unit.B,unit.n,base)},seed=seedFor(c.seed,9999),r=simulateExt(conf,c.mcN,seed),mcMs=performance.now()-t0;
  let exact=null,exactMs=null;if(r.size<=300000){const start=performance.now();exact=compact(exactExt(conf,r.counts));exactMs=performance.now()-start;}
  return {unit,modelConfig:conf,agents:unit.B*unit.n,size:r.size,N:r.N,seed:r.seed,counts:r.counts,hist:r.hist,coverage:r.coverage,loss:r.loss,coverageLow:r.coverageLow,coverageHigh:r.coverageHigh,lossLow:r.lossLow,lossHigh:r.lossHigh,exactCoverage:exact?.coverage??null,exactLoss:exact?.loss??null,mcMs,exactMs,groupTableCells:conf.groups.reduce((a,n)=>a+2*2*(n+1)*(n+2)/2,0),ms:performance.now()-t0};
 }
 if(unit.kind==="advancedMC")return {unit,...advancedMC(c,unit.rep),ms:performance.now()-t0};
 if(unit.kind==="queue"){const r=queueStudy(c,unit.rep);return {unit,...r,ms:performance.now()-t0};}
 if(unit.kind==="interaction")return {...interactionPoint(base,unit),ms:performance.now()-t0};
 if(unit.kind==="alternatives")return {unit,...alternatives(base,unit.rep),ms:performance.now()-t0};
 if(unit.kind==="rareMC")return {unit,...rareStudy(base,unit.rep),ms:performance.now()-t0};
 if(unit.kind==="structure")return {...structureStudy(base,unit),ms:performance.now()-t0};
 if(unit.kind==="regroup")return {...dynamicStructure(base,unit),ms:performance.now()-t0};
 if(unit.kind==="monitor")return {...monitorStudy(base,unit),ms:performance.now()-t0};
 if(unit.kind==="weighted")return {unit,...adaptiveNext(base,unit),ms:performance.now()-t0};
 if(unit.kind==="pomdp")return {...dynamicPomdp(base,unit),ms:performance.now()-t0};
 if(unit.kind==="optimal")return {unit,...optimalStopping(base),ms:performance.now()-t0};
 if(unit.kind==="heterogeneousQueue")return {...heterogeneousQueue(base,unit),ms:performance.now()-t0};
 if(unit.kind==="closedQueue"||unit.kind==="jointQueue")return {unit,...closedQueue(base,unit),ms:performance.now()-t0};
 if(unit.kind==="adaptive")return {unit,...adaptiveStudy(c),ms:performance.now()-t0};
 if(unit.kind==="sequential")return {unit,...sequentialStudy(c),ms:performance.now()-t0};
 if(unit.kind==="multiclass")return {unit,...multiStudy(c),ms:performance.now()-t0};
 throw Error("Данные обрабатываются отдельным модулем");
}
function stats(a,alpha){const m=mean(a),s=a.length>1?Math.sqrt(sum(a.map(v=>(v-m)**2))/(a.length-1)):null,h=s===null?null:studentCritical(alpha,a.length-1)*s/Math.sqrt(a.length);return {mean:m,sd:s,lo:h===null?null:m-h,hi:h===null?null:m+h};}
export function summarizeStudy(mode,c,records){
 if(!records.length)return {rows:[],aux:[]};
 if(mode==="batch")return batchSummary(records);
 if(mode==="optimization"&&c.experiment==="structure")return {rows:records.flatMap(r=>r.summary.map(v=>({...v,rep:r.unit.rep}))),aux:records[0].candidates};
 if(mode==="dynamics"&&c.experiment==="regroup")return {rows:records.flatMap(r=>r.summary),aux:(records.find(r=>r.unit.shift>0)||records[0]).trace};
 if(mode==="robustness"&&c.stress==="dependenceRobust")return {rows:records.flatMap(r=>r.summary),aux:records.map(r=>({...r.scope,x:r.unit.x,rep:r.unit.rep}))};
 if(mode==="sensitivity"&&c.experiment==="interaction")return interactionSummary(records);
 if(mode==="sensitivity"&&["alternatives","riskBounds"].includes(c.experiment))return {rows:records.flatMap(r=>r.summary),aux:records.flatMap(r=>r.trace.map(v=>({...v,rep:r.unit.rep})))};
 if(mode==="queue"&&c.queueExperiment==="joint")return jointSummary(c,records);
 if(mode==="queue"&&c.queueExperiment==="heterogeneous")return {rows:records.flatMap(r=>r.summary),aux:records[0].trace};
 if(mode==="queue"&&c.queueExperiment==="closed")return {rows:records.flatMap(r=>r.summary),aux:records[0].trace};
 if(mode==="dynamics"&&c.experiment==="monitor")return monitorSummary(records);
 if(mode==="dynamics"&&c.experiment==="weighted"){const groups=new Map();for(const r of records)for(const row of r.summary){const key=JSON.stringify([row.policy,row.shift]);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);}const rows=[...groups.values()].map(a=>{const v=a[0],mean=k=>sum(a.map(r=>r[k]))/a.length,detected=a.filter(r=>r.alarmDelay!==null);return {policy:v.policy,shift:v.shift,reps:a.length,coverage:mean("coverage"),loss:mean("loss"),miss:mean("miss"),false:mean("false"),falseAlarm:mean("preAlarm"),detectionRate:v.shift>0?detected.length/a.length:null,alarmDelay:detected.length?sum(detected.map(r=>r.alarmDelay))/detected.length:null};});return {rows,aux:(records.find(r=>r.unit.shift>0)||records[0]).trace};}
 if(mode==="mcExtended")return {rows:records.flatMap(r=>r.summary),aux:records.flatMap(r=>r.trace.map(v=>({...v,rep:r.unit.rep})))};
 if(mode==="sensitivity"&&c.experiment==="morris"){
  const rows=[];for(const metric of ["coverage","loss","tight"])for(const factor of ["prior","c","rhoScale","drop"]){const effects=[];for(let i=0;i<c.sobolN;i++){const tr=records.filter(r=>r.unit.i===i).sort((a,b)=>a.unit.step-b.unit.step);if(tr.length!==5)continue;const j=tr.findIndex(r=>r.unit.tag===factor);effects.push((tr[j][metric]-tr[j-1][metric])/tr[j].unit.delta);}if(effects.length){const m=mean(effects);rows.push({metric,factor,N:effects.length,mu:m,muStar:mean(effects.map(Math.abs)),sigma:effects.length>1?Math.sqrt(sum(effects.map(v=>(v-m)**2))/(effects.length-1)):null});}}return {rows,aux:[]};
 }
 if(mode==="sensitivity"&&c.experiment==="sobol"){
  const names=["prior","c","rhoScale","drop"],lookup=new Map(records.map(r=>[r.unit.i+":"+r.unit.tag,r]));
  const complete=seq(c.sobolN).filter(i=>["A","B",...names].every(k=>lookup.has(i+":"+k))),rows=[];
  if(complete.length<2)return {rows,aux:[]};
  for(const metric of ["coverage","loss","tight"]){
   const a=complete.map(i=>lookup.get(i+":A")[metric]),b=complete.map(i=>lookup.get(i+":B")[metric]),all=[...a,...b],m=mean(all),v=mean(all.map(x=>(x-m)**2));
   for(const factor of names){const ab=complete.map(i=>lookup.get(i+":"+factor)[metric]);rows.push({factor,metric,N:complete.length,variance:v,first:v>1e-20?1-mean(ab.map((x,i)=>(b[i]-x)**2))/(2*v):null,total:v>1e-20?mean(ab.map((x,i)=>(a[i]-x)**2))/(2*v):null});}
  }return {rows,aux:[]};
 }
 if(mode==="optimization"&&["grid","heterogeneous"].includes(c.experiment)){
  const rows=records.map(r=>({...(r.unit.spec?{candidate:r.unit.spec.name,composition:r.unit.spec.groups.join(", "),B:r.unit.spec.groups.length,algorithm:r.algorithm,nomCoverage:r.nomCoverage??null,nomLoss:r.nomLoss??null}:{B:r.unit.B,n:r.unit.n}),agents:r.agents,size:r.size,cost:r.cost,status:r.status,coverage:r.coverage??null,loss:r.loss??null,tight:r.tight??null,upperRisk:r.upperRisk??null}));
  const valid=rows.filter(r=>r.status==="feasible");for(const r of rows)r.pareto=r.status==="feasible"&&!valid.some(q=>q!==r&&q.cost<=r.cost&&q.upperRisk<=r.upperRisk&&q.tight>=r.tight&&(q.cost<r.cost||q.upperRisk<r.upperRisk||q.tight>r.tight));
  return {rows,aux:valid.filter(r=>r.pareto).sort((a,b)=>a.cost-b.cost)};
 }
 if(mode==="sensitivity"&&c.experiment==="scale")return {rows:records.map(({unit,modelConfig,counts,hist,...r})=>({B:unit.B,n:unit.n,...r})),aux:[]};
 if(mode==="queue"){const rows=records.map(({unit,trace,model,...r})=>({rep:unit.rep,...r}));return {rows,aux:records[0].trace||[]};}
 if(mode==="dynamics"||mode==="optimization")return {rows:records[0].summary||[],aux:records[0].trace||[]};
 const groups=new Map();for(const r of records){const u=r.unit,k=JSON.stringify([u.stress??null,u.family??null,u.x,u.y??null]);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(r);}
 const rows=[];for(const a of groups.values()){const u=a[0].unit,row={x:u.x,y:u.y??null,stress:u.stress??null,family:u.family??null,reps:a.length,assumptionsValid:a.every(r=>r.assumptionsValid)};
  for(const k of METRICS){const s=stats(a.map(r=>r[k]),c.alpha);row[k]=s.mean;row[k+"SD"]=s.sd;row[k+"Low"]=s.lo;row[k+"High"]=s.hi;}
  rows.push(row);
 }
 // Interaction relative to the first row/column on the actual computed two-factor grid.
 if(mode==="sensitivity"&&c.experiment==="two"){const x0=Math.min(...rows.map(r=>r.x)),y0=Math.min(...rows.map(r=>r.y)),map=new Map(rows.map(r=>[r.x+":"+r.y,r]));for(const r of rows){const a=map.get(x0+":"+r.y),b=map.get(r.x+":"+y0),o=map.get(x0+":"+y0);r.interaction=a&&b&&o?r.loss-a.loss-b.loss+o.loss:null;}}
 return {rows,aux:[]};
}
export function erlang(lambda,mu,s){
 if(!real(lambda,0,1e9)||!real(mu,1e-12,1e9)||!integer(s,1,100))fail();
 const a=lambda/mu,rho=a/s;if(rho>=1)return {rho,stable:false,waitProb:null,Wq:null,Lq:null};
 let B=1;for(let i=1;i<=s;i++)B=a*B/(i+a*B);
 const C=B/(1-rho+rho*B),Wq=C/(s*mu-lambda);return {rho,stable:true,waitProb:C,Wq,Lq:lambda*Wq};
}
export function simulateQueue(lambda,mu,s,N,warmup,deadline,seed){
 const r=random(seed),exponential=rate=>-Math.log1p(-r())/rate,free=seq(s).map(()=>0),data=[],trace=[];
 if(lambda===0)return {Wq:0,Lq:0,deadlineMiss:0,waitFraction:0,observedRate:0,trace:[]};
 let t=0;for(let i=0;i<N;i++){t+=exponential(lambda);let j=0;for(let k=1;k<s;k++)if(free[k]<free[j])j=k;const start=Math.max(t,free[j]),finish=start+exponential(mu);free[j]=finish;data.push({t,start,finish,wait:start-t});}
 const start=data[warmup].t,end=data.at(-1).t,selected=data.slice(warmup),duration=end-start;
 if(!(duration>0))throw Error("Недостаточный горизонт СМО");
 const Wq=mean(selected.map(v=>v.wait)),Lq=sum(data.map(v=>Math.max(0,Math.min(end,v.start)-Math.max(start,v.t))))/duration;
 for(let i=0;i<selected.length;i+=Math.max(1,Math.floor(selected.length/100))){const a=selected[i];trace.push({t:a.t-start,wait:a.wait,queue:data.filter(v=>v.t<=a.t&&v.start>a.t).length});}
 return {Wq,Lq,deadlineMiss:mean(selected.map(v=>+(v.wait>deadline))),waitFraction:mean(selected.map(v=>+(v.wait>0))),observedRate:(selected.length-1)/duration,trace};
}
function queueStudy(c,rep){
 const base=baseFor(c),model=c.gammaSource==="manual"?null:exactExt({...base,seed:seedFor(c.seed,0)}),gamma=model?(c.gammaSource==="lower"?model.tight:model.coverage):c.gamma,lambda=c.arrival*(1-gamma),a=erlang(lambda,c.service,c.operators),seed=seedFor(c.seed,30000+rep),sim=simulateQueue(lambda,c.service,c.operators,c.arrivals,c.warmup,c.deadline,seed);
 return {gamma,lambda,seed,rho:a.rho,stable:a.stable,exactWq:a.Wq,exactLq:a.Lq,exactWaitProb:a.waitProb,exactDeadlineMiss:a.stable?(a.waitProb*Math.exp(-(c.operators*c.service-lambda)*c.deadline)):null,Wq:sim.Wq,Lq:sim.Lq,deadlineMiss:sim.deadlineMiss,waitFraction:sim.waitFraction,observedRate:sim.observedRate,littleResidual:sim.Lq-sim.observedRate*sim.Wq,trace:sim.trace,model:model?{config:model.config,counts:model.counts,coverage:model.coverage,tight:model.tight}:null};
}
function counted(c,counts,x,full,sign){for(let g=0;g<c.groups.length;g++)counts[x][g][full[g]]+=sign;}
function clone(a){return JSON.parse(JSON.stringify(a));}
function scoreSummary(name,acc,N){return {policy:name,coverage:acc.auto/N,loss:acc.loss/N,miss:acc.miss/N,false:acc.false/N,delay:acc.delay/N};}
function accumulator(){return {auto:0,loss:0,miss:0,false:0,delay:0};}
function add(acc,c,a,x,wait=0,waitCost=0){acc.auto+=+(a!==2);acc.loss+=loss(c,a,x)+waitCost*wait;acc.miss+=+(a===0&&x===1);acc.false+=+(a===1&&x===0);acc.delay+=wait;}
export function adaptiveStudy(c){
 const base={...baseFor(c),m:c.window,alpha:c.alpha/(c.steps+1)},q=lawsExt(base).nominal,r0=random(seedFor(c.seed,40000)),hist=q.map(row=>row[0].length&&seq(c.window).map(()=>row.map(a=>draw(a.map((_,i)=>sum(a.slice(0,i+1))),r0())))),counts=q.map(row=>row.map(a=>a.map(()=>0)));
 for(let x=0;x<2;x++)for(const full of hist[x])counted(base,counts,x,full,1);
 const initial=clone(counts),fixed=tables(base,initial),refMean=sum(initial[1][0].map((n,j)=>n*j))/(c.window*base.groups[0]),testSeed=seedFor(c.seed,40001),rng=random(testSeed),shifted={...base,stress:"drift",eta:c.shift},before=sampler(base,q,rng),after=sampler(shifted,lawsExt(shifted).test,rng),acc=[accumulator(),accumulator(),accumulator()],pending=[],trace=[];
 let B=fixed,alarm=null,released=0,lastUpdate=0,lossWindow=[0,0,0],autoWindow=[0,0,0],windowN=0;
 const switchAt=Math.floor(c.steps*c.changeAt);
 for(let t=0;t<c.steps;t++){
  while(released<pending.length&&pending[released].reveal<=t){const v=pending[released++];counted(base,counts,v.x,hist[v.x].shift(),-1);hist[v.x].push(v.full);counted(base,counts,v.x,v.full,1);}
  if(t%c.updateEvery===0){B=tables(base,counts);lastUpdate=t;const avg=sum(counts[1][0].map((n,j)=>n*j))/(c.window*base.groups[0]),h=2*Math.sqrt(Math.log(4*(c.steps+1)/c.alpha)/(2*c.window));if(alarm===null&&Math.abs(avg-refMean)>h)alarm=t;}
  const {x,ix,full}=t<switchAt?before():after(),actions=[fixed,B,alarm===null?fixed:B].map(T=>select(base,...point(base,T,ix)));
  for(let k=0;k<3;k++){add(acc[k],base,actions[k],x);lossWindow[k]+=loss(base,actions[k],x);autoWindow[k]+=+(actions[k]!==2);}windowN++;
  pending.push({x,full,reveal:t+Math.max(1,c.delay)});
  if((t+1)%c.updateEvery===0||t===c.steps-1){trace.push({t:t+1,staticLoss:lossWindow[0]/windowN,adaptiveLoss:lossWindow[1]/windowN,triggerLoss:lossWindow[2]/windowN,staticCoverage:autoWindow[0]/windowN,adaptiveCoverage:autoWindow[1]/windowN,triggerCoverage:autoWindow[2]/windowN,released,lastUpdate});lossWindow=[0,0,0];autoWindow=[0,0,0];windowN=0;}
 }
 return {summary:[scoreSummary("Фиксированная",acc[0],c.steps),scoreSummary("Скользящее окно",acc[1],c.steps),scoreSummary("Перекалибровка по сигналу",acc[2],c.steps)],trace,initialCounts:initial,finalCounts:counts,initialSeed:seedFor(c.seed,40000),testSeed,switchAt,alarm,alarmDelay:alarm===null?null:alarm-switchAt,stationaryGuarantee:c.shift===0,labelsReleased:released,alphaPerUpdate:base.alpha,warning:"Полные счётчики становятся доступны вместе с отложенной истинной меткой; при сдвиге интервалы эвристические."};
}
export function sequentialStudy(c){
 const base=baseFor(c),counts=calibration(base,lawsExt(base).cal),T=tables(base,counts),r=random(seedFor(c.seed,50000)),next=sampler(base,lawsExt(base).test,r),acc=[accumulator(),accumulator(),accumulator()],trace=[];
 // Nested reveal: given total J, sampling source identities without replacement is hypergeometric.
 for(let t=0;t<c.steps;t++){const {x,full}=next();let m=base.groups.map(()=>0),k=m.slice(),remaining=full.slice(),actions=[],stopAt=null;
  for(let step=0;step<c.rounds;step++){for(let g=0;g<m.length;g++){const target=Math.floor(base.groups[g]*(step+1)/c.rounds);while(m[g]<target){const y=+(r()<remaining[g]/(base.groups[g]-m[g]));m[g]++;k[g]+=y;remaining[g]-=y;}}
   const ix=m.map((n,g)=>n*(n+1)/2+k[g]),a=select(base,...point(base,T,ix));actions.push(a);if(stopAt===null&&a!==2)stopAt=step;
  }
  const stop=stopAt??(c.rounds-1);add(acc[0],base,actions[0],x);add(acc[1],base,actions.at(-1),x,c.rounds-1,c.waitCost);add(acc[2],base,actions[stop],x,stop,c.waitCost);
  if((t+1)%Math.max(1,Math.floor(c.steps/100))===0||t===c.steps-1)trace.push({t:t+1,firstLoss:acc[0].loss/(t+1),fullLoss:acc[1].loss/(t+1),sequentialLoss:acc[2].loss/(t+1),sequentialDelay:acc[2].delay/(t+1)});
 }
 return {summary:[scoreSummary("Первый этап",acc[0],c.steps),scoreSummary("Полное наблюдение",acc[1],c.steps),scoreSummary("Первый допустимый",acc[2],c.steps)],trace,counts,testSeed:seedFor(c.seed,50000),warning:"Модель вложенного раскрытия до полного наблюдения; drop не используется. Не оптимальная остановка, а сравнение фиксированных политик."};
}
export function defaultClasses(c){return {priors:[1-c.prior,c.prior/2,c.prior/2],u:[c.u[0],c.u[0].map((v,g)=>(v+c.u[1][g])/2),c.u[1]],losses:[[0,2,6],[1,.3,3],[4,1,.5]]};}
function ratioExtreme(lo,hi,v){
 if(!hi.some(a=>a>0))return null;
 let l=Math.min(...v),h=Math.max(...v);
 for(let i=0;i<70;i++){const m=(l+h)/2,s=sum(v.map((a,k)=>(a-m)*(a>=m?hi[k]:lo[k])));if(s>0)l=m;else h=m;}
 return h;
}
export function robustMulti(lo,hi,L,c){
 if(!hi.some(v=>v>0))return L.length;
 for(let a=0;a<L.length;a++){const risk=ratioExtreme(lo,hi,L[a]);if(risk>c+1e-12)continue;if(L.every((b,j)=>j===a||ratioExtreme(lo,hi,L[a].map((v,k)=>v-b[k]))< -1e-12))return a;}
 return L.length;
}
export function multiStudy(c){
 const base=baseFor(c),spec=c.classSpec||defaultClasses(base),K=spec.priors?.length,A=spec.losses?.length,B=base.groups.length;
 if(!integer(K,3,6)||!integer(A,2,8)||spec.priors.some(v=>!real(v,1e-8,1))||Math.abs(sum(spec.priors)-1)>1e-8||!Array.isArray(spec.u)||spec.u.length!==K||spec.u.some(row=>!Array.isArray(row)||row.length!==B||row.some(v=>!real(v,0,1)))||spec.losses.some(row=>!Array.isArray(row)||row.length!==K||row.some(v=>!real(v,0,1000))))throw Error("Некорректная многоклассовая спецификация");
 const q=spec.u.map(row=>row.map((u,g)=>mixLaw(base.groups[g],u,base.rho[g]*base.rhoScale))),r0=random(base.seed),counts=q.map(row=>row.map(p=>multinomial(base.m,p,r0))),G=base.groups.map(groupGeometry),hat=counts.map(row=>row.map(p=>p.map(v=>v/base.m))),eps=base.groups.map(n=>Math.min(2,Math.sqrt(2/base.m*Math.log((2**(n+1)-2)*K*B/base.alpha))));
 const low=hat.map(row=>row.map((p,g)=>G[g].H.map(h=>Math.max(0,-extrem(h.map(v=>-v),p,eps[g]))))),hi=hat.map(row=>row.map((p,g)=>G[g].H.map(h=>Math.max(0,extrem(h,p,eps[g]))))),center=hat.map(row=>row.map((p,g)=>G[g].H.map(h=>sum(h.map((v,j)=>v*p[j])))));
 const cdf=a=>a.map((_,i)=>sum(a.slice(0,i+1))),F=q.map(row=>row.map(cdf)),priorF=cdf(spec.priors),seed=seedFor(c.seed,60000),r=random(seed),hist=seq(3).map(()=>seq(K).map(()=>seq(A+1).map(()=>0)));
 for(let i=0;i<c.mcN;i++){const x=draw(priorF,r()),ix=base.groups.map((n,g)=>{const j=draw(F[x][g],r());let m=0,k=0;for(let v=0;v<n;v++)if(r()<1-base.drop){m++;k+=+(v<j);}return m*(m+1)/2+k;});
  const lik=table=>table.map((row,k)=>Math.log(spec.priors[k])+sum(row.map((a,g)=>Math.log(a[ix[g]]))));
  const l=lik(low),u=lik(hi),p=lik(center),truth=q.map((row,k)=>Math.log(spec.priors[k])+sum(row.map((a,g)=>Math.log(sum(G[g].H[ix[g]].map((v,j)=>v*a[j]))))));
  const max=Math.max(...u),lo=l.map(v=>Number.isFinite(max)?Math.exp(v-max):0),up=u.map(v=>Number.isFinite(max)?Math.exp(v-max):0);
  const bayes=logs=>{const z=Math.max(...logs);if(!Number.isFinite(z))return A;const w=logs.map(v=>Math.exp(v-z)),R=spec.losses.map(row=>sum(row.map((v,k)=>v*w[k]))/sum(w)),a=R.indexOf(Math.min(...R));return R[a]<=base.c?a:A;};
  [robustMulti(lo,up,spec.losses,base.c),bayes(p),bayes(truth)].forEach((a,k)=>hist[k][x][a]++);
 }
 const hMC=Math.sqrt(Math.log(12/base.alpha)/(2*c.mcN)),Lmax=Math.max(base.c,...spec.losses.flat());const summary=hist.map((H,i)=>({policy:["Робастная","Байес эмпирический","Истинный закон"][i],coverage:1-sum(H.map(row=>row[A]))/c.mcN,loss:sum(H.map((row,x)=>sum(row.map((n,a)=>n*(a===A?base.c:spec.losses[a][x])))))/c.mcN,N:c.mcN}));
 for(const row of summary){row.coverageLow=clamp(row.coverage-hMC,0,1);row.coverageHigh=clamp(row.coverage+hMC,0,1);row.lossLow=clamp(row.loss-Lmax*hMC,0,Lmax);row.lossHigh=clamp(row.loss+Lmax*hMC,0,Lmax);}return {summary,trace:[],spec,counts,hist,seed,eps,warning:"Многоклассовая модель с прямоугольными множествами правдоподобия. Истинный закон — недоступный эталон. Имитационные оценки условны относительно калибровки."};
}
