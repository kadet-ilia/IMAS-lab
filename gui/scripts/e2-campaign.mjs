// Preregistered exploratory synthetic campaign; actual production kernels.
import fs from "node:fs";
import path from "node:path";
import {DEFAULTS,compute,random} from "../src/automaticDecisions/kernel.js";
import {EXTRA_DEFAULTS} from "../src/automaticDecisions/extendedStudies.js";
import {seedFor,exactExt,lawsExt,calibration,sampler} from "../src/automaticDecisions/extendedModel.js";
import {advancedMC} from "../src/automaticDecisions/advancedMC.js";
import {alternatives} from "../src/automaticDecisions/alternativeRisk.js";
import {evaluateDesign} from "../src/automaticDecisions/designOptimization.js";
import {adaptiveNext} from "../src/automaticDecisions/adaptiveNext.js";
import {optimalStopping} from "../src/automaticDecisions/optimalStopping.js";
import {closedQueue} from "../src/automaticDecisions/closedLoopQueue.js";
import {validateObservations} from "../src/automaticDecisions/dataValidation.js";
const N=128,ROOT=20261126,MODES=["general","mc","sensitivity","robustness","optimization","dynamics","queue","data"];
const sum=a=>a.reduce((s,v)=>s+v,0),mean=a=>a.length?sum(a)/a.length:null,round=v=>Math.round(v*1e6)/1e6;
const arr=(n,f)=>Array.from({length:n},(_,i)=>f(i));
function makeBase(i,mode,B=3){
 const seed=seedFor(ROOT,10000*(MODES.indexOf(mode)+1)+i),r=random(seedFor(seed,11)),uniform=(a,b)=>a+(b-a)*r(),integer=(a,b)=>Math.floor(uniform(a,b+1));
 const groups=arr(B,()=>integer(2,5)),u=[arr(B,()=>uniform(.08,.30)),arr(B,()=>uniform(.70,.92))],rho=arr(B,()=>uniform(.05,.85));
 return {...EXTRA_DEFAULTS,seed,groups,u,rho,prior:uniform(.12,.55),m:integer(600,8000),drop:uniform(.08,.65),c:uniform(.7,1.55),reps:1,stress:"none",eta:0,family:"l1"};
}
const compact=r=>Object.fromEntries(["coverage","loss","miss","false","lower","tight","upperRisk","nomCoverage","nomLoss","posteriorMass","width","violation","assumptionsValid","status","cost","size"].filter(k=>r[k]!==undefined).map(k=>[k,r[k]]));
const check=(condition,msg)=>{if(!condition)throw Error(msg);};
const cfg=c=>Object.fromEntries(["seed","groups","u","rho","prior","m","drop","c","b","f","d","alpha","family"].map(k=>[k,c[k]]));
function general(i){
 const c=makeBase(i,"general"),scenario=i%8+1,critical=c.b*c.f/(c.b+c.f-c.d),config={...c,mode:"custom",series:"fixed",scenario};
 const calc=price=>{const r=compute({...config,c:price},{s:scenario,rep:0,m:c.m,series:"fixed"}),a=r.rows.fixed.find(v=>v.method===6),b=r.rows.fixed.find(v=>v.method===7),cert=r.rows.validity[0];return {M6:a,M7:b,cert,counts:r.counts};};
 const low=calc(.65*critical),high=calc(1.35*critical);
 check(JSON.stringify(low.counts)===JSON.stringify(high.counts),"general paired calibration");
 check(Math.abs(low.M6.coverage-low.M7.coverage)<1e-10&&Math.abs(low.M6.loss-low.M7.loss)<1e-10,"M6/M7 under threshold");
 return {input:{...cfg(c),scenario,prices:[.65*critical,1.35*critical]},output:{low,high},metrics:{coverage:high.M6.coverage,loss:high.M6.loss,extraCoverage:high.M7.coverage-high.M6.coverage,lossGain:high.M6.loss-high.M7.loss,certificateGain:high.cert.lower_tight-high.cert.lower,violation:high.cert.risk_violation_mass,valid:high.cert.assumptionsValid?1:0}};
}
function mc(i){
 const b=makeBase(i,"mc"),r=random(seedFor(b.seed,30)),c={...b,prior:.005+.145*r(),mcN:5000,mcBatch:5000,mcTolerance:0,mcExact:true,mcProposal:.5,mcAlpha:.05};
 const plain=advancedMC({...c,mcImportance:false},0),imp=advancedMC({...c,mcImportance:true},0),p=plain.summary[0],q=imp.summary[0],truth=exactExt(c,plain.counts);
 check(JSON.stringify(plain.counts)===JSON.stringify(imp.counts),"MC paired calibration");
 return {input:{...cfg(c),N:c.mcN,proposal:c.mcProposal},output:{truth:compact(truth),plain:p,importance:q,counts:plain.counts,seeds:[plain.calSeed,plain.testSeed]},metrics:{coverage:truth.coverage,loss:truth.loss,trueMiss:truth.miss,plainMissSquared:(p.miss-truth.miss)**2,importanceMissSquared:(q.miss-truth.miss)**2,plainFalseSquared:(p.false-truth.false)**2,importanceFalseSquared:(q.false-truth.false)**2,plainLossSquared:(p.loss-truth.loss)**2,importanceLossSquared:(q.loss-truth.loss)**2,plainMissInterval:+(p.missLow<=truth.miss+1e-12&&truth.miss<=p.missHigh+1e-12),importanceMissInterval:+(q.missLow<=truth.miss+1e-12&&truth.miss<=q.missHigh+1e-12),plainMissWidth:p.missHigh-p.missLow,importanceMissWidth:q.missHigh-q.missLow}};
}
function sensitivity(i){
 const c=makeBase(i,"sensitivity"),r=random(seedFor(c.seed,31)),dl=.05+.2*r(),dh=.55+.3*r(),rl=.05+.2*r(),rh=.60+.3*r(),v=[];
 for(const rho of [rl,rh]){
  const base={...c,rho:c.rho.map(()=>rho)},counts=calibration(base,lawsExt(base).cal);
  for(const drop of [dl,dh]){const a=exactExt({...base,drop},counts);v.push({rho,drop,...compact(a),counts});}
 }
 const [a,b,d,e]=v,alt=alternatives({...c,mcN:2000,riskCalN:1000,riskLevels:21,autoRiskTarget:.1},0);
 const lossInteraction=(e.loss-d.loss)-(b.loss-a.loss),coverageInteraction=(e.coverage-d.coverage)-(b.coverage-a.coverage);
 return {input:{...cfg(c),dropLevels:[dl,dh],rhoLevels:[rl,rh],riskCalN:1000,testN:2000,target:.1},output:{factorial:v,alternative:alt.summary,alternativeControl:alt.control,alternativeCounts:alt.counts,alternativeSeeds:[alt.calSeed,alt.riskSeed,alt.testSeed]},metrics:{coverage:a.coverage,loss:a.loss,lossInteraction,coverageInteraction,dropPenaltyLowRho:a.coverage-b.coverage,dropPenaltyHighRho:d.coverage-e.coverage,correlationPenaltyLowDrop:a.coverage-d.coverage,correlationPenaltyHighDrop:b.coverage-e.coverage,crcRisk:alt.summary[3].autoRisk,pacRisk:alt.summary[4].autoRisk,crcCoverage:alt.summary[3].coverage,pacCoverage:alt.summary[4].coverage,bayesLoss:alt.summary[1].loss,m6Loss:alt.summary[0].loss}};
}
function robustness(i){
 const c=makeBase(i,"robustness"),stress=["drift","cross","mnar","nonexchangeable","biasedMask","contamination","drift","mnar"][i%8],r=random(seedFor(c.seed,32)),eta=.25+.7*r(),a=exactExt(c),b=exactExt({...c,stress,eta});
 if(stress==="nonexchangeable")check(Math.abs(a.loss-b.loss)<1e-10&&Math.abs(a.coverage-b.coverage)<1e-10,"negative control");
 return {input:{...cfg(c),stress,eta},output:{baseline:compact(a),stress:compact(b),counts0:a.counts,counts1:b.counts},metrics:{coverage:b.coverage,loss:b.loss,coverageChange:b.coverage-a.coverage,lossIncrease:b.loss-a.loss,posteriorMassChange:b.posteriorMass-a.posteriorMass,violation:b.violation,nominalTight:b.tight,certificateShortfall:Math.max(0,b.tight-b.coverage)}};
}
function optimization(i){
 const c=makeBase(i,"optimization"),n=2+i%4,r=random(seedFor(c.seed,33)),u0=.08+.2*r(),u1=.72+.2*r(),rho=.08+.77*r(),B=3;
 const conf={...c,u:[arr(B,()=>u0),arr(B,()=>u1)],rho:arr(B,()=>rho),requiredCoverage:.55,riskLimit:1.1,approxLarge:true,mcN:5000};
 const shapes=[[n,n,n],[n-1,n,n+1],[3*n]],results=shapes.map((groups,j)=>evaluateDesign(conf,{kind:"heterogeneous",spec:{id:j+1,name:["balanced","skewed","single"][j],groups,u:[groups.map(()=>u0),groups.map(()=>u1)],rho:groups.map(()=>rho),costs:groups.map(v=>2+v)}},shapes.length));
 check(results.every(r=>r.algorithm==="exact"),"optimization expected exact");
 const [a,b,d]=results,cert=results.filter(v=>v.status==="feasible");
 return {input:{...cfg(conf),n,rho,u0,u1,shapes,requiredCoverage:conf.requiredCoverage,riskLimit:conf.riskLimit},output:results.map(r=>({...compact(r),agents:r.agents,algorithm:r.algorithm,counts:r.counts})),metrics:{coverage:a.coverage,loss:a.loss,skewCoverageGain:b.coverage-a.coverage,skewLossGain:a.loss-b.loss,multiCoverageGain:a.coverage-d.coverage,multiLossGain:d.loss-a.loss,certified:cert.length,balancedFeasible:+(a.status==="feasible"),skewedFeasible:+(b.status==="feasible"),singleFeasible:+(d.status==="feasible")}};
}
function dynamics(i){
 const b=makeBase(i,"dynamics",2),r=random(seedFor(b.seed,34)),shift=i%2===0?0:.35+.6*r(),window=120+Math.floor(160*r()),delay=5+Math.floor(55*r()),c={...b,window,shortWindow:Math.floor(window*.4),steps:1000,updateEvery:50,forgetting:.96+.035*r(),shift,delay,queryBudget:2+i%4,queryCost:.01+.13*r(),safetyRisk:1.5};
 const a=adaptiveNext(c,{kind:"weighted",rep:0,shift}),d=optimalStopping(c),[fixed,long,ew,adapt]=a.summary,[immediate,cyclic,active]=d.summary;
 check(active.nominalValue<=cyclic.nominalValue+1e-10&&cyclic.nominalValue<=immediate.nominalValue+1e-10,"DP nominal order");
 return {input:{...cfg(c),shift,window,shortWindow:c.shortWindow,delay,forgetting:c.forgetting,steps:c.steps,queryBudget:c.queryBudget,queryCost:c.queryCost,safetyRisk:c.safetyRisk},output:{weighted:a.summary,optimal:d.summary,trace:a.trace,stoppingStates:d.states,initial:a.initial,counts:d.counts,seeds:[a.seed,a.testSeed,d.seed,d.querySeed]},metrics:{coverage:active.coverage,loss:active.loss,forgettingGain:fixed.loss-ew.loss,windowGain:fixed.loss-adapt.loss,longGain:fixed.loss-long.loss,nominalActiveGain:cyclic.nominalValue-active.nominalValue,testActiveGain:cyclic.loss-active.loss,queryGain:cyclic.delay-active.delay,alarm:+(a.firstAlarm!==null),unsafe:sum(d.summary.map(v=>v.unsafe))}};
}
function queue(i){
 const b=makeBase(i,"queue"),r=random(seedFor(b.seed,35)),operators=2+i%4,service=6+6*r(),offered=.5+2*r(),arrival=operators*service*offered,c={...b,operators,service,arrival,queueHorizon:5,queueWarmup:.5,peakMultiplier:1.5+2.5*r(),peakStart:.3,peakEnd:.65,queueCapacity:3+Math.floor(15*r()),deadline:.06+.35*r(),queuePriority:i%2===0,feedbackGain:1+9*r(),safetyRisk:1.2+.65*r(),queueOperatorLoss:1.25,queueWaitCost:1,failureCost:2};
 const a=closedQueue(c,{kind:"closedQueue",rep:0}),[p,q]=a.summary;
 check(p.N>0&&p.N===q.N&&p.unsafe===0&&q.unsafe===0,"queue common measured stream and admission");
 return {input:{...cfg(c),operators,service,arrival,offered,peakMultiplier:c.peakMultiplier,queueCapacity:c.queueCapacity,deadline:c.deadline,queuePriority:c.queuePriority,feedbackGain:c.feedbackGain,safetyRisk:c.safetyRisk,horizon:c.queueHorizon,warmup:c.queueWarmup},output:{summary:a.summary,counts:a.outcomes.map(v=>v.counts),calibrationCounts:a.calibrationCounts,seeds:[a.calSeed,a.arrivalSeed,a.observationSeed,a.serviceSeed]},metrics:{coverage:q.coverage,loss:q.loss,coverageGain:q.coverage-p.coverage,lossGain:p.loss-q.loss,failureGain:p.failed-q.failed,queueGain:p.Lq-q.Lq,unsafe:p.unsafe+q.unsafe,baseFailure:p.failed}};
}
function data(i){
 const c=makeBase(i,"data",2),r=random(seedFor(c.seed,36)),n=3+i%3,N=800+Math.floor(500*r()),grouping=i%2===0,rho=.35+.6*r(),mask=.15+.5*r(),mnar=i%4===3,base={...c,groups:[n,n],rho:[rho,rho],drop:0},q=lawsExt(base).nominal,next=sampler(base,q,random(seedFor(c.seed,37))),rng=random(seedFor(c.seed,38));
 const cut=Math.floor(.6*N),full=arr(N,time=>{const {x,full}=next(),agents=full.map(j=>{const a=arr(n,k=>+(k<j));for(let k=n-1;k>0;k--){const l=Math.floor(rng()*(k+1));[a[k],a[l]]=[a[l],a[k]];}return a;});return {time,x,agents};});
 const maskRng=random(seedFor(c.seed,39)),masked=(rows,trainMask)=>rows.map((row,k)=>({...row,agents:row.agents.map(a=>a.map(v=>((k>=cut||trainMask)&&maskRng()<(trainMask&&k<cut&&mnar?(v?Math.min(.95,mask+.2):Math.max(0,mask-.2)):mask))?null:v))}));
 const spec=rows=>({schema:"imas-e2-observations-v1",groups:[n,n],source:"Synthetic campaign",synthetic:true,rows}),config={...EXTRA_DEFAULTS,...base,trainFraction:.6,iidTest:false};
 if(grouping){
  const interleaved=full.map(row=>{const a=arr(n,j=>[row.agents[0][j],row.agents[1][j]]).flat();return {...row,agents:[a.slice(0,n),a.slice(n)]};});
  const dataset=spec(masked(interleaved,false)),threshold=.01+.09*r(),method=i%4===0?"complete":"components",res=validateObservations(dataset,{...config,discoverGroups:true,discoveryFraction:.5,groupThreshold:threshold,groupMethod:method,groupMaxSize:2*n});
  check(res.grouping.valid&&res.summary.length===2&&!res.certified,"group discovery output");
  const [a,b]=res.summary,[before,after]=res.grouping.diagnostics;
  return {input:{...cfg(base),N,mask,kind:"grouping",threshold,method},output:{summary:res.summary,groups:res.grouping.groups,diagnostics:res.grouping.diagnostics,split:res.split,counts:res.counts,groupedCounts:res.grouped.counts},metrics:{coverage:b.coverage,loss:b.loss,groupLossGain:a.loss-b.loss,groupCoverageGain:b.coverage-a.coverage,meanBetweenGain:before.meanBetween!==null&&after.meanBetween!==null?before.meanBetween-after.meanBetween:null,maxBetweenGain:before.maxBetween!==null&&after.maxBetween!==null?before.maxBetween-after.maxBetween:null}};
 }
 const partial=masked(full,true),complete=partial.map((row,k)=>k<cut?full[k]:row),ref=validateObservations(spec(complete),config),res=validateObservations(spec(partial),{...config,calibrationMode:"partial",emIterations:300,emTolerance:1e-8});
 check(res.summary.length===2&&!res.certified,"partial data output");
 const [a,b]=res.summary,[v]=ref.summary;
 return {input:{...cfg(base),N,mask,kind:"partial",mnar},output:{complete:v,partial:res.summary,fit:res.partial.fit,split:res.split,countsComplete:ref.counts},metrics:{coverage:b.coverage,loss:b.loss,emLossGain:v.loss-a.loss,completionLossGain:v.loss-b.loss,completionCoverageGap:v.coverage-b.coverage,emCoverageGap:v.coverage-a.coverage,emConvergence:mean(res.diagnostics.map(v=>+v.converged))}};
}
const run={general,mc,sensitivity,robustness,optimization,dynamics,queue,data};
const stats=a=>{const b=a.filter(Number.isFinite),n=b.length;if(!n)return null;const z=b.slice().sort((x,y)=>x-y);return {n,mean:round(mean(b)),median:round((z[(n-1)>>1]+z[n>>1])/2),min:round(z[0]),max:round(z.at(-1)),positive:b.filter(v=>v>1e-9).length,negative:b.filter(v=>v< -1e-9).length};};
function summarize(rows,keys){return Object.fromEntries(keys.map(k=>[k,stats(rows.map(v=>v.metrics[k]))]));}
function selected(rows){
 const mode=rows[0].mode,keys=[...new Set(rows.flatMap(r=>Object.keys(r.metrics)))],all=summarize(rows,keys),discovery=summarize(rows.filter(r=>r.fold==="discovery"),keys),confirmation=summarize(rows.filter(r=>r.fold==="confirmation"),keys);
 const strata={};
 if(mode==="general")for(const valid of [0,1])strata["valid="+valid]=summarize(rows.filter(r=>r.metrics.valid===valid),["violation","certificateGain","extraCoverage","lossGain"]);
 if(mode==="robustness")for(const stress of [...new Set(rows.map(r=>r.input.stress))])strata[stress]=summarize(rows.filter(r=>r.input.stress===stress),["lossIncrease","coverageChange","posteriorMassChange","violation","certificateShortfall"]);
 if(mode==="dynamics")for(const shift of [false,true])strata["shift="+shift]=summarize(rows.filter(r=>(r.input.shift>0)===shift),["forgettingGain","windowGain","longGain","nominalActiveGain","testActiveGain","alarm"]);
 if(mode==="queue")for(const high of [false,true])strata["offered>=1.5="+high]=summarize(rows.filter(r=>(r.input.offered>=1.5)===high),["coverageGain","lossGain","failureGain","queueGain"]);
 if(mode==="data")for(const kind of ["grouping","partial"])for(const mn of kind==="partial"?[false,true]:[null])strata[kind+(mn===null?"":"/mnar="+mn)]=summarize(rows.filter(r=>r.input.kind===kind&&(mn===null||r.input.mnar===mn)),kind==="grouping"?["groupLossGain","groupCoverageGain","meanBetweenGain","maxBetweenGain"]:["emLossGain","completionLossGain","completionCoverageGap","emConvergence"]);
 return {mode,cases:rows.length,distinctInputs:new Set(rows.map(r=>JSON.stringify(r.input))).size,all,discovery,confirmation,strata};
}
const outDir=process.argv[2]||"campaign-results";fs.mkdirSync(outDir,{recursive:true});
const all=[];
for(const mode of MODES){
 const rows=[],start=performance.now();
 for(let i=0;i<N;i++){const value=run[mode](i);rows.push({mode,case:i+1,fold:i<64?"discovery":"confirmation",...value});}
 const result=selected(rows);
 check(result.cases===N&&result.distinctInputs===N,"incomplete campaign "+mode);
 fs.writeFileSync(path.join(outDir,mode+".json"),JSON.stringify(rows,null,2));
 all.push({...result,ms:Math.round(performance.now()-start)});
 console.log("CAMPAIGN "+JSON.stringify(all.at(-1)));
}
const manifest={schema:"imas-e2-campaign-v1",rootSeed:ROOT,source:"synthetic",casesPerMode:N,totalCases:N*MODES.length,folds:{discovery:64,confirmation:64},scope:"128 distinct configurations per mode; paired policies or factor levels do not inflate case count. Descriptive summaries on fixed designed configurations, not sampling inference or external validation.",results:all};
fs.writeFileSync(path.join(outDir,"summary.json"),JSON.stringify(manifest,null,2));
console.log("CAMPAIGN COMPLETE "+JSON.stringify({totalCases:manifest.totalCases,modes:all.map(r=>({mode:r.mode,cases:r.cases,distinctInputs:r.distinctInputs,ms:r.ms}))}));
