/**
 * Research-2027 uncertainty procedures.
 * Frequentist intervals represent finite Monte-Carlo sampling variation only.
 * They do not quantify model error, parameter uncertainty or external validity.
 */
export const STATISTICS_VERSION="statistics-2027-1.1";
export const Z95=1.959963984540054;

const quantile=(a,q)=>{
 if(!a.length)throw Error("Квантиль требует непустую выборку");
 const s=[...a].sort((x,y)=>x-y),p=(s.length-1)*q,k=Math.floor(p);
 return s[k]+(s[Math.min(k+1,s.length-1)]-s[k])*(p-k);
};
export function wilson95(success,total){
 if(!Number.isInteger(total)||total<1||!Number.isInteger(success)||success<0||success>total)
  throw Error("Wilson: требуется 0≤число событий≤число прогонов, R≥1");
 const phat=success/total,z2=Z95*Z95,denom=1+z2/total;
 const center=(phat+z2/(2*total))/denom;
 const delta=Z95*Math.sqrt(phat*(1-phat)/total+z2/(4*total*total))/denom;
 return {estimate:phat,lower:success===0?0:Math.max(0,center-delta),upper:success===total?1:Math.min(1,center+delta),n:total,events:success,method:"Wilson-95"};
}
export function mean95(values){
 if(!Array.isArray(values)||!values.length||values.some(x=>!Number.isFinite(x)))throw Error("Mean CI: некорректная выборка");
 const n=values.length,m=values.reduce((a,b)=>a+b,0)/n;
 if(n===1)return {estimate:m,lower:null,upper:null,n,method:"normal-approx-95",warning:"R=1: дисперсия не определена"};
 const variance=values.reduce((a,v)=>a+(v-m)**2,0)/(n-1);
 const half=Z95*Math.sqrt(variance/n);
 return {estimate:m,lower:m-half,upper:m+half,n,method:"normal-approx-95",warning:n<30?"Малое R: нормальная аппроксимация может быть неточной":null};
}
const seeded=(seed)=>{
 let s=(Number(seed)>>>0)||1;
 return ()=>{s^=s<<13;s^=s>>>17;s^=s<<5;return (s>>>0)/4294967296;};
};
/**
 * Fixed-sample nonparametric percentile bootstrap.
 * For all-constant data CI degenerates to a point, which is NOT evidence that
 * the population parameter is known without uncertainty.
 */
export function bootstrap95(values,estimator,seed=1,replicates=300){
 if(!Array.isArray(values)||!values.length||values.some(x=>!Number.isFinite(x)))
  throw Error("Bootstrap: требуется непустая конечная выборка");
 if(!Number.isInteger(replicates)||replicates<100||replicates>5000)
  throw Error("Bootstrap: 100..5000 повторных выборок");
 const random=seeded(seed),n=values.length,estimates=new Array(replicates),sample=new Array(n);
 for(let b=0;b<replicates;b++){
  for(let i=0;i<n;i++)sample[i]=values[Math.floor(random()*n)];
  estimates[b]=estimator(sample);
  if(!Number.isFinite(estimates[b]))throw Error("Bootstrap: оценка не является конечным числом");
 }
 return {estimate:estimator(values),lower:quantile(estimates,.025),upper:quantile(estimates,.975),n,replicates,method:"percentile-bootstrap-95"};
}
export function pairedDifference95(first,second,seed=1,replicates=300){
 if(!Array.isArray(first)||!Array.isArray(second)||first.length!==second.length||!first.length)
  throw Error("Парное сравнение: требуются равные непустые массивы");
 const differences=first.map((v,i)=>v-second[i]);
 const result=bootstrap95(differences,a=>a.reduce((s,v)=>s+v,0)/a.length,seed,replicates);
 return {...result,baseline:"second",direction:"first-minus-second",paired:true};
}


/**
 * Two-sided paired sign-flip reference test for a zero mean contrast.
 * Exact for n<=14. Larger arrays use a seeded Monte Carlo randomisation test.
 * Validity requires pairwise sign-exchangeability under the null; a shared
 * exogenous RNG by itself does not establish that hypothesis.
 */
export function pairedSignFlipP(differences,seed=1,replicates=4095){
 if(!Array.isArray(differences)||differences.length<2||
    differences.some(x=>!Number.isFinite(x)))throw Error("Sign-flip: требуется не менее двух конечных пар");
 if(!Number.isInteger(replicates)||replicates<100||replicates>20000)
  throw Error("Sign-flip: число перестановок 100..20000");
 const n=differences.length,observed=Math.abs(differences.reduce((a,b)=>a+b,0));
 const tolerance=1e-12*Math.max(1,observed,differences.reduce((a,v)=>a+Math.abs(v),0));
 if(differences.every(x=>Math.abs(x)<=tolerance))return {p:1,n,replicates:0,method:"degenerate-zero"};
 if(n<=14){
  let extreme=0;
  const total=2**n;
  for(let bits=0;bits<total;bits++){
   let signed=0;
   for(let i=0;i<n;i++)signed+=(bits&(1<<i)?1:-1)*differences[i];
   if(Math.abs(signed)+tolerance>=observed)extreme++;
  }
  return {p:extreme/total,n,replicates:total,method:"exact-paired-sign-flip"};
 }
 const random=seeded(seed);
 let extreme=0;
 for(let b=0;b<replicates;b++){
  let signed=0;
  for(const difference of differences)signed+=(random()<.5?-1:1)*difference;
  if(Math.abs(signed)+tolerance>=observed)extreme++;
 }
 return {p:(extreme+1)/(replicates+1),n,replicates,method:"monte-carlo-paired-sign-flip"};
}
/** Familywise error rate control, Holm (1979) step-down. */
export function holmAdjusted(pValues){
 if(!Array.isArray(pValues)||pValues.some(p=>!Number.isFinite(p)||p<0||p>1))
  throw Error("Holm: каждое p-значение должно лежать в [0,1]");
 const m=pValues.length,sorted=pValues.map((p,i)=>({p,i})).sort((a,b)=>a.p-b.p||a.i-b.i);
 const adjusted=new Array(m);let ceiling=0;
 for(let rank=0;rank<m;rank++){
  const {p,i}=sorted[rank];
  ceiling=Math.max(ceiling,Math.min(1,(m-rank)*p));
  adjusted[i]=ceiling;
 }
 return adjusted;
}
