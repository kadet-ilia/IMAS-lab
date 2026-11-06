import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,existsSync,readdirSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname,resolve} from "node:path";

const here=dirname(fileURLToPath(import.meta.url));
const gui=resolve(here,"..");
const file=path=>readFileSync(resolve(gui,path),"utf8");

test("Cloudflare Workers serves Vite build as SPA assets without a server script",()=>{
 const config=file("wrangler.toml");
 assert.match(config,/^name\s*=\s*"imas-lab-test"\s*$/m);
 assert.match(config,/^\[assets\]\s*$/m);
 assert.match(config,/^directory\s*=\s*"\.\/dist"\s*$/m);
 assert.match(config,/^not_found_handling\s*=\s*"single-page-application"\s*$/m);
 assert.doesNotMatch(config,/^main\s*=|^\[site\]/m);
});
test("Vite build contains the actual application and compiled client workers",()=>{
 const output=resolve(gui,"dist");
 if(!existsSync(resolve(output,"index.html"))){
  assert.match(file("index.html"),/<div id="root"><\/div>/);
  return; // Build assets are checked on the post-build test invocation.
 }
 const html=file("dist/index.html");
 assert.match(html,/<div id="root"><\/div>/);
 assert.match(html,/assets\/.+\.js/);
 const assets=resolve(output,"assets");
 const entries=readdirSync(assets);
 assert.ok(entries.some(name=>name.endsWith(".js")&&!name.includes("trustWorker")&&!name.includes("research2027.worker")),"Main JavaScript bundle missing");
 assert.ok(entries.some(name=>name.includes("trustWorker")&&name.endsWith(".js")),"Browser trust worker not bundled");
 assert.ok(entries.some(name=>name.includes("research2027.worker")&&name.endsWith(".js")),"Other research worker not bundled");
});
