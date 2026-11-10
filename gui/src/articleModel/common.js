/** Reproducible keyed exogenous random streams, independent of execution order. */
export const clamp=(x,lo=0,hi=1)=>Math.min(hi,Math.max(lo,x));
export const mean=xs=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;
export const median=xs=>{if(!xs.length)return null;const a=[...xs].sort((x,y)=>x-y);const n=a.length;return n%2?a[(n-1)/2]:(a[n/2-1]+a[n/2])/2;};
export const stdev=xs=>xs.length>1?Math.sqrt(xs.reduce((s,x)=>s+(x-mean(xs))**2,0)/(xs.length-1)):0;
export const norm=xs=>Math.hypot(...xs);
export const distance=(a,b)=>norm(a.map((v,i)=>v-b[i]));
export function hash(...parts){let h=2166136261>>>0;for(const part of parts){for(const ch of String(part)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619);}h^=255;h=Math.imul(h,16777619);}return h||1;}
export function rng(...parts){let s=hash(...parts),spare=null;const random=()=>{s^=s<<13;s^=s>>>17;s^=s<<5;return(s>>>0)/4294967296;};
 return {random,normal(){if(spare!==null){const x=spare;spare=null;return x;}const u=Math.max(random(),1e-12),v=random(),a=Math.sqrt(-2*Math.log(u)),p=2*Math.PI*v;spare=a*Math.sin(p);return a*Math.cos(p);},
 integer(n){return Math.floor(random()*n);},fork(...keys){return rng(...parts,...keys);}};}
export const matrix=(n,fill)=>Array.from({length:n},()=>Array(n).fill(fill));
export const indices=n=>Array.from({length:n},(_,i)=>i);
export const round=x=>x===null?null:Number(x.toFixed(12));
