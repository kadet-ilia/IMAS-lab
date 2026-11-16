#!/usr/bin/env node
/**
 * E1-A prequential risk evaluation (locked no-oracle model).
 * All parameter choices are in adaptiveRiskCampaign.js and are never fitted
 * using old heldout labels. The whole run is paired between two alpha rules.
 */
import {createHash} from "node:crypto";
import {mkdirSync,readFileSync,writeFileSync,renameSync,existsSync} from "node:fs";
import {fileURLToPath} from "node:url";
import path from "node:path";
import {runAdaptiveSingle} from "../src/adaptiveExperiment.js";
import {riskCampaignDesign,riskCampaignConfig,riskCampaignAssertPair,riskCampaignValidateDesign,
 RISK_CAMPAIGN_CRITERION,RISK_CAMPAIGN_TOLERANCE} from "../src/adaptiveRiskCampaign.js";
import {bootstrap95,pairedSignFlipP,holmAdjusted} from "../src/statistics2027.js";

const args=process.argv.slice(2),get=(name,defaultValue)=>{
 const items=args.filter(s=>s.startsWith("--"+name+"="));
 if(items.length>1)throw Error("Repeated argument "+name);
 return items.length?items[0].slice(name.length+3):defaultValue;
};
if(args.some(x=>!/^--(stage|output)=/.test(x)))throw Error("Only --stage and --output permitted");
const stage=get("stage","smoke");
if(!["design","smoke","exploratory","confirmatory","all"].includes(stage))
 throw Error("Unknown risk campaign stage "+stage);
const design=riskCampaignValidateDesign(riskCampaignDesign());
const guiRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const json=o=>JSON.stringify(o,null,2)+"\n";
const sha=x=>createHash("sha256").update(x).digest("hex");
const sourceFiles=[
 "src/trustEngine.js","src/trustMethods.js","src/attackProfiles.js",
 "src/adaptiveDecisionEngine.js","src/adaptiveRiskController.js",
 "src/adaptiveScenario.js","src/adaptiveExperiment.js",
 "src/adaptiveCampaignProtocol.js","src/adaptiveRiskCampaign.js",
 "src/statistics2027.js","scripts/adaptiveRiskCampaign.mjs"
];
const hashed=createHash("sha256");
for(const file of sourceFiles){
 hashed.update(file);hashed.update("\0");
 hashed.update(readFileSync(path.join(guiRoot,file)));hashed.update("\0");
}
const sourceSha256=hashed.digest("hex");
const designSha256=sha(json(design));
const fingerprint=sha(designSha256+":"+sourceSha256);
const output=path.resolve(get("output",path.join(guiRoot,"adaptive-results","risk",fingerprint.slice(0,16))));
function atomic(p,content){
 mkdirSync(path.dirname(p),{recursive:true});
 const tmp=p+".tmp."+process.pid;writeFileSync(tmp,content);renameSync(tmp,p);
}
function csv(rows,keys){
 const escaped=x=>{
  const s=x==null?"":String(x);
  return /[\n";]/.test(s)?'"'+s.replaceAll('"','""')+'"':s;
 };
 return keys.join(";")+"\n"+rows.map(r=>keys.map(k=>escaped(r[k])).join(";")).join("\n")+"\n";
}
mkdirSync(output,{recursive:true});
const manifestFile=path.join(output,"risk-design.json");
const manifest={design,designSha256,sourceSha256,fingerprint,sourceFiles,
 origin:"experimental; not an oracle-validated or field-validated risk estimate",
 gitSha:process.env.GITHUB_SHA??null};
if(existsSync(manifestFile)){
 const saved=JSON.parse(readFileSync(manifestFile,"utf8"));
 if(saved.fingerprint!==fingerprint||saved.designSha256!==designSha256||
   saved.sourceSha256!==sourceSha256||sha(json(saved.design))!==designSha256)
  throw Error("Risk campaign archive / code identity mismatch");
}else atomic(manifestFile,json(manifest));
console.log("E1-A RISK fingerprint="+fingerprint+" stage="+stage);
if(stage==="design")process.exit(0);

const mean=a=>a.reduce((s,x)=>s+x,0)/a.length;
const seedRandom=seed=>{
 let s=(seed>>>0)||1;
 return()=>{s^=s<<13;s^=s>>>17;s^=s<<5;return(s>>>0)/4294967296;};
};
function quantile(values,q){
 const a=[...values].sort((x,y)=>x-y),v=(a.length-1)*q,k=Math.floor(v);
 return a[k]+(a[Math.min(a.length-1,k+1)]-a[k])*(v-k);
}
function analyzeCell(cell){
 const cache=path.join(output,cell.stage,cell.id+".json");
 if(existsSync(cache)){
  const record=JSON.parse(readFileSync(cache,"utf8"));
  if(record.fingerprint!==fingerprint||record.cell?.id!==cell.id||
   record.cell?.seed!==cell.seed||record.cell?.runs!==cell.runs||
   record.runs?.length!==cell.runs)
   throw Error("Risk campaign checkpoint incompatible "+cell.id);
  if(Math.abs(mean(record.runs.map(x=>x.dRiskLegacy))-record.meanDeltaRiskLegacy)>1e-12)
   throw Error("Risk campaign stored pair metrics invalid "+cell.id);
  return {value:record,cached:true};
 }
 const {config,risk,legacy}=riskCampaignConfig(cell);
 const pairs=[];
 let firstTrace=null;
 for(let index=0;index<cell.runs;index++){
  const newRun=runAdaptiveSingle(config,risk,index);
  const oldRun=runAdaptiveSingle(config,legacy,index);
  const metric=riskCampaignAssertPair(newRun,oldRun);
  if(index===0)firstTrace={
   risk:newRun.trajectory.map(t=>({
    step:t.step,alpha:t.diagnostics.alpha,riskContrast:t.diagnostics.riskContrast,
    riskPairs:t.diagnostics.riskPairs,decision:t.adaptive_robust,
    baseline:t.trimmed_unweighted,combined:t.proposed_robust
   })),
   legacy:oldRun.trajectory.map(t=>({
    step:t.step,alpha:t.diagnostics.alpha,decision:t.adaptive_robust
   }))
  };
  pairs.push(metric);
 }
 const differences=pairs.map(p=>p.dRiskLegacy),effect=mean(differences);
 const bootstrap=bootstrap95(differences,mean,cell.seed^0x6BC55,499);
 const sign=pairedSignFlipP(differences,cell.seed^0xA24E,4095);
 const out={fingerprint,cell,runs:pairs,
  adaptiveMeanRmse:mean(pairs.map(x=>x.rmseLegacyAdaptive)),
  riskMeanRmse:mean(pairs.map(x=>x.rmseRisk)),
  trimmedMeanRmse:mean(pairs.map(x=>x.rmseTrimmed)),
  combinedMeanRmse:mean(pairs.map(x=>x.rmseCombined)),
  meanDeltaRiskLegacy:effect,meanDeltaRiskTrimmed:mean(pairs.map(x=>x.dRiskTrimmed)),
  meanDeltaRiskCombined:mean(pairs.map(x=>x.dRiskCombined)),
  bootstrap95:[bootstrap.lower,bootstrap.upper],
  bootstrapReplicates:bootstrap.replicates,
  signFlipP:sign.p,signFlipMethod:sign.method,
  wins:differences.filter(x=>x<0).length,
  losses:differences.filter(x=>x>0).length,ties:differences.filter(x=>x===0).length,
  firstTrace
 };
 atomic(cache,json(out));
 return {value:out,cached:false};
}
function aggregate(current,records){
 const p=records.map(x=>x.signFlipP),adjusted=holmAdjusted(p);
 const conditions=records.map((x,i)=>({
  id:x.cell.id,law:x.cell.law,schedule:x.cell.schedule,f:x.cell.f,
  N:30,T:48,seed:x.cell.seed,R:x.cell.runs,
  riskRmse:x.riskMeanRmse,oldAdaptiveRmse:x.adaptiveMeanRmse,
  trimmedRmse:x.trimmedMeanRmse,combinedRmse:x.combinedMeanRmse,
  deltaRiskLegacy:x.meanDeltaRiskLegacy,
  deltaRiskTrimmed:x.meanDeltaRiskTrimmed,
  deltaRiskCombined:x.meanDeltaRiskCombined,
  ciLow:x.bootstrap95[0],ciHigh:x.bootstrap95[1],
  pSignFlip:x.signFlipP,pHolm:adjusted[i],
  wins:x.wins,losses:x.losses
 }));
 const point=mean(records.map(x=>x.meanDeltaRiskLegacy));
 const random=seedRandom(current==="confirmatory"?0xE111:0xE423);
 const replicates=999,draws=[];
 for(let b=0;b<replicates;b++){
  const cellMeans=records.map(cell=>{
   const diffs=cell.runs.map(x=>x.dRiskLegacy),n=diffs.length;
   let sample=0;for(let i=0;i<n;i++)sample+=diffs[Math.floor(random()*n)];
   return sample/n;
  });
  draws.push(mean(cellMeans));
 }
 return {stage:current,fingerprint,designSha256,model:design.modelVersions,
  pairedSimulationRuns:conditions.reduce((s,x)=>s+x.R,0),
  actualEstimatorRuns:2*conditions.reduce((s,x)=>s+x.R,0),
  cells:conditions.length,
  meanDeltaRiskLegacy:point,
  stratifiedBootstrapCi95:[quantile(draws,.025),quantile(draws,.975)],
  better:conditions.filter(x=>x.deltaRiskLegacy<0).length,
  worse:conditions.filter(x=>x.deltaRiskLegacy>0).length,
  usefulBenefit:conditions.filter(x=>x.deltaRiskLegacy<=-RISK_CAMPAIGN_TOLERANCE).length,
  materialHarm:conditions.filter(x=>x.deltaRiskLegacy>=RISK_CAMPAIGN_TOLERANCE).length,
  holmPotentialDiscoveries:conditions.filter(x=>x.pHolm<.05).length,
  interpretation:"Synthetic paired-seed simulation only; internal new-seed replication. Sign-flip requires sign exchangeability; risk proxy is uncalibrated.",
  primary:RISK_CAMPAIGN_CRITERION,conditions};
}
const stages=stage==="all"?["exploratory","confirmatory"]:[stage];
for(const s of stages){
 const results=[],started=Date.now();
 for(const [i,cell] of design.stages[s].entries()){
  const {value,cached}=analyzeCell(cell);
  results.push(value);
  console.log("E1-A RISK "+s+" ["+(i+1)+"/"+design.stages[s].length+"] "+
   cell.id+" dRiskLegacy="+value.meanDeltaRiskLegacy.toFixed(6)+(cached?" (checkpoint)":""));
 }
 const result=aggregate(s,results);
 atomic(path.join(output,s+"-summary.json"),json(result));
 const fields=["id","law","schedule","f","seed","R","riskRmse","oldAdaptiveRmse",
  "trimmedRmse","combinedRmse","deltaRiskLegacy","deltaRiskTrimmed",
  "deltaRiskCombined","ciLow","ciHigh","pSignFlip","pHolm","wins","losses"];
 atomic(path.join(output,s+"-summary.csv"),csv(result.conditions,fields));
 console.log("E1-A RISK RESULT "+JSON.stringify({
  stage:s,cells:result.cells,paired:result.pairedSimulationRuns,
  meanDeltaRiskLegacy:+result.meanDeltaRiskLegacy.toFixed(7),
  interval:result.stratifiedBootstrapCi95.map(x=>+x.toFixed(7)),
  better:result.better,worse:result.worse,usefulBenefit:result.usefulBenefit,
  materialHarm:result.materialHarm,
  elapsedSeconds:Math.round((Date.now()-started)/1000)
 }));
}
