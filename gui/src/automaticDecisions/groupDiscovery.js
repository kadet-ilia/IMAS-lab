// E2.11: conditional mutual information on discovery data only.
// Cluster partition is frozen before a separate calibration and test.
const seq=n=>Array.from({length:n},(_,i)=>i),sum=a=>a.reduce((s,v)=>s+v,0);
export function conditionalGraph(rows,N){
 if(!Number.isInteger(N)||N<2||N>100||rows.length*N*(N-1)/2>50000000)throw Error("Поиск групп: 2–100 агентов, максимум 50 млн парных операций на выборку");
 const hist=Array.from({length:N},()=>Array.from({length:N},()=>[0,0,0,0,0,0,0,0])),classes=[0,0];
 for(const row of rows){const a=row.agents.flat();if(a.length!==N||a.some(v=>v!==0&&v!==1)||![0,1].includes(row.x))throw Error("Для выявления групп требуются полные размеченные наблюдения");classes[row.x]++;for(let i=0;i<N;i++)for(let j=i+1;j<N;j++)hist[i][j][4*row.x+2*a[i]+a[j]]++;}
 if(classes.some(n=>n<2))throw Error("Для выявления групп нужно не менее двух строк каждого класса");
 const edges=[];
 for(let i=0;i<N;i++)for(let j=i+1;j<N;j++){
  const counts=hist[i][j],perClass=classes.map((n,x)=>{const h=counts.slice(4*x,4*x+4);let v=0;for(let a=0;a<2;a++)for(let b=0;b<2;b++){const k=h[2*a+b];if(k>0){const r=h[2*a]+h[2*a+1],c=h[b]+h[b+2];v+=k/n*Math.log2(k*n/(r*c));}}return Math.max(0,v);});
  edges.push({i,j,cmi:sum(perClass.map((v,x)=>v*classes[x]/rows.length)),x0:perClass[0],x1:perClass[1]});
 }
 return {N,classes,edges};
}
export function partitionGraph(graph,threshold,method="complete",maxSize=50){
 if(!Number.isFinite(threshold)||threshold<=0||threshold>1||!["complete","components"].includes(method)||!Number.isInteger(maxSize)||maxSize<1||maxSize>50)throw Error("Неверные параметры группировки");
 const weights=Array.from({length:graph.N},()=>Array(graph.N).fill(0));
 for(const e of graph.edges){weights[e.i][e.j]=e.cmi;weights[e.j][e.i]=e.cmi;}
 const groups=seq(graph.N).map(i=>[i]);
 for(;;){let best=-1,p=-1,q=-1;
  for(let i=0;i<groups.length;i++)for(let j=i+1;j<groups.length;j++){
   if(method==="complete"&&groups[i].length+groups[j].length>maxSize)continue;
   const scores=groups[i].flatMap(a=>groups[j].map(b=>weights[a][b])),score=method==="complete"?Math.min(...scores):Math.max(...scores);
   if(score>=threshold&&score>best){best=score;p=i;q=j;}
  }
  if(p<0)break;
  groups[p]=[...groups[p],...groups[q]].sort((a,b)=>a-b);groups.splice(q,1);
 }
 return groups.sort((a,b)=>a[0]-b[0]);
}
export function residual(graph,groups){
 const by=new Map();groups.forEach((g,i)=>g.forEach(a=>by.set(a,i)));
 if(by.size!==graph.N)throw Error("Неполное разбиение");
 const between=graph.edges.filter(e=>by.get(e.i)!==by.get(e.j)),within=graph.edges.filter(e=>by.get(e.i)===by.get(e.j));
 const mean=a=>a.length?sum(a.map(v=>v.cmi))/a.length:null;
 return {groups:groups.length,meanWithin:mean(within),meanBetween:mean(between),maxBetween:between.length?Math.max(...between.map(e=>e.cmi)):null,betweenPairs:between.length,withinPairs:within.length};
}
export function originalPartition(sizes){let offset=0;return sizes.map(n=>{const v=seq(n).map(i=>i+offset);offset+=n;return v;});}
export function remapRows(rows,groups){return rows.map(row=>{const a=row.agents.flat();return {...row,agents:groups.map(g=>g.map(i=>a[i]))};});}
export function discoverGrouping(discovery,calibration,sizes,config){
 const N=sum(sizes),graph=conditionalGraph(discovery,N),holdout=conditionalGraph(calibration,N),original=originalPartition(sizes),groups=partitionGraph(graph,config.groupThreshold,config.groupMethod,config.groupMaxSize);
 const valid=groups.length<=20&&groups.every(g=>g.length<=50);
 return {method:config.groupMethod,threshold:config.groupThreshold,maxSize:config.groupMaxSize,groups,original,graph,holdout,valid,diagnostics:[{partition:"Исходная",...residual(holdout,original)},{partition:"Выявленная",...residual(holdout,groups)}],warning:"Эмпирическая попарная условная взаимная информация, оцененная по отдельной выборке; порог не является проверкой гипотезы о независимости. Многомерные зависимости и обменность требуют отдельной проверки."};
}
