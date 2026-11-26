// E2.27/E2.28. Finite-horizon, two-state, serial acquisition, exact
// enumeration of histories. Robust value is an upper bound obtained by
// rectangularizing belief and observation ambiguity at every public history.
import {validateExt,select,loss} from "./extendedModel.js";
const clip=x=>Math.max(0,Math.min(1,x)),sum=a=>a.reduce((s,v)=>s+v,0),int=(v,a,b)=>Number.isInteger(v)&&v>=a&&v<=b,real=(v,a,b)=>Number.isFinite(v)&&v>=a&&v<=b;
export const DEFAULT_AGENTS=[
 {name:"IDS",u0:.12,u1:.86,availability:.95,delay:1,cost:.035,radius:.03},
 {name:"EDR",u0:.06,u1:.92,availability:.82,delay:2,cost:.055,radius:.025},
 {name:"SIEM",u0:.22,u1:.76,availability:.99,delay:1,cost:.015,radius:.04},
 {name:"Аудит",u0:.03,u1:.96,availability:.75,delay:3,cost:.08,radius:.02}
];
export const POLICIES=["Немедленная робастная","Случайный запрос","Циклический DP","Жадный робастный","Номинальный DP","Робастный DP"];
const band=(v,r)=>[clip(v-r),clip(v+r)];
export function validateDynamicPomdp(c){
 if(!int(c.pomdpHorizon,1,5)||!real(c.p01,0,1)||!real(c.p10,0,1)||!real(c.transitionRadius,0,1)||!real(c.waitCost,0,1000)||!real(c.safetyRisk,0,1000)||!Array.isArray(c.pomdpAgents)||c.pomdpAgents.length<1||c.pomdpAgents.length>6)throw Error("POMDP: горизонт 1–5, от 1 до 6 источников, вероятности в [0,1]");
 const names=new Set();
 for(const a of c.pomdpAgents){
  if(!a||typeof a.name!=="string"||!a.name.trim()||a.name.length>80||names.has(a.name)||![a.u0,a.u1,a.availability,a.radius].every(v=>real(v,0,1))||!int(a.delay,1,5)||!real(a.cost,0,1000))throw Error("Источник: уникальное имя, u0,u1,availability,radius в [0,1], delay 1–5, cost 0–1000");
  names.add(a.name);
 }
 // Upper bound on number of distinct histories expanded by exhaustive DP.
 const A=c.pomdpAgents;
 function work(mask,t){let n=1;if(t<1)return n;n+=work(mask,t-1);for(let i=0;i<A.length;i++)if(!(mask&(1<<i))&&A[i].delay<=t)n+=3*work(mask|(1<<i),t-A[i].delay);return n;}
 if(work(0,c.pomdpHorizon)>100000)throw Error("Более 100000 узлов дерева; уменьшите горизонт или число источников");
 return c;
}
export function predict(p,a,b,steps=1){for(let i=0;i<steps;i++)p=(1-p)*a+p*(1-b);return clip(p);}
export function predictInterval(interval,A,B,steps=1){
 let [l,u]=interval;for(let i=0;i<steps;i++){const vals=[l,u].flatMap(p=>A.flatMap(a=>B.map(b=>(1-p)*a+p*(1-b))));l=clip(Math.min(...vals));u=clip(Math.max(...vals));}return [l,u];
}
function post(p,q0,q1){const z=(1-p)*q0+p*q1;return z>0?p*q1/z:null;}
export function posteriorInterval([l,u],A,B){
 // Monotone fractional update, with impossible branches treated as
 // uninformative if the corresponding extremum has zero denominator.
 const vals=[l,u].flatMap(p=>A.flatMap(a=>B.map(b=>post(p,a,b)))).filter(v=>v!==null);
 return vals.length?[clip(Math.min(...vals)),clip(Math.max(...vals))]:[0,1];
}
function obsProbability(p,u0,u1){return (1-p)*u0+p*u1;}
function observation(p,[u0,u1],y){if(y===2)return p;return post(p,y?u0:1-u0,y?u1:1-u1)??p;}
const prob=(p,a)=>[(1-obsProbability(p,a.u0,a.u1))*a.availability,obsProbability(p,a.u0,a.u1)*a.availability,1-a.availability];
function empty(N){return {loss:0,decisionLoss:0,acquisitionCost:0,waitingCost:0,coverage:0,miss:0,false:0,delay:0,queries:0,unsafe:0,agentCounts:Array(N).fill(0)};}
function terminalMetrics(c,a,p){
 const v=empty(c.pomdpAgents.length);v.loss=v.decisionLoss=(1-p)*loss(c,a,0)+p*loss(c,a,1);v.coverage=+(a!==2);v.miss=a===0?p:0;v.false=a===1?1-p:0;v.unsafe=+(a!==2&&v.loss>c.safetyRisk+1e-10);return v;
}
function combine(c,values,weights,agent,delay,cost){
 const v=empty(c.pomdpAgents.length);
 for(let i=0;i<values.length;i++)if(weights[i]>0){for(const k of Object.keys(v))if(k!=="agentCounts")v[k]+=weights[i]*values[i][k];v.agentCounts.forEach((_,j)=>v.agentCounts[j]+=weights[i]*values[i].agentCounts[j]);}
 v.acquisitionCost+=cost;v.waitingCost+=c.waitCost*delay;v.loss+=cost+c.waitCost*delay;v.delay+=delay;if(agent!==null){v.queries++;v.agentCounts[agent]++;}return v;
}
const lower=(a,b,k)=>b[k]<a[k]-1e-12?b:a;
function terminal(c,I,p,s){
 const safe=select({...c,c:c.safetyRisk},...I,6),actions=safe===2?[2]:[2,safe];
 const rows=actions.map(a=>({type:"stop",a,upper:Math.max(...I.map(q=>(1-q)*loss(c,a,0)+q*loss(c,a,1))),nom:terminalMetrics(c,a,p),stress:terminalMetrics(c,a,s)}));
 return {n:rows.reduce((a,b)=>b.nom.loss<a.nom.loss-1e-12?b:a),r:rows.reduce((a,b)=>lower(a,b,"upper"))};
}
function robustExpectation(values,weights,lo1,hi1,av){
 if(av===null)return values[0];
 return (1-av)*values[2]+Math.max((av-lo1)*values[0]+lo1*values[1],(av-hi1)*values[0]+hi1*values[1]);
}
export function dynamicPomdp(raw,unit={kind:"pomdp"}){
 const c=validateDynamicPomdp(validateExt({...raw,stress:"none",eta:0})),A=band(c.p01,c.transitionRadius),B=band(c.p10,c.transitionRadius),agents=c.pomdpAgents,stressAgents=agents.map(a=>({...a,u0:band(a.u0,a.radius)[1],u1:band(a.u1,a.radius)[0]})),stressTransition=[A[1],B[0]];
 let nodes=0;
 function solve(mask,t,I,p,s){
  nodes++;const stop=terminal(c,I,p,s),choices=POLICIES.map((_,j)=>j===2||j===4?stop.n:stop.r);
  if(t===0)return {choices,stop};
  const options=[];
  for(const i of [null,...agents.map((_,j)=>j)]){
   if(i!==null&&((mask&(1<<i))||agents[i].delay>t))continue;
   const a=i===null?null:agents[i],d=a?a.delay:1,cost=a?a.cost:0,ip=predictInterval(I,A,B,d),pn=predict(p,c.p01,c.p10,d),ps=predict(s,...stressTransition,d);
   let kids,wn,ws,lo1=0,hi1=0,av=null;
   if(a){
    av=a.availability;const U=band(a.u0,a.radius),V=band(a.u1,a.radius),sr=stressAgents[i],q=ip.flatMap(x=>U.flatMap(u=>V.map(v=>obsProbability(x,u,v))));lo1=av*Math.min(...q);hi1=av*Math.max(...q);
    wn=prob(pn,a);ws=prob(ps,sr);
    const intervals=[posteriorInterval(ip,U.map(v=>1-v).reverse(),V.map(v=>1-v).reverse()),posteriorInterval(ip,U,V),ip];
    kids=intervals.map((v,y)=>solve(mask|(1<<i),t-d,v,observation(pn,[a.u0,a.u1],y),observation(ps,[sr.u0,sr.u1],y)));
   }else{kids=[solve(mask,t-d,ip,pn,ps)];wn=ws=[1];}
   const make=(k,terminalOnly=false)=>{
    const children=kids.map(r=>terminalOnly?r.stop.r:r.choices[k]),upper=cost+c.waitCost*d+robustExpectation(children.map(v=>v.upper),wn,lo1,hi1,av);
    return {type:i===null?"wait":"query",agent:i,delay:d,cost,upper,nom:combine(c,children.map(v=>v.nom),wn,i,d,cost),stress:combine(c,children.map(v=>v.stress),ws,i,d,cost),children};
   };
   options.push({i,make});
  }
  // Random baseline: uniform over available source identities, with robust
  // stopping. Nature may observe the chosen source. No wait-only action.
  const queries=options.filter(v=>v.i!==null);
  if(queries.length){
   const qs=queries.map(v=>v.make(1)),w=qs.map(()=>1/qs.length),r={type:"random",upper:sum(qs.map(v=>v.upper))/qs.length,nom:combine(c,qs.map(v=>v.nom),w,null,0,0),stress:combine(c,qs.map(v=>v.stress),w,null,0,0),children:qs};
   choices[1]=lower(choices[1],r,"upper");
  }
  let greedyScore=stop.r.upper;
  for(const o of options){
   if(o.i===null||o===queries[0]){const v=o.make(2);if(v.nom.loss<choices[2].nom.loss-1e-12)choices[2]=v;}
   const one=o.make(3,true);if(one.upper<greedyScore-1e-12){greedyScore=one.upper;choices[3]=o.make(3);}
   const n=o.make(4);if(n.nom.loss<choices[4].nom.loss-1e-12)choices[4]=n;
   choices[5]=lower(choices[5],o.make(5),"upper");
  }
  return {choices,stop};
 }
 const root=solve(0,c.pomdpHorizon,[c.prior,c.prior],c.prior,c.prior),R=root.choices,lowerBound=R[4].nom.loss,upperBound=R[5].upper;
 if(lowerBound>upperBound+1e-9||R.some(v=>v.nom.loss>v.upper+1e-8||v.stress.loss>v.upper+1e-8||v.nom.unsafe>1e-9||v.stress.unsafe>1e-9))throw Error("Нарушена оценка робастного риска");
 const actionName=v=>v.type==="stop"?["Не реагировать","Реагировать","Эскалация"][v.a]:v.type==="query"?agents[v.agent].name:v.type==="wait"?"Ожидание":"Равномерный выбор";
 const summary=R.map((v,i)=>({policy:POLICIES[i],firstAction:actionName(v),...Object.fromEntries(Object.entries(v.nom).filter(([k])=>k!=="agentCounts")),stressLoss:v.stress.loss,stressCoverage:v.stress.coverage,stressMiss:v.stress.miss,stressFalse:v.stress.false,stressUnsafe:v.stress.unsafe,upperRisk:v.upper,gap:v.upper-v.nom.loss,certified:false}));
 const agentStats=R.flatMap((v,i)=>agents.map((a,j)=>({policy:POLICIES[i],agent:a.name,nominalQueries:v.nom.agentCounts[j],stressQueries:v.stress.agentCounts[j]})));
 const plan=(v,t)=>({action:actionName(v),type:v.type,t,upper:v.upper,nominal:v.nom.loss,...(v.children?{children:v.children.map((w,j)=>({observation:v.type==="query"?["0","1","нет доставки"][j]:"без наблюдения",...plan(w,t+(v.delay??0))}))}:{})});
 return {unit,summary,trace:summary,agentStats,states:nodes,lowerBound,upperBound,optimalityGap:upperBound-lowerBound,transition:{nominal:[c.p01,c.p10],bounds:[A,B],stress:stressTransition},agents,stressAgents,plans:{nominal:plan(R[4],0),robust:plan(R[5],0)},warning:"Точное перечисление конечного дерева для номинальной модели и прямоугольной интервальной оболочки. Робастная верхняя граница консервативна для фиксированного неизвестного закона в заданных интервалах; это не точный minimax исходной не-прямоугольной задачи. Интервалы заданы извне, не оценены статистически. Источники условно независимы при данном текущем состоянии; запрос одноразовый, сведения измеряются при доставке. Промежуточных решений во время ожидания нет. Все результаты — точные ожидания в двух синтетических законах, не полевой сертификат."};
}
