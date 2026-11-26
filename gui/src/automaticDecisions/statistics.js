import {aggregate} from "./kernel.js";
// Inverse Student distribution via regularized incomplete beta; no asymptotic normal substitution.
function logGamma(z){const p=[676.5203681218851,-1259.1392167224028,771.3234287776531,-176.6150291621406,12.507343278686905,-.13857109526572012,9.984369578019572e-6,1.5056327351493116e-7];if(z<.5)return Math.log(Math.PI)-Math.log(Math.sin(Math.PI*z))-logGamma(1-z);z--;let x=.9999999999998099;for(let i=0;i<p.length;i++)x+=p[i]/(z+i+1);let t=z+7.5;return .5*Math.log(2*Math.PI)+(z+.5)*Math.log(t)-t+Math.log(x);}
function cf(a,b,x){const tiny=1e-300;let qab=a+b,qap=a+1,qam=a-1,c=1,d=1-qab*x/qap;if(Math.abs(d)<tiny)d=tiny;d=1/d;let h=d;for(let m=1;m<=200;m++){let m2=2*m,aa=m*(b-m)*x/((qam+m2)*(a+m2));d=1+aa*d;if(Math.abs(d)<tiny)d=tiny;c=1+aa/c;if(Math.abs(c)<tiny)c=tiny;d=1/d;h*=d*c;aa=-(a+m)*(qab+m)*x/((a+m2)*(qap+m2));d=1+aa*d;if(Math.abs(d)<tiny)d=tiny;c=1+aa/c;if(Math.abs(c)<tiny)c=tiny;d=1/d;let delta=d*c;h*=delta;if(Math.abs(delta-1)<1e-13)break;}return h;}
function ibeta(a,b,x){if(x<=0)return 0;if(x>=1)return 1;const k=Math.exp(logGamma(a+b)-logGamma(a)-logGamma(b)+a*Math.log(x)+b*Math.log1p(-x));return x<(a+1)/(a+b+2)?k*cf(a,b,x)/a:1-k*cf(b,a,1-x)/b;}
export function studentCritical(alpha,df){if(!(alpha>0&&alpha<1&&df>0))return null;const tail=t=>.5*ibeta(df/2,.5,df/(df+t*t));let a=0,b=1;while(tail(b)>alpha/2)b*=2;for(let i=0;i<80;i++){const mid=(a+b)/2;if(tail(mid)>alpha/2)a=mid;else b=mid;}return (a+b)/2;}
export function paired(rows,alpha=.05){
 const scenarios=[...new Set(rows.map(r=>r.scenario))],family=scenarios.length*4,out=[];
 for(const scenario of scenarios){const selected=rows.filter(r=>r.scenario===scenario),base=new Map(selected.filter(r=>r.method===6).map(r=>[r.rep,r.loss]));
 for(const baseline of [3,4,8,11]){const d=selected.filter(r=>r.method===baseline&&base.has(r.rep)).map(r=>r.loss-base.get(r.rep)),n=d.length;if(!n)continue;const difference=d.reduce((a,b)=>a+b,0)/n,sd=n>1?Math.sqrt(d.reduce((a,b)=>a+(b-difference)**2,0)/(n-1)):null,half=sd===null?null:studentCritical(alpha/family,n-1)*sd/Math.sqrt(n);out.push({scenario,baseline,difference,lower:half===null?null:difference-half,upper:half===null?null:difference+half,reps:n,family});}}
 return out;
}
export function summarize(records,alpha=.05){const raw={};for(const r of records)for(const [key,rows] of Object.entries(r.rows))(raw[key]??=[]).push(...rows);
 const keys={fixed:["scenario","method"],matched:["scenario","method"],validity:["scenario"],sensitivity:["n"],cost:["cost","method"],validation:["scenario","method"],monte_carlo:["scenario"],certificate_checks:["scenario"]};
 const tables=Object.fromEntries(Object.entries(raw).map(([key,rows])=>[key,aggregate(rows,keys[key]||[])]));if(raw.matched)tables.paired=paired(raw.matched,alpha);
 return {raw,tables};}

 // Conservative numerical bracket for a beta quantile. The returned endpoints
 // bracket the root of the computed CDF; independent SciPy tests check accuracy.
export function betaQuantileBracket(a,b,p){
 if(!(a>0&&b>0&&p>=0&&p<=1))throw Error("Некорректные параметры beta");
 if(p===0)return [0,0];if(p===1)return [1,1];
 // Work in the smaller tail to avoid catastrophic cancellation at p near one.
 if(p>.5){const [l,h]=betaQuantileBracket(b,a,1-p);return [1-h,1-l];}
 let l=0,h=1;for(let i=0;i<80;i++){const m=(l+h)/2,v=ibeta(a,b,m);if(!Number.isFinite(v))throw Error("Неустойчивый расчёт beta CDF");if(v<p)l=m;else h=m;if(h-l<1e-14)break;}
 return [l,h];
}
