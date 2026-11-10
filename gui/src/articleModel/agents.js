import {rng,indices,clamp} from "./common.js";
/** (1)-(3): Synthetic object state, agents and partially observable proposals. */
export function initState(c,run=0){
 const shuffle=indices(c.n_agents),r=rng(c.seed,run,"attack","membership");
 for(let i=shuffle.length-1;i>0;i--){const j=r.integer(i+1);[shuffle[i],shuffle[j]]=[shuffle[j],shuffle[i]];}
 const bad=new Set(shuffle.slice(0,c.n_byzantine)),n=c.n_agents;
 return {run,bad,D:Array.from({length:n},()=>Array(n).fill(c.initial_trust)),
 E:Array(n).fill(c.initial_trust),T:Array.from({length:n},()=>Array(n).fill(c.initial_trust)),
 tau:Array(n).fill(c.initial_trust),tauPrev:Array(n).fill(c.initial_trust),
 isolated:Array(n).fill(false),below:Array(n).fill(0),z:Array(n).fill(0),
 previousMessages:null,theta:{},isolationEvents:[],reference:[...c.reference_vector],
 alive(){return indices(n).filter(i=>!this.isolated[i]);}};
}
/** Attack is indexed by zero-based t; t >= attack_start_step. */
export function activeAttack(c,t,attacked=true){
 if(!attacked||c.attack_shift===0||t<c.attack_start_step)return false;
 return c.attack_scenario!=="on_off"||((t-c.attack_start_step)%c.on_off_period)<c.on_off_attack_steps;
}
/** (2): observed coordinates are null for unobserved entries (not zero). */
export function generateMessages(st,t,c,attacked=true){
 const active=activeAttack(c,t,attacked),d=c.decision_dim;
 const x=st.reference.map((v,k)=>v+c.reference_drift*t*(k%2?-1:1));
 const messages=indices(c.n_agents).map(i=>{
  const r=rng(c.seed,st.run,"noise",t,i);
  const mask=rng(c.seed,st.run,"observation",i);
  const y=x.map((v,k)=>mask.random()<c.observation_fraction?v+c.honest_noise_sigma*r.normal():null);
  if(active&&st.bad.has(i)){
   const amp=c.attack_scenario==="subtle"?c.subtle_shift:c.attack_shift;
   for(let k=0;k<d;k++)if(y[k]!==null)y[k]+=amp*c.attack_vector[k];
  }
  return y;
 });
 return {messages,reference:x,attackActive:active,compromised:[...st.bad]};
}
/** Five attack strategies: coherent shift, reputation manipulation, subtle shift, camouflage, on-off. */
export const ATTACK_SCENARIOS=["collusion","trust","subtle","mask","on_off"];
