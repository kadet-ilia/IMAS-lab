/* E2 structural-probabilistic model; independent browser implementation. */
const kernel = (function kernel(){
 const VERSION="E2-article-20261126-v1";
 const DEFAULTS={groups:[9,7,5],u:[[.22,.13,.18],[.78,.87,.82]],rho:[.8,.45,.1],prior:.35,alpha:.05,m:20000,reps:30,seed:20261125,b:6,f:2,d:.6,c:1.25,target:.85,mode:"article",series:"fixed",scenario:3};
 const METHODS=[3,4,6,7,8,9,10,11];
 const SCENARIOS=["Независимые оценки","Зависимые оценки","Зависимость и неполнота","Изменение закона","Бета-биномиальный закон","Отрицательная зависимость","Межгрупповая зависимость","Информативные пропуски"];
 const sum=a=>a.reduce((s,x)=>s+x,0),dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0),clamp=(x,l,h)=>Math.max(l,Math.min(h,x)),seq=n=>Array.from({length:n},(_,i)=>i);
 const normalize=a=>{const s=sum(a);if(!(s>0)||a.some(x=>!Number.isFinite(x)||x<0))throw Error("Некорректный вероятностный закон");return a.map(x=>x/s);};
 const comb=(n,k)=>{if(k<0||k>n)return 0;let v=1;for(let i=1;i<=Math.min(k,n-k);i++)v=v*(n-i+1)/i;return v;};
 const bin=(n,k,u)=>k<0||k>n?0:comb(n,k)*u**k*(1-u)**(n-k);
 function mix(n,u,r){let q=seq(n+1).map(j=>(1-r)*bin(n,j,u));q[0]+=r*(1-u);q[n]+=r*u;return normalize(q);}
 function beta(n,u,r){if(r<=1e-8||u===0||u===1)return mix(n,u,0);if(r>=1-1e-8)return mix(n,u,1);const z=1/r-1,a=u*z,b=(1-u)*z;let q=[1];for(let j=0;j<n;j++)q.push(q[j]*(n-j)/(j+1)*(a+j)/(b+n-j-1));return normalize(q);}
 function neg(n,u){const z=n*u,j=Math.floor(z),q=seq(n+1).map(()=>0);q[j]=1-z+j;if(j<n)q[j+1]=z-j;return normalize(q);}
 function validate(raw={}){
  const c={...DEFAULTS,...raw};
  if(!["article","custom"].includes(c.mode)||!["fixed","matched","cost","validity","sensitivity","validation","control","all"].includes(c.series))throw Error("Неизвестный режим");
  const int=(v,l,h)=>Number.isInteger(v)&&v>=l&&v<=h, real=(v,l,h)=>Number.isFinite(v)&&v>=l&&v<=h;
  if(!Array.isArray(c.groups)||c.groups.length!==3||!c.groups.every(n=>int(n,2,30)))throw Error("Три группы по 2–30 агентов");
  if(c.groups.reduce((a,n)=>a*(n+1)*(n+2)/2,1)>300000)throw Error("Превышен предварительный предел точного перечисления 300000 конфигураций");
  if(!Array.isArray(c.u)||c.u.length!==2||c.u.some(a=>!Array.isArray(a)||a.length!==3||a.some(v=>!real(v,0,1)))||!Array.isArray(c.rho)||c.rho.length!==3||c.rho.some(v=>!real(v,0,1)))throw Error("Некорректные параметры групп");
  if(!int(c.m,1,1000000)||!int(c.reps,1,100)||!int(c.seed,1,4294967295)||!int(c.scenario,1,8)||!real(c.prior,1e-9,1-1e-9)||!real(c.alpha,1e-9,1-1e-9)||!real(c.target,0,1)||!real(c.b,1e-9,1000)||!real(c.f,1e-9,1000)||!real(c.d,0,c.f)||c.d===c.f||!real(c.c,0,1000))throw Error("Некорректные параметры вероятностей, потерь или калибровки");
  if(c.mode==="custom"&&c.series==="validation"&&![2,3,4,5].includes(c.scenario))throw Error("Валидационная серия предусмотрена для S2–S5");
  if(c.mode==="article")for(const k of ["groups","u","rho","prior","alpha","m","reps","seed","b","f","d","c","target"])if(JSON.stringify(c[k])!==JSON.stringify(DEFAULTS[k]))throw Error("Параметры статьи фиксированы: "+k);
  return c;
 }
 function laws(c,s){const q=c.u.map(row=>row.map((u,g)=>s===6?neg(c.groups[g],u):s===5?beta(c.groups[g],u,c.rho[g]):mix(c.groups[g],u,s===1?0:c.rho[g])));const test=q.map(row=>row.map(a=>a.slice()));if(s===4)test[1][0]=mix(c.groups[0],.45,.8);return {q,test};}
 function geometry(c){const pairs=c.groups.map(n=>seq(n+1).flatMap(m=>seq(m+1).map(k=>[m,k])));const H=pairs.map((p,g)=>p.map(([m,k])=>seq(c.groups[g]+1).map(j=>comb(j,k)*comb(c.groups[g]-j,m-k)/comb(c.groups[g],m))));const shape=pairs.map(p=>p.length),size=shape.reduce((a,b)=>a*b,1);return {pairs,H,shape,size};}
 function transforms(c,G,s,nom){return G.pairs.map((p,g)=>p.map(([m,k],i)=>seq(c.groups[g]+1).map(j=>s===8&&!nom?bin(j,k,.35)*bin(c.groups[g]-j,m-k,.75):G.H[g][i][j]*bin(c.groups[g],m,s<=2?.95:.6))));}
 function outer(v){const out=new Float64Array(v[0].length*v[1].length*v[2].length);let i=0;for(const a of v[0])for(const b of v[1])for(const c of v[2])out[i++]=a*b*c;return out;}
 const marg=(T,q)=>q.map((row)=>row.map((a,g)=>T[g].map(h=>dot(h,a))));
 function joint(c,G,q,s,nom=false){
  const T=transforms(c,G,s,nom),f=marg(T,q),P=f.map(outer);
  if(s===7&&!nom){for(let x=0;x<2;x++){
   const F=q[x].map(a=>{let v=0;return a.map(y=>clamp(v+=y,0,1));});
   const cuts=[...new Set([0,1,...F.flat()])].sort((a,b)=>a-b);
   const z=new Map();for(let i=1;i<cuts.length;i++){let a=cuts[i-1],b=cuts[i];if(b<=a)continue;let js=F.map((f,g)=>{const j=f.findIndex(v=>v>=(a+b)/2);return j<0?c.groups[g]:j;});const k=js.join(",");z.set(k,(z.get(k)||0)+b-a);}
   P[x]=P[x].map(v=>.8*v);
   for(const [key,w] of z){const js=key.split(",").map(Number),v=outer(T.map((t,g)=>t.map(h=>h[js[g]])));for(let i=0;i<G.size;i++)P[x][i]+=.2*w*v[i];}
  }}
  if(P.some(a=>Math.abs(sum(a)-1)>1e-10))throw Error("Нарушена нормировка совместного закона");
  return P;
 }
 const radius=(c,n,m)=>Math.min(2,Math.sqrt(2/m*Math.log((2**(n+1)-2)*6/c.alpha)));
 const boxRadius=(c,m)=>Math.sqrt(Math.log(2*sum(c.groups.map(n=>2*(n+1)))/c.alpha)/(2*m));
 function extrem(h,q,r){const a=q.slice(),o=seq(q.length).sort((i,j)=>h[i]-h[j]);let budget=r/2,i=0,j=o.length-1;while(i<j&&budget>1e-15){const l=o[i],k=o[j];if(h[k]<=h[l])break;const v=Math.min(a[l],1-a[k],budget);a[l]-=v;a[k]+=v;budget-=v;if(a[l]<1e-14)i++;if(a[k]>1-1e-14)j--;}return dot(h,a);}
 function boxExt(h,q,e){const p=q.map(v=>Math.max(0,v-e)),hi=q.map(v=>Math.min(1,v+e));let b=1-sum(p);for(const k of seq(q.length).sort((i,j)=>h[j]-h[i])){const v=Math.max(0,Math.min(b,hi[k]-p[k]));p[k]+=v;b-=v;}return dot(h,p);}
 function post(c,P){return P[0].map((v,i)=>{const a=c.prior*P[1][i],d=(1-c.prior)*v+a;return d>0?a/d:c.prior;});}
 function bounds(c,G,q,m,box=false){
  const e=boxRadius(c,m),fn=(h,a,g)=>box?boxExt(h,a,e):extrem(h,a,radius(c,c.groups[g],m));
  const low=q.map(row=>outer(row.map((a,g)=>G.H[g].map(h=>Math.max(0,-fn(h.map(v=>-v),a,g))))));
  const hi=q.map(row=>outer(row.map((a,g)=>G.H[g].map(h=>Math.max(0,fn(h,a,g))))));
  const l=low[1].map((v,i)=>{const a=c.prior*v,b=(1-c.prior)*hi[0][i];return a+b>0?a/(a+b):0;});
  const u=hi[1].map((v,i)=>{const a=c.prior*v,b=(1-c.prior)*low[0][i];return a+b>0?a/(a+b):1;});
  return [l,u];
 }
 const theta=c=>c.f/(c.b+c.f-c.d);
 const score=(c,p)=>Math.min(c.b*p,c.f+(c.d-c.f)*p);
 function decisions(c,l,u,cost=c.c,strict=true){const a=new Uint8Array(l.length),th=theta(c);for(let i=0;i<l.length;i++){const w0=c.b*u[i],w1=c.f+(c.d-c.f)*l[i];a[i]=strict?(u[i]<th&&w0<=cost?0:l[i]>th&&w1<=cost?1:2):Math.min(w0,w1)<=cost?(w1<w0?1:0):2;}return a;}
 function masses(c,P){return P[0].map((p,i)=>(1-c.prior)*p+c.prior*P[1][i]);}
 function metrics(c,P,a,cost=c.c,acc=null){let cov=0,miss=0,fp=0,tp=0;for(let i=0;i<a.length;i++){const keep=acc?acc[i]:+(a[i]!==2),p0=(1-c.prior)*P[0][i]*keep,p1=c.prior*P[1][i]*keep;cov+=p0+p1;if(a[i]===0)miss+=p1;if(a[i]===1){fp+=p0;tp+=p1;}}cov=clamp(cov,0,1);return {coverage:cov,loss:c.b*miss+c.f*fp+c.d*tp+cost*(1-cov),miss,false:fp};}
 function match(c,p,z,target){const v=p.map(a=>Math.round(score(c,a)*1e12)/1e12),o=seq(v.length).sort((a,b)=>v[a]-v[b]);let mass=0,i=0;while(i<o.length-1&&mass+z[o[i]]<target)mass+=z[o[i++]];const cut=v[o[i]];let less=0,tie=0;for(let j=0;j<v.length;j++){if(v[j]<cut)less+=z[j];else if(v[j]===cut)tie+=z[j];}const frac=clamp((target-less)/Math.max(tie,1e-300),0,1);return v.map(a=>a<cut?1:a===cut?frac:0);}
 function estimate(c,q,type){return q.map(row=>row.map((p,g)=>{const n=c.groups[g],j=seq(n+1),u=clamp(dot(j,p)/n,1e-9,1-1e-9),r=(dot(j.map(k=>k*(k-1)),p)/(n*(n-1))-u*u)/(u*(1-u));return type===3?mix(n,dot(j,p)/n,0):type===8?beta(n,u,clamp(r,0,.999999)):mix(n,u,clamp(r,0,1));}));}
 function cert(c,G,q,a,s,m){const T=transforms(c,G,s,true),F=marg(T,q),P=F.map(outer),nominal=metrics(c,P,a).coverage,e=c.groups.map(n=>radius(c,n,m)),D=1-e.reduce((a,v)=>a*(1-v/2),1),rem=(e[0]*e[1]+e[0]*e[2]+e[1]*e[2]+e[0]*e[1]*e[2])/2;let d=0;
  for(let x=0;x<2;x++){const f=F[x],h=G.shape.map(n=>new Float64Array(n));let i=0;for(let j=0;j<G.shape[0];j++)for(let k=0;k<G.shape[1];k++)for(let l=0;l<G.shape[2];l++,i++)if(a[i]!==2){h[0][j]+=f[1][k]*f[2][l];h[1][k]+=f[0][j]*f[2][l];h[2][l]+=f[0][j]*f[1][k];}
   for(let g=0;g<3;g++){const v=seq(c.groups[g]+1).map(j=>dot(h[g],T[g].map(row=>row[j])));d+=(x===1?c.prior:1-c.prior)*(dot(v,q[x][g])+extrem(v.map(y=>-y),q[x][g],e[g]));}}
  return {nominal,lower:Math.max(0,nominal-D),lower_tight:Math.max(0,nominal-D,nominal-d-rem)};
 }
 function random(seed){let a=seed>>>0||1;return ()=>{a^=a<<13;a^=a>>>17;a^=a<<5;return (a>>>0)/4294967296;};}
 function multinomial(n,p,r){let out=new Array(p.length).fill(0),t=0;const F=p.map(v=>t+=v);for(let k=0;k<n;k++){let l=0,h=p.length-1,u=r();while(l<h){const m=(l+h)>>1;if(u<F[m])h=m;else l=m+1;}out[l]++;}return out;}
 function validateCounts(c,counts,m){if(!Array.isArray(counts)||counts.length!==2||counts.some(row=>!Array.isArray(row)||row.length!==3||row.some((a,g)=>!Array.isArray(a)||a.length!==c.groups[g]+1||a.some(v=>!Number.isSafeInteger(v)||v<0)||sum(a)!==m)))throw Error("Некорректные первичные частоты");return counts.map(row=>row.map(a=>a.map(v=>v/m)));}
 function fixtureRecord(f,s,rep,m,series){return f?.records?.find(a=>a.s===s&&a.rep===rep&&a.m===m&&Boolean(a.sensitivity)===(series==="sensitivity"));}
 function units(c){const ss=c.mode==="article"?seq(8).map(i=>i+1):[c.scenario],o=[];if(c.series==="sensitivity"||c.series==="all")for(const m of [500,2000,5000,20000,100000])for(let rep=0;rep<c.reps;rep++)o.push({s:3,rep,m,series:"sensitivity"});if(c.series!=="sensitivity"){let scen=c.series==="cost"?[3]:c.series==="validation"?ss.filter(s=>[2,3,4,5].includes(s)):c.series==="control"?ss: ss;for(const s of scen)for(let rep=0;rep<(c.series==="control"?1:c.reps);rep++)o.push({s,rep,m:c.m,series:c.series==="all"?"all":c.series});}return o;}
 function compute(raw,unit,fixture=null,prepared=null){
  const c=validate(raw),{s,rep,m,series}=unit,G=prepared?.G||geometry(c),{q,test}=laws(c,s),P=prepared?.P||joint(c,G,test,s),ptrue=post(c,P),z=masses(c,P);
  const fr=fixtureRecord(fixture,s,rep,m,series);
  if(c.mode==="article"&&!fr)throw Error("Не найдены первичные частоты NumPy: S"+s+", повтор "+rep+", M="+m);
  const r=random((c.seed^Math.imul(s,0x9e3779b9)^Math.imul(rep+1,0x85ebca6b)^Math.imul(m,0xc2b2ae35))>>>0);
  const counts=fr?.counts||q.map(row=>row.map(a=>multinomial(m,a,r))),hat=validateCounts(c,counts,m);
  const [lo,hi]=bounds(c,G,hat,m),[blo,bhi]=bounds(c,G,hat,m,true),Pnom=joint(c,G,hat,s,true);
  const pm={3:post(c,joint(c,G,estimate(c,hat,3),s,true)),4:post(c,Pnom),8:post(c,joint(c,G,estimate(c,hat,8),s,true)),10:ptrue,11:post(c,joint(c,G,estimate(c,hat,11),s,true))};
  const aa=Object.fromEntries(Object.entries(pm).map(([j,p])=>[j,decisions(c,p,p)]));aa[6]=decisions(c,lo,hi);aa[7]=decisions(c,lo,hi,c.c,false);aa[9]=decisions(c,blo,bhi);
  const record=(method,a,cost=c.c,acc=null)=>({scenario:s,rep,method,...metrics(c,P,a,cost,acc)});
  const met=record(6,aa[6]),certificate=cert(c,G,hat,aa[6],s,m);
  let posterior_mass=0,width=0,risk_violation_mass=0;for(let i=0;i<G.size;i++){if(lo[i]>hi[i]+1e-12)throw Error("Инвертирован интервал");if(ptrue[i]>=lo[i]-1e-12&&ptrue[i]<=hi[i]+1e-12)posterior_mass+=z[i];width+=z[i]*(hi[i]-lo[i]);if(aa[6][i]!==2&&(aa[6][i]===0?c.b*ptrue[i]:c.f+(c.d-c.f)*ptrue[i])>c.c+1e-12)risk_violation_mass+=z[i];}
  const calibration_included=+(q.every((row,x)=>row.every((a,g)=>sum(a.map((v,i)=>Math.abs(v-hat[x][g][i])))<=radius(c,c.groups[g],m))));
  const valid={scenario:s,rep,posterior_mass,width,...certificate,coverage:met.coverage,risk_violation_mass,calibration_included,assumptionsValid:![4,7,8].includes(s)};
  if(c.c<c.b*theta(c)&&aa[6].some((v,i)=>v!==aa[7][i]))throw Error("Нарушено совпадение M6/M7");
  if(certificate.lower>certificate.lower_tight+1e-12||certificate.lower_tight>certificate.nominal+1e-12)throw Error("Некорректные границы автоматизации");
  const result={unit,counts,rows:{},sample:null};
  if(["fixed","all","control"].includes(series))result.rows.fixed=METHODS.map(j=>record(j,aa[j]));
  if(["matched","all"].includes(series))result.rows.matched=[...Object.entries(pm).map(([j,p])=>record(+j,p.map(v=>+(v>theta(c))),c.c,match(c,p,z,met.coverage))),met].sort((a,b)=>a.method-b.method);
  if(["validity","fixed","all","control"].includes(series))result.rows.validity=[valid];
  if(series==="sensitivity")result.rows.sensitivity=[{n:m,rep,width,...metrics(c,P,aa[6]),lower:certificate.lower,lower_tight:certificate.lower_tight}];
  if((series==="cost"||series==="all")&&s===3){result.rows.cost=[];for(const cost of [.75,1,1.25,1.5,c.b*theta(c),1.75,2,2.5])for(const j of [6,7]){const a=decisions(c,lo,hi,cost,j===6);let cross=0;for(let i=0;i<G.size;i++)if(a[i]!==2&&lo[i]<=theta(c)&&hi[i]>=theta(c))cross+=z[i];result.rows.cost.push({cost,rep,method:j,...metrics(c,P,a,cost),crossing_coverage:cross});}}
  if((series==="validation"||series==="all")&&[2,3,4,5].includes(s)){
   const vr=random((20270000+s*100+rep+c.seed-DEFAULTS.seed)>>>0),vcount=fr?.validation;
   let v;
   if(vcount){v=new Float64Array(G.size);let n=0;for(const [i,count] of vcount){if(!Number.isInteger(i)||i<0||i>=G.size||!Number.isSafeInteger(count)||count<0||v[i]!==0)throw Error("Некорректная валидационная выборка");v[i]=count;n+=count;}if(n!==m)throw Error("Неверный объём валидации");v=v.map(a=>a/m);}
   else {if(c.mode==="article")throw Error("Отсутствует эталонная валидационная выборка");v=Float64Array.from(multinomial(m,masses(c,joint(c,G,q,s,true)),vr),a=>a/m);}
   const target=dot(v,aa[6].map(x=>+(x!==2)));
   result.rows.validation=[...[3,4,8,11].map(j=>record(j,pm[j].map(p=>+(p>theta(c))),c.c,match(c,pm[j],v,target))),met];result.validation= vcount||Array.from(v.entries()).filter(([,a])=>a>0).map(([i,a])=>[i,Math.round(a*m)]);
  }
  // A real enumerated observation, not an invented time series.
  let idx=0;for(let i=1;i<z.length;i++)if(z[i]>z[idx])idx=i;
  const ix=[Math.floor(idx/(G.shape[1]*G.shape[2])),Math.floor(idx/G.shape[2])%G.shape[1],idx%G.shape[2]];
  result.sample={pairs:ix.map((i,g)=>G.pairs[g][i]),lo:lo[idx],hi:hi[idx],action:aa[6][idx],risk0:c.b*hi[idx],risk1:c.f+(c.d-c.f)*lo[idx],mass:z[idx],scenario:s,rep};
  if(series==="control"){
   const size=100000,rg=random((20262125+s+c.seed-DEFAULTS.seed)>>>0);let coverage=0,loss=0,sq=0;for(let k=0;k<size;k++){const x=+(rg()<c.prior);let ix=0;for(let g=0;g<3;g++){const n=c.groups[g],u=s===4&&x===1&&g===0?.45:c.u[x][g],rho=s===1?0:s===4&&x===1&&g===0?.8:c.rho[g],common=rg()<rho,shared=rg()<u;let m0=0,k0=0;for(let i=0;i<n;i++){const y=common?shared:rg()<u;if(rg()<(s<=2?.95:.6)){m0++;k0+=+y;}}ix=ix*G.shape[g]+m0*(m0+1)/2+k0;}if(s>4)break;const a=aa[6][ix],L=a===2?c.c:a===0?c.b*x:x?c.d:c.f;coverage+=+(a!==2);loss+=L;sq+=L*L;}
   if(s<=4)result.rows.monte_carlo=[{scenario:s,exact_coverage:met.coverage,mc_coverage:coverage/size,exact_loss:met.loss,mc_loss:loss/size,se:Math.sqrt(Math.max(0,(sq-loss*loss/size)/(size-1))/size),size}];
   result.rows.certificate_checks=[];let sampled_min_coverage=1;const rg2=random(91822+s);for(let k=0;k<100;k++){const qq=hat.map(row=>row.map((p,g)=>{const v=normalize(p.map(()=>-Math.log(Math.max(1e-15,rg2())))),f=rg2()*Math.min(1,radius(c,c.groups[g],m)/Math.max(1e-15,sum(p.map((a,i)=>Math.abs(a-v[i])))));return p.map((a,i)=>a+f*(v[i]-a));}));sampled_min_coverage=Math.min(sampled_min_coverage,metrics(c,joint(c,G,qq,s,true),aa[6]).coverage);}
   if(sampled_min_coverage+1e-12<certificate.lower_tight)throw Error("Выборочная проверка сертификата не пройдена");
   result.rows.certificate_checks.push({scenario:s,lower:certificate.lower,lower_tight:certificate.lower_tight,sampled_min_coverage,box_lp_error:null});
  }
  return result;
 }
 function aggregate(rows,keys){const map=new Map();for(const row of rows){const key=JSON.stringify(keys.map(k=>row[k]));if(!map.has(key))map.set(key,{first:row,count:0,sums:{}});const a=map.get(key);a.count++;for(const [k,v] of Object.entries(row))if(!keys.includes(k)&&k!=="rep"&&typeof v==="number")a.sums[k]=(a.sums[k]||0)+v;}return [...map.values()].map(a=>({...Object.fromEntries(keys.map(k=>[k,a.first[k]])),...Object.fromEntries(Object.entries(a.sums).map(([k,v])=>[k,v/a.count])),...(a.first.assumptionsValid===undefined?{}:{assumptionsValid:a.first.assumptionsValid}),reps:a.count}));}
 return {VERSION,DEFAULTS,METHODS,SCENARIOS,validate,laws,geometry,transforms,joint,radius,boxRadius,extrem,boxExt,bounds,post,theta,decisions,metrics,masses,match,cert,random,multinomial,units,compute,aggregate};
})();
export const {VERSION,DEFAULTS,METHODS,SCENARIOS,validate,laws,geometry,transforms,joint,radius,boxRadius,extrem,boxExt,bounds,post,theta,decisions,metrics,masses,match,cert,random,multinomial,units,compute,aggregate}=kernel;
