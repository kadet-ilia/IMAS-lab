import test from "node:test";
import assert from "node:assert/strict";
import {cacheKeyForPayload} from "./trustBrowserClient.js";
import {TRUST_MODEL_VERSION} from "./trustEngine.js";

test("UP-04/35 every browser cache key includes current mathematical model version",()=>{
 const payload={action:"trace",scenario:"collusion",config:{seed:11,n_agents:7}};
 const key=JSON.parse(cacheKeyForPayload(payload));
 assert.equal(key.modelVersion,TRUST_MODEL_VERSION);
 assert.equal(key.config.seed,11);
 const changed=JSON.parse(cacheKeyForPayload({...payload,config:{...payload.config,seed:12}}));
 assert.notDeepEqual(key,changed);
});
