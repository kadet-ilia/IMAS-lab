#!/usr/bin/env node
/**
 * Frozen M5-B research: 80 discovery conditions, 16 OOD confirmation.
 * Never tune the regime policy based on a finished confirmation.
 *
 * node scripts/adaptivePeriodicCampaign.mjs --stage=design|smoke|exploratory|confirmatory|all
 */
import {createHash} from "node:crypto";
import {mkdirSync,existsSync,readFileSync,writeFileSync,renameSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {runAdaptiveSingle} from "../src/adaptiveExperiment.js";
import {periodicCampaignDesign,validatePeriodicCampaignDesign,
 periodicCellOptions,PERIODIC_MODES,E1A_PERIODIC_VERSION}
 from "../src/adaptivePeriodicCampaignProtocol.js";
import {bootstrap95,pairedSignFlipP,holmAdjusted} from "../src/statistics2027.js";

const args=process.argv.slice(2);
const option=(name,fallback)=>{
 const match=args.filter(x=>x.startsWith("--"+name+"="));
 if(match.length>1)throw Error("Repeated --"+name);
 return match.length?match[0].slice(name.length+3):fallback;
};
if(args.some(s=>!/^--(stage|output)=/.test(s)))
 throw Error("Only --stage and --output are allowed; design is immutable");
const stage=option("stage","smoke");
if(!["design","smoke","exploratory","confirmatory","all"].includes(stage))
 throw Error("Unknown M5-B stage");
const design=validatePeriodicCampaignDesign(periodicCampaignDesign());
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const files=[
 "src/trustEngine.js","src/trustMethods.js","src/attackProfiles.js",
 "src/adaptiveDecisionEngine.js","src/adaptiveScenario.js",
 "src/adaptiveExperiment.js","src/adaptiveRiskController.js",
 "src/adaptiveEvidenceQuality.js","src/adaptiveRegimeDetector.js",
 "src/adaptivePolicySelector.js","src/adaptiveCampaignProtocol.js",
 "src/adaptivePeriodicCampaignProtocol.js","src/statistics2027.js",
 "scripts/adaptivePeriodicCampaign.mjs"
];
const sourceHash=createHash("sha256");
for(const f of files)sourceHash.update(f+"\0")
 .update(readFileSync(path.join(root,f))).update("\0");
const sourceSha256=sourceHash.digest("hex");
const json=x=>JSON.stringify(x,null,2)+"\n";
const sha=x=>createHash("sha256").update(x).digest("hex");
const designSha256=sha(json(design));
const fingerprint=sha(sourceSha256+":"+designSha256);
const folder=path.resolve(option("output",
 path.join(root,"adaptive-results","periodic",fingerprint.slice(0,16))));
function atomic(file,data){
 mkdirSync(path.dirname(file),{recursive:true});
 const tmp=file+".tmp."+process.pid;
 writeFileSync(tmp,data,"utf8");renameSync(tmp,file);
}
function csv(rows,keys=Object.keys(rows[0]??{})){
 const fmt=v=>{
  if(v===null||v===undefined)return "";
  const s=String(v);
  return /[;"\n]/.test(s)?'"'+s.replaceAll('"','""')+'"':s;
 };
 return [keys.join(";"),...rows.map(row=>keys.map(k=>fmt(row[k])).join(";"))].join("\n")+"\n";
}
mkdirSync(folder,{recursive:true});
const manifestFile=path.join(folder,"protocol-manifest.json");
const manifest={protocol:design.protocol,design,designSha256,
 sourceSha256,fingerprint,sourceFiles:files,commit:process.env.GITHUB_SHA??null,
 limitations:"Synthetic scenario, exploratory RMSE not a validation of full IMAS stability."};
if(existsSync(manifestFile)){
 const old=JSON.parse(readFileSync(manifestFile,"utf8"));
 if(old.fingerprint!==fingerprint||old.sourceSha256!==sourceSha256||
   old.designSha256!==designSha256||sha(json(old.design))!==designSha256)
  throw Error("Stored campaign fingerprint mismatch");
}else atomic(manifestFile,json(manifest));
console.log("M5-B fingerprint="+fingerprint+" stage="+stage);
if(stage==="design")process.exit(0);

const finite=Number.isFinite;
const mean=x=>x.reduce((s,v)=>s+v,0)/x.length;
const label={adaptive:"adaptive",risk_aware:"risk",
 regime_aware_discrete:"discrete"};
function metrics(run,method){
 const m=run.metrics.find(x=>x.method===method);
 if(!m||![m.rmse,m.unconditional_decision_loss,m.decision_coverage].every(finite))
  throw Error("M5-B missing finite metric "+method);
 return m;
}
function checkPair(reference,other,cell,index){
 if(reference.run!==index||other.run!==index||
    reference.trajectory.length!==other.trajectory.length)
  throw Error("M5-B unpaired simulation "+cell.id);
 for(let t=0;t<reference.trajectory.length;t++){
  const a=reference.trajectory[t],b=other.trajectory[t];
  for(const key of ["step","attack_intensity","truth","trimmed_unweighted",
   "proposed_robust","adaptive_unweighted","adaptive_weighted"]){
   if(!Object.is(a[key],b[key]))
    throw Error("M5-B invariant failure "+cell.id+
     " run="+index+" step="+t+" variable="+key);
  }
 }
}
function runCell(cell){
 const filename=path.join(folder,cell.stage,cell.id+".json");
 if(existsSync(filename)){
  const saved=JSON.parse(readFileSync(filename,"utf8"));
  if(saved.fingerprint!==fingerprint||saved.cell.id!==cell.id||
    saved.cell.runs!==cell.runs||saved.cell.seed!==cell.seed||
    saved.runs.length!==cell.runs)
   throw Error("M5-B invalid checkpoint "+cell.id);
  const reconstructed=mean(saved.runs.map(x=>x.deltaDiscreteCombined));
  if(Math.abs(reconstructed-saved.summary.meanDeltaDiscreteCombined)>1e-11)
   throw Error("M5-B corrupted checkpoint "+cell.id);
  return {record:saved,cached:true};
 }
 const modes=PERIODIC_MODES,rows=[],firstTrace={};
 const configurations=Object.fromEntries(modes.map(mode=>[
  mode,periodicCellOptions(cell,mode)]));
 for(let index=0;index<cell.runs;index++){
  const results={};
  for(const mode of modes){
   const {config,options}=configurations[mode];
   const output=runAdaptiveSingle(config,options,index);
   if(results.adaptive)checkPair(results.adaptive,output,cell,index);
   results[mode]=output;
  }
  const control=metrics(results.adaptive,"proposed_robust");
  const trimmed=metrics(results.adaptive,"trimmed_unweighted");
  const row={cell:cell.id,run:index,seed:cell.seed,
   strategy:cell.strategy,law:cell.law,schedule:cell.schedule,
   f:cell.f,correlation:cell.correlation,
   period:cell.period,dutyFraction:cell.dutyFraction,
   attackDuty:cell.attackDuty,
   combinedRmse:control.rmse,trimmedRmse:trimmed.rmse,
   combinedLoss:control.unconditional_decision_loss,
   trimmedLoss:trimmed.unconditional_decision_loss,
   combinedCoverage:control.decision_coverage};
  for(const mode of modes){
   const key=label[mode],cap=key[0].toUpperCase()+key.slice(1);
   const m=metrics(results[mode],"adaptive_robust");
   row[key+"Rmse"]=m.rmse;
   row[key+"Loss"]=m.unconditional_decision_loss;
   row[key+"Coverage"]=m.decision_coverage;
   row["delta"+cap+"Combined"]=m.rmse-control.rmse;
   row["deltaLoss"+cap+"Combined"]=
    m.unconditional_decision_loss-control.unconditional_decision_loss;
   if(mode==="regime_aware_discrete"){
    const trajectory=results[mode].trajectory;
    row.switches=trajectory.at(-1).diagnostics.policySwitches;
    row.endSelection=trajectory.at(-1).diagnostics.regimeSelected;
    row.changeDetections=trajectory.filter(x=>
     x.diagnostics.regimeState==="change_detected").length;
   }
   if(index===0)firstTrace[mode]=results[mode].trajectory.map(x=>({
    step:x.step,intensity:x.attack_intensity,decision:x.adaptive_robust,
    combined:x.proposed_robust,selected:x.diagnostics.regimeSelected,
    regime:x.diagnostics.regimeState,quality:x.diagnostics.evidenceQualityScore,
    weights:x.diagnostics.policyWeights,alpha:x.diagnostics.alpha}));
  }
  if(Object.values(row).some(v=>typeof v==="number"&&!finite(v)))
   throw Error("Nonfinite M5-B metric "+cell.id+" run "+index);
  rows.push(row);
 }
 const summary={id:cell.id,stage:cell.stage,strategy:cell.strategy,
  law:cell.law,schedule:cell.schedule,f:cell.f,
  correlation:cell.correlation,period:cell.period,
  dutyFraction:cell.dutyFraction,attackDuty:cell.attackDuty,
  runs:cell.runs,seed:cell.seed,
  combinedRmse:mean(rows.map(x=>x.combinedRmse)),
  combinedLoss:mean(rows.map(x=>x.combinedLoss)),
  fractionWithoutSwitch:rows.filter(x=>x.switches===0).length/rows.length};
 for(const mode of modes){
  const key=label[mode],cap=key[0].toUpperCase()+key.slice(1);
  const differences=rows.map(x=>x["delta"+cap+"Combined"]);
  const ci=bootstrap95(differences,mean,
   cell.seed^((cell.ordinal+1)*131)^((modes.indexOf(mode)+1)*8107),
   cell.stage==="smoke"?199:499);
  summary["meanDelta"+cap+"Combined"]=mean(differences);
  summary["ci"+cap+"Low"]=ci.lower;
  summary["ci"+cap+"High"]=ci.upper;
  summary["better"+cap]=differences.filter(x=>x<0).length;
  summary["worse"+cap]=differences.filter(x=>x>0).length;
  summary["meanDeltaLoss"+cap+"Combined"]=mean(rows.map(x=>
   x["deltaLoss"+cap+"Combined"]));
 }
 const record={fingerprint,cell,config:configurations.adaptive.config,
  options:configurations.adaptive.options,summary,runs:rows,firstTrace};
 atomic(filename,json(record));
 return {record,cached:false};
}
function aggregate(current,records){
 const conditions=records.map(x=>x.summary);
 if(conditions.length!==design.stages[current].length)
  throw Error("Incomplete M5-B stage");
 const expected=design.stages[current];
 for(let i=0;i<expected.length;i++){
  if(conditions[i].id!==expected[i].id||
    conditions[i].seed!==expected[i].seed||
    records[i].runs.length!==expected[i].runs)
   throw Error("M5-B missing or reordered cell "+i);
 }
 const rows=records.flatMap(x=>x.runs);
 const grouped=(key,value)=>conditions.filter(x=>x[key]===value);
 const factorSummary=(key)=>Object.fromEntries(
  [...new Set(conditions.map(x=>x[key]))].map(value=>{
   const a=grouped(key,value);
   return [String(value),{cells:a.length,
    meanDeltaDiscreteCombined:mean(a.map(x=>x.meanDeltaDiscreteCombined)),
    meanDeltaRiskCombined:mean(a.map(x=>x.meanDeltaRiskCombined)),
    meanCombinedRmse:mean(a.map(x=>x.combinedRmse)),
    fractionWithoutSwitch:mean(a.map(x=>x.fractionWithoutSwitch))}];
  })
 );
 const overall=Object.fromEntries(PERIODIC_MODES.map(mode=>{
  const key=label[mode],cap=key[0].toUpperCase()+key.slice(1);
  const d=conditions.map(x=>x["meanDelta"+cap+"Combined"]);
  return [key,{meanDeltaRmse:mean(d),
   betterCells:d.filter(x=>x<0).length,
   worseCells:d.filter(x=>x>0).length,
   equalCells:d.filter(x=>x===0).length,
   materialBenefits:d.filter(x=>x<=-design.practicalTolerance).length,
   materialHarms:d.filter(x=>x>=design.practicalTolerance).length}];
 }));
 if(current==="confirmatory"){
  const p=records.map((r,i)=>pairedSignFlipP(
   r.runs.map(x=>x.deltaDiscreteCombined),
   r.cell.seed^(i*1193),4095).p);
  const adjusted=holmAdjusted(p);
  conditions.forEach((x,i)=>{x.signFlipP=p[i];x.holmP=adjusted[i];});
 }
 const result={protocol:E1A_PERIODIC_VERSION,stage:current,
  fingerprint,designSha256,sourceSha256,
  conditionsCount:conditions.length,cellRuns:rows.length,
  individualSimulations:rows.length*PERIODIC_MODES.length,
  primary:"paired whole-run delta RMSE(discrete regime - combined E1)",
  overall,byStrategy:factorSummary("strategy"),byLaw:factorSummary("law"),
  bySchedule:factorSummary("schedule"),
  byCorrelation:factorSummary("correlation"),byF:factorSummary("f"),
  byPeriod:factorSummary("period"),
  inferentialStatus:"Synthetic fixed conditions; conditional descriptive bootstrap per cell; no inference to arbitrary attack distributions.",
  conditions};
 atomic(path.join(folder,current+"-summary.json"),json(result));
 atomic(path.join(folder,current+"-conditions.csv"),csv(conditions));
 atomic(path.join(folder,current+"-per-run.csv"),csv(rows));
 return result;
}
const stages=stage==="all"?["exploratory","confirmatory"]:[stage];
for(const current of stages){
 const records=[],started=Date.now();
 for(const [i,cell] of design.stages[current].entries()){
  const {record,cached}=runCell(cell);
  records.push(record);
  console.log("M5-B "+current+" ["+(i+1)+"/"+
   design.stages[current].length+"] "+cell.id+
   " delta="+record.summary.meanDeltaDiscreteCombined.toFixed(7)+
   (cached?" (checkpoint)":""));
 }
 const result=aggregate(current,records);
 console.log("M5-B RESULT "+JSON.stringify({stage:current,
  conditions:result.conditionsCount,cellRuns:result.cellRuns,
  modelSimulations:result.individualSimulations,
  overall:result.overall,wallSeconds:Math.round((Date.now()-started)/1000),
  fingerprint,output:folder}));
}
