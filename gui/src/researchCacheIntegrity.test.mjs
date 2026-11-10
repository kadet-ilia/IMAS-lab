import test from "node:test";
import assert from "node:assert/strict";
import {executeStudy,validateStudy} from "./research2027.js";
import {researchKey,RESEARCH_STORAGE_SCHEMA,sealResearchRecord,unsealResearchRecord,
 auditCachedResearchResult} from "./researchBrowserClient.js";
test("UP-35 sealed research result detects corrupted bytes, key and digest",async()=>{
 const config={agents:9,runs:8,seed:20261106};
 const normalized=validateStudy("uncertainty",config);
 const result=executeStudy("uncertainty",config);
 const key="complete:"+researchKey("uncertainty",normalized);
 const envelope=await sealResearchRecord(key,result);
 assert.equal(envelope.schemaVersion,RESEARCH_STORAGE_SCHEMA);
 assert.match(envelope.sha256,/^[a-f0-9]{64}$/);
 assert.deepEqual(await unsealResearchRecord(key,structuredClone(envelope)),result);
 const malformed=structuredClone(envelope);
 malformed.payload.rows[0].coverage=0.345;
 await assert.rejects(unsealResearchRecord(key,malformed),/SHA-256/);
 await assert.rejects(unsealResearchRecord(key+"other",envelope),/неверный конверт/);
 await assert.rejects(unsealResearchRecord(key,{...envelope,sha256:"0".repeat(64)}),/SHA-256/);
 await assert.rejects(unsealResearchRecord(key,{...envelope,schemaVersion:1}),/конверт/);
});
test("UP-35 source evidence tampering is rejected even if attacker re-seals hash",async()=>{
 const input={agents:7,runs:6,seed:20261107,record_source_runs:1,source_run_limit:6};
 const normalized=validateStudy("uncertainty",input);
 const good=executeStudy("uncertainty",input);
 assert.equal(auditCachedResearchResult("uncertainty",normalized,good),good);
 const key="complete:"+researchKey("uncertainty",normalized);
 const corrupted=structuredClone(good);
 corrupted.sourceRunJournal.entries[0].methodEstimates[0]*=-1;
 const forgedEnvelope=await sealResearchRecord(key,corrupted);
 const unpacked=await unsealResearchRecord(key,forgedEnvelope);
 assert.throws(()=>auditCachedResearchResult("uncertainty",normalized,unpacked),/Контроль сохранённого/);
 const wrongConfig=validateStudy("uncertainty",{...input,seed:input.seed+1});
 assert.throws(()=>auditCachedResearchResult("uncertainty",wrongConfig,good),/другой версии или конфигурации/);
});
test("UP-35 cached Holm inference is independently checked rather than trusting a boolean",()=>{
 const config={agents:11,runs:8,steps:4,seed:20261108};
 const normalized=validateStudy("probgraph",config);
 const output=executeStudy("probgraph",config);
 assert.equal(auditCachedResearchResult("probgraph",normalized,output),output);
 const changed=structuredClone(output);
 changed.pairedEffects[0].pHolm=.123456;
 assert.throws(()=>auditCachedResearchResult("probgraph",normalized,changed),/Контроль сохранённого/);
});
