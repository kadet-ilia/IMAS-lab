import {digest} from "./storage.js";
import {STUDY_VERSION} from "./extendedStudies.js";
const DB="imas-e2-research-v1",STORE="series",RECORDS="records-v2",FORMAT="append-v2";
function open(){return new Promise((resolve,reject)=>{const r=indexedDB.open(DB,2);r.onupgradeneeded=()=>{const db=r.result;if(!db.objectStoreNames.contains(STORE))db.createObjectStore(STORE);if(!db.objectStoreNames.contains(RECORDS))db.createObjectStore(RECORDS);};r.onsuccess=()=>{const db=r.result;db.onversionchange=()=>db.close();resolve(db);};r.onerror=()=>reject(r.error);r.onblocked=()=>reject(Error("Хранилище заблокировано другой вкладкой"));});}
const range=key=>IDBKeyRange.bound([key,0],[key,Number.MAX_SAFE_INTEGER]);
async function transaction(mode,action){
 const db=await open();
 try{return await new Promise((resolve,reject)=>{
  const t=db.transaction([STORE,RECORDS],mode),s=t.objectStore(STORE),r=t.objectStore(RECORDS);
  let result,reason;const fail=e=>{reason=e;try{t.abort();}catch{}};
  t.oncomplete=()=>resolve(result);t.onerror=()=>reject(reason||t.error||Error("Ошибка хранилища"));t.onabort=()=>reject(reason||t.error||Error("Транзакция прервана"));
  try{action(s,r,v=>{result=v;},fail);}catch(e){fail(e);}
 });}finally{db.close();}
}
export async function studyKey(mode,c){return digest(JSON.stringify([STUDY_VERSION,mode,c]));}
const hashRecord=(key,index,payload)=>digest(JSON.stringify([key,index,payload]));
const bytes=s=>new TextEncoder().encode(s).length;
async function encode(key,start,records){
 return Promise.all(records.map(async(record,i)=>{const index=start+i,payload=JSON.stringify(record);return {index,payload,hash:await hashRecord(key,index,payload),bytes:bytes(payload)};}));
}
function manifest(d){return d?.format===FORMAT&&Number.isSafeInteger(d.count)&&d.count>=0&&Number.isSafeInteger(d.payloadBytes)&&d.payloadBytes>=0;}
function invalid(){return Error("Нарушена целостность контрольной точки");}
async function snapshot(key){
 return transaction("readonly",(s,r,done)=>{const a=s.get(key),b=r.getAll(range(key)),k=r.getAllKeys(range(key));let pending=3;const finish=()=>{if(--pending===0)done({meta:a.result,items:b.result,keys:k.result});};a.onsuccess=b.onsuccess=k.onsuccess=finish;});
}
async function decode(key,data){
 const {meta,items,keys}=data;
 if(!meta){if(items.length)throw invalid();return null;}
 if(meta.format!==FORMAT){
  if(items.length||typeof meta.payload!=="string"||await digest(meta.payload)!==meta.hash)throw invalid();
  const a=JSON.parse(meta.payload);if(!Array.isArray(a))throw invalid();return a;
 }
 if(!manifest(meta)||items.length!==meta.count||keys.length!==meta.count)throw invalid();
 let total=0;const out=[];
 // Verify in bounded blocks rather than allocating one promise per large record.
 for(let start=0;start<items.length;start+=16){
  const block=items.slice(start,start+16);
  const a=await Promise.all(block.map(async(v,j)=>{const i=start+j;if(keys[i][0]!==key||keys[i][1]!==i||v.index!==i||typeof v.payload!=="string"||bytes(v.payload)!==v.bytes||await hashRecord(key,i,v.payload)!==v.hash)throw invalid();return JSON.parse(v.payload);}));
  for(const v of block)total+=v.bytes;out.push(...a);
 }
 if(total!==meta.payloadBytes)throw invalid();return out;
}
// Prepare hashes before opening the read/write transaction. Count comparison,
// record inserts and manifest update are one atomic transaction across stores.
async function commit(key,start,items,legacyHash=null){
 return transaction("readwrite",(s,r,done,fail)=>{
  const req=s.get(key);req.onsuccess=()=>{try{
   const d=req.result,migrating=legacyHash!==null;
   if(migrating){if(!d||d.format===FORMAT||d.hash!==legacyHash)throw Error("Контрольная точка изменена другой вкладкой; запустите серию заново");}
   else if(d?(!manifest(d)||d.count!==start):start!==0)throw Error("Контрольная точка изменена другой вкладкой; запустите серию заново");
   if(migrating||!d){const check=r.count(range(key));check.onsuccess=()=>{try{if(check.result!==0)throw invalid();store();}catch(e){fail(e);}};}else store();
   function store(){for(const v of items)r.add(v,[key,v.index]);const payloadBytes=(migrating||!d?0:d.payloadBytes)+items.reduce((a,v)=>a+v.bytes,0);s.put({format:FORMAT,count:start+items.length,payloadBytes},key);done({count:start+items.length,payloadBytes});}
  }catch(e){fail(e);}};
 });
}
export async function appendCheckpoint(key,start,records){
 if(!Number.isSafeInteger(start)||start<0||!Array.isArray(records)||!records.length||records.length>2000)throw Error("Некорректная дозапись");
 return commit(key,start,await encode(key,start,records));
}
export async function readCheckpoint(key,plan){
 const d=await snapshot(key),a=await decode(key,d);if(!a)return [];
 if(a.length>plan.length||a.some((v,i)=>JSON.stringify(v.unit)!==JSON.stringify(plan[i])))throw Error("Контрольная точка не соответствует плану");
 if(d.meta.format!==FORMAT){
  // Migrate only after verification of the full legacy hash and plan.
  const items=await encode(key,0,a);await commit(key,0,items,d.meta.hash);
 }
 return a;
}
export async function readPayload(key){return decode(key,await snapshot(key));}
export async function deleteCheckpoint(key){await transaction("readwrite",(s,r)=>{s.delete(key);r.delete(range(key));});}
// Compatibility for other consumers. Normal execution uses appendCheckpoint.
export async function writeCheckpoint(key,records){
 const old=await readPayload(key)||[];
 if(old.length>records.length||old.some((r,i)=>JSON.stringify(r)!==JSON.stringify(records[i])))throw Error("Контрольная точка не является префиксом");
 const d=await snapshot(key);
 if(d.meta&&d.meta.format!==FORMAT){await readCheckpoint(key,records.map(v=>v.unit));}
 if(records.length>old.length)await appendCheckpoint(key,old.length,records.slice(old.length));
}
