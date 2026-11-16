#!/usr/bin/env node
/**
 * E1-A protocol-locked scientific campaign.
 *
 * Examples:
 *   node scripts/adaptiveCampaign.mjs --stage=design
 *   node scripts/adaptiveCampaign.mjs --stage=smoke
 *   node scripts/adaptiveCampaign.mjs --stage=exploratory
 *   node scripts/adaptiveCampaign.mjs --stage=confirmatory
 *   node scripts/adaptiveCampaign.mjs --stage=all
 *
 * Per-cell atomic checkpoints permit restart without silently accepting
 * earlier results from changed code, scenarios, configurations or protocols.
 * Confirmatory cells have preselected IDs and wholly disjoint random seeds.
 */
import {createHash} from "node:crypto";
import {existsSync,mkdirSync,readFileSync,writeFileSync,renameSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {runAdaptiveStudy} from "../src/adaptiveExperiment.js";
import {campaignDesign,campaignConfiguration,validateCampaignDesign} from "../src/adaptiveCampaignProtocol.js";
import {analyzeCampaignCell,summarizeCampaignStage,E1A_CAMPAIGN_ANALYSIS_VERSION} from "../src/adaptiveCampaignAnalysis.js";

const args=process.argv.slice(2);
function argument(key,fallback=null){
 const matches=args.filter(x=>x.startsWith("--"+key+"="));
 if(matches.length>1)throw Error("Repeated campaign option --"+key);
 return matches.length?matches[0].slice(key.length+3):fallback;
}
const stage=argument("stage","smoke");
if(!["design","smoke","exploratory","confirmatory","all"].includes(stage))
 throw Error("Unknown stage "+stage+"; use design/smoke/exploratory/confirmatory/all");
if(args.some(x=>!/^--(stage|output)=/.test(x)))
 throw Error("Only --stage and --output are supported. R and cell selection are frozen.");
const design=validateCampaignDesign(campaignDesign());
const json=x=>JSON.stringify(x,null,2)+"\n";
const sha=x=>createHash("sha256").update(x).digest("hex");
const guiRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
// Freeze the actual E1-A computation sources, not only declarative model
// version strings. Any numerical algorithm change creates a different archive.
const sourceFiles=[
 "src/trustEngine.js","src/trustMethods.js","src/attackProfiles.js",
 "src/adaptiveDecisionEngine.js","src/adaptiveScenario.js",
 "src/adaptiveExperiment.js","src/adaptiveCampaignProtocol.js",
 "src/adaptiveCampaignAnalysis.js","src/statistics2027.js",
 "scripts/adaptiveCampaign.mjs"
];
const sourceHash=createHash("sha256");
for(const name of sourceFiles){
 sourceHash.update(name+"\\0");
 sourceHash.update(readFileSync(path.join(guiRoot,name)));
 sourceHash.update("\\0");
}
const sourceSha256=sourceHash.digest("hex"),designSha256=sha(json(design));
const digest=sha(designSha256+":"+sourceSha256);
const defaultOutput=path.join(guiRoot,"adaptive-results","campaign",digest.slice(0,16));
const output=path.resolve(argument("output",defaultOutput));
function atomicWrite(target,value){
 mkdirSync(path.dirname(target),{recursive:true});
 const tmp=target+".tmp."+process.pid;
 writeFileSync(tmp,value,"utf8");
 renameSync(tmp,target);
}
function toCsv(rows,keys){
 const escaped=value=>{
  if(value===null||value===undefined)return "";
  const s=String(value);
  return /[";\n]/.test(s)?'"'+s.replaceAll('"','""')+'"':s;
 };
 return [keys.join(";"),...rows.map(row=>keys.map(key=>escaped(row[key])).join(";"))].join("\n")+"\n";
}
mkdirSync(output,{recursive:true});
const manifestPath=path.join(output,"campaign-design.json");
const manifest={design,campaignFingerprint:digest,designSha256,sourceSha256,sourceFiles,
 sourceRevision:process.env.GITHUB_SHA||null,
 notice:"Protocol and code dependency fingerprint. A changed model source creates a new checkpoint namespace."
};
if(existsSync(manifestPath)){
 const previous=JSON.parse(readFileSync(manifestPath,"utf8"));
 if(previous.campaignFingerprint!==digest||previous.designSha256!==designSha256||
   previous.sourceSha256!==sourceSha256||sha(json(previous.design))!==designSha256)
  throw Error("Stored campaign design differs from this source. Stop rather than overwrite.");
}else atomicWrite(manifestPath,json(manifest));
console.log("E1-A CAMPAIGN fingerprint="+digest+" designSHA256="+designSha256+
 " sourceSHA256="+sourceSha256+" stage="+stage+" path="+output);
if(stage==="design")process.exit(0);

function verifyCheckpoint(saved,cell){
 if(saved.designSha256!==digest||saved.cell?.id!==cell.id||
  saved.cell?.seed!==cell.seed||saved.cell?.runs!==cell.runs||
  saved.result?.campaignCellId!==cell.id||
  saved.result?.differences?.runs?.length!==cell.runs||
  saved.analysis!==E1A_CAMPAIGN_ANALYSIS_VERSION)
  throw Error("Incompatible or incomplete persisted cell "+cell.id);
 const mean=saved.result.differences.runs.reduce((s,x)=>s+x.difference,0)/cell.runs;
 if(Math.abs(mean-saved.result.meanDeltaRmse)>1e-11)
  throw Error("Stored campaign cell has inconsistent paired differences");
 return saved.result;
}
function executeCell(cell){
 const target=path.join(output,cell.stage,cell.id+".json");
 if(existsSync(target)){
  const saved=JSON.parse(readFileSync(target,"utf8"));
  return {value:verifyCheckpoint(saved,cell),cached:true};
 }
 const {config,options}=campaignConfiguration(cell);
 const result=runAdaptiveStudy(config,options);
 if(result.completedRuns!==cell.runs||result.partial||result.models?.base!==design.algorithms.base||
  result.models?.adaptive!==design.algorithms.adaptive||
  result.models?.study!==design.algorithms.study||
  result.models?.scenario!==design.algorithms.scenario)
  throw Error("Incomplete or version-incompatible scientific cell "+cell.id);
 const analyzed=analyzeCampaignCell(result,cell);
 const saved={designSha256:digest,analysis:E1A_CAMPAIGN_ANALYSIS_VERSION,
  cell,config,options,
  versions:result.models,methodology:result.methodology,
  result:analyzed,secondaryMetrics:result.summary,
  perRunMetrics:result.runs.map(run=>({run:run.run,metrics:run.metrics,
   generator:run.scenarioDiagnostics})),
  firstRunTrajectory:result.trace};
 atomicWrite(target,json(saved));
 return {value:analyzed,cached:false};
}
const stages=stage==="all"?["exploratory","confirmatory"]:[stage];
for(const currentStage of stages){
 const cells=design.cells[currentStage],results=[],started=Date.now();
 for(const [index,cell] of cells.entries()){
  const outputCell=executeCell(cell);
  results.push(outputCell.value);
  const delta=outputCell.value.meanDeltaRmse;
  console.log("E1-A "+currentStage+" ["+(index+1)+"/"+cells.length+"] "+
   cell.id+" ΔRMSE="+delta.toFixed(6)+(outputCell.cached?" (validated checkpoint)":""));
 }
 const summary=summarizeCampaignStage(currentStage,results);
 const summaryPath=path.join(output,currentStage+"-summary.json");
 atomicWrite(summaryPath,json({designSha256:digest,analysis:E1A_CAMPAIGN_ANALYSIS_VERSION,
  summary}));
 const keys=["id","law","schedule","f","runs","seed",
  "adaptiveMeanRmse","trimmedMeanRmse","meanDeltaRmse","practicalDirection",
  "bootstrapLower95","bootstrapUpper95","signFlipP","holmAcrossCellsP","wins","losses"];
 atomicWrite(path.join(output,currentStage+"-summary.csv"),
  toCsv(summary.conditions,keys));
 console.log("E1-A CAMPAIGN "+JSON.stringify({
  stage:currentStage,designSha256:digest,cells:summary.cells,
  pairedRuns:summary.pairedRuns,better:summary.benefits,worse:summary.harms,
  benefitAtLeast001:summary.benefitAtLeast001,
  meanDelta:+summary.equalCellWeightedMeanDeltaRmse.toFixed(7),
  interval:summary.stratifiedBootstrapCi95.map(x=>+x.toFixed(7)),
  holmPossibleDiscoveries:summary.possibleHolmDiscoveries,
  elapsedWallSeconds:Math.round((Date.now()-started)/1000)
 }));
}
