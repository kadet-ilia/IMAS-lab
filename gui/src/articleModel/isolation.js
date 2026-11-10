import {median,indices} from "./common.js";
/** (14), §3.4: threshold confirmations and optional nonnegative CUSUM. */
export function updateIsolation(st,q,t,c,attackActive){
 const events=[];
 for(let j=0;j<c.n_agents;j++){
  if(st.isolated[j])continue;
  const raters=st.alive().filter(i=>i!==j&&q[i][j]!==null);
  const evidence=median(raters.map(i=>q[i][j]));
  if(evidence===null)continue;
  st.below[j]=st.tau[j]<c.isolation_threshold?st.below[j]+1:0;
  if(c.cusum_enabled)st.z[j]=Math.max(0,st.z[j]+c.cusum_mu-evidence);
  const reason=st.below[j]>=c.isolation_patience?"threshold":c.cusum_enabled&&st.z[j]>c.cusum_limit?"cusum":null;
  if(reason){
   st.isolated[j]=true;
   const event={agent:j,step:t,attackTick:t-c.attack_start_step+1,reason,tau:st.tau[j],z:st.z[j],malicious:st.bad.has(j),duringAttack:attackActive};
   events.push(event);st.isolationEvents.push(event);
  }
 }
 const admitted=indices(c.n_agents).filter(j=>!st.isolated[j]&&st.tau[j]>=c.admission_threshold);
 return {admitted,events};
}
