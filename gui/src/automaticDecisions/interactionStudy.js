// E2.20. Exact finite-difference interaction of absolute intra-group correlation
// and independent delivery. Independent conditional groups; known law vs M6.
import {validateExt,spaceSize,mixLaw,groupGeometry,calibration,tables,point,select,loss,transform,marginal,seedFor} from "./extendedModel.js";
const sum=a=>a.reduce((s,v)=>s+v,0),seq=n=>Array.from({length:n},(_,i)=>i),clamp=(v,l,h)=>Math.max(l,Math.min(h,v));
export function countLaw(n,u,rho,family){
 if(!Number.isInteger(n)||n<1||n>50||!Number.isFinite(u)||u<0||u>1||!Number.isFinite(rho)||rho< -1||rho>1||!["shock","beta"].includes(family))throw Error("Некорректный условный закон");
 if(family==="beta"&&rho<0)throw Error("Бета-биномиальный закон не допускает отрицательную корреляцию");
 if(n===1||u===0||u===1)return mixLaw(n,u,0);
 if(rho<0){
  // Mix independent binomial with the minimum-variance count distribution.
  // Exchangeable Bernoulli correlation is determined by Var(J).
  const a=Math.floor(n*u),frac=n*u-a,minVar=frac*(1-frac),baseVar=n*u*(1-u),rhoMin=(minVar/baseVar-1)/(n-1);
  if(rho<rhoMin-1e-12||rhoMin>=0)throw Error("Отрицательная корреляция ниже допустимой для n,u: "+rhoMin);
  const t=clamp(rho/rhoMin,0,1),p=mixLaw(n,u,0).map(v=>(1-t)*v);p[a]+=t*(1-frac);p[a+1]+=t*frac;return p;
 }
 if(family==="shock"||rho===0||rho===1)return mixLaw(n,u,rho);
 const a=u*(1-rho)/rho,b=(1-u)*(1-rho)/rho,logs=[0];
 for(let j=0;j<n;j++)logs.push(logs[j]+Math.log(n-j)-Math.log(j+1)+Math.log(j+a)-Math.log(n-j-1+b));
 const max=Math.max(...logs),p=logs.map(v=>Math.exp(v-max)),z=sum(p);return p.map(v=>v/z);
}
export function lawAt(c,rho,family){return c.u.map(row=>row.map((u,g)=>countLaw(c.groups[g],u,rho,family)));}
export function validateInteraction(raw){
 const c=validateExt({...raw,stress:"none",eta:0});
 const real=(v,l,h)=>Number.isFinite(v)&&v>=l&&v<=h,int=(v,l,h)=>Number.isInteger(v)&&v>=l&&v<=h;
 if(!["shock","beta"].includes(c.interactionLaw)||!real(c.rhoFrom,-1,1)||!real(c.rhoTo,c.rhoFrom,1)||c.rhoTo===c.rhoFrom||!real(c.dropFrom,0,1)||!real(c.dropTo,c.dropFrom,1)||c.dropTo===c.dropFrom||!int(c.interactionLevels,2,15))throw Error("Некорректная сетка взаимодействия");
 // Correlation is absolute, not a multiplier. Check the lowest point first.
 lawAt(c,c.rhoFrom,c.interactionLaw);
 if(spaceSize(c)>300000||spaceSize(c)*c.interactionLevels**2*c.reps>25000000)throw Error("Сетка превышает 25 млн совместных наблюдений или 300000 на точку");
 return c;
}
export function interactionPlan(raw){
 const c=validateInteraction(raw),levels=seq(c.interactionLevels),rhos=levels.map(i=>c.rhoFrom+(c.rhoTo-c.rhoFrom)*i/(levels.length-1)),drops=levels.map(i=>c.dropFrom+(c.dropTo-c.dropFrom)*i/(levels.length-1));
 return seq(c.reps).flatMap(rep=>rhos.flatMap((rho,i)=>drops.map((drop,j)=>({kind:"interaction",rep,i,j,rho,drop}))));
}
export function interactionPoint(raw,unit){
 const c=validateExt({...raw,stress:"none",eta:0,drop:unit.drop}),q=lawAt(c,unit.rho,c.interactionLaw),seed=seedFor(c.seed,unit.rep),counts=calibration(c,q,seed),T=tables(c,counts),F=marginal(transform(c,T.G),q),shape=T.G.map(g=>g.pairs.length),size=spaceSize(c);
 if(size>300000)throw Error("Превышен размер точной задачи");
 let mass=0,lossM6=0,lossOracle=0,coverageM6=0,coverageOracle=0;
 for(let i=0;i<size;i++){
  let z=i;const ix=shape.map(()=>0);for(let g=shape.length-1;g>=0;g--){ix[g]=z%shape[g];z=Math.floor(z/shape[g]);}
  const p0=(1-c.prior)*F[0].reduce((a,v,g)=>a*v[ix[g]],1),p1=c.prior*F[1].reduce((a,v,g)=>a*v[ix[g]],1),p=p0+p1;
  mass+=p;if(!p)continue;
  const a=select(c,...point(c,T,ix)),risk=[c.b*p1,c.f*p0+c.d*p1,c.c*p],best=Math.min(...risk),b=risk.indexOf(best);
  lossM6+=p0*loss(c,a,0)+p1*loss(c,a,1);lossOracle+=best;if(a!==2)coverageM6+=p;if(b!==2)coverageOracle+=p;
 }
 if(Math.abs(mass-1)>1e-8||lossOracle>lossM6+1e-9)throw Error("Нарушена нормировка или нижняя граница Байеса");
 return {unit,seed,counts,size,lossM6,lossOracle,coverageM6,coverageOracle};
}
export function interactionSummary(records){
 const groups=new Map(),lookup=new Map(records.map(r=>[r.unit.rep+":"+r.unit.i+":"+r.unit.j,r]));
 const fields=["lossM6","lossOracle","coverageM6","coverageOracle"];
 for(const r of records){const {i,j,rep,rho,drop}=r.unit,key=i+":"+j;if(!groups.has(key))groups.set(key,{i,j,x:rho,y:drop,points:[],cells:[]});const v=groups.get(key);v.points.push(r);
  if(i&&j){const a=lookup.get(rep+":"+(i-1)+":"+(j-1)),b=lookup.get(rep+":"+(i-1)+":"+j),d=lookup.get(rep+":"+i+":"+(j-1));if(a&&b&&d)v.cells.push({rep,i,j,rho,drop,seed:r.seed,...Object.fromEntries(fields.map(k=>[k,r[k]-d[k]-b[k]+a[k]]))});}
 }
 const avg=(a,k)=>a.length?sum(a.map(v=>v[k]))/a.length:null,sign=a=>a>1e-10?"positive":a< -1e-10?"negative":"zero";
 const rows=[...groups.values()].map(v=>({x:v.x,y:v.y,reps:v.points.length,cellReps:v.cells.length,...Object.fromEntries(fields.map(k=>[k,avg(v.points,k)])),interactionM6:avg(v.cells,"lossM6"),interactionOracle:avg(v.cells,"lossOracle"),signM6:v.cells.length?sign(avg(v.cells,"lossM6")):null,signOracle:v.cells.length?sign(avg(v.cells,"lossOracle")):null,positiveM6:v.cells.filter(r=>sign(r.lossM6)==="positive").length,positiveOracle:v.cells.filter(r=>sign(r.lossOracle)==="positive").length}));
 return {rows,aux:[...groups.values()].flatMap(v=>v.cells)};
}
// Analytical sufficient condition: one group of 3, symmetric binary error e,
// equal error costs, prior 1/2, d=0 and escalation cost >=1/2.
// Bayes risk conditional on 1 or 2 delivered agents is e; for 3 it is
// (1-rho)*(3e^2-2e^3)+rho*e. No escalation needed.
export function symmetricThreeRisk(e,rho,delta){
 if(!(e>=0&&e<=.5&&rho>=0&&rho<=1&&delta>=0&&delta<=1))throw Error("Неверные параметры аналитической модели");
 return e+(.5-e)*delta**3-(1-rho)*(e-3*e**2+2*e**3)*(1-delta)**3;
}
