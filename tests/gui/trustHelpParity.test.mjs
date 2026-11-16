import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {TRUST_MODEL_VERSION,DEFAULTS} from "../../gui/src/trustEngine.js";
import {TRUST_METHOD_DEFINITIONS} from "../../gui/src/trustMethods.js";

const source=readFileSync(new URL("../../gui/src/main.jsx",import.meta.url),"utf8");
const help=readFileSync(new URL("../../gui/src/UnifiedHelp.jsx",import.meta.url),"utf8");
const simple=readFileSync(new URL("../../gui/src/SimpleGuides.js",import.meta.url),"utf8");
const article=source.slice(source.indexOf("function TrustHelpArticle()"),source.indexOf("function App()"));
const toc=source.slice(source.indexOf("const HELP_SECTIONS"),source.indexOf("function TrustHelpArticle()"));

test("E1 documentation indexes exactly the visible mathematical sections",()=>{
 const ids=[...article.matchAll(/<section id="([^"]+)">/g)].map(x=>x[1]);
 const registered=[...toc.matchAll(/\["([^"]+)",\s*"[^"]+"\]/g)].map(x=>x[1]);
 assert.ok(ids.length>=20);
 assert.deepEqual(registered,ids,"Содержание справки должно соответствовать реальным разделам и их порядку");
 for(const section of ids)assert.match(help,new RegExp('"'+section+'"'),"Нет группировки для "+section);
});

test("E1 help equations have consecutive numbering including Lyapunov and ablation",()=>{
 const numbers=[...article.matchAll(/<Formula number="(\d+)">/g)].map(x=>Number(x[1]));
 assert.deepEqual(numbers,Array.from({length:numbers.length},(_,i)=>i+1));
 assert.equal(numbers.at(-1),25);
});

test("E1 model version in help is linked to the runtime constant",()=>{
 assert.match(source,/import \{validateConfig,TRUST_MODEL_VERSION\} from "\.\/trustEngine\.js"/);
 assert.match(article,/<code>\{TRUST_MODEL_VERSION\}<\/code>/);
 assert.ok(TRUST_MODEL_VERSION.startsWith("trust-js-"));
 assert.doesNotMatch(article,/trust-js-2\.11\.0-dynamic-attack/);
});

test("E1 trust help distinguishes four estimators and missing-decision semantics",()=>{
 assert.equal(TRUST_METHOD_DEFINITIONS.length,4);
 for(const part of ["арифметический","доверительно-взвешенный","усечённый","комбинированный"])
   assert.match(article,new RegExp(part,"i"));
 assert.match(article,/n=0/);
 assert.match(article,/null/);
 assert.match(simple,/четыре способа агрегирования/i);
});

test("E1 help distinguishes evidence discount, phases, transport and inference limits",()=>{
 assert.equal(DEFAULTS.forgetting_factor,0.95);
 assert.match(article,/φ=1−λ/);
 assert.match(article,/минимальное число свидетельств на агента/);
 assert.match(article,/без отдельной очереди/);
 assert.match(article,/глобальный EigenTrust/);
 assert.match(article,/36 запланированных парных контрастов/);
 assert.match(article,/поправк[а-я]+ Холма/);
 assert.match(article,/схематическое изображение графа/i);
 assert.match(article,/не доказывают физическую воспроизводимость/);
});
