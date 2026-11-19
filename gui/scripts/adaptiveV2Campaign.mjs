#!/usr/bin/env node
/**
 * Frozen E1-A v2 exploratory/held-out research.
 * Node.js --stage=design|smoke|train|holdout
 * A paired sample = ONE full independent seeded simulation, not one tick.
 */
import {createHash} from "node:crypto";
import {existsSync,readFileSync,writeFileSync,renameSync,mkdirSync} from "node:fs";
import {fileURLToPath} from "node:url";
import path from "node:path";
import {runAdaptiveSingle} from "../src/adaptiveExperiment.js";
import {v2CampaignDesign,v2CampaignParameters,
 validateV2CampaignDesign,V2_CAMPAIGN_MODES}
 from "../src/adaptiveV2CampaignProtocol.js";
import {bootstrap95,pairedSignFlipP,holmAdjusted} from "../src/statistics2027.js";

const args=process.argv.slice(2);
if(args.length!==1||!/^--stage=(design|smoke|train|holdout)$/.test(args[0]))
 throw Error("Required --stage=design|smoke|train|holdout");
const stage=args[0].split("=")[1],design=validateV2CampaignDesign(v2CampaignDesign());
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const sources=[
 "src/trustEngine.js","src/trustMethods.js","src/attackProfiles.js",
 "src/adaptiveDecisionEngine.js","src/adaptiveExperiment.js",
 "src/adaptiveScenario.js","src/adaptiveRiskController.js",
 "src/adaptiveRegimeDetector.js","src/adaptiveEvidenceQuality.js",
 "src/adaptivePolicySelector.js","src/adaptivePolicySelectorV2.js",
 "src/adaptiveV2CampaignProtocol.js","src/statistics2027.js",
 "scripts/adaptiveV2Campaign.mjs"
];
const input=JSON.stringify(design,null,2)+"\n";
const sha=x=>createHash("sha256").update(x).digest("hex");
const planHash=sha(input),hash=createHash("sha256");
for(const source of sources)hash.update(source+"\0")
 .update(readFileSync(path.join(root,source))).update("\0");
const sourceHash=hash.digest("hex");
const fingerprint=sha(sourceHash+":"+planHash);
const output=path.join(root,"adaptive-results","v2",fingerprint.slice(0,20));
mkdirSync(output,{recursive:true});
const manifest={protocol:design.protocol,sourceHash,planHash,fingerprint,
 sources,design,gitCommit:process.env.GITHUB_SHA??null,
 provenance:"This is source-linked simulated data; not field evidence."};
const write=(file,obj)=>{
 const tmp=file+".tmp."+process.pid;
 writeFileSync(tmp,JSON.stringify(obj,null,2)+"\n");
 renameSync(tmp,file);
};
const manifestFile=path.join(output,"manifest.json");
if(existsSync(manifestFile)){
 const old=JSON.parse(readFileSync(manifestFile,"utf8"));
 if(old.fingerprint!==fingerprint||old.planHash!==planHash||
   old.sourceHash!==sourceHash||JSON.stringify(old.design)!==JSON.stringify(design))
  throw Error("V2: checkpoint source/version mismatch");
}else write(manifestFile,manifest);
console.log("V2 STUDY "+JSON.stringify({stage,fingerprint,planHash,sourceHash,
 cells:stage==="design"?0:design.stages[stage].length}));
if(stage==="design")process.exit(0);
const finite=Number.isFinite;
const mean=x=>x.reduce((a,b)=>a+b,0)/x.length;
const csv=(data,keys)=>[keys.join(";"),...data.map(row=>keys.map(k=>
 row[k]===null||row[k]===undefined?"":String(row[k])).join(";"))].join("\n")+"\n";
const stem={
 adaptive:"adaptive",risk_aware:"risk",
 regime_aware:"v1",
 regime_aware_v2_discrete:"v2Discrete",
 regime_aware_v2_blend:"v2Blend"
};
const metric=(run,method)=>{
 const m=run.metrics.find(x=>x.method===method);
 if(!m||![m.rmse,m.decision_coverage,m.unconditional_decision_loss].every(finite))
  throw Error("V2: invalid metric "+method);
 return m;
};
function paired(a,b,c,run){
 const x=a.trajectory,y=b.trajectory;
 if(x.length!==y.length)throw Error("V2: broken paired length");
 for(let i=0;i<x.length;i++){
  for(const field of ["step","truth","attack_intensity",
   "proposed_robust","trimmed_unweighted",
   "adaptive_unweighted","adaptive_weighted"])
   if(!Object.is(x[i][field],y[i][field]))
    throw Error("V2: baseline mismatch "+c.id+" index "+run+
     " step "+i+" key "+field);
 }
}
function calculate(c){
 const filename=path.join(output,c.stage+"__"+c.id+".json");
 if(existsSync(filename)){
  const previous=JSON.parse(readFileSync(filename,"utf8"));
  if(previous.fingerprint!==fingerprint||
    JSON.stringify(previous.cell)!==JSON.stringify(c)||
    previous.rows?.length!==c.runs)
   throw Error("V2: incompatible checkpoint "+filename);
  return previous;
 }
 const parameters=Object.fromEntries(V2_CAMPAIGN_MODES.map(mode=>[
  mode,v2CampaignParameters(c,mode)]));
 const rows=[],firstTraces={};
 for(let index=0;index<c.runs;index++){
  let original=null;
  const row={stage:c.stage,id:c.id,index,seed:c.seed,
   f:c.f,law:c.law,schedule:c.schedule,
   strategy:c.strategy,evidence:c.evidence};
  for(const mode of V2_CAMPAIGN_MODES){
   const param=parameters[mode];
   const x=runAdaptiveSingle(param.core,param.options,index);
   if(original)paired(original,x,c,index);
   else original=x;
   const ref=metric(x,"proposed_robust");
   const m=metric(x,"adaptive_robust"),prefix=stem[mode];
   row[prefix+"Rmse"]=m.rmse;
   row[prefix+"Loss"]=m.unconditional_decision_loss;
   row[prefix+"Delta"]=m.rmse-ref.rmse;
   row[prefix+"LossDelta"]=m.unconditional_decision_loss-ref.unconditional_decision_loss;
   row[prefix+"Coverage"]=m.decision_coverage;
   row[prefix+"Switches"]=x.trajectory.at(-1)?.diagnostics?.policySwitches??0;
   row.controlRmse=ref.rmse;
   row.controlLoss=ref.unconditional_decision_loss;
   if(index===0)firstTraces[mode]=x.trajectory.map(t=>({
    step:t.step,effectiveIntensity:t.attack_intensity,
    control:t.proposed_robust,decision:t.adaptive_robust,
    selected:t.diagnostics.regimeSelected,
    quality:t.diagnostics.evidenceQualityScore,
    v2RegretAdaptive:t.diagnostics.v2RegretAdaptive,
    v2RegretRisk:t.diagnostics.v2RegretRisk
   }));
  }
  row.activeTicks=original.trajectory.filter(t=>t.attack_intensity>0).length;
  if(Object.values(row).some(v=>typeof v==="number"&&!finite(v)))
   throw Error("V2: non-finite scientific row "+c.id);
  rows.push(row);
 }
 const condition={...c,
  controlRmse:mean(rows.map(r=>r.controlRmse)),
  activeTicks:mean(rows.map(r=>r.activeTicks))};
 for(const mode of V2_CAMPAIGN_MODES){
  const prefix=stem[mode],d=rows.map(r=>r[prefix+"Delta"]);
  const ci=bootstrap95(d,mean,c.seed+V2_CAMPAIGN_MODES.indexOf(mode)*101,499);
  condition[prefix+"Delta"]=mean(d);
  condition[prefix+"CiLow"]=ci.lower;
  condition[prefix+"CiHigh"]=ci.upper;
  condition[prefix+"Better"]=d.filter(v=>v<0).length;
  condition[prefix+"Worse"]=d.filter(v=>v>0).length;
  condition[prefix+"Switches"]=mean(rows.map(r=>r[prefix+"Switches"]));
  condition[prefix+"LossDelta"]=mean(rows.map(r=>r[prefix+"LossDelta"]));
 }
 const record={fingerprint,cell:c,parameters:parameters.adaptive,
  rows,firstTraces,condition};
 write(filename,record);return record;
}
const records=[];
for(const [i,c] of design.stages[stage].entries()){
 const x=calculate(c);records.push(x);
 if((i+1)%5===0||i===design.stages[stage].length-1)
  console.log("V2 "+stage+" "+(i+1)+"/"+design.stages[stage].length+
   " delta="+x.condition.v2DiscreteDelta.toFixed(6));
}
const conditions=records.map(r=>r.condition);
const perRun=records.flatMap(x=>x.rows);
if(conditions.length!==design.stageSizes[stage].cells||
  perRun.length!==design.stageSizes[stage].cells*design.stageSizes[stage].runs)
 throw Error("V2: missing/duplicate whole-run observations");
if(stage==="holdout"){
 const p=records.map((x,i)=>pairedSignFlipP(
  x.rows.map(r=>r.v2DiscreteDelta),x.cell.seed^(i*1009),4095).p);
 const adjusted=holmAdjusted(p);
 for(let i=0;i<conditions.length;i++){
  conditions[i].signFlipP=p[i];conditions[i].holmP=adjusted[i];
 }
}
const overall=Object.fromEntries(V2_CAMPAIGN_MODES.map(mode=>{
 const prefix=stem[mode],values=conditions.map(c=>c[prefix+"Delta"]);
 return [mode,{meanCellDelta:mean(values),
  betterCells:values.filter(v=>v<0).length,
  worseCells:values.filter(v=>v>0).length,
  tiedCells:values.filter(v=>v===0).length,
  materialHarms:values.filter(v=>v>=design.minimumPracticalEffectRmse).length}];
}));
const result={stage,protocol:design.protocol,fingerprint,planHash,sourceHash,
 cells:conditions.length,wholeRunPairs:perRun.length,
 modelExecutions:perRun.length*V2_CAMPAIGN_MODES.length,
 unit:"one complete independent seeded run within each fixed synthetic condition",
 inference:"Bootstrap CI per condition is exploratory; sign flip requires sign-exchangeability, Holm across predeclared 12 holdout contrasts",
 caveat:"No field attack calibration; v2 surrogate may be manipulated by collusion",
 overall,conditions};
write(path.join(output,stage+"-summary.json"),result);
writeFileSync(path.join(output,stage+"-per-run.csv"),csv(perRun,
 Object.keys(perRun[0])));
writeFileSync(path.join(output,stage+"-conditions.csv"),csv(conditions,
 Object.keys(conditions[0])));
console.log("V2 COMPLETE "+JSON.stringify({stage,cells:conditions.length,
 pairs:perRun.length,executions:result.modelExecutions,overall,sourceHash,planHash}));
