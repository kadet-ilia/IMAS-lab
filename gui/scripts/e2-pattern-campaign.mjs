// Prospective synthetic confirmation. Rules frozen and written before new outcomes.
import fs from "node:fs";
import path from "node:path";
import {EXTRA_DEFAULTS} from "../src/automaticDecisions/extendedStudies.js";
import {exactExt,seedFor} from "../src/automaticDecisions/extendedModel.js";
import {heterogeneousQueue} from "../src/automaticDecisions/heterogeneousQueue.js";
import {random} from "../src/automaticDecisions/kernel.js";
import {discoverRules,evaluateRules} from "../src/automaticDecisions/patternAnalysis.js";
const ROOT=20261127,N=128,seq=n=>Array.from({length:n},(_,i)=>i),mean=a=>a.reduce((s,v)=>s+v,0)/a.length;
const dir=process.argv[2]||"pattern-campaign";fs.mkdirSync(dir,{recursive:true});
const base={...EXTRA_DEFAULTS,groups:[3,3,3],u:[[.1,.15,.2],[.9,.85,.8]],rho:[.6,.5,.4],prior:.35,drop:.2,m:4000,reps:1,c:1.25,b:6,f:2,d:.6,family:"l1",stress:"none",eta:0};
const domains=[
 {name:"coverage",axes:["rhoScale","drop"],settings:{margin:.02,minN:12,target:.75,maxRules:5},make(seed,id){
  const r=random(seedFor(seed,11)),factors={rhoScale:r(),drop:.05+.8*r()},input={...base,...factors,seed};
  const v=exactExt(input);return {id,factors,gain:v.coverage-.6,reps:1,seeds:[seed],input,primary:{coverage:v.coverage,loss:v.loss,counts:v.counts}};
 }},
 {name:"reserve",axes:["arrival","reserveHourly"],settings:{margin:.003,minN:12,target:.75,maxRules:5},make(seed,id){
  const r=random(seedFor(seed,11)),factors={arrival:20+60*r(),reserveHourly:.1+2.4*r()},input={...base,seed,arrival:factors.arrival,queueExperiment:"heterogeneous",queueHorizon:6,queueWarmup:.5,peakMultiplier:3,peakStart:.3,peakEnd:.65,queueCapacity:12,deadline:.25,queueWaitCost:1,failureCost:2,feedbackGain:1,safetyRisk:1.25,queueReps:3,reserveOn:4,reserveOff:1,operatorSpec:[{name:"Fast",rate:18,fp:.12,fn:.15,cost:.2,hourly:.65,reserve:false},{name:"Expert",rate:8,fp:.025,fn:.03,cost:.4,hourly:1.25,reserve:false},{name:"Reserve",rate:14,fp:.06,fn:.07,cost:.25,hourly:factors.reserveHourly,reserve:true}]};
  const runs=seq(3).map(rep=>heterogeneousQueue(input,{kind:"heterogeneousQueue",rep}));
  if(runs.some(v=>v.summary.some(s=>!Number.isFinite(s.loss)||s.unsafe)))throw Error("Invalid queue outcome");
  return {id,factors,gain:mean(runs.map(v=>v.summary[2].loss-v.summary[3].loss)),reps:3,seeds:[seed],input,primary:runs.map(v=>({unit:v.unit,summary:v.summary,calSeed:v.calSeed,arrivalSeed:v.arrivalSeed,observationSeed:v.observationSeed,serviceSeed:v.serviceSeed,errorSeed:v.errorSeed,calibrationCounts:v.calibrationCounts}))};
 }}
];
const results=[];
for(const [i,d] of domains.entries()){
 const make=(phase)=>seq(N).map(j=>d.make(seedFor(ROOT,301000+i*10000+phase*1000+j),d.name+"-"+phase+"-"+j));
 const discovery=make(0),frozen=discoverRules(discovery,d.axes,d.settings);
 fs.writeFileSync(path.join(dir,d.name+"-frozen.json"),JSON.stringify(frozen,null,2));
 const confirmation=make(1);
 if(new Set([...discovery,...confirmation].map(v=>JSON.stringify(v.factors))).size!==2*N)throw Error("Repeated configuration");
 const report=evaluateRules(frozen,confirmation,{iidFresh:true,alpha:.025});
 const summary={domain:d.name,discoveryN:discovery.length,confirmationN:confirmation.length,examined:frozen.examined,selected:report.rules.length,significant:report.rules.filter(v=>v.significant).length,reproduced:report.rules.filter(v=>v.status==="descriptive_support").length,allDiscoveryMean:mean(discovery.map(v=>v.gain)),allConfirmationMean:mean(confirmation.map(v=>v.gain)),rules:report.rules.map(({exceptions,...v})=>({...v,exceptionCount:exceptions.length,worstException:exceptions[0]??null}))};
 fs.writeFileSync(path.join(dir,d.name+"-cases.json"),JSON.stringify({discovery,confirmation}));fs.writeFileSync(path.join(dir,d.name+"-report.json"),JSON.stringify(report,null,2));results.push(summary);console.log("PATTERN_CAMPAIGN "+JSON.stringify(summary));
}
fs.writeFileSync(path.join(dir,"summary.json"),JSON.stringify({seed:ROOT,uniqueConfigurations:4*N,alphaPerDomain:.025,results},null,2));
