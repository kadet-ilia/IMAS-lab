// E2.24/E2.26. All candidate partitions observe the SAME agent identities.
// Selection, count calibration, validation and test are chronologically separate.
import {validateExt,lawsExt,draw,tables,point,select,loss,seedFor} from "./extendedModel.js";
import {conditionalGraph,partitionGraph,originalPartition} from "./groupDiscovery.js";
import {random} from "./kernel.js";
const sum=a=>a.reduce((s,v)=>s+v,0),seq=n=>Array.from({length:n},(_,i)=>i),mean=a=>sum(a)/a.length,real=(v,a,b)=>Number.isFinite(v)&&v>=a&&v<=b,int=(v,a,b)=>Number.isInteger(v)&&v>=a&&v<=b;
const canonical=p=>p.map(g=>g.slice().sort((a,b)=>a-b)).sort((a,b)=>a[0]-b[0]),key=p=>JSON.stringify(canonical(p));
export function partitionDistance(a,b){
 const by=p=>{const m=new Map();p.forEach((g,i)=>g.forEach(j=>m.set(j,i)));return m;},A=by(a),B=by(b),ids=[...A.keys()];
 if(ids.length!==B.size||ids.some(i=>!B.has(i)))throw Error("Несовместимые разбиения");
 let d=0,n=0;for(let i=0;i<ids.length;i++)for(let j=i+1;j<ids.length;j++){n++;d+=+((A.get(ids[i])===A.get(ids[j]))!==(B.get(ids[i])===B.get(ids[j])));}
 return n?d/n:0;
}
export function enumeratePartitions(N,maxSize){
 if(!int(N,2,6)||!int(maxSize,1,N))throw Error("Точное перечисление: 2–6 агентов");
 const result=[],visit=(i,p)=>{if(i===N){result.push(p.map(g=>g.slice()));return;}for(const g of p)if(g.length<maxSize){g.push(i);visit(i+1,p);g.pop();}p.push([i]);visit(i+1,p);p.pop();};visit(0,[]);return result;
}
function candidates(graph,original,c,active=original){
 const N=graph.N,max=c.structMax,valid=p=>p.every(g=>g.length<=max),list=[original,active,seq(N).map(i=>[i])];
 if(c.structSearch==="exact")list.push(...enumeratePartitions(N,max));
 else for(const t of [.001,.005,.01,.025,.05,.1,.2,.4])list.push(partitionGraph(graph,t,"complete",max));
 return [...new Map(list.filter(valid).map(p=>[key(p),canonical(p)])).values()];
}
export function validateStructure(c,dynamic=false){
 const N=sum(c.groups);
 if(c.family!=="l1"||!int(N,2,12)||!int(c.structMax,Math.max(...c.groups),N)||!["exact","graph"].includes(c.structSearch)||c.structSearch==="exact"&&N>6||!int(c.structBlock,80,4000)||!int(c.structTest,100,10000)||!int(c.structReps,1,30)||![c.structRiskWeight,c.structCoverageWeight,c.structDependenceWeight,c.structCostWeight].every(v=>real(v,0,100))||c.structRiskWeight+c.structCoverageWeight+c.structDependenceWeight+c.structCostWeight<=0)throw Error("Структура: L1, 2–12 агентов; точный перебор до 6; допустимый размер группы и ненулевые веса");
 const K=c.structSearch==="exact"?enumeratePartitions(N,c.structMax).length:11;
 if(dynamic&&(!int(c.structPeriod,50,2000)||!int(c.structDwell,0,20000)||!real(c.structReconf,0,1000)||!real(c.structHysteresis,0,100)||c.groups.length<2))throw Error("Некорректные параметры реконфигурации");
 const updates=dynamic?1+Math.ceil(c.steps/c.structPeriod):1;
 if(K*c.structBlock*updates*c.structReps*N>50000000||c.structTest*K*c.structReps>5000000)throw Error("Превышен бюджет сравнения разбиений; уменьшите число повторов или блоки");
 return c;
}
function source(c,seed){
 const q=lawsExt(c).nominal,F=q.map(row=>row.map(a=>{let s=0;return a.map(v=>s+=v);})),r=random(seed),N=sum(c.groups);
 return (time,changed=false)=>{
  const x=+(r()<c.prior),a=[];
  for(let g=0;g<c.groups.length;g++){
   const j=draw(F[x][g],r()),v=seq(c.groups[g]).map(i=>+(i<j));
   for(let i=v.length-1;i>0;i--){const k=Math.floor(r()*(i+1));[v[i],v[k]]=[v[k],v[i]];}a.push(...v);
  }
  // Reassign identities, preserving all individual marginals if u is uniform.
  const full=changed?a.map((_,i)=>a[(i+1)%N]):a;
  const observed=full.map(y=>r()<c.drop?null:y);
  return {time,x,full,observed};
 };
}
const graphOf=(rows,N)=>conditionalGraph(rows.map(r=>({x:r.x,agents:[r.full]})),N);
function fit(c,p,rows){
 const groups=p.map(g=>g.length),M=[0,0],counts=[0,1].map(()=>groups.map(n=>seq(n+1).map(()=>0)));
 for(const r of rows){M[r.x]++;p.forEach((g,i)=>counts[r.x][i][sum(g.map(j=>r.full[j]))]++);}
 if(M.some(n=>n<2))return null;
 const conf={...c,groups,u:[0,1].map(()=>groups.map(()=>.5)),rho:groups.map(()=>0),m:Math.max(...M)};
 return {conf,p,T:tables(conf,counts,M),counts,M,fitFirst:rows[0].time,fitLast:rows.at(-1).time};
}
function action(model,r){
 if(!model)return 2;
 const ix=model.p.map(g=>{let m=0,k=0;for(const j of g){const v=r.observed[j];if(v!==null){m++;k+=v;}}return m*(m+1)/2+k;});
 return select(model.conf,...point(model.conf,model.T,ix));
}
function score(c,model,rows){
 let cov=0,L=0,miss=0,fp=0;
 for(const r of rows){const a=action(model,r);cov+=+(a!==2);L+=loss(c,a,r.x);miss+=+(a===0&&r.x===1);fp+=+(a===1&&r.x===0);}
 return {coverage:cov/rows.length,loss:L/rows.length,miss:miss/rows.length,false:fp/rows.length,N:rows.length};
}
function residual(graph,p){
 const group=new Map();p.forEach((g,i)=>g.forEach(j=>group.set(j,i)));
 return sum(graph.edges.filter(e=>group.get(e.i)!==group.get(e.j)).map(e=>e.cmi))/graph.edges.length;
}
export function paretoFlags(rows,fields){
 return rows.map(a=>!rows.some(b=>b!==a&&fields.every(k=>b[k]<=a[k]+1e-12)&&fields.some(k=>b[k]<a[k]-1e-12)));
}
export function chooseStructure(c,discovery,calibration,validation,original,active=original){
 const N=sum(c.groups),Lmax=Math.max(c.b,c.f,c.d,c.c),graph=graphOf(discovery,N),holdout=graphOf(calibration,N),ps=candidates(graph,original,c,active),K=ps.length;
 // Only describes validation uncertainty under iid stationary validation
 // observations, conditional on discovery and calibration. No M6 field certificate.
 const h=Math.sqrt(Math.log(2*K/c.alpha)/(2*validation.length));
 const models=ps.map(p=>fit(c,p,calibration));
 if(models.some(m=>!m))throw Error("Недостаточно аудитов одного класса для калибровки");
 const rows=ps.map((p,i)=>{
  const v=score(c,models[i],validation),riskUpper=Math.min(Lmax,v.loss+Lmax*h),coverageLower=Math.max(0,v.coverage-h),dependence=residual(holdout,p),cost=c.agentCost*N+c.groupCost*p.length,dist=partitionDistance(p,active);
  const designNorm=(cost/(Math.max(1,c.agentCost*N+c.groupCost*N)));
  const objective=c.structRiskWeight*riskUpper/Lmax+c.structCoverageWeight*(1-coverageLower)+c.structDependenceWeight*dependence+c.structCostWeight*designNorm;
  return {id:i,partition:p.map(g=>g.map(j=>j+1).join(",")).join(" | "),groups:p.length,...v,riskUpper,coverageLower,dependence,cost,dist,objective};
 });
 const flags=paretoFlags(rows,["riskUpper","dependence","cost"]); // coverage added below without sign confusion
 const fullFlags=paretoFlags(rows.map(r=>({...r,nonCoverage:1-r.coverageLower})),["riskUpper","nonCoverage","dependence","cost"]);
 rows.forEach((r,i)=>r.pareto=fullFlags[i]);
 const best=rows.reduce((a,b)=>b.objective<a.objective-1e-12?b:a).id,cmi=rows.reduce((a,b)=>b.dependence<a.dependence-1e-12?b:a).id;
 return {rows,models,best,cmi,original:ps.findIndex(p=>key(p)===key(original)),active:ps.findIndex(p=>key(p)===key(active)),graph,holdout,h,discoveryLast:discovery.at(-1).time,calibrationLast:calibration.at(-1).time,validationLast:validation.at(-1).time};
}
const split=(a,b)=>[a.slice(0,b),a.slice(b,2*b),a.slice(2*b,3*b)];
export function structureStudy(raw,unit){
 const c=validateStructure(validateExt({...raw,stress:"none",eta:0})),seed=seedFor(c.seed,101000+unit.rep*2),testSeed=seedFor(c.seed,101001+unit.rep*2),gen=source(c,seed),testGen=source(c,testSeed),n=c.structBlock,original=originalPartition(c.groups),history=seq(3*n).map(i=>gen(i)),test=seq(c.structTest).map(i=>testGen(3*n+i)),S=chooseStructure(c,...split(history,n),original);
 const ids=[S.original,S.cmi,S.best],names=["Исходная структура","Минимум остаточной CMI","Многокритериальный выбор"],summary=ids.map((id,i)=>({policy:names[i],candidate:id,partition:S.rows[id].partition,...score(c,S.models[id],test),validationObjective:S.rows[id].objective,dependence:S.rows[id].dependence,cost:S.rows[id].cost,certified:false}));
 return {unit,summary,trace:S.rows,candidates:S.rows,chosen:ids,seed,testSeed,split:{discovery:n,calibration:n,validation:n,test:c.structTest},counts:ids.map(i=>S.models[i].counts),warning:"Сравнение на общих агентных наблюдениях. Группировка по CMI не доказывает независимость или обменность. Валидационные границы условны при iid, не являются сертификатом M6. Тест не использован при выборе."};
}
export function dynamicStructure(raw,unit){
 const c=validateStructure(validateExt({...raw,stress:"none",eta:0}),true),n=c.structBlock,seed=seedFor(c.seed,102000+unit.rep*2),testSeed=seedFor(c.seed,102001+unit.rep*2),gen=source(c,seed),stream=source(c,testSeed),original=originalPartition(c.groups),history=seq(3*n).map(i=>gen(i-3*n)),pending=[],events=[],trace=[],updates=[],switchAt=Math.floor(c.steps*c.changeAt);
 const initial=chooseStructure(c,...split(history,n),original),fixed=initial.models[initial.best];let active=fixed,staticRefit=fixed,released=0,lastChange=-c.structDwell,changes=0,cost=0;
 const acc=seq(3).map(()=>({L:0,cov:0,miss:0,fp:0}));let block=seq(3).map(()=>({L:0,cov:0})),blockN=0;
 for(let t=0;t<c.steps;t++){
  while(released<pending.length&&pending[released].reveal<=t){history.push(pending[released++].row);if(history.length>3*n)history.shift();}
  let charge=0;
  if(t>0&&t%c.structPeriod===0){
   const parts=split(history,n);
   if(parts.every(a=>[0,1].every(x=>a.filter(r=>r.x===x).length>=2))){
    const S=chooseStructure(c,...parts,original,active.p),current=S.rows[S.active],Lmax=Math.max(c.b,c.f,c.d,c.c),penalty=v=>c.structRiskWeight*c.structReconf*v.dist/(c.structPeriod*Lmax);
    const best=S.rows.reduce((a,b)=>b.objective+penalty(b)<a.objective+penalty(a)-1e-12?b:a);
    const changed=best.id!==current.id&&t-lastChange>=c.structDwell&&current.objective-best.objective-penalty(best)>c.structHysteresis;
    if(changed){charge=c.structReconf*best.dist;cost+=charge;changes++;lastChange=t;}
    active=S.models[changed?best.id:current.id];staticRefit=fit(c,fixed.p,parts[1]);
    updates.push({t,changed,charge,selected:key(active.p),previous:current.partition,chosen:S.rows[changed?best.id:current.id].partition,objective:S.rows[changed?best.id:current.id].objective,discoveryLast:S.discoveryLast,calibrationLast:S.calibrationLast,validationLast:S.validationLast,released});
   }
  }
  const r=stream(t,unit.shift>0&&t>=switchAt),actions=[fixed,staticRefit,active].map(m=>action(m,r));
  actions.forEach((a,i)=>{const L=loss(c,a,r.x)+(i===2?charge:0);acc[i].L+=L;acc[i].cov+=+(a!==2);acc[i].miss+=+(a===0&&r.x===1);acc[i].fp+=+(a===1&&r.x===0);block[i].L+=L;block[i].cov+=+(a!==2);});
  pending.push({row:r,reveal:t+Math.max(1,c.delay)});events.push({t,actions,x:r.x,partition:key(active.p),charge,released,fitLast:active.fitLast});blockN++;
  if((t+1)%c.structPeriod===0||t===c.steps-1){trace.push({t:t+1,fixedLoss:block[0].L/blockN,refitLoss:block[1].L/blockN,regroupLoss:block[2].L/blockN,regroupCoverage:block[2].cov/blockN,groups:active.p.length,changes,released});block=seq(3).map(()=>({L:0,cov:0}));blockN=0;}
 }
 const summary=["Фиксированная структура и модель","Фиксированная структура + калибровка","Динамическая перегруппировка"].map((policy,i)=>({policy,rep:unit.rep,shift:unit.shift,coverage:acc[i].cov/c.steps,loss:acc[i].L/c.steps,miss:acc[i].miss/c.steps,false:acc[i].fp/c.steps,changes:i===2?changes:0,reconfCost:i===2?cost:0,decisionLoss:(acc[i].L-(i===2?cost:0))/c.steps,certified:false}));
 return {unit,summary,trace,updates,events,seed,testSeed,switchAt,released,initialPartition:key(fixed.p),warning:"Смена зависимости моделируется циклической перестановкой идентичностей агентов. Все три политики видят одни наблюдения; аудиты восстанавливают полные счётчики после фиксированной задержки. Гистерезис и минимальное время между изменениями. При нестационарности границы валидации — эвристический критерий, не сертификат."};
}
