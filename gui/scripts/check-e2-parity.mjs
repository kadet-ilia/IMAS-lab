import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {DEFAULTS,units,compute,geometry,laws,joint} from "../src/automaticDecisions/kernel.js";
import {summarize} from "../src/automaticDecisions/statistics.js";
const gui=resolve(dirname(fileURLToPath(import.meta.url)),".."),ref=resolve(gui,"../research/automatic-decisions/reference");
const fixture=JSON.parse(readFileSync(resolve(gui,"public/e2-fixtures.json"),"utf8")),config={...DEFAULTS,series:"all"},G=geometry(config),cache=new Map(),records=[];
for(const unit of units(config)){if(!cache.has(unit.s))cache.set(unit.s,joint(config,G,laws(config,unit.s).test,unit.s));records.push(compute(config,unit,fixture,{G,P:cache.get(unit.s)}));if(records.length%30===0)console.log("E2",records.length,"/",390);}
const {raw,tables}=summarize(records,config.alpha);
function csv(path){const lines=readFileSync(path,"utf8").trim().split(/\r?\n/),keys=lines.shift().split(",");return lines.map(l=>Object.fromEntries(l.split(",").map((v,i)=>[keys[i],Number(v)])));}
const keys={fixed:["scenario","rep","method"],matched:["scenario","rep","method"],cost:["cost","rep","method"],validity:["scenario","rep"],sensitivity:["n","rep"],validation:["scenario","rep","method"],paired:["scenario","baseline"],monte_carlo:["scenario"],certificate_checks:["scenario"]};
const counts={fixed:1920,matched:1440,cost:480,validity:240,sensitivity:150,validation:600,paired:32,monte_carlo:4,certificate_checks:8};
for(const [name,ks] of Object.entries(keys)){const expected=csv(resolve(ref,name+".csv")),actual=name==="paired"?tables.paired:raw[name];assert.equal(expected.length,counts[name],name+" reference count");assert.equal(actual.length,expected.length,name+" browser count");const id=r=>ks.map(k=>k==="cost"?r[k].toFixed(12):r[k]).join(":"),map=new Map(actual.map(r=>[id(r),r]));let max=0;for(const row of expected){const a=map.get(id(row));assert.ok(a,name+" missing "+id(row));for(const [k,v] of Object.entries(row)){assert.ok(Number.isFinite(a[k]),name+" "+k+" missing");const d=Math.abs(a[k]-v);max=Math.max(max,d);assert.ok(d<1e-8,name+" "+id(row)+" "+k+" "+a[k]+" != "+v);}}console.log(name,expected.length,"max deviation",max);}
