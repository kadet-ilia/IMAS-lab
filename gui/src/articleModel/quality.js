import {rng,clamp,median,norm,indices} from "./common.js";
/** (8): q_ij=beta1*c_ij+beta2*s_ij+beta3*g_ij, or explicit synthetic evidence. */
export function interactionQuality(st,step,c,generated){
 const n=c.n_agents,{messages,attackActive}=generated,q=Array.from({length:n},()=>Array(n).fill(null));
 for(let i=0;i<n;i++)if(!st.isolated[i])for(let j=0;j<n;j++){
  if(i===j||st.isolated[j])continue;
  const observed=messages[j].map((v,k)=>v===null?null:k).filter(k=>k!==null);
  if(!observed.length)continue;
  if(attackActive&&st.bad.has(i)&&c.manipulate_reputation){
   q[i][j]=st.bad.has(j)?1:c.reputation_low;continue;
  }
  if(c.quality_mode==="synthetic"){
   const mu=attackActive&&st.bad.has(j)?(c.attack_scenario==="mask"?c.mask_quality:c.byzantine_quality):c.honest_quality;
   q[i][j]=clamp(mu+c.quality_sigma*rng(c.seed,st.run,"quality",step,i,j).normal());continue;
  }
  const common=observed.filter(k=>indices(n).some(m=>m!==j&&m!==i&&!st.isolated[m]&&messages[m][k]!==null));
  if(!common.length)continue;
  const discrepancies=common.map(k=>{
   const others=indices(n).filter(m=>m!==j&&m!==i&&!st.isolated[m]&&messages[m][k]!==null).map(m=>messages[m][k]);
   return messages[j][k]-median(others);
  });
  const consistency=1-Math.min(1,norm(discrepancies)/c.consistency_scale);
  const previous=st.previousMessages?.[j];
  const diffs=previous?common.filter(k=>previous[k]!==null).map(k=>messages[j][k]-previous[k]):[];
  const stability=diffs.length?1-Math.min(1,norm(diffs)/c.stability_scale):1;
  // All identities in this synthetic experiment possess valid signatures.
  const authenticity=1;
  q[i][j]=clamp(c.quality_weights[0]*consistency+c.quality_weights[1]*stability+c.quality_weights[2]*authenticity);
 }
 return q;
}
