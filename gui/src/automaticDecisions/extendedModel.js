/* E2.2–E2.7: generalized grouped model, isolated from the article kernel. */
import {DEFAULTS,extrem,boxExt,random,multinomial} from "./kernel.js";
export const EXT_VERSION="E2-extension-1.0";
export const BASE={...DEFAULTS,mode:"custom",m:2000,reps:3,drop:.4,stress:"none",eta:0,family:"l1",rhoScale:1};
export const STRESS=["none","drift","cross","mnar","nonexchangeable","biasedMask","contamination"];
export const FAMILIES=["l1","box","wasserstein","kl","moments"];
const sum=a=>a.reduce((s,v)=>s+v,0),dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),seq=n=>Array.from({length:n},(_,i)=>i),clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
export const seedFor=(s,i)=>((s+Math.imul(i+1,0x9e3779b9))>>>0)||1;
export function validateExt(raw={}){
 const c={...BASE,...raw},B=c.groups?.length,real=(v,l,h)=>Number.isFinite(v)&&v>=l&&v<=h,int=(v,l,h)=>Number.isInteger(v)&&v>=l&&v<=h;
 if(!int(B,1,20)||c.groups.some(n=>!int(n,1,50)))throw Error("1–20 групп по 1–50 агентов");
 if(!Array.isArray(c.u)||c.u.length!==2||c.u.some(a=>!Array.isArray(a)||a.length!==B||a.some(v=>!real(v,0,1)))||!Array.isArray(c.rho)||c.rho.length!==B||c.rho.some(v=>!real(v,0,1)))throw Error("Неверные групповые параметры");
 if(!int(c.m,1,100000)||!int(c.reps,1,30)||!int(c.seed,1,4294967295)||!real(c.prior,1e-8,1-1e-8)||!real(c.alpha,1e-8,1-1e-8)||!real(c.drop,0,1)||!real(c.eta,0,1)||!real(c.rhoScale,0,1)||!real(c.b,1e-8,1000)||!real(c.f,1e-8,1000)||!real(c.d,0,c.f)||c.d>=c.f||c.d>=c.b||!real(c.c,0,1000)||!STRESS.includes(c.stress)||!FAMILIES.includes(c.family))throw Error("Некорректные параметры расширенной модели");
 return c;
}
export function uniformGroups(B,n,c=BASE){return {groups:seq(B).map(()=>n),u:[0,1].map(x=>seq(B).map(g=>c.u[x][g%c.u[x].length])),rho:seq(B).map(g=>c.rho[g%c.rho.length])};}
const comb=(n,k)=>{if(k<0||k>n)return 0;let v=1;for(let i=1;i<=Math.min(k,n-k);i++)v=v*(n-i+1)/i;return v;};
const bin=(n,k,p)=>k<0||k>n?0:comb(n,k)*p**k*(1-p)**(n-k);
export function mixLaw(n,u,r){const q=seq(n+1).map(j=>(1-r)*bin(n,j,u));q[0]+=r*(1-u);q[n]+=r*u;return q.map(v=>v/sum(q));}
const geometryCache=new Map();
export function groupGeometry(n){
 if(!geometryCache.has(n)){const pairs=seq(n+1).flatMap(m=>seq(m+1).map(k=>[m,k])),H=pairs.map(([m,k])=>seq(n+1).map(j=>comb(j,k)*comb(n-j,m-k)/comb(n,m)));geometryCache.set(n,{n,pairs,H});}
 return geometryCache.get(n);
}
export function spaceSize(c){return c.groups.reduce((s,n)=>s*(n+1)*(n+2)/2,1);}
export function lawsExt(c){
 const nominal=c.u.map(row=>row.map((u,g)=>mixLaw(c.groups[g],u,c.rho[g]*c.rhoScale))),test=nominal.map(row=>row.map(a=>a.slice())),cal=nominal.map(row=>row.map(a=>a.slice()));
 if(c.stress==="drift")test[1][0]=mixLaw(c.groups[0],(1-c.eta)*c.u[1][0]+c.eta*.45,c.rho[0]*c.rhoScale);
 if(c.stress==="contamination")for(let x=0;x<2;x++)for(let g=0;g<c.groups.length;g++)cal[x][g]=cal[x][g].map((v,j)=>(1-c.eta)*v+c.eta*+(j===(x===0?c.groups[g]:0)));
 return {nominal,test,cal};
}
export function calibration(c,q,seed=c.seed){const r=random(seed);return q.map(row=>row.map(a=>multinomial(c.m,a,r)));}
export function l1Radius(c,n,M=c.m){return Math.min(2,Math.sqrt(2/M*Math.log((2**(n+1)-2)*2*c.groups.length/c.alpha)));}
export function boxRadiusExt(c,M=c.m){return Math.sqrt(Math.log(2*2*sum(c.groups.map(n=>n+1))/c.alpha)/(2*M));}
export function wasserRadius(c,M=c.m){return Math.min(1,Math.sqrt(Math.log(4*c.groups.length/c.alpha)/(2*M)));}
// W1 on normalized count j/n. Dual upper bound (conservative even at finite search precision).
export function wasserMax(h,p,r){
 if(r<=0)return dot(h,p);if(r>=1)return Math.max(...h);
 const n=h.length-1,range=Math.max(...h)-Math.min(...h);
 const dual=lambda=>{const d=lambda/n,left=h.slice(),right=h.slice();for(let i=1;i<h.length;i++)left[i]=Math.max(h[i],left[i-1]-d);for(let i=h.length-2;i>=0;i--)right[i]=Math.max(h[i],right[i+1]-d);return lambda*r+sum(p.map((a,i)=>a*Math.max(left[i],right[i])));};
 let l=0,u=n*range,best=Math.min(dual(l),dual(u));
 for(let k=0;k<40;k++){const a=(2*l+u)/3,b=(l+2*u)/3,fa=dual(a),fb=dual(b);best=Math.min(best,fa,fb);if(fa<fb)u=b;else l=a;}
 return Math.min(Math.max(...h),best+1e-13);
}
// Method-of-types radius for reverse KL D(q_hat || q). The dual follows
// from weighted AM-GM; any evaluated dual point gives a valid upper bound.
export function klRadius(c,n,M=c.m){return ((n+1)*Math.log(M+1)+Math.log(2*c.groups.length/c.alpha))/M;}
export function klMax(h,p,r){
 if(r<=0)return dot(h,p);
 const max=Math.max(...h),range=max-Math.min(...h);if(range===0)return max;
 const dual=nu=>nu-Math.exp(sum(p.map((v,i)=>v>0?v*Math.log(nu-h[i]):0))-r);
 let l=max+Math.max(1e-13,range*1e-13),u=max+2*range/Math.max(1e-12,-Math.expm1(-r)),best=max;
 for(let i=0;i<70;i++){const a=(2*l+u)/3,b=(l+2*u)/3,fa=dual(a),fb=dual(b);best=Math.min(best,fa,fb);if(fa<fb)u=b;else l=a;}
 return Math.min(max,best+1e-12);
}
export function momentRadius(c,M=c.m){return Math.sqrt(Math.log(8*c.groups.length/c.alpha)/(2*M));}
export function momentMax(h,p,r){
 const t=h.map((_,i)=>i/(h.length-1)),s=t.map(v=>v*v),a=dot(t,p),b=dot(s,p);
 const dual=(x,y)=>Math.max(...h.map((v,i)=>v-x*t[i]-y*s[i]))+x*a+y*b+r*(Math.abs(x)+Math.abs(y));
 let x=0,y=0,best=dual(0,0),step=Math.max(...h)-Math.min(...h);
 // Feasible dual upper estimates; no claim of exact LP optimum.
 for(let k=0;k<35&&step>1e-12;k++){let bx=x,by=y,old=best;for(const dx of [-step,0,step])for(const dy of [-step,0,step]){const v=dual(x+dx,y+dy);if(v<best){best=v;bx=x+dx;by=y+dy;}}x=bx;y=by;if(best===old)step/=2;}
 return Math.min(Math.max(...h),best+1e-12);
}
export function tables(c,counts,Ms=null){
 const G=c.groups.map(groupGeometry),B=c.groups.length;
 const sizes=Ms||[c.m,c.m];
 if(!Array.isArray(counts)||counts.length!==2||counts.some((row,x)=>!Array.isArray(row)||row.length!==B||row.some((a,g)=>!Array.isArray(a)||a.length!==c.groups[g]+1||a.some(v=>!Number.isSafeInteger(v)||v<0)||sum(a)!==sizes[x]||sizes[x]<1)))throw Error("Некорректные калибровочные счётчики");
 const hat=counts.map((row,x)=>row.map(a=>a.map(v=>v/sizes[x])));
 const r=(x,g)=>c.family==="l1"?l1Radius(c,c.groups[g],sizes[x]):c.family==="box"?boxRadiusExt(c,sizes[x]):c.family==="wasserstein"?wasserRadius(c,sizes[x]):c.family==="kl"?klRadius(c,c.groups[g],sizes[x]):momentRadius(c,sizes[x]);
 const fn=(h,p,x,g)=>c.family==="l1"?extrem(h,p,r(x,g)):c.family==="box"?boxExt(h,p,r(x,g)):c.family==="wasserstein"?wasserMax(h,p,r(x,g)):c.family==="kl"?klMax(h,p,r(x,g)):momentMax(h,p,r(x,g));
 const low=hat.map((row,x)=>row.map((p,g)=>G[g].H.map(h=>clamp(-fn(h.map(v=>-v),p,x,g),0,1))));
 const high=hat.map((row,x)=>row.map((p,g)=>G[g].H.map(h=>clamp(fn(h,p,x,g),0,1))));
 const tv=[0,1].map(x=>1-c.groups.reduce((v,n,g)=>v*(1-Math.min(1,c.family==="l1"?r(x,g)/2:c.family==="box"?(n+1)*r(x,g)/2:c.family==="wasserstein"?n*r(x,g):c.family==="kl"?Math.sqrt(r(x,g)/2):1)),1));
 return {G,hat,low,high,D:(1-c.prior)*tv[0]+c.prior*tv[1],radii:[0,1].map(x=>seq(B).map(g=>r(x,g)))};
}
function logprod(row,ix){let v=0;for(let g=0;g<ix.length;g++){const p=row[g][ix[g]];if(p<=0)return -Infinity;v+=Math.log(p);}return v;}
function posterior(a,b,fallback){if(a===-Infinity&&b===-Infinity)return fallback;if(a===-Infinity)return 0;if(b===-Infinity)return 1;const z=b-a;return z>700?0:z< -700?1:1/(1+Math.exp(z));}
export function point(c,T,ix){
 const l=Math.log(c.prior),r=Math.log1p(-c.prior),u0=r+logprod(T.high[0],ix),u1=l+logprod(T.high[1],ix);
 if(u0===-Infinity&&u1===-Infinity)return [0,1];
 if(u0===-Infinity)return [1,1];if(u1===-Infinity)return [0,0];
 return [posterior(l+logprod(T.low[1],ix),u0,0),posterior(u1,r+logprod(T.low[0],ix),1)];
}
export function select(c,lo,hi,method=6){
 const theta=c.f/(c.b+c.f-c.d),w0=c.b*hi,w1=c.f+(c.d-c.f)*lo;
 return method===6?(hi<theta&&w0<=c.c?0:lo>theta&&w1<=c.c?1:2):(Math.min(w0,w1)<=c.c?(w1<w0?1:0):2);
}
export const loss=(c,a,x)=>a===2?c.c:a===0?c.b*x:x?c.d:c.f;
export function transform(c,G,test=false){
 return G.map(({n,pairs,H})=>pairs.map(([m,k],i)=>seq(n+1).map(j=>{
  if(test&&c.stress==="mnar"){const pp=(1-c.drop)*(1-c.eta)+.35*c.eta,pn=(1-c.drop)*(1-c.eta)+.75*c.eta;return bin(j,k,pp)*bin(n-j,m-k,pn);}
  const hyper=H[i][j],biased=test&&c.stress==="biasedMask"?((1-c.eta)*hyper+c.eta*+(k===Math.min(m,j))):hyper;
  return bin(n,m,1-c.drop)*biased;
 })));
}
export function marginal(T,q){return q.map(row=>row.map((p,g)=>T[g].map(h=>dot(h,p))));}
const cdf=a=>{let s=0;return a.map(v=>s=clamp(s+v,0,1));};
export function draw(F,u){let a=0,b=F.length-1;while(a<b){const m=(a+b)>>1;if(u<F[m])b=m;else a=m+1;}return a;}
function coupled(q){const F=q.map(cdf),cuts=[...new Set([0,1,...F.flat()])].sort((a,b)=>a-b);return cuts.slice(1).map((b,i)=>({w:b-cuts[i],j:F.map(f=>draw(f,(b+cuts[i])/2))})).filter(a=>a.w>0);}
function indices(shape,i){const ix=new Array(shape.length);for(let g=shape.length-1;g>=0;g--){ix[g]=i%shape[g];i=Math.floor(i/shape[g]);}return ix;}
function prob(row,ix){return row.reduce((v,a,g)=>v*a[ix[g]],1);}
export function exactExt(raw,counts0=null){
 const c=validateExt(raw),size=spaceSize(c);if(size>300000)throw Error("Точное перечисление ограничено 300 000 конфигураций");
 const {nominal,test,cal}=lawsExt(c),counts=counts0||calibration(c,cal),B=tables(c,counts),T=transform(c,B.G,true),nomT=transform(c,B.G),f=marginal(T,test),fn=marginal(nomT,B.hat),cross=c.stress==="cross"?c.eta:0,cp=cross?test.map(coupled):null,shape=B.G.map(g=>g.pairs.length),maxLoss=Math.max(c.b,c.f,c.d,c.c);
 let mass=0,coverage=0,loss0=0,miss=0,false0=0,posteriorMass=0,width=0,violation=0,nomCoverage=0,nomLoss=0,identityGap=0;
 // First-order event-specific L1 certificate, with the general B remainder.
 const first=[0,1].map(()=>B.G.map(g=>new Float64Array(g.pairs.length)));
 for(let i=0;i<size;i++){
  const ix=indices(shape,i),[lo,hi]=point(c,B,ix);if(lo>hi+1e-12)throw Error("Инвертированный интервал");
  const a=select(c,lo,hi),p=[0,1].map(x=>{const base=prob(f[x],ix);return !cross?base:(1-cross)*base+cross*sum(cp[x].map(v=>v.w*T.reduce((p0,t,g)=>p0*t[ix[g]][v.j[g]],1)));});
  const z0=(1-c.prior)*p[0],z1=c.prior*p[1],z=z0+z1,v0=(1-c.prior)*prob(fn[0],ix),v1=c.prior*prob(fn[1],ix);
  mass+=z;loss0+=z0*loss(c,a,0)+z1*loss(c,a,1);nomLoss+=v0*loss(c,a,0)+v1*loss(c,a,1);
  if(a!==2){coverage+=z;nomCoverage+=v0+v1;if(a===0)miss+=z1;else false0+=z0;if(z>0&&(z0*loss(c,a,0)+z1*loss(c,a,1))/z>c.c+1e-12)violation+=z;
   if(c.family==="l1")for(let x=0;x<2;x++)for(let g=0;g<shape.length;g++){let v=1;for(let j=0;j<shape.length;j++)if(j!==g)v*=fn[x][j][ix[j]];first[x][g][ix[g]]+=v;}}
  if(z>0&&z1/z>=lo-1e-12&&z1/z<=hi+1e-12)posteriorMass+=z;
  width+=z*(hi-lo);
 }
 if(Math.abs(mass-1)>1e-8)throw Error("Нарушена нормировка тестового закона: "+mass);
 let lower=Math.max(0,nomCoverage-B.D),tight=lower;
 if(c.family==="l1"){
  let penalty=0;
  for(let x=0;x<2;x++){
   const e=B.radii[x],rem=Math.max(0,(e.reduce((a,v)=>a*(1+v),1)-1-sum(e))/2);
   let d=0;for(let g=0;g<c.groups.length;g++){const h=seq(c.groups[g]+1).map(j=>dot(first[x][g],nomT[g].map(row=>row[j])));d+=dot(h,B.hat[x][g])+extrem(h.map(v=>-v),B.hat[x][g],e[g]);}
   penalty+=(x?c.prior:1-c.prior)*(Math.max(0,d)+rem);
  }
  tight=Math.max(lower,nomCoverage-penalty,0);
 }
 if(c.stress==="nonexchangeable"||c.stress==="biasedMask")identityGap=c.eta*(1-nominal[0][0][0]-nominal[0][0].at(-1)); // first vs last agent, X=0
 const assumptionsValid=c.eta===0||c.stress==="none";
 return {version:EXT_VERSION,config:c,counts,size,coverage,loss:loss0,miss,false:false0,posteriorMass,width,violation,nomCoverage,nomLoss,lower,tight,upperRisk:Math.min(maxLoss,nomLoss+maxLoss*B.D),assumptionsValid,identityGap,radii:B.radii};
}
// Sampling only grouped observations, without constructing a joint space. Uniform delivery renders
// identity order immaterial except in the explicitly combined nonexchangeability/biased mask stress.
export function sampler(c,q,r){
 const F=q.map(row=>row.map(cdf));
 return ()=>{const x=+(r()<c.prior),shared=c.stress==="cross"&&r()<c.eta,u=shared?r():0;
  const full=[],ix=c.groups.map((n,g)=>{const j=draw(F[x][g],shared?u:r());full.push(j);let m=0,k=0;
   const biased=c.stress==="biasedMask"&&r()<c.eta;
   if(biased){for(let i=0;i<n;i++)m+=+(r()<1-c.drop);k=Math.min(j,m);}
   else for(let i=0;i<n;i++){const y=i<j,p=c.stress==="mnar"?(1-c.drop)*(1-c.eta)+(y?.35:.75)*c.eta:1-c.drop;if(r()<p){m++;k+=+y;}}
   return m*(m+1)/2+k;
  });return {x,ix,full};
 };
}
export function simulateExt(raw,N,seed,counts0=null){
 const c=validateExt(raw);if(!Number.isInteger(N)||N<1||N>200000||!Number.isInteger(seed)||seed<1||seed>4294967295||seed===c.seed)throw Error("Некорректная тестовая выборка");
 const {test,cal}=lawsExt(c),counts=counts0||calibration(c,cal),T=tables(c,counts),next=sampler(c,test,random(seed)),hist=[[0,0,0],[0,0,0]];
 for(let i=0;i<N;i++){const {x,ix}=next(),a=select(c,...point(c,T,ix));hist[x][a]++;}
 const coverage=1-(hist[0][2]+hist[1][2])/N,miss=hist[1][0]/N,fp=hist[0][1]/N,L=c.b*miss+c.f*fp+c.d*hist[1][1]/N+c.c*(1-coverage);
 const h=Math.sqrt(Math.log(4/c.alpha)/(2*N)),maxLoss=Math.max(c.b,c.f,c.d,c.c);
 return {version:EXT_VERSION,config:c,counts,N,seed,hist,coverage,loss:L,miss,false:fp,coverageLow:clamp(coverage-h,0,1),coverageHigh:clamp(coverage+h,0,1),lossLow:clamp(L-maxLoss*h,0,maxLoss),lossHigh:clamp(L+maxLoss*h,0,maxLoss),size:spaceSize(c)};
}
