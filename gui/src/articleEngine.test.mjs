import test from "node:test";
import assert from "node:assert/strict";
import {ARTICLE_DEFAULTS,ARTICLE_MODEL_VERSION,validateArticleConfig,runArticle,runArticleTask,summarizeArticleTasks} from "./articleEngine.js";
import {initState} from "./articleModel/agents.js";
import {updateTrust} from "./articleModel/trust.js";
import {trimmedMean,clipNorm,ARTICLE_METHODS} from "./articleModel/aggregation.js";
import {psi} from "./articleModel/resilience.js";
const small={...ARTICLE_DEFAULTS,n_steps:14,n_runs:3,attack_start_step:3,n_agents:11,n_byzantine:2,trim_each_side:2,resilience_window:14,bootstrap_samples:100};
test("article schema and strict mathematical validation",()=>{
 assert.equal(ARTICLE_MODEL_VERSION,"imas-article-1.0.0");
 assert.equal(validateArticleConfig(small).n_agents,11);
 assert.throws(()=>validateArticleConfig({...small,n_byzantine:6}),/N > 2f/);
 assert.throws(()=>validateArticleConfig({...small,trust_memory:1}),/trust_memory/);
 assert.throws(()=>validateArticleConfig({...small,quality_weights:[1,1,1]}),/quality_weights/);
 assert.throws(()=>validateArticleConfig({...small,resilience_weights:[1,0,0,1]}),/resilience_weights/);
 assert.throws(()=>validateArticleConfig({...small,isolation_threshold:.7,admission_threshold:.5}),/admission_threshold/);
 assert.throws(()=>validateArticleConfig({...small,trim_each_side:6}),/trim_each_side/);
});
test("formula (9): closed form exponential smoothing for constant quality",()=>{
 const c=validateArticleConfig({...small,trust_memory:.8,isolation_threshold:0,admission_threshold:0}),
 st=initState(c,0),q=Array.from({length:c.n_agents},(_,i)=>Array.from({length:c.n_agents},(_,j)=>i===j?null:.2));
 for(let t=1;t<=10;t++){
  updateTrust(st,q,c);
  const expected=.8**t*.5+(1-.8**t)*.2;
  assert.ok(Math.abs(st.D[0][1]-expected)<1e-12);
  for(const i of st.alive())assert.ok(st.tau[i]>=0&&st.tau[i]<=1);
 }
});
test("formula (18): trimmed average constrained by honest coordinate interval",()=>{
 const honest=[[.1,-2],[.2,-1],[.3,0],[.4,1],[.5,2]];
 const malicious=[[1e20,-1e30],[-1e20,1e30]];
 const got=trimmedMean([...honest,...malicious],2);
 for(let j=0;j<2;j++){
  assert.ok(got[j]>=Math.min(...honest.map(h=>h[j]))-1e-12);
  assert.ok(got[j]<=Math.max(...honest.map(h=>h[j]))+1e-12);
 }
 assert.throws(()=>trimmedMean([[1],[2]],1),/2b/);
 assert.deepEqual(clipNorm([3,4],2.5),[1.5,2]);
});
test("seed gives bit-identical article trace, and zero-amplitude paired Psi equals 1",()=>{
 const a=runArticle(small,0,true,true),b=runArticle(small,0,true,true);
 assert.equal(JSON.stringify(a),JSON.stringify(b));
 assert.notEqual(JSON.stringify(a),JSON.stringify(runArticle({...small,seed:12345},0,true,true)));
 const clean=runArticleTask({...small,attack_shift:0},0,true);
 for(const row of clean.rows)assert.equal(row.psi,1);
 for(const row of clean.rows)assert.equal(row.unsafeActions,0);
 for(const t of a.trace){
  for(const x of t.trust)assert.ok(x>=0&&x<=1);
  for(const row of t.D)for(const x of row)assert.ok(x>=0&&x<=1);
 }
});
test("CUSUM isolates on-off malicious agents even with disabled threshold isolation",()=>{
 const cfg={...small,attack_scenario:"on_off",attack_shift:1,
  trust_memory:.95,isolation_threshold:0,admission_threshold:0,
  quality_sigma:0,byzantine_quality:0,consistency_scale:1,
  cusum_enabled:true,cusum_mu:.8,cusum_limit:.7};
 const without=runArticle({...cfg,cusum_enabled:false},0,true,true);
 const withCusum=runArticle(cfg,0,true,true);
 assert.equal(without.metrics.isolatedMalicious,0);
 assert.ok(withCusum.metrics.isolatedMalicious>0);
 assert.ok(withCusum.metrics.events.some(e=>e.reason==="cusum"));
});
test("publication summary uses sample s, paired bootstrap and bounded indicator pass",()=>{
 const c={...small,n_runs:3};
 const tasks=Array.from({length:c.n_runs},(_,i)=>runArticleTask(c,i,i===0));
 const result=summarizeArticleTasks(c,tasks);
 assert.equal(result.rows.length,ARTICLE_METHODS.length);
 assert.equal(result.completed_runs,3);
 assert.ok(result.trajectory.length>0);
 assert.deepEqual(result.rows.map(r=>r.method),ARTICLE_METHODS);
 for(const row of result.rows){
  assert.ok(row.meanError===null||row.meanError>=0);
  assert.ok(row.psiPassRate===null||(row.psiPassRate>=0&&row.psiPassRate<=1));
  assert.ok(row.psiCI95Low===null||row.psiCI95Low<=row.psiCI95High);
 }
 const q=psi([[1,1,1,1]],[[1,1,1,1]],[.25,.25,.25,.25]);
 assert.equal(q.psi,1);
});
