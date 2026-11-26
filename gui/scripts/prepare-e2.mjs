import {existsSync,mkdirSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {spawnSync} from "node:child_process";
const root=resolve(dirname(fileURLToPath(import.meta.url)),".."),target=resolve(root,"public/e2-fixtures.json"),script=resolve(root,"../research/automatic-decisions/reference/generate_fixtures.py");
if(!existsSync(target)||process.argv.includes("--required")){
 mkdirSync(dirname(target),{recursive:true});
 const required=process.argv.includes("--required")||process.env.E2_REQUIRE_FIXTURES==="1";
 let ok=false;
 for(const python of [...new Set([process.env.PYTHON,"python3","python"].filter(Boolean))]){
  const check=spawnSync(python,[script,"--output",target],{stdio:"inherit"});
  if(check.status===0&&existsSync(target)){ok=true;break;}
 }
 if(!ok){console.warn("E2: эталонные частоты не созданы. Установите зависимости из research/automatic-decisions/reference/requirements.txt; npm run e2:fixtures. Пользовательский режим работает без файла.");if(required)process.exit(1);}
}
