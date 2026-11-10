import {rng,mean,indices} from "./common.js";
export const ACTIONS=["verification_priority","reauthenticate","limit_session","monitor","isolate_segment"];
// Explicit synthetic utilities, not calibrated on a protected infrastructure.
export const DEFAULT_ACTION_UTILITIES={normal:[.65,.55,.40,.60,-.40],attack:[.50,.85,.75,.70,.80]};
/** (15)-(16): authorized automatic action with operator fallback. */
export function chooseAction(st,step,c,generated,admitted){
 const candidates=ACTIONS.map((id,k)=>({id,index:k,utility:c.action_utilities[generated.attackActive?"attack":"normal"][k]}));
 // Segmentation is treated as irreversible and requires human authorization.
 const safe=candidates.filter(a=>a.id!=="isolate_segment");
 const fail=reason=>({action:"operator",reason,automatic:false,safe:true,correct:false,margin:null});
 if(!safe.length)return fail("empty_safe_set");
 if(admitted.length<c.minimum_admitted)return fail("insufficient_agents");
 const scored=safe.map(a=>{
  let s=0,sw=0;
  for(const i of admitted){
   const noise=rng(c.seed,st.run,"scores",step,i,a.index).normal()*c.score_noise_sigma;
   const distortion=generated.attackActive&&st.bad.has(i)?c.score_attack_shift*(a.index===0?1:-1):0;
   const w=st.tau[i];s+=w*(a.utility+noise+distortion);sw+=w;
  }
  return {...a,score:sw>0?s/sw:-Infinity};
 }).sort((a,b)=>b.score-a.score||a.index-b.index);
 const margin=scored.length>1?scored[0].score-scored[1].score:Infinity;
 if(margin<c.decision_margin)return {...fail("low_confidence"),margin};
 const optimal=safe.reduce((best,a)=>a.utility>best.utility?a:best);
 return {action:scored[0].id,automatic:true,reason:null,safe:true,correct:scored[0].id===optimal.id,margin};
}
