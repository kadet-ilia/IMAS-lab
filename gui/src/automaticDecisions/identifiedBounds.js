// E2.22: sensitivity model for full delivery S, conditional on X.
// odds(P(S=1|J=j,X))/odds(P(S=1|X)) in [1/Gamma,Gamma].
// Outer component bounds; not a point identification or exact joint set.
const sum=a=>a.reduce((s,v)=>s+v,0),clip=v=>Math.max(0,Math.min(1,v));
export function identifiedBounds(completion,N,h,gamma){
 if(!Number.isSafeInteger(N)||N<1||!Number.isFinite(h)||h<0||!Number.isFinite(gamma)||gamma<1||gamma>10000)throw Error("Некорректные параметры частичной идентификации");
 const full=sum(completion.forced),p=full/N,pLow=clip(p-h),pHigh=clip(p+h);
 const sLow=pLow/(pLow+gamma*(1-pLow)),sHigh=gamma*pHigh/(1-pHigh+gamma*pHigh);
 const lower=completion.lower.map((v,j)=>Math.max(v,sHigh>0?clip(Math.max(0,completion.forced[j]/N-h)/sHigh):0));
 const upper=completion.upper.map((v,j)=>Math.min(v,sLow>0?clip(Math.min(1,completion.forced[j]/N+h)/sLow):1));
 // The intersection is tested for feasibility on the simplex. If empty,
 // no repair by projecting into an unsupported model: retain completion bounds.
 const compatible=lower.every((v,j)=>v<=upper[j])&&sum(lower)<=1&&sum(upper)>=1;
 const l=compatible?lower:completion.lower.slice(),u=compatible?upper:completion.upper.slice();
 return {lower:l,upper:u,compatible,gamma,fullRate:p,fullRateLow:pLow,fullRateHigh:pHigh,selectionLow:sLow,selectionHigh:sHigh,widthBefore:sum(completion.upper.map((v,j)=>v-completion.lower[j])),widthAfter:sum(u.map((v,j)=>v-l[j]))};
}
