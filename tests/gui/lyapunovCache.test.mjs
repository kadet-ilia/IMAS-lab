import test from "node:test";
import assert from "node:assert/strict";
import {lyapunovCacheKey,loadLyapunovResult,saveLyapunovResult} from "../../gui/src/lyapunovCache.js";
import {runLyapunovStudy} from "../../gui/src/lyapunovStudy.js";
import {clearBrowserResults} from "../../gui/src/trustBrowserClient.js";

const config={n_agents:7,n_byzantine:1,n_steps:12,attack_start_step:2,
 trim_each_side:1,seed:5566,network_enabled:false,isolation_enabled:false};
const options={phases:[{start:1,intensity:0},{start:3,intensity:1}],
 gain:.5,initialError:1,tolerance:.1,runs:1};

test("Lyapunov cache persists full four-method result under an exact model/version/parameter key",async()=>{
 await clearBrowserResults();
 const value=runLyapunovStudy(config,options);
 assert.equal(await loadLyapunovResult(config,options),null);
 await saveLyapunovResult(config,options,value);
 const cached=await loadLyapunovResult(config,options);
 assert.deepEqual(cached,value);
 assert.equal(cached.runs[0].trajectory.length,12);
 assert.equal(cached.summary.length,4);
 assert.equal(await loadLyapunovResult({...config,seed:5567},options),null);
 assert.equal(await loadLyapunovResult(config,{...options,gain:.65}),null);
 assert.equal(await loadLyapunovResult(config,{...options,phases:[{start:1,intensity:0}]}),null);
 assert.notEqual(lyapunovCacheKey(config,options),lyapunovCacheKey(config,{...options,runs:2}));
 await clearBrowserResults();
 assert.equal(await loadLyapunovResult(config,options),null);
});
test("partial and structurally invalid results cannot be marked as saved",async()=>{
 await assert.rejects(saveLyapunovResult(config,options,{summary:[],runs:[]}),/повреждён/);
});
