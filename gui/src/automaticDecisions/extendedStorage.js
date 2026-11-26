import {digest} from "./storage.js";
import {STUDY_VERSION,studyPlan} from "./extendedStudies.js";
const DB="imas-e2-research-v1",STORE="series";
async function tx(mode,action){
 const db=await new Promise((resolve,reject)=>{const r=indexedDB.open(DB,1);r.onupgradeneeded=()=>r.result.createObjectStore(STORE);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.onblocked=()=>reject(Error("Хранилище заблокировано"));});
 try{return await new Promise((resolve,reject)=>{const t=db.transaction(STORE,mode),r=action(t.objectStore(STORE));t.oncomplete=()=>resolve(r.result);t.onerror=()=>reject(t.error);t.onabort=()=>reject(t.error||Error("Транзакция прервана"));});}finally{db.close();}
}
export async function studyKey(mode,c){return digest(JSON.stringify([STUDY_VERSION,mode,c]));}
export async function writeCheckpoint(key,records){const payload=JSON.stringify(records),hash=await digest(payload);await tx("readwrite",s=>s.put({payload,hash},key));}
export async function readCheckpoint(key,plan){const d=await tx("readonly",s=>s.get(key));if(!d)return [];if(await digest(d.payload)!==d.hash)throw Error("Нарушена целостность контрольной точки");const r=JSON.parse(d.payload);if(!Array.isArray(r)||r.length>plan.length||r.some((v,i)=>JSON.stringify(v.unit)!==JSON.stringify(plan[i])))throw Error("Контрольная точка не соответствует плану");return r;}
export async function deleteCheckpoint(key){await tx("readwrite",s=>s.delete(key));}
