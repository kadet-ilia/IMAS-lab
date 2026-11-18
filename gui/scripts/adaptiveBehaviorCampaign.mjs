#!/usr/bin/env node
/**
 * E1-A expanded exploratory factorial: 120 distinct parameter configurations.
 * 5 attacker strategies x 3 behavioral evidence models x 4 Byzantine counts x 2 alpha modes.
 * 60 paired scenarios, 20 independent run indices per scenario.
 * All compared rules see exactly the same exogenous realization per run.
 * No tuning, no network or Sybil, synthetic estimator-only comparison.
 */
import {createHash} from "node:crypto";
import {mkdirSync,readFileSync,writeFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {runAdaptiveSingle} from "../src/adaptiveExperiment.js";
import {ADAPTIVE_DEFAULTS} from "../src/adaptiveDecisionEngine.js";
import {campaignAttackSchedule} from "../src/adaptiveCampaignProtocol.js";
import {riskCampaignAssertPair} from "../src/adaptiveRiskCampaign.js";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const strategies=["legacy","coordinated","stealth","pulsed","reputation_boost"];
const evidences=["behavior_linked","correlated_witnesses","lagged_observation"];
const fractions=[3,6,9,12];
const alphaModes=["adaptive","risk_aware"];
const R=20, N=30,T=48, k=6;
const numeric=x=>Number.isFinite(x)?x:null;
const mean=a=>a.reduce((s,x)=>s+x,0)/a.length;
const json=x=>JSON.stringify(x,null,2)+"\n";
const hash=createHash("sha256");
const files=["src/trustEngine.js","src/trustMethods.js","src/attackProfiles.js",
 "src/adaptiveDecisionEngine.js","src/adaptiveScenario.js",
 "src/adaptiveExperiment.js","src/adaptiveRiskController.js",
 "src/adaptiveRiskCampaign.js","src/adaptiveCampaignProtocol.js",
 "scripts/adaptiveBehaviorCampaign.mjs"];
for(const f of files)hash.update(f+"\0").update(readFileSync(path.join(root,f))).update("\0");
const sha=hash.digest("hex");
const output=path.join(root,"adaptive-results","behavior",sha.slice(0,16));
mkdirSync(output,{recursive:true});
const phases=campaignAttackSchedule("constant","sustained");
const cells=[],runs=[];
let ordinal=0;
for(const strategy of strategies)for(const evidence of evidences)for(const f of fractions){
 const id=strategy+"__"+evidence+"__f"+f, seed=2100000000+ordinal*256+113;
 ordinal++;
 const config={seed,n_agents:N,n_byzantine:f,n_steps:T,trim_each_side:k,
  attack_start_step:13,network_enabled:false,paired_exogenous_events:true,n_sybil_agents:0};
 const base={...ADAPTIVE_DEFAULTS,runs:R,comparisonMode:"estimator_only",
  scenario:"dynamic",phases,attackStrategy:strategy,evidenceModel:evidence,
  alphaMode:"adaptive",trimMode:"source_first",trimEachSide:k,
  coordinatedBias:2,stealthBias:0.65,attackPeriod:10,attackDuty:4,
  reputationWarmup:12,evidenceTolerance:0.45,evidenceNoiseSigma:0.025,
  witnessCorruption:0.8,evidenceCorrelation:0.45,evidenceLag:2,
  adaptiveTrim:false};
 const pairs=[];
 for(let j=0;j<R;j++){
  const o=runAdaptiveSingle(config,base,j);
  const r=runAdaptiveSingle(config,{...base,alphaMode:"risk_aware"},j);
  const pair=riskCampaignAssertPair(r,o);
  const row={id,strategy,evidence,f,seed,run:j,
   rmseTrimmed:pair.rmseTrimmed,rmseCombined:pair.rmseCombined,
   rmseAdaptive:pair.rmseLegacyAdaptive,rmseRisk:pair.rmseRisk,
   deltaRiskAdaptive:pair.dRiskLegacy,deltaAdaptiveTrimmed:pair.rmseLegacyAdaptive-pair.rmseTrimmed,
   deltaRiskTrimmed:pair.dRiskTrimmed,
   alphaAdaptive:pair.meanAlphaLegacy,alphaRisk:pair.meanAlphaRisk,
   coverageAdaptive:pair.legacyCoverage,coverageRisk:pair.riskCoverage,
   historyPairsRisk:pair.meanRiskPairs};
  if(Object.values(row).some((v)=>typeof v==="number"&&!Number.isFinite(v)))
   throw Error("Nonfinite pair metrics in "+id+" run "+j);
  pairs.push(row);runs.push(row);
 }
 const d=pairs.map(x=>x.deltaRiskAdaptive);
 cells.push({id,strategy,evidence,f,seed,R,
  alphaModes:alphaModes,meanDeltaRiskAdaptive:mean(d),
  meanDeltaAdaptiveTrimmed:mean(pairs.map(x=>x.deltaAdaptiveTrimmed)),
  meanDeltaRiskTrimmed:mean(pairs.map(x=>x.deltaRiskTrimmed)),
  meanRmseAdaptive:mean(pairs.map(x=>x.rmseAdaptive)),
  meanRmseRisk:mean(pairs.map(x=>x.rmseRisk)),
  meanRmseTrimmed:mean(pairs.map(x=>x.rmseTrimmed)),
  meanAlphaAdaptive:mean(pairs.map(x=>x.alphaAdaptive)),
  meanAlphaRisk:mean(pairs.map(x=>x.alphaRisk)),
  coverageAdaptive:mean(pairs.map(x=>x.coverageAdaptive)),
  coverageRisk:mean(pairs.map(x=>x.coverageRisk))});
 console.log("BEHAVIOR ["+cells.length+"/60] "+id+" risk-minus-adaptive="+mean(d).toFixed(6));
}
if(cells.length!==60||runs.length!==60*R||new Set(cells.map(x=>x.seed)).size!==60)
 throw Error("Experiment set not complete");
const group=key=>Object.fromEntries([...new Set(cells.map(x=>x[key]))].map(value=>{
 const c=cells.filter(x=>x[key]===value);
 return [String(value),{cells:c.length,meanDeltaRiskAdaptive:mean(c.map(x=>x.meanDeltaRiskAdaptive)),
 meanDeltaAdaptiveTrimmed:mean(c.map(x=>x.meanDeltaAdaptiveTrimmed)),
 meanDeltaRiskTrimmed:mean(c.map(x=>x.meanDeltaRiskTrimmed)),
 riskWins:c.filter(x=>x.meanDeltaRiskAdaptive<0).length,
 riskLosses:c.filter(x=>x.meanDeltaRiskAdaptive>0).length}];
}));
const summary={
 status:"COMPLETED_EXPLORATORY",model:"E1-A",sourceSha256:sha,sourceFiles:files,
 branch:"IMAS_Lab_test",runSha:process.env.GITHUB_SHA??null,
 protocol:"e1a-behavior-120-configs-1.0.1",baseFactorialCells:60,
 distinctParameterConfigurations:120,alphaModes,independentRunsPerCell:R,
 pairedRunComparisons:runs.length,individualMethodSimulations:runs.length*2,
 methodology:"Same seed/run index and identical non-alpha parameters; synthetic oracle used only to evaluate error.",
 factors:{strategies,evidences,byzantine:fractions,alphaModes,
  N,T,k,attackSchedule:"constant, sustained 13-48",networkEnabled:false},
 overall:{meanDeltaRiskAdaptive:mean(cells.map(x=>x.meanDeltaRiskAdaptive)),
  meanDeltaAdaptiveTrimmed:mean(cells.map(x=>x.meanDeltaAdaptiveTrimmed)),
  meanDeltaRiskTrimmed:mean(cells.map(x=>x.meanDeltaRiskTrimmed)),
  riskWins:cells.filter(x=>x.meanDeltaRiskAdaptive<0).length,
  riskLosses:cells.filter(x=>x.meanDeltaRiskAdaptive>0).length,
  noDifference:cells.filter(x=>x.meanDeltaRiskAdaptive===0).length},
 byStrategy:group("strategy"),byEvidence:group("evidence"),byF:group("f"),
 limitations:["Exploratory fixed synthetic scenarios; not real attacks.",
  "20 runs per cell, observations correlated over time; full run is statistical unit.",
  "Different evidence models change synthetic data-generation mechanisms; effects are conditional on default values.",
  "No valid claim of universal benefit, causal security improvement or stability of full distributed system."],
 cells
};
function csv(rows){const keys=Object.keys(rows[0]);return keys.join(";")+"\n"+
 rows.map(row=>keys.map(k=>Array.isArray(row[k])?row[k].join("|"):row[k]).join(";")).join("\n")+"\n";}
writeFileSync(path.join(output,"protocol-and-summary.json"),json(summary));
writeFileSync(path.join(output,"cells.csv"),csv(cells));
writeFileSync(path.join(output,"run-metrics.csv"),csv(runs));
console.log("BEHAVIOR RESULT "+JSON.stringify({baseCells:60,configurations:120,
 independentRunPairs:runs.length,methodRuns:runs.length*2,
 overall:summary.overall,byStrategy:summary.byStrategy,byEvidence:summary.byEvidence,byF:summary.byF}));
