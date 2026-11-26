// Simplex intersected with unequal component bounds. Greedy linear extrema.
const sum=a=>a.reduce((s,v)=>s+v,0);
export function simplexMax(h,lo,hi){
 if(h.length!==lo.length||h.length!==hi.length||lo.some((v,i)=>!Number.isFinite(v)||v<0||v>hi[i]||hi[i]>1)||sum(lo)>1+1e-10||sum(hi)<1-1e-10)throw Error("Пустое или некорректное множество вероятностей");
 let rest=Math.max(0,1-sum(lo)),value=sum(h.map((v,i)=>v*lo[i]));
 for(const i of h.map((_,i)=>i).sort((a,b)=>h[b]-h[a])){const d=Math.min(rest,hi[i]-lo[i]);value+=d*h[i];rest-=d;if(rest<=1e-15)break;}
 if(rest>1e-10)throw Error("Нарушена нормировка симплекса");
 return value;
}
export function boundedTables(G,hat,lower,upper){
 const clamp=v=>Math.min(1,Math.max(0,v));
 return {G,hat,low:lower.map((row,x)=>row.map((p,g)=>G[g].H.map(h=>clamp(-simplexMax(h.map(v=>-v),p,upper[x][g]))))),high:upper.map((row,x)=>row.map((p,g)=>G[g].H.map(h=>clamp(simplexMax(h,lower[x][g],p))))),lower,upper};
}
export function predictiveTables(G,hat){
 const p=hat.map(row=>row.map((a,g)=>G[g].H.map(h=>sum(h.map((v,j)=>v*a[j])))));
 return {G,hat,low:p,high:p};
}
