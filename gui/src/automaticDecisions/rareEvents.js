// E2.30: importance sampling of rare errors INSIDE each true class.
import {validateExt,lawsExt,calibration,tables,point,select,loss,sampler,seedFor,spaceSize,exactExt} from "./extendedModel.js";
import {random} from "./kernel.js";
const sum=a=>a.reduce((s,v)=>s+v,0),int=(v,a,b)=>Number.isInteger(v)&&v>=a&&v<=b,real=(v,a,b)=>Number.isFinite(v)&&v>=a&&v<=b;
export function validateRare(c){
 if(c.stress!=="none"||!int(c.mcN,1000,200000)||!real(c.mcAlpha,1e-6,.5)||!real(c.mcProposal,1e-5,1-1e-5)||!real(c.rareTilt,0,10)||!real(c.rareDefensive,.05,1)||typeof c.mcExact!=="boolean")throw Error("Редкие события: только номинальный закон, фиксированное N 1000–200000, корректные предложение и смесь");
 if(c.mcN*c.reps*3>6000000||c.mcN*c.reps*c.groups.reduce((s,n)=>s+n,0)>1e8)throw Error("Превышен бюджет имитации редких событий");
 if(c.mcExact&&spaceSize(c)>300000)throw Error("Точное сравнение ограничено 300000 наблюдений");
 return c;
}
export function tiltLaw(q,theta){
 if(!q.length||q.some(v=>!Number.isFinite(v)||v<0)||Math.abs(sum(q)-1)>1e-9||!Number.isFinite(theta)||Math.abs(theta)>10)throw Error("Некорректный закон наклона");
 const a=q.map((v,j)=>v*Math.exp(theta*j/Math.max(1,q.length-1))),z=sum(a);
 return a.map(v=>v/z);
}
export function mixtureWeight(c,q,tilted,row){
 const x=row.x,ratio=row.full.reduce((a,j,g)=>a*tilted[x][g][j]/q[x][g][j],1),wClass=x?c.prior/c.mcProposal:(1-c.prior)/(1-c.mcProposal);
 return wClass/(c.rareDefensive+(1-c.rareDefensive)*ratio);
}
export function rareStudy(raw,rep){
 const c=validateRare(validateExt(raw)),q=lawsExt(c).nominal,calSeed=seedFor(c.seed,96000+4*rep),counts=calibration(c,q,calSeed),T=tables(c,counts),tilted=q.map((row,x)=>row.map(a=>tiltLaw(a,x?-c.rareTilt:c.rareTilt))),seeds=[1,2,3].map(i=>seedFor(c.seed,96000+4*rep+i));
 const methods=["Обычная выборка","По классу","По классу и внутри класса"],Lmax=Math.max(c.b,c.f,c.d,c.c),keys=["coverage","loss","miss","false"],maxClass=Math.max(c.prior/c.mcProposal,(1-c.prior)/(1-c.mcProposal)),truth=c.mcExact?exactExt(c,counts):null,alpha=c.mcAlpha/(c.reps*methods.length*keys.length),N=c.mcN;
 const summary=methods.map((policy,k)=>{
  const r=random(seeds[k]),nom=sampler(k?{...c,prior:c.mcProposal}:c,q,r),alt=sampler({...c,prior:c.mcProposal},tilted,r),s=keys.map(()=>0),ss=keys.map(()=>0);
  let sw=0,sw2=0,maxW=0,missEvents=0,falseEvents=0;
  const bound=k===0?1:k===1?maxClass:maxClass/c.rareDefensive;
  for(let i=0;i<N;i++){
   const row=k===2&&r()>=c.rareDefensive?alt():nom(),a=select(c,...point(c,T,row.ix)),w=k===0?1:k===1?(row.x?c.prior/c.mcProposal:(1-c.prior)/(1-c.mcProposal)):mixtureWeight(c,q,tilted,row);
   if(!Number.isFinite(w)||w<=0||w>bound*(1+1e-10))throw Error("Нарушена граница веса");
   sw+=w;sw2+=w*w;maxW=Math.max(maxW,w);
   const v=[+(a!==2),loss(c,a,row.x),+(a===0&&row.x===1),+(a===1&&row.x===0)];
   missEvents+=v[2];falseEvents+=v[3];v.forEach((y,j)=>{s[j]+=w*y;ss[j]+=(w*y)**2;});
  }
  const out={policy,method:6,rep,N,ess:sw*sw/sw2,meanWeight:sw/N,maxWeight:maxW,weightBound:bound,missEvents,falseEvents,seed:seeds[k]};
  keys.forEach((name,j)=>{
   const m=s[j]/N,L=name==="loss"?Lmax:1,h=bound*L*Math.sqrt(Math.log(2/alpha)/(2*N)),variance=Math.max(0,(ss[j]-s[j]*s[j]/N)/(N-1));
   out[name]=m;out[name+"SE"]=Math.sqrt(variance/N);out[name+"Low"]=Math.min(L,Math.max(0,m-h));out[name+"High"]=Math.min(L,Math.max(0,m+h));
   if(truth)out["exact"+name[0].toUpperCase()+name.slice(1)]=truth[name];
  });
  return out;
 });
 return {summary,trace:[],counts,tilted,nominal:q,calSeed,seeds,alphaPerMetric:alpha,warning:"Фиксированная защитная смесь: вес вычисляется по полной латентной конфигурации, а не только наблюдаемой части. Оценки несмещённые, не самонормированные; могут выходить за физические пределы. SE описательная, интервалы Hoeffding одновременны по запланированным повторностям, методам и метрикам условно по калибровке. Наклон предложения не гарантирует уменьшения дисперсии."};
}
