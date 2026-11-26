import {existsSync,mkdirSync,readFileSync,writeFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
const root=resolve(dirname(fileURLToPath(import.meta.url)),".."),target=resolve(root,"public/e2-fixtures.json"),manifest=resolve(root,"public/e2-fixtures.sha256"),script=resolve(root,"../research/automatic-decisions/reference/generate_fixtures.py");
const regenerate=process.argv.includes("--required");
if(regenerate){
 mkdirSync(dirname(target),{recursive:true});
 let ok=false;
 for(const python of [...new Set([process.env.PYTHON,"python3","python"].filter(Boolean))]){
  const check=spawnSync(python,[script,"--output",target],{stdio:"inherit"});
  if(check.status===0&&existsSync(target)){ok=true;break;}
 }
 if(!ok)throw Error("E2: регенерация не выполнена; установите закреплённые Python-зависимости.");
}
if(!existsSync(target))throw Error("E2: отсутствует обязательный статический ресурс public/e2-fixtures.json; сборка остановлена. Получите файл из ветки или выполните npm run e2:fixtures.");
const bytes=readFileSync(target),fixture=JSON.parse(bytes.toString("utf8"));
if(fixture.schema!=="imas-e2-fixtures-v1"||fixture.seed!==20261125||fixture.numpy!=="2.3.5"||fixture.scipy!=="1.17.0"||fixture.records?.length!==390)throw Error("E2: неверный эталонный набор");
const hash=createHash("sha256").update(bytes).digest("hex");
if(regenerate)writeFileSync(manifest,hash+"\n");
if(!existsSync(manifest)||readFileSync(manifest,"utf8").trim()!==hash)throw Error("E2: не совпадает SHA-256 эталонного набора");
console.log("E2: статический ресурс проверен;",bytes.length,"байт; SHA-256",hash);
