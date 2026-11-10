/**
 * UP-23 / UP-34: independent finite-horizon reachability oracle for the
 * seven-agent experimental graph. It does NOT call runPetri or its BFS helpers.
 * It exhaustively computes reachable sets at each discrete depth via a
 * frontier-to-frontier transition system. This validates observable EF results,
 * not full CPN semantics or equivalence to independent formal tools.
 */
const REFERENCE_GRAPH=[
 [0,1],[0,2],[1,3],[2,3],[2,4],[3,5],[4,5],[5,6],[1,6]
];
const SIZE=7;
const countBits=x=>x.toString(2).replaceAll("0","").length;
const stateKey=(compromised,isolated)=>compromised+":"+isolated;

export function petriReference({steps,criticalCount,detectionDelay,isolationPolicy}){
 if(!Number.isInteger(steps)||steps<0||steps>12)throw Error("Oracle: steps must be 0..12");
 if(!Number.isInteger(criticalCount)||criticalCount<1||criticalCount>SIZE)throw Error("Oracle: invalid criticalCount");
 if(!Number.isInteger(detectionDelay)||detectionDelay<0||detectionDelay>12)throw Error("Oracle: invalid detectionDelay");
 if(![0,1].includes(isolationPolicy))throw Error("Oracle: invalid isolationPolicy");
 let frontier=[{compromised:1,isolated:0}],maxStates=1;
 const byTime=[];
 for(let t=0;t<=steps;t++){
  byTime.push(frontier.length);
  for(const st of frontier)if(countBits(st.compromised)>=criticalCount)
   return {verdict:"reachable",firstReachableTick:t,byTime,maxFrontier:maxStates};
  if(t===steps)break;
  const next=new Map(),add=(compromised,isolated)=>{
   const k=stateKey(compromised,isolated);if(!next.has(k))next.set(k,{compromised,isolated});
  };
  for(const st of frontier){
   if(isolationPolicy===1&&t+1>=detectionDelay){
    add(st.compromised,st.isolated|st.compromised);
    continue;
   }
   add(st.compromised,st.isolated); // Explicit waiting step
   for(const [src,dst] of REFERENCE_GRAPH){
    const s=1<<src,d=1<<dst;
    if((st.compromised&s)&&!(st.isolated&s)&&!(st.compromised&d)&&!(st.isolated&d))
     add(st.compromised|d,st.isolated);
   }
   if(isolationPolicy===0&&t+1>=detectionDelay){
    for(let agent=0;agent<SIZE;agent++){
     const mask=1<<agent;
     if((st.compromised&mask)&&!(st.isolated&mask))
      add(st.compromised,st.isolated|mask);
    }
   }
  }
  frontier=[...next.values()];
  maxStates=Math.max(maxStates,frontier.length);
 }
 return {verdict:"unreachable_within_bound",firstReachableTick:null,byTime,maxFrontier:maxStates};
}
