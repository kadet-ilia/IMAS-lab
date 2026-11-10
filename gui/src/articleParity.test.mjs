import test from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {ARTICLE_DEFAULTS,runArticleTask,validateArticleConfig} from "./articleEngine.js";
const bin=process.platform==="win32"?"python":"python3";
const hasPython=spawnSync(bin,["--version"],{encoding:"utf8"}).status===0;
const close=(a,b,label)=>assert.ok(
 (a===null&&b===null)||(Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<1e-10),
 label+": "+String(a)+" versus "+String(b));
test("independent Python/JS same-address keyed random streams and complete article run",{
 skip:!hasPython},()=>{
 for(const mode of ["synthetic","computed"])for(const seed of [12,20260716,99991])for(const scenario of ["collusion","subtle","on_off"]){
  const cfg=validateArticleConfig({...ARTICLE_DEFAULTS,seed,attack_scenario:scenario,
   n_agents:9,n_byzantine:2,trim_each_side:2,n_steps:10,n_runs:1,attack_start_step:2,
   quality_mode:mode,observation_fraction:mode==="computed"?.75:1,
   resilience_window:10,quality_sigma:.03,bootstrap_samples:100});
  const py=spawnSync(bin,["../reference/imas_article.py"],{
   encoding:"utf8",input:JSON.stringify({config:cfg,run:0}),maxBuffer:10*1024*1024});
  assert.equal(py.status,0,"Python failed: "+py.stderr);
  const reference=JSON.parse(py.stdout),js=runArticleTask(cfg,0,true);
  for(const row of js.rows){
   close(row.psi,reference.psi[row.method],scenario+" Psi "+row.method);
   close(row.error,reference.errors[row.method],scenario+" error "+row.method);
  }
  assert.equal(js.trace.length,reference.snapshot.length);
  for(let t=0;t<js.trace.length;t++){
   const a=js.trace[t],b=reference.snapshot[t];
   close(a.trustMedian,b.trustMedian,scenario+" median "+t);
   close(a.D[0][1],b.D01,scenario+" D01 "+t);
   assert.equal(a.choice.action,b.choice,scenario+" action "+t);
   for(const [m,x] of Object.entries(b.errors))close(a.methods[m].error,x,scenario+" "+m+" "+t);
  }
 }
});
