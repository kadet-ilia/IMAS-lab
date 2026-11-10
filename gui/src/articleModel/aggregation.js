import {mean,median,norm,distance} from "./common.js";
export const ARTICLE_METHODS=["arithmetic_mean","trust_mean","trimmed_mean","trust_trimmed_mean"];
/** (17): norm clipping of local update before any aggregation. */
export function clipNorm(vector,bound){const n=norm(vector);return n>bound?vector.map(x=>x*bound/n):[...vector];}
/** (18): coordinate-wise b-trimmed mean. Requires 2b<n, no silent clipping of b. */
export function trimmedMean(vectors,b){
 if(!vectors.length||2*b>=vectors.length)throw Error("Trim_b: 2b должно быть меньше числа участников");
 return vectors[0].map((_,k)=>{
  const ordered=vectors.map(v=>v[k]).sort((a,b)=>a-b);
  return mean(ordered.slice(b,ordered.length-b));
 });
}
const combine=(vectors,method,b)=>{
 if(!vectors.length)return {value:null,fallback:false};
 if(method==="trimmed_mean"||method==="trust_trimmed_mean"){
  if(2*b>=vectors.length)return {value:vectors[0].map((_,k)=>median(vectors.map(v=>v[k]))),fallback:true};
  return {value:trimmedMean(vectors,b),fallback:false};
 }
 return {value:vectors[0].map((_,k)=>mean(vectors.map(v=>v[k]))),fallback:false};
};
/** Four parallel aggregation methods with independent theta states. */
export function aggregateAll(st,c,generated,admitted){
 const live=st.alive(),output={};
 for(const method of ARTICLE_METHODS){
  const eligible=(method==="trust_mean"||method==="trust_trimmed_mean"?admitted:live);
  const theta=st.theta[method]||Array(c.decision_dim).fill(0);
  // Missing H_i coordinates are excluded from their coordinate's estimate.
  // Their zero contribution below is ONLY used in the norm of an observed update.
  const updates=eligible.map(i=>clipNorm(generated.messages[i].map((x,k)=>x===null?0:x-theta[k]),c.update_norm_bound));
  let fallback=false,observedCount=0;
  const estimate=theta.map((v,k)=>{
   const observed=eligible.map((i,n)=>generated.messages[i][k]===null?null:updates[n][k]).filter(x=>x!==null);
   if(!observed.length)return v;
   observedCount++;
   const part=combine(observed.map(x=>[x]),method,c.trim_each_side);
   fallback||=part.fallback;
   return v+c.global_step*part.value[0];
  });
  const value=observedCount?estimate:null;
  if(value)st.theta[method]=value;
  output[method]={value,error:value?distance(value,generated.reference):null,
    selected:eligible.length,observedCoordinates:observedCount,trimFallback:fallback};
 }
 return output;
}
