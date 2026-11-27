import test from "node:test";
import assert from "node:assert/strict";
import {EXTRA_DEFAULTS} from "./extendedStudies.js";
import {externalExample,parseExternal,parseDataImport,outcomeBounds,evaluateExternal} from "./externalValidation.js";
const c={...EXTRA_DEFAULTS,calibrationMode:"complete",discoverGroups:false,iidTest:false};
test("JSON and JSONL retain declared provenance, unknown labels, identities and exact cohorts",()=>{
 const f=externalExample(100),{rows,...head}=f;
 assert.deepEqual(parseDataImport(JSON.stringify(f)),f);
 assert.deepEqual(parseDataImport([JSON.stringify(head),...rows.map(r=>JSON.stringify(r))].join("\n")),f);
 const r=evaluateExternal(f,c);assert.equal(r.split.trainN,60);assert.equal(r.split.testN,40);assert.equal(r.summary.length,4);assert.equal(r.trace.length,160);assert.equal(r.certified,false);
 assert.ok(r.summary.every(s=>s.labelCoverage<1&&s.lossLow<=s.lossHigh));
 assert.equal(r.summary[3].loss,c.c);assert.ok(Math.abs(r.summary[3].lossLow-c.c)<1e-10);
});
test("Reject leakage, future audits, duplicate IDs and unsupported declarations",()=>{
 const f=externalExample(100),change=(i,v)=>({...f,rows:f.rows.map((r,j)=>i===j?{...r,...v}:r)});
 assert.throws(()=>parseExternal(change(60,{incident:f.rows[0].incident})),/инцидент/);
 assert.throws(()=>parseExternal(change(0,{labelTime:61})),/метки/);
 assert.throws(()=>parseExternal(change(1,{id:f.rows[0].id})),/дубликат/);
 assert.throws(()=>parseExternal({...f,provenance:{...f.provenance,kind:"unknown"}}));
 assert.throws(()=>evaluateExternal(f,{...c,iidTest:true}));
});
test("Unknown-label bounds match exhaustive completions, including paired effects",()=>{
 const rows=[{x:0,a:1,b:2},{x:null,a:0,b:2},{x:null,a:1,b:0}],L=(a,x)=>a===2?1.25:a===0?6*x:x?.6:2,fn=(r,x)=>L(r.b,x)-L(r.a,x);
 const b=outcomeBounds(rows,fn),all=[];
 for(const a of [0,1])for(const x of [0,1])all.push((fn(rows[0],0)+fn(rows[1],a)+fn(rows[2],x))/3);
 assert.equal(b.low,Math.min(...all));assert.equal(b.high,Math.max(...all));assert.equal(b.knownN,1);
});
test("No test label dependence in calibration or decisions",()=>{
 const f=externalExample(100),r=evaluateExternal(f,c),g={...f,rows:f.rows.map(v=>v.split==="test"?{...v,x:null,labelTime:null}:v)},q=evaluateExternal(g,c);
 assert.deepEqual(r.counts,q.counts);assert.deepEqual(r.trace.map(v=>[v.action,v.lo,v.hi]),q.trace.map(v=>[v.action,v.lo,v.hi]));
 assert.ok(q.summary.every(v=>v.knownN===0&&v.lossKnown===null));
 assert.ok(q.summary.every((v,i)=>v.lossLow<=r.summary[i].lossLow+1e-12&&v.lossHigh>=r.summary[i].lossHigh-1e-12));
});
