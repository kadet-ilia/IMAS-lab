import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {ARTICLE_DEFAULTS,runArticleTask,validateArticleConfig} from "./articleEngine.js";
const cases=[20260716,42,731991].flatMap(seed=>["collusion","subtle","on_off"].map(scenario=>({seed,scenario})));
const artifact=()=>Object.fromEntries(cases.map(({seed,scenario})=>{
 const c=validateArticleConfig({...ARTICLE_DEFAULTS,seed,attack_scenario:scenario,
   n_agents:11,n_byzantine:2,n_steps:16,n_runs:1,
   attack_start_step:3,trim_each_side:2,resilience_window:16,bootstrap_samples:100});
 const r=runArticleTask(c,0,true);
 const stable={rows:r.rows,events:r.events,trace:r.trace.map(t=>({
   step:t.step,trustMedian:t.trustMedian,trust:t.trust,
   action:t.choice.action,methods:Object.fromEntries(
     Object.entries(t.methods).map(([k,v])=>[k,v.error]))}))};
 return [String(seed)+"/"+scenario,createHash("sha256").update(JSON.stringify(stable)).digest("hex")];
}));
test("produce nine fixed article golden trace fingerprints",()=>{
 const once=artifact(),again=artifact();assert.deepEqual(once,again);
 const expected=JSON.parse(readFileSync(new URL("../../reference/article_golden_sha256.json",import.meta.url),"utf8"));
 assert.equal(expected.modelVersion,"imas-article-1.0.0");
 assert.deepEqual(once,expected.fingerprints);
});
