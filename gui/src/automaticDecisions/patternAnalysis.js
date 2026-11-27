// E2.32: discovery-only rule selection, held-out evaluation and falsifiers.
// No inferential claim for a retrospectively inspected or non-iid design.
import {random} from "./kernel.js";
const finite=Number.isFinite,mean=a=>a.length?a.reduce((s,v)=>s+v,0)/a.length:null,seq=n=>Array.from({length:n},(_,i)=>i);
export function pairedCases(records,plan,{metric,baseline,candidate,threshold=0,direction="lower"}){
 if(!["loss","coverage","miss","false","failed","upperRisk","tight"].includes(metric)||!["lower","higher"].includes(direction)||!finite(threshold)||typeof candidate!=="string"||!candidate||baseline===candidate)throw Error("Некорректный показатель или сравнение");
 const expected=new Map(),seen=new Set(),cases=new Map();
 for(const u of plan){const k=u.case+":"+u.rep;if(expected.has(k))throw Error("Повтор единицы плана");expected.set(k,u);}
 for(const r of records){
  const u=r.unit,k=u.case+":"+u.rep,e=expected.get(k);
  if(!e||seen.has(k)||e.seed!==u.seed||JSON.stringify(e.values)!==JSON.stringify(u.values))throw Error("Несоответствие плана и результатов");
  seen.add(k);
  const a=r.summary.filter(v=>v.policy===candidate),b=baseline===null?[]:r.summary.filter(v=>v.policy===baseline);
  if(a.length!==1||baseline!==null&&b.length!==1||!finite(a[0][metric])||baseline!==null&&!finite(b[0][metric]))throw Error("Нет однозначного конечного значения метрики в паре");
  if(["upperRisk","tight"].includes(metric)&&(a[0].assumptionsValid===false||baseline!==null&&b[0].assumptionsValid===false))throw Error("Номинальная граница неприменима");
  const sign=direction==="lower"?1:-1,reference=baseline===null?threshold:b[0][metric],gain=sign*(reference-a[0][metric]);
  if(!finite(gain))throw Error("Неконечный контраст");
  if(!cases.has(u.case))cases.set(u.case,{id:u.case,factors:u.values,values:[],seeds:[]});
  const v=cases.get(u.case);if(JSON.stringify(v.factors)!==JSON.stringify(u.values))throw Error("Несогласованные факторы повторов");
  v.values.push(gain);v.seeds.push(u.seed);
 }
 if(seen.size!==expected.size)throw Error("Анализ доступен только для полной серии");
 return [...cases.values()].sort((a,b)=>a.id-b.id).map(v=>({id:v.id,factors:v.factors,gain:mean(v.values),reps:v.values.length,seeds:v.seeds}));
}
export function splitCases(rows,seed){
 const a=rows.slice().sort((x,y)=>String(x.id).localeCompare(String(y.id))),r=random(seed);
 for(let i=a.length-1;i>0;i--){const j=Math.floor(r()*(i+1));[a[i],a[j]]=[a[j],a[i]];}
 const n=Math.floor(a.length/2);return {discovery:a.slice(0,n),confirmation:a.slice(n)};
}
function validate(rows,axes){
 const ids=new Set(),keys=new Set();
 if(!Array.isArray(rows)||!Array.isArray(axes)||axes.length!==2||axes[0]===axes[1])throw Error("Требуются два различных фактора");
 for(const r of rows){
  const k=JSON.stringify(axes.map(a=>r.factors?.[a]));
  if(ids.has(r.id)||keys.has(k)||!finite(r.gain)||axes.some(a=>!finite(r.factors?.[a])))throw Error("Дубликат или некорректная конфигурация");
  ids.add(r.id);keys.add(k);
 }
}
export function matches(row,rule){return rule.conditions.every(c=>c.side==="low"?row.factors[c.factor]<=c.cut:row.factors[c.factor]>c.cut);}
function summarize(rows,rule,margin){
 const a=rows.filter(v=>matches(v,rule)),n=a.length,success=a.filter(v=>v.gain>margin+1e-10).length;
 return {n,success,fraction:n?success/n:null,mean:mean(a.map(v=>v.gain)),min:n?Math.min(...a.map(v=>v.gain)):null,max:n?Math.max(...a.map(v=>v.gain)):null};
}
export function discoverRules(rows,axes,{margin=0,minN=12,target=.75,maxRules=5}={}){
 validate(rows,axes);
 if(!finite(margin)||margin<0||!Number.isInteger(minN)||minN<2||!finite(target)||target<=.5||target>=1||!Number.isInteger(maxRules)||maxRules<1||maxRules>20)throw Error("Некорректные критерии поиска");
 const cuts=axes.map(a=>{const v=rows.map(r=>r.factors[a]).sort((a,b)=>a-b);return [...new Set([.25,.5,.75].map(q=>v[Math.floor(q*(v.length-1))]))].filter(t=>finite(t)&&t<v.at(-1)).flatMap(cut=>["low","high"].map(side=>({factor:a,cut,side})));});
 const pool=[[],...cuts.flatMap(a=>a.map(c=>[c])),...cuts[0].flatMap(a=>cuts[1].map(b=>[a,b]))];
 const tested=pool.map((conditions,i)=>{const rule={id:i+1,conditions};return {...rule,discovery:summarize(rows,rule,margin)};});
 const chosen=tested.filter(r=>r.discovery.n>=minN&&r.discovery.mean>margin&&r.discovery.fraction>=target).sort((a,b)=>b.discovery.fraction-a.discovery.fraction||b.discovery.mean-a.discovery.mean||b.discovery.n-a.discovery.n||a.conditions.length-b.conditions.length||a.id-b.id).slice(0,maxRules);
 return {axes,margin,minN,target,maxRules,examined:tested.length,discoveryN:rows.length,rules:chosen};
}
// Exact one-sided binomial tail under H0: P(success|subgroup)<=p0.
// Log-space summation; no normal approximation.
export function binomialTail(n,k,p0){
 if(!Number.isInteger(n)||n<0||!Number.isInteger(k)||k<0||k>n||!finite(p0)||p0<=0||p0>=1)throw Error("Некорректные параметры биномиальной проверки");
 if(k===0)return 1;
 let logC=0,max=-Infinity,scaled=0;
 for(let j=0;j<=n;j++){
  if(j>=k){const z=logC+j*Math.log(p0)+(n-j)*Math.log1p(-p0);if(z>max){scaled=scaled*Math.exp(max-z)+1;max=z;}else scaled+=Math.exp(z-max);}
  if(j<n)logC+=Math.log(n-j)-Math.log(j+1);
 }
 return Math.min(1,Math.exp(max)*scaled);
}
export function holm(p){
 const a=p.map((v,i)=>({v,i})).sort((a,b)=>a.v-b.v),out=Array(p.length);let last=0;
 a.forEach((v,j)=>{last=Math.max(last,Math.min(1,(a.length-j)*v.v));out[v.i]=last;});return out;
}
export function evaluateRules(frozen,rows,{iidFresh=false,alpha=.05}={}){
 validate(rows,frozen.axes);
 if(!finite(alpha)||alpha<=0||alpha>=1)throw Error("Некорректный alpha");
 const evaluated=frozen.rules.map(rule=>{
  const confirmation=summarize(rows,rule,frozen.margin),exceptions=rows.filter(r=>matches(r,rule)&&r.gain<=frozen.margin+1e-10).sort((a,b)=>a.gain-b.gain).map(r=>({rule:rule.id,case:r.id,...r.factors,gain:r.gain,reps:r.reps,seeds:r.seeds,kind:r.gain< -1e-10?"opposite":r.gain<=1e-10?"tie":"below_margin"}));
  const status=confirmation.n<frozen.minN?"insufficient":confirmation.mean>frozen.margin&&confirmation.fraction>=frozen.target?"descriptive_support":"not_reproduced";
  return {...rule,confirmation,exceptions,status,p:iidFresh&&confirmation.n>=frozen.minN?binomialTail(confirmation.n,confirmation.success,frozen.target):iidFresh?1:null};
 });
 const adjusted=iidFresh?holm(evaluated.map(v=>v.p)):[];
 return {schema:"imas-e2-pattern-v1",...frozen,confirmationN:rows.length,iidFresh,alpha:iidFresh?alpha:null,rules:evaluated.map((v,i)=>({...v,pHolm:iidFresh?adjusted[i]:null,significant:iidFresh?adjusted[i]<=alpha:null})),warning:iidFresh?"Биномиальная проверка условна по замороженному поиску и независимым iid конфигурациям того же генератора; Холм по выбранным правилам. Проверяется доля успехов, не средний эффект и не универсальный закон.":"Разбиение уже рассчитанной серии — описательная проверка воспроизводимости. Не независимая проспективная валидация; p-значения не вычисляются. Контрпримеры относятся к среднему по фактическим повторам."};
}
export function analyzeBatch(records,plan,axes,settings){
 const rows=pairedCases(records,plan,settings);
 validate(rows,axes);
 const {discovery,confirmation}=splitCases(rows,settings.seed);
 const frozen=discoverRules(discovery,axes,settings);
 return {...evaluateRules(frozen,confirmation),settings,split:{discovery:discovery.map(r=>r.id),confirmation:confirmation.map(r=>r.id)},cases:rows};
}
