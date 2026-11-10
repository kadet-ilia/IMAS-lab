import {clamp,median,indices} from "./common.js";
/** (9), (11)-(13): exponential direct trust; one-step weighted reputation; median. */
export function updateTrust(st,q,c){
 const n=c.n_agents,live=st.alive(),oldTau=[...st.tauPrev];
 for(const i of live)for(const j of live){
  if(i!==j&&q[i][j]!==null)st.D[i][j]=clamp(c.trust_memory*st.D[i][j]+(1-c.trust_memory)*q[i][j]);
 }
 for(const j of live){
  const rec=live.filter(i=>i!==j&&q[i][j]!==null);
  if(!rec.length)continue; // Missing evidence is not a zero-quality observation.
  const weights=rec.map(i=>oldTau[i]+c.reputation_eps);
  const sum=weights.reduce((s,x)=>s+x,0);
  st.E[j]=clamp(rec.reduce((s,i,k)=>s+weights[k]*st.D[i][j],0)/sum);
  for(const i of rec)st.T[i][j]=clamp(c.trust_alpha*st.D[i][j]+(1-c.trust_alpha)*st.E[j]);
  st.tau[j]=clamp(median(rec.map(i=>st.T[i][j])));
 }
 st.tauPrev=[...st.tau];
 return st.tau;
}
