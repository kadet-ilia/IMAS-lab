// E2.17: distinguish posterior credibility, frequentist calibration and marginal CRC.
import {validateExt,lawsExt,calibration,tables,point,select,loss,sampler,seedFor,groupGeometry} from "./extendedModel.js";
import {random} from "./kernel.js";
import {betaQuantileBracket} from "./statistics.js";
import {boundedTables,predictiveTables} from "./probabilityBounds.js";
const sum=a=>a.reduce((s,v)=>s+v,0),int=(v,a,b)=>Number.isInteger(v)&&v>=a&&v<=b,real=(v,a,b)=>Number.isFinite(v)&&v>=a&&v<=b;
export function validateAlternatives(c){
 const L=Math.max(c.b,c.f,c.d);
 if(!real(c.dirichletMass,.1,100)||!int(c.riskCalN,100,50000)||!int(c.mcN,1000,50000)||!real(c.autoRiskTarget,0,L)||!int(c.riskLevels,2,101)||!real(c.riskAlpha,1e-6,.5))throw Error("Некорректные параметры альтернативных методов");
 if(c.groups.reduce((a,n)=>a+(n+1)*(n+2)/2,0)>10000)throw Error("Слишком большие групповые таблицы для сравнения");
 return c;
}
export function dirichletTables(c,counts){
 const G=c.groups.map(groupGeometry),K=2*sum(c.groups.map(n=>n+1)),tail=c.alpha/(2*K);
 const parameters=counts.map(row=>row.map((a,g)=>a.map(v=>v+c.dirichletMass/(c.groups[g]+1))));
 const hat=parameters.map(row=>row.map(a=>a.map(v=>v/sum(a)))),lower=[],upper=[];
 for(let x=0;x<2;x++){lower[x]=[];upper[x]=[];for(let g=0;g<G.length;g++){
  const a=parameters[x][g],z=sum(a);
  lower[x][g]=a.map(v=>Math.max(0,betaQuantileBracket(v,z-v,tail)[0]-1e-10));
  upper[x][g]=a.map(v=>Math.min(1,betaQuantileBracket(v,z-v,1-tail)[1]+1e-10));
 }}
 return {...boundedTables(G,hat,lower,upper),parameters,tail,posteriorMassAtLeast:1-c.alpha};
}
export function nominalAction(c,p){
 const r=[c.b*p,c.f+(c.d-c.f)*p];return {action:r[1]<r[0]?1:0,score:Math.min(...r)};
}
// A finite nested family. Escalation has zero loss for this particular risk target.
// The operator cost is included in total loss reported separately.
export function chooseRiskThreshold(rows,thresholds,target,Lmax,alpha){
 if(!rows.length||!thresholds.length||thresholds.some((t,i)=>!Number.isFinite(t)||t<0||(i&&t<=thresholds[i-1]))||!real(target,0,Lmax)||!(Lmax>0)||!real(alpha,1e-8,1-1e-8)||rows.some(r=>!Number.isFinite(r.score)||r.score<0||!real(r.autoLoss,0,Lmax)))throw Error("Некорректная калибровка риска");
 const n=rows.length,h=Lmax*Math.sqrt(Math.log(thresholds.length/alpha)/(2*n));
 let crc=null,pac=null;
 const curve=thresholds.map(t=>{
  const selected=rows.filter(r=>r.score<=t),s=sum(selected.map(r=>r.autoLoss)),crcBound=(s+Lmax)/(n+1),pacBound=Math.min(Lmax,s/n+h);
  if(crcBound<=target)crc=t;if(pacBound<=target)pac=t;
  return {threshold:t,coverage:selected.length/n,autoRisk:s/n,crcBound,pacBound};
 });
 return {crc,pac,curve,crcType:"marginal_expected_risk",pacType:"simultaneous_upper_mean_risk",h,N:n,target,Lmax,alpha};
}
// Empirical Bernstein (sample variance, bounded observations) with
// a union bound over the fixed threshold grid. Separate method-wise guarantee.
export function varianceRiskThreshold(rows,thresholds,target,Lmax,alpha){
 const old=chooseRiskThreshold(rows,thresholds,target,Lmax,alpha),N=rows.length;if(N<2)throw Error("Нужно минимум два наблюдения");
 let bernstein=null,combined=null;const t=Math.log(2*thresholds.length/alpha),tc=Math.log(4*thresholds.length/alpha),hc=Lmax*Math.sqrt(Math.log(2*thresholds.length/alpha)/(2*N));
 const curve=old.curve.map(v=>{
  const z=rows.filter(r=>r.score<=v.threshold).map(r=>r.autoLoss),s=sum(z),ss=sum(z.map(a=>a*a)),variance=Math.max(0,(ss-s*s/N)/(N-1)),upper=t=>Math.min(Lmax,v.autoRisk+Math.sqrt(2*variance*t/N)+7*Lmax*t/(3*(N-1)));
  const bernsteinBound=upper(t),combinedBound=Math.min(upper(tc),Lmax,v.autoRisk+hc);
  if(bernsteinBound<=target)bernstein=v.threshold;if(combinedBound<=target)combined=v.threshold;
  return {...v,variance,bernsteinBound,combinedBound};
 });
 return {...old,curve,bernstein,combined,varianceAlpha:alpha};
}
export function alternatives(raw,rep){
 const c=validateAlternatives(validateExt({...raw,stress:"none",eta:0})),q=lawsExt(c),calSeed=seedFor(c.seed,110000+3*rep),riskSeed=seedFor(c.seed,110001+3*rep),testSeed=seedFor(c.seed,110002+3*rep),counts=calibration(c,q.cal,calSeed),B=dirichletTables(c,counts),P=predictiveTables(B.G,B.hat),M=tables({...c,family:"l1"},counts),Lmax=Math.max(c.b,c.f,c.d);
 const score=ix=>nominalAction(c,point(c,P,ix)[0]);
 const gen=sampler(c,q.test,random(riskSeed)),riskRows=[];
 for(let i=0;i<c.riskCalN;i++){const {x,ix}=gen(),a=score(ix);riskRows.push({...a,autoLoss:loss(c,a.action,x)});}
 const thresholds=Array.from({length:c.riskLevels},(_,i)=>Lmax*i/(c.riskLevels-1)),control=(c.experiment==="riskBounds"?varianceRiskThreshold:chooseRiskThreshold)(riskRows,thresholds,c.autoRiskTarget,Lmax,c.riskAlpha);
 const names=["M6 — L1","Байес — прогноз","Байес — credible box","CRC — средний риск","PAC — средний риск",...(c.experiment==="riskBounds"?["PAC — Бернштейн","PAC — комбинированная"]:[])],hist=names.map(()=>[[0,0,0],[0,0,0]]),test=sampler(c,q.test,random(testSeed));
 for(let i=0;i<c.mcN;i++){
  const {x,ix}=test(),{action,score:r}=score(ix),actions=[select(c,...point(c,M,ix)),r<=c.c?action:2,select(c,...point(c,B,ix)),control.crc!==null&&r<=control.crc?action:2,control.pac!==null&&r<=control.pac?action:2,...(c.experiment==="riskBounds"?[control.bernstein!==null&&r<=control.bernstein?action:2,control.combined!==null&&r<=control.combined?action:2]:[])];
  actions.forEach((a,k)=>hist[k][x][a]++);
 }
 const summary=hist.map((H,i)=>{const N=c.mcN,autoRisk=(c.b*H[1][0]+c.f*H[0][1]+c.d*H[1][1])/N,coverage=1-(H[0][2]+H[1][2])/N;return {policy:names[i],rep,N,coverage,autoRisk,conditionalAutoRisk:coverage>0?autoRisk/coverage:null,loss:autoRisk+c.c*(1-coverage),miss:H[1][0]/N,false:H[0][1]/N,threshold:i===3?control.crc:i===4?control.pac:i===5?control.bernstein:i===6?control.combined:null,guarantee:["conditional_robust","bayesian_predictive","posterior_credible","marginal_expected_risk","pac_mean_risk","pac_bernstein","pac_combined"][i]};});
 return {summary,trace:control.curve,counts,dirichlet:{parameters:B.parameters,lower:B.lower,upper:B.upper,tail:B.tail,posteriorMassAtLeast:B.posteriorMassAtLeast},riskRows,hist,control,calSeed,riskSeed,testSeed,warning:"CRC ограничивает ожидаемый вклад автоматических действий в потери (эскалация ноль), в среднем по калибровке и новому запросу при обменности. PAC ограничивает средний вклад с заданной частотной вероятностью. Ни один не ограничивает условный риск каждого автоматического действия. Байесовская область имеет апостериорную, не частотную вероятность. Общие потери учитывают цену оператора отдельно."};
}
