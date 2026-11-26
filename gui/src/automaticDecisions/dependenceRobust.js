// E2.21: TV residual dependence around the product of true marginal laws.
// Exact extrema on a joint TV outer ball for small problems; product envelope
// for large ones. Intersection of outer interval bounds is conservative.
import {validateExt,spaceSize,groupGeometry,lawsExt,calibration,tables,transform,marginal,select,loss,seedFor,draw,sampler} from "./extendedModel.js";
import {random,extrem} from "./kernel.js";
const sum=a=>a.reduce((s,v)=>s+v,0),prod=a=>a.reduce((s,v)=>s*v,1),clip=v=>Math.min(1,Math.max(0,v)),seq=n=>Array.from({length:n},(_,i)=>i);
function index(shape,i){const a=shape.map(()=>0);for(let g=shape.length-1;g>=0;g--){a[g]=i%shape[g];i=Math.floor(i/shape[g]);}return a;}
function posterior(c,l,u){const a=(1-c.prior)*u[0],b=c.prior*u[1],d=(1-c.prior)*l[0],e=c.prior*l[1];if(a===0&&b===0)return [0,1];if(!a)return [1,1];if(!b)return [0,0];return [e/(e+a),b/(b+d)];}
export function dependenceTables(c,counts,bound){
 if(!Number.isFinite(bound)||bound<0||bound>1)throw Error("Граница TV должна быть в [0,1]");
 const T=tables({...c,family:"l1"},counts),B=c.groups.length,shape=c.groups.map(n=>n+1),K=prod(shape);
 const residual=B===1?0:bound,rad=T.radii.map(a=>Math.min(1,residual+1-prod(a.map(v=>1-v/2))));
 const exact=K<=5000&&K*spaceSize(c)<=3000000;
 const states=exact?seq(K).map(i=>index(shape,i)):null,center=exact?T.hat.map(row=>states.map(ix=>prod(ix.map((j,g)=>row[g][j])))):null;
 const min=T.G.map(g=>g.H.map(h=>Math.min(...h))),max=T.G.map(g=>g.H.map(h=>Math.max(...h)));
 return {T,residual,rad,states,center,min,max,algorithm:exact?"joint_tv_outer":"product_envelope"};
}
export function dependencePoint(c,D,ix){
 const {T,residual,rad,states,center,min,max}=D,small=prod(ix.map((i,g)=>min[g][i])),big=prod(ix.map((i,g)=>max[g][i])),osc=big-small;
 const h=states?states.map(js=>prod(js.map((j,g)=>T.G[g].H[ix[g]][j]))):null,lo=[],hi=[];
 for(let x=0;x<2;x++){
  let a=Math.max(small,prod(ix.map((i,g)=>T.low[x][g][i]))-residual*osc),b=Math.min(big,prod(ix.map((i,g)=>T.high[x][g][i]))+residual*osc);
  if(h){a=Math.max(a,-extrem(h.map(v=>-v),center[x],2*rad[x]));b=Math.min(b,extrem(h,center[x],2*rad[x]));}
  // Round outward to absorb small floating-point errors, but preserve exact
  // constants (including all missing and impossible observations).
  if(osc===0){a=small;b=big;}else{a=Math.max(small,a-1e-13*osc);b=Math.min(big,b+1e-13*osc);}
  if(a>b+1e-10)throw Error("Несогласованные внешние границы");
  lo.push(Math.min(a,b));hi.push(Math.max(a,b));
 }
 return posterior(c,lo,hi);
}
function coupling(q){
 const F=q.map(a=>{let s=0;return a.map(v=>clip(s+=v));}),cuts=[...new Set([0,1,...F.flat()])].sort((a,b)=>a-b);
 return cuts.slice(1).map((b,i)=>({w:b-cuts[i],j:F.map(f=>draw(f,(b+cuts[i])/2))})).filter(v=>v.w>0);
}
export function validateDependence(c){
 if(c.family!=="l1")throw Error("E2.21 использует только L1 калибровку");
 if(!Number.isFinite(c.depBound)||c.depBound<0||c.depBound>1||!Number.isInteger(c.depN)||c.depN<1000||c.depN>50000)throw Error("Некорректные параметры TV или Монте-Карло");
 // Limit repeated kernel evaluations and common-shock support size.
 const work=Math.min(spaceSize(c),c.depN)*c.groups.reduce((s,n)=>s+n+1,0)*c.groups.length;
 if(work>150000000)throw Error("Слишком большой объём вычислений; уменьшите число групп или тестовую выборку");
 return c;
}
export function dependenceStudy(raw,unit){
 const c=validateDependence(validateExt({...raw,stress:"none",eta:0,seed:seedFor(raw.seed,unit.rep)})),eta=unit.x,q=lawsExt(c).nominal,counts=calibration(c,q),base=dependenceTables(c,counts,0),rob=dependenceTables(c,counts,c.depBound),G=base.T.G,T=transform(c,G),f=marginal(T,q),cp=q.map(coupling),shape=G.map(g=>g.pairs.length),size=spaceSize(c);
 if(!Number.isFinite(eta)||eta<0||eta>1)throw Error("Некорректная интенсивность стресса");
 const trueMass=(x,ix)=>{const a=prod(ix.map((i,g)=>f[x][g][i]));if(!eta)return a;return (1-eta)*a+eta*sum(cp[x].map(v=>v.w*prod(ix.map((i,g)=>T[g][i][v.j[g]]))));};
 // Exact integration for moderate support; independent test sample otherwise.
 // Selection of algorithm is deterministic and independent of observed outcomes.
 const exact=size<=300000&&size*c.groups.reduce((s,n)=>s+n+1,0)*c.groups.length<=150000000,metrics=[0,1].map(()=>({coverage:0,loss:0,miss:0,false:0,posteriorMass:0,width:0,violation:0,unsafePreference:0})),Ds=[base,rob];
 let mass=0;const testSeed=seedFor(c.seed,301001);
 function add(ix,p0,p1,weight,x=null){
  const z=p0+p1;if(z<=0)return;const p=p1/z;mass+=weight;
  Ds.forEach((D,i)=>{const [lo,hi]=dependencePoint(c,D,ix),a=select(c,lo,hi),m=metrics[i],l0=x===null?p0/z:+(x===0),l1=x===null?p1/z:+(x===1);
   m.loss+=weight*(l0*loss(c,a,0)+l1*loss(c,a,1));m.width+=weight*(hi-lo);
   if(p>=lo-1e-10&&p<=hi+1e-10)m.posteriorMass+=weight;
   if(a!==2){m.coverage+=weight;if(a===0)m.miss+=weight*l1;else m.false+=weight*l0;
    const r=(1-p)*loss(c,a,0)+p*loss(c,a,1);
    if(r>c.c+1e-10)m.violation+=weight;
    if(r>Math.min(c.b*p,c.f+(c.d-c.f)*p)+1e-10)m.unsafePreference+=weight;
   }
  });
 }
 if(exact){for(let i=0;i<size;i++){const ix=index(shape,i),p0=(1-c.prior)*trueMass(0,ix),p1=c.prior*trueMass(1,ix);add(ix,p0,p1,p0+p1);}}
 else{const next=sampler({...c,stress:"cross",eta},q,random(testSeed));for(let i=0;i<c.depN;i++){const {ix,x}=next();add(ix,(1-c.prior)*trueMass(0,ix),c.prior*trueMass(1,ix),1/c.depN,x);}}
 if(Math.abs(mass-1)>1e-7)throw Error("Нарушена нормировка тестовой меры");
 // eta is an upper bound on TV of the mixture, not the exact residual TV.
 const inScope=c.groups.length===1||eta<=c.depBound+1e-12;
 const summary=metrics.map((v,i)=>{const valid=c.groups.length===1||eta<=(i?c.depBound:0)+1e-12,h=exact?0:Math.sqrt(Math.log(4*7/c.alpha)/(2*c.depN)),L=Math.max(c.b,c.f,c.d,c.c);return {...v,policy:i?"M6 + TV зависимости":"M6 независимость",x:eta,rep:unit.rep,depBound:i?rob.residual:0,assumptionsValid:valid,algorithm:Ds[i].algorithm,evaluation:exact?"exact":"mc",N:exact?null:c.depN,coverageLow:clip(v.coverage-h),coverageHigh:clip(v.coverage+h),lossLow:Math.max(0,v.loss-L*h),lossHigh:Math.min(L,v.loss+L*h)};});
 return {unit,summary,counts,testSeed,scope:{inScope,assumedTV:rob.residual,actualTVUpper:c.groups.length===1?0:eta,outerRadii:rob.rad,latentSize:prod(c.groups.map(n=>n+1)),observationSize:size},warning:"TV-граница является внешним предположением, а не оценкой из данных. Точные экстремумы относятся к внешнему TV-шару, не к пересечению всех совместных маргинальных ограничений. MC-интервалы условны по калибровке; не являются одновременной гарантией по сетке."};
}
