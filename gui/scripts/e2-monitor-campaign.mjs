// Predeclared pilot: 128 distinct configurations per direction.
// All kernels are imported from the actual application.
import fs from "node:fs";
import path from "node:path";
import {EXTRA_DEFAULTS} from "../src/automaticDecisions/extendedStudies.js";
import {random} from "../src/automaticDecisions/kernel.js";
import {seedFor,groupGeometry,lawsExt,transform,marginal,point,loss,spaceSize} from "../src/automaticDecisions/extendedModel.js";
import {monitorStudy} from "../src/automaticDecisions/adequacyMonitor.js";
import {rareStudy} from "../src/automaticDecisions/rareEvents.js";
import {alternatives,nominalAction} from "../src/automaticDecisions/alternativeRisk.js";
import {predictiveTables} from "../src/automaticDecisions/probabilityBounds.js";
const ROOT=20261129,N=128,seq=n=>Array.from({length:n},(_,i)=>i),sum=a=>a.reduce((s,v)=>s+v,0),mean=a=>a.length?sum(a)/a.length:null;
function base(i,mode){
 const seed=seedFor(ROOT,10000*mode+i),r=random(seedFor(seed,11)),u=(a,b)=>a+(b-a)*r(),n=(a,b)=>Math.floor(u(a,b+1)),groups=seq(3).map(()=>n(2,4)),c={...EXTRA_DEFAULTS,seed,groups,u:[groups.map(()=>u(.08,.25)),groups.map(()=>u(.78,.95))],rho:groups.map(()=>u(.05,.4)),m:n(1500,4000),prior:u(.35,.65),drop:u(.05,.25),c:u(.9,1.5),reps:1,stress:"none",eta:0,family:"l1"};
 return {c,u,n};
}
function monitor(i){
 const {c:b,u,n}=base(i,1),monitorStress=["driftAll","drift","cross","mnar"][i%4],c={...b,monitorStress,monitorRef:n(4000,8000),monitorReps:1,steps:n(2600,4200),window:n(300,600),shortWindow:n(50,150),monitorMin:n(40,100),delay:n(5,30),changeAt:u(.25,.5),shift:u(.75,1),updateEvery:50,alarmAlpha:.05};
 const a=monitorStudy(c,{kind:"monitor",rep:0,shift:0}),d=monitorStudy(c,{kind:"monitor",rep:0,shift:c.shift});
 if(JSON.stringify(a.counts)!==JSON.stringify(d.counts)||a.refSeed!==d.refSeed)throw Error("Unpaired monitor reference");
 for(const r of [a,d])for(const v of r.events)if(v.eAlarm!==null&&(!v.revoked[2]||!v.revoked[3]||v.actions[2]!==2))throw Error("Invalid withdrawal");
 return {input:c,output:{null:a.summary,shift:d.summary,alarms:[a.scanAlarm,a.eAlarm,d.scanAlarm,d.eAlarm],features:[d.scanFeature,d.eFeature],switchAt:d.switchAt,counts:d.counts,referenceStats:d.referenceStats,seeds:[d.seed,d.refSeed,d.testSeed]}};
}
function rare(i){
 const {c:b,u}=base(i,2),c={...b,prior:u(.03,.4),drop:u(.05,.4),mcN:4000,mcAlpha:.05,mcVariant:"rare",mcExact:true,mcProposal:.5,rareTilt:u(.5,4),rareDefensive:u(.2,.6)};
 const r=rareStudy(c,0);
 return {input:c,output:{summary:r.summary,counts:r.counts,seeds:r.seeds,calSeed:r.calSeed}};
}
function exactRisk(c,r){
 const G=c.groups.map(groupGeometry),hat=r.dirichlet.parameters.map(row=>row.map(a=>a.map(v=>v/sum(a)))),P=predictiveTables(G,hat),q=lawsExt(c).nominal,F=marginal(transform(c,G),q),shape=G.map(g=>g.pairs.length),names=["pac","bernstein","combined"],risk=names.map(()=>0),coverage=names.map(()=>0);let mass=0;
 for(let i=0;i<spaceSize(c);i++){let j=i;const ix=shape.map(()=>0);for(let g=shape.length-1;g>=0;g--){ix[g]=j%shape[g];j=Math.floor(j/shape[g]);}
 const p0=(1-c.prior)*F[0].reduce((a,v,g)=>a*v[ix[g]],1),p1=c.prior*F[1].reduce((a,v,g)=>a*v[ix[g]],1),{action,score}=nominalAction(c,point(c,P,ix)[0]);mass+=p0+p1;
 names.forEach((k,i)=>{if(r.control[k]!==null&&score<=r.control[k]){risk[i]+=p0*loss(c,action,0)+p1*loss(c,action,1);coverage[i]+=p0+p1;}});
 }
 if(Math.abs(mass-1)>1e-9)throw Error("PAC true mass");
 return names.map((k,i)=>({policy:k,risk:risk[i],coverage:coverage[i],exceeds:risk[i]>c.autoRiskTarget+1e-12,threshold:r.control[k]}));
}
function pac(i){
 const {c:b,u}=base(i,3),c={...b,prior:u(.03,.45),experiment:"riskBounds",riskCalN:i%2?1000:3000,mcN:2000,riskLevels:21,autoRiskTarget:u(.08,.18),riskAlpha:.05},r=alternatives(c,0);
 return {input:c,output:{summary:r.summary,truth:exactRisk(c,r),control:r.control,counts:r.counts,seeds:[r.calSeed,r.riskSeed,r.testSeed]}};
}
function monStats(a){return {cases:a.length,detectors:[1,2].map(j=>({policy:a[0].output.shift[j].policy,falseAlarms:sum(a.map(v=>v.output.null[j].preAlarm)),preAlarms:sum(a.map(v=>v.output.shift[j].preAlarm)),detections:sum(a.map(v=>v.output.shift[j].detected)),delay:mean(a.map(v=>v.output.shift[j].alarmDelay).filter(v=>v!==null)),lossGain:mean(a.map(v=>v.output.shift[0].loss-v.output.shift[j].loss))})),refitLossGain:mean(a.map(v=>v.output.shift[2].loss-v.output.shift[3].loss)),refitUpdates:mean(a.map(v=>v.output.shift[3].updates))};}
function rareStats(a){return [0,1,2].map(j=>{const b=a.map(v=>v.output.summary[j]);return {policy:b[0].policy,cases:b.length,rmseMiss:Math.sqrt(mean(b.map(v=>(v.miss-v.exactMiss)**2))),rmseFalse:Math.sqrt(mean(b.map(v=>(v.false-v.exactFalse)**2))),rmseLoss:Math.sqrt(mean(b.map(v=>(v.loss-v.exactLoss)**2))),meanESS:mean(b.map(v=>v.ess)),meanMissEvents:mean(b.map(v=>v.missEvents)),meanFalseEvents:mean(b.map(v=>v.falseEvents)),meanWeight:mean(b.map(v=>v.meanWeight)),missCovered:sum(b.map(v=>+(v.missLow<=v.exactMiss+1e-12&&v.exactMiss<=v.missHigh+1e-12))),falseCovered:sum(b.map(v=>+(v.falseLow<=v.exactFalse+1e-12&&v.exactFalse<=v.falseHigh+1e-12)))};});}
function pacStats(a){return [0,1,2].map(j=>{const b=a.map(v=>v.output.truth[j]);return {policy:b[0].policy,cases:b.length,nonempty:b.filter(v=>v.threshold!==null).length,coverage:mean(b.map(v=>v.coverage)),risk:mean(b.map(v=>v.risk)),exceeds:b.filter(v=>v.exceeds).length};});}
const dir=process.argv[2]||"monitor-campaign";fs.mkdirSync(dir,{recursive:true});
const all=[];
for(const [mode,f,stats] of [["monitor",monitor,monStats],["rare",rare,rareStats],["pac",pac,pacStats]]){
 const start=performance.now(),rows=seq(N).map(i=>({case:i+1,fold:i<64?"discovery":"confirmation",...f(i)}));
 if(new Set(rows.map(v=>JSON.stringify(v.input))).size!==N)throw Error("Duplicate configurations");
 const summary={mode,cases:N,all:stats(rows),confirmation:stats(rows.slice(64)),...(mode==="monitor"?{strata:Object.fromEntries(["driftAll","drift","cross","mnar"].map(k=>[k,stats(rows.filter(v=>v.input.monitorStress===k))]))}:{}),ms:Math.round(performance.now()-start)};
 fs.writeFileSync(path.join(dir,mode+".json"),JSON.stringify(rows,null,2));all.push(summary);console.log("MONITOR_CAMPAIGN "+JSON.stringify(summary));
}
fs.writeFileSync(path.join(dir,"summary.json"),JSON.stringify({seed:ROOT,uniqueConfigurations:3*N,scope:"Synthetic pilot, paired null and shift, separate 64+64 halves; descriptive, not universal power or field validation.",all},null,2));
console.log("MONITOR_CAMPAIGN_COMPLETE "+JSON.stringify({cases:3*N}));
