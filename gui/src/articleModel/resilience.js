import {mean} from "./common.js";
/** (19): weighted synthetic functionality with all four weights normalized to one. */
export const jt=(chi,g)=>chi.reduce((sum,v,i)=>sum+v*g[i],0);
/** (20): arithmetic mean over a defined time window. */
export const JL=values=>mean(values);
/** (21): paired attacks/clean ratio. Never cap at one. */
export function psi(attack,clean,weights){
 const Ja=JL(attack.map(x=>jt(x,weights))),J0=JL(clean.map(x=>jt(x,weights)));
 return {psi:J0>0?Ja/J0:null,Ja,J0,violates:Ja>J0};
}
export function indicators(choice,aggregation,st,generated,c,method){
 const available=choice.automatic?1:choice.action==="operator"?c.operator_availability:0;
 const e=aggregation[method].error;
 const correctness=e===null?0:Math.max(0,1-e/c.error_scale);
 const security=choice.safe?1:0;
 const recovery=generated.attackActive?(st.bad.size?[...st.bad].filter(i=>st.isolated[i]).length/st.bad.size:1):1;
 return [available,correctness,security,recovery];
}
