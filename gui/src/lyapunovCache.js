import {TRUST_MODEL_VERSION} from "./trustEngine.js";
import {LYAPUNOV_STUDY_VERSION} from "./lyapunovStudy.js";
import {loadLyapunovCacheRecord,saveLyapunovCacheRecord} from "./trustBrowserClient.js";

export const LYAPUNOV_CACHE_SCHEMA=1;
export const lyapunovCacheKey=(config,options)=>JSON.stringify({
 format:"imas-lyapunov-complete-result",
 schema:LYAPUNOV_CACHE_SCHEMA,
 trustModel:TRUST_MODEL_VERSION,
 studyModel:LYAPUNOV_STUDY_VERSION,
 config,options
});
function validateEnvelope(record,key){
 if(!record||record.key!==key||record.schema!==LYAPUNOV_CACHE_SCHEMA||
 !record.value||!Array.isArray(record.value.summary)||record.value.summary.length!==4||
 !Array.isArray(record.value.runs)||!record.value.options||!record.value.configuration)
  throw Error("Сохранённый результат устойчивости повреждён или несовместим. Повторите расчёт.");
 return record.value;
}
/** Read data only for an exact match of all parameters and both model versions. */
export async function loadLyapunovResult(config,options){
 const key=lyapunovCacheKey(config,options);
 const envelope=await loadLyapunovCacheRecord(key);
 return envelope?validateEnvelope(envelope,key):null;
}
/** Return only after IndexedDB readwrite transaction has committed. */
export async function saveLyapunovResult(config,options,result){
 const key=lyapunovCacheKey(config,options);
 validateEnvelope({key,schema:LYAPUNOV_CACHE_SCHEMA,value:result},key);
 await saveLyapunovCacheRecord(key,{
  key,schema:LYAPUNOV_CACHE_SCHEMA,savedAt:new Date().toISOString(),value:result
 });
}
