#!/usr/bin/env node
/**
 * E1-A f x k x evidence-lag study; source-locked fixed synthetic protocol.
 * CLI: node scripts/adaptiveFklCampaign.mjs --stage=design|smoke|exploratory|confirmatory|all
 * 80 exploratory cells x 30 paired simulation blocks x FOUR fixed policies.
 * Source-locked per-cell checkpoint and full run-level metrics.
 */
import {createHash} from "node:crypto";
import {mkdirSync,existsSync,readFileSync,writeFileSync,renameSync} from "node:fs";
import {fileURLToPath} from "node:url";
import path from "node:path";
import {runAdaptiveSingle} from "../src/adaptiveExperiment.js";
import {fklDesign,validateFklDesign,fklCellConfiguration,fklModeOptions,
 E1A_FKL_MODES,E1A_FKL_VERSION} from "../src/adaptiveFklProtocol.js";
import {bootstrap95,pairedSignFlipP,holmAdjusted} from "../src/statistics2027.js";

const args=process.argv.slice(2);
const get=(name,fallback)=>{
 const found=args.filter(x=>x.startsWith("--"+name+"="));
 if(found.length>1)throw Error("Repeated --"+name);
 return found.length?found[0].slice(name.length+3):fallback;
};
if(args.some(x=>!/^--(stage|output)=/.test(x)))throw Error("Only --stage and --output may be specified; the protocol is frozen");
const stage=get("stage","smoke");
if(!["design","smoke","exploratory","confirmatory","all"].includes(stage))
 throw Error("Unknown experiment stage "+stage);
const design=validateFklDesign(fklDesign());
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const sourceFiles=[
 "src/trustEngine.js","src/trustMethods.js","src/attackProfiles.js",
 "src/adaptiveDecisionEngine.js","src/adaptiveScenario.js",
 "src/adaptiveExperiment.js","src/adaptiveRiskController.js",
 "src/adaptiveRegimeDetector.js","src/adaptiveEvidenceQuality.js",
 "src/adaptivePolicySelector.js","src/adaptiveCampaignProtocol.js",
 "src/adaptiveFklProtocol.js","src/statistics2027.js",
 "scripts/adaptiveFklCampaign.mjs"
];
const json=x=>JSON.stringify(x,null,2)+"\n";
const sha=x=>createHash("sha256").update(x).digest("hex");
const sourceHasher=createHash("sha256");
for(const file of sourceFiles)sourceHasher.update(file+"\0")
 .update(readFileSync(path.join(root,file))).update("\0");
const sourceSha256=sourceHasher.digest("hex");
const designSha256=sha(json(design)),fingerprint=sha(sourceSha256+":"+designSha256);
const output=path.resolve(get("output",
 path.join(root,"adaptive-results","fkl",fingerprint.slice(0,16))));
const atomic=(filename,data)=>{
 mkdirSync(path.dirname(filename),{recursive:true});
 const tmp=filename+".tmp."+process.pid;
 writeFileSync(tmp,data,"utf8");renameSync(tmp,filename);
};
const mean=x=>x.reduce((a,b)=>a+b,0)/x.length;
const finite=Number.isFinite;
const modeTag=Object.freeze({
 adaptive:"adaptive",risk_aware:"risk",
 regime_aware_discrete:"discrete",regime_aware_blend:"blend"
});
const tag=mode=>modeTag[mode];
function csv(rows,keys=Object.keys(rows[0]??{})){
 const escape=s=>{
  if(s==null)return "";
  const value=String(s);
  return /[;"\n]/.test(value)?'"'+value.replaceAll('"','""')+'"':value;
 };
 return [keys.join(";"),...rows.map(row=>keys.map(key=>escape(row[key])).join(";"))].join("\n")+"\n";
}
mkdirSync(output,{recursive:true});
const manifestPath=path.join(output,"protocol-manifest.json");
const manifest={protocol:design.protocol,design,designSha256,sourceSha256,fingerprint,
 sourceFiles,commit:process.env.GITHUB_SHA??null,
 note:"Hash-locked synthetic simulation. Same f/runIndex seed intentionally reused across k and lag."};
if(existsSync(manifestPath)){
 const old=JSON.parse(readFileSync(manifestPath,"utf8"));
 if(old.fingerprint!==fingerprint||old.designSha256!==designSha256||
  old.sourceSha256!==sourceSha256||sha(json(old.design))!==designSha256)
  throw Error("Stored FKL manifest incompatible; refuse mixed-code results");
}else atomic(manifestPath,json(manifest));
console.log("FKL fingerprint="+fingerprint+" stage="+stage+" output="+output);
if(stage==="design")process.exit(0);

const primaryModes=["adaptive","risk_aware","regime_aware_discrete","regime_aware_blend"];
function metric(run,method){
 const x=run.metrics.find(m=>m.method===method);
 if(!x||!finite(x.rmse)||!finite(x.unconditional_decision_loss)||!finite(x.decision_coverage))
  throw Error("Invalid RMSE/refusal metric for "+method+" run "+run.run);
 return x;
}
function assertPaired(a,b,cell,index){
 if(a.run!==index||b.run!==index||a.trajectory.length!==b.trajectory.length)
  throw Error("Simulation pairing mismatch in "+cell.id+" run "+index);
 for(let t=0;t<a.trajectory.length;t++){
  const x=a.trajectory[t],y=b.trajectory[t];
  for(const key of ["step","truth","attack_intensity","trimmed_unweighted",
   "proposed_robust","adaptive_unweighted","adaptive_weighted"]){
   if(!Object.is(x[key],y[key]))
    throw Error("Exogenous/baseline mismatch "+cell.id+" run "+index+
     " step "+t+" field "+key);
  }
 }
}
function phaseRmse(run,method,phase){
 const accepted=run.trajectory.filter(row=>
  (phase==="active"?row.attack_intensity>0:row.attack_intensity===0)&&finite(row[method]));
 if(!accepted.length)return null;
 return Math.sqrt(mean(accepted.map(row=>(row[method]-row.truth)**2)));
}
function runCell(cell){
 const file=path.join(output,cell.stage,cell.id+".json");
 if(existsSync(file)){
  const saved=JSON.parse(readFileSync(file,"utf8"));
  if(saved.fingerprint!==fingerprint||saved.cell?.id!==cell.id||
   saved.cell?.stage!==cell.stage||saved.cell?.runs!==cell.runs||
   saved.cell?.seed!==cell.seed||saved.runRows?.length!==cell.runs)
   throw Error("Invalid stored FKL cell "+cell.id);
  const computed=mean(saved.runRows.map(x=>x.deltaDiscreteCombined));
  if(Math.abs(computed-saved.summary.meanDeltaDiscreteCombined)>1e-11)
   throw Error("Corrupted FKL checkpoint mean "+cell.id);
  return {cached:true,record:saved};
 }
 const {config,options}=fklCellConfiguration(cell);
 const rows=[],firstTrace={};
 for(let runIndex=0;runIndex<cell.runs;runIndex++){
  const values={};
  for(const mode of E1A_FKL_MODES){
   const run=runAdaptiveSingle(config,fklModeOptions(options,mode),runIndex);
   if(run.trajectory.length!==config.n_steps)throw Error("Truncated trajectory");
   if(values.adaptive)assertPaired(values.adaptive,run,cell,runIndex);
   values[mode]=run;
  }
  const control=metric(values.adaptive,"proposed_robust");
  const trimmed=metric(values.adaptive,"trimmed_unweighted");
  const row={run:runIndex,seed:cell.seed,block:cell.block,
   f:cell.f,k:cell.k,lag:cell.lag,
   combinedRmse:control.rmse,trimmedRmse:trimmed.rmse,
   combinedUnconditionalLoss:control.unconditional_decision_loss,
   trimmedUnconditionalLoss:trimmed.unconditional_decision_loss,
   combinedCoverage:control.decision_coverage,
   combinedActiveRmse:phaseRmse(values.adaptive,"proposed_robust","active"),
   combinedInactiveRmse:phaseRmse(values.adaptive,"proposed_robust","inactive")};
  for(const mode of primaryModes){
   const key=tag(mode),m=metric(values[mode],"adaptive_robust");
   row[key+"Rmse"]=m.rmse;
   row[key+"UnconditionalLoss"]=m.unconditional_decision_loss;
   row[key+"Coverage"]=m.decision_coverage;
   row["delta"+key[0].toUpperCase()+key.slice(1)+"Combined"]=m.rmse-control.rmse;
   row["deltaLoss"+key[0].toUpperCase()+key.slice(1)+"Combined"]=
    m.unconditional_decision_loss-control.unconditional_decision_loss;
   row[key+"ActiveRmse"]=phaseRmse(values[mode],"adaptive_robust","active");
   row[key+"InactiveRmse"]=phaseRmse(values[mode],"adaptive_robust","inactive");
   if(mode.startsWith("regime_aware")){
    const last=values[mode].trajectory.at(-1).diagnostics;
    row[key+"Switches"]=last.policySwitches;
    row[key+"FinalSelection"]=last.regimeSelected;
    row[key+"Changes"]=values[mode].trajectory.filter(v=>v.diagnostics.regimeState==="change_detected").length;
    row[key+"MeanQuality"]=mean(values[mode].trajectory.map(v=>v.diagnostics.evidenceQualityScore).filter(finite));
   }
   if(runIndex===0)firstTrace[mode]=values[mode].trajectory.map(x=>({
    step:x.step,attackIntensity:x.attack_intensity,
    estimated:x.adaptive_robust,combined:x.proposed_robust,
    selected:x.diagnostics.regimeSelected,
    state:x.diagnostics.regimeState,quality:x.diagnostics.evidenceQualityScore,
    weights:x.diagnostics.policyWeights,k:x.diagnostics.k,
    alpha:x.diagnostics.alpha
   }));
  }
  if(Object.values(row).some(x=>typeof x==="number"&&!finite(x)))
   throw Error("Non-finite FKL result "+cell.id+"/"+runIndex);
  rows.push(row);
 }
 const summary={id:cell.id,stage:cell.stage,f:cell.f,k:cell.k,lag:cell.lag,
  strategy:cell.attackStrategy,law:cell.temporalLaw,schedule:cell.temporalSchedule,
  R:cell.runs,seed:cell.seed,block:cell.block,
  meanCombinedRmse:mean(rows.map(x=>x.combinedRmse)),
  meanTrimmedRmse:mean(rows.map(x=>x.trimmedRmse)),
  meanCombinedCoverage:mean(rows.map(x=>x.combinedCoverage))};
 for(const mode of primaryModes){
  const key=tag(mode),code=key[0].toUpperCase()+key.slice(1);
  const d=rows.map(x=>x["delta"+code+"Combined"]);
  const bootstrap=bootstrap95(d,mean,cell.seed^((cell.ordinal+1)*16471)^
   (primaryModes.indexOf(mode)+5)*439,cell.stage==="smoke"?199:499);
  summary["mean"+code+"Rmse"]=mean(rows.map(x=>x[key+"Rmse"]));
  summary["meanDelta"+code+"Combined"]=mean(d);
  summary["ci"+code+"Low"]=bootstrap.lower;
  summary["ci"+code+"High"]=bootstrap.upper;
  summary["wins"+code]=d.filter(x=>x<0).length;
  summary["losses"+code]=d.filter(x=>x>0).length;
  summary["meanDeltaLoss"+code+"Combined"]=
   mean(rows.map(x=>x["deltaLoss"+code+"Combined"]));
 }
 const record={fingerprint,cell,config,options,summary,runRows:rows,firstTrace};
 atomic(file,json(record));
 return {cached:false,record};
}
function pairedFactorContrasts(records,factor){
 const cells=new Map(records.map(r=>[r.cell.id,r]));
 const rows=[];
 if(factor==="lag"){
  for(const f of design.factorial.f)for(const k of design.factorial.k){
   const base=cells.get("f"+f+"__k"+k+"__lag0");
   if(!base)continue;
   for(const lag of design.factorial.lag.filter(x=>x>0)){
    const other=cells.get("f"+f+"__k"+k+"__lag"+lag);
    if(!other)continue;
    const d=base.runRows.map((x,j)=>
     other.runRows[j].deltaDiscreteCombined-x.deltaDiscreteCombined);
    const b=bootstrap95(d,mean,base.cell.seed^lag^0x1CA1,499);
    rows.push({factor:"lag",f,k,from:0,to:lag,R:d.length,
     meanInteractionDelta:d.length?mean(d):null,ciLow:b.lower,ciHigh:b.upper});
   }
  }
 }
 if(factor==="k"){
  for(const f of design.factorial.f)for(const lag of design.factorial.lag){
   const base=cells.get("f"+f+"__k0__lag"+lag);
   if(!base)continue;
   for(const k of design.factorial.k.filter(x=>x>0)){
    const other=cells.get("f"+f+"__k"+k+"__lag"+lag);
    if(!other)continue;
    const d=base.runRows.map((x,j)=>
     other.runRows[j].deltaDiscreteCombined-x.deltaDiscreteCombined);
    const b=bootstrap95(d,mean,base.cell.seed^k^0x2AB1,499);
    rows.push({factor:"k",f,lag,from:0,to:k,R:d.length,
     meanInteractionDelta:mean(d),ciLow:b.lower,ciHigh:b.upper});
   }
  }
 }
 return rows;
}
function stageSummary(current,records){
 const conditions=records.map(x=>x.summary);
 const runRows=records.flatMap(x=>x.runRows.map(row=>({...row,id:x.cell.id,
  stage:current,attackStrategy:x.cell.attackStrategy})));
 if(conditions.length!==design.stages[current].length||
   runRows.length!==design.stages[current].reduce((s,c)=>s+c.runs,0))
  throw Error("Truncated FKL stage "+current);
 const expected=design.stages[current];
 for(let i=0;i<expected.length;i++)
  if(expected[i].id!==conditions[i].id||expected[i].seed!==conditions[i].seed)
   throw Error("FKL cells reordered after computation");
 const aggregate={};
 for(const mode of primaryModes){
  const key=tag(mode),code=key[0].toUpperCase()+key.slice(1);
  const name="meanDelta"+code+"Combined";
  aggregate[key]={meanCellWeightedDeltaRmse:mean(conditions.map(x=>x[name])),
   cellsBetter:conditions.filter(x=>x[name]<0).length,
   cellsWorse:conditions.filter(x=>x[name]>0).length,
   cellsWithinAbs001:conditions.filter(x=>Math.abs(x[name])<0.01).length,
   averageRunCoverage:mean(runRows.map(x=>x[key+"Coverage"]))};
 }
 if(current==="confirmatory"){
  // Conditional exploratory-style inference; sign-exchangeability is an assumption.
  const p=records.map((x,i)=>pairedSignFlipP(
   x.runRows.map(row=>row.deltaDiscreteCombined),x.cell.seed^(i*947),4095).p);
  const adjusted=holmAdjusted(p);
  conditions.forEach((row,i)=>{row.pDiscreteSignFlip=p[i];row.pDiscreteHolm=adjusted[i];});
 }
 const results={protocol:E1A_FKL_VERSION,stage:current,fingerprint,
  designSha256,sourceSha256,cells:conditions.length,
  pairedBlocksPerCell:expected[0]?.runs??0,
  cellRuns:runRows.length,individualPolicyRuns:runRows.length*primaryModes.length,
  distinctFactorCells:conditions.length,
  seedBlocks:design.stageSeedBlocks,
  factorBlocking:"Common seed within each Byzantine f and runIndex, across all k/lag cells. Do not treat cell×runIndex as independent for across-cell inference.",
  primary:"RMSE(regime_aware_discrete) minus RMSE(proposed_robust) by whole-run paired observation",
  overall:aggregate,
  averageCombinedRmse:mean(conditions.map(x=>x.meanCombinedRmse)),
  lagContrasts:current==="exploratory"?pairedFactorContrasts(records,"lag"):[],
  kContrasts:current==="exploratory"?pairedFactorContrasts(records,"k"):[],
  caveats:["Synthetic data; result only conditional on configured factors and controls.",
   "Cross-cell standard errors cannot be computed as if all cells were independent.",
   "Within-cell percentile bootstrap intervals are descriptive and unadjusted.",
   "Sign-flip requires exchangeability of paired-difference signs.",
   "Confirmatory stage is held out by seed and attack strategy; not a real-world external dataset."],
  conditions};
 atomic(path.join(output,current+"-summary.json"),json(results));
 atomic(path.join(output,current+"-conditions.csv"),csv(conditions));
 atomic(path.join(output,current+"-run-metrics.csv"),csv(runRows));
 if(results.lagContrasts.length)
  atomic(path.join(output,current+"-lag-contrasts.csv"),csv(results.lagContrasts));
 if(results.kContrasts.length)
  atomic(path.join(output,current+"-trim-contrasts.csv"),csv(results.kContrasts));
 return results;
}
const stages=stage==="all"?["exploratory","confirmatory"]:[stage];
for(const current of stages){
 const records=[],start=Date.now();
 for(const [index,cell] of design.stages[current].entries()){
  const {record,cached}=runCell(cell);
  records.push(record);
  console.log("FKL "+current+" ["+(index+1)+"/"+design.stages[current].length+"] "+
   cell.id+" ΔRMSE(discrete-combined)="+record.summary.meanDeltaDiscreteCombined.toFixed(6)+
   (cached?" (verified checkpoint)":""));
 }
 const result=stageSummary(current,records);
 console.log("FKL RESULT "+JSON.stringify({stage:current,cells:result.cells,
  cellRuns:result.cellRuns,methodSimulations:result.individualPolicyRuns,
  overall:result.overall,elapsedWallSeconds:Math.round((Date.now()-start)/1000),
  output,fingerprint}));
}
