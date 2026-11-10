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
  const selected=(method==="trust_mean"||method==="trust_trimmed_mean"?admitted:live)
   .filter(i=>generated.messages[i].every(v=>v!==null)); // no invented coordinates
  const theta=st.theta[method]||Array(c.decision_dim).fill(0);
  const updates=selected.map(i=>clipNorm(generated.messages[i].map((x,k)=>x-theta[k]),c.update_norm_bound));
  const combined=combine(updates,method,c.trim_each_side);
  const estimate=combined.value?theta.map((v,k)=>v+c.global_step*combined.value[k]):null;
  if(estimate)st.theta[method]=estimate;
  output[method]={value:estimate,error:estimate?distance(estimate,generated.reference):null,
    selected:selected.length,trimFallback:combined.fallback};
 }
 return output;
}
