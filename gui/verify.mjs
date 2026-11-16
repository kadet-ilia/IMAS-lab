import fs, { createReadStream, createWriteStream } from "node:fs";
import { mkdir, chmod, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createBrotliDecompress } from "node:zlib";
import { pipeline } from "node:stream/promises";
import chromiumPackage from "@sparticuz/chromium";
import { chromium as playwright } from "playwright-core";

const here = path.dirname(fileURLToPath(import.meta.url));
const runtime = path.join(here, ".verify-runtime");
const bundledExecutable = path.join(runtime, "chromium");
const runtimeMarker = path.join(runtime, ".complete");

async function extractTar(source, destination) {
  await mkdir(destination, { recursive: true });
  // Extract from an intermediate file: piping into tar stdin can close
  // prematurely under heavily loaded GitHub Actions containers.
  const archive = path.join(runtime, path.basename(source) + ".tmp.tar");
  await pipeline(createReadStream(source), createBrotliDecompress(), createWriteStream(archive));
  try {
    const tar = spawn("tar", ["--no-same-owner", "-xf", archive, "-C", destination], { stdio: "ignore" });
    const code = await new Promise((resolve, reject) => {
      tar.on("error", reject);
      tar.on("close", resolve);
    });
    if (code !== 0) throw new Error("tar extraction failed: " + source + ", code " + code);
  } finally {
    await rm(archive, { force: true });
  }
}

async function ensureBundledChromium() {
  if (!fs.existsSync(runtimeMarker)) {
    const bin = path.join(here, "node_modules", "@sparticuz", "chromium", "bin");
    await mkdir(runtime, { recursive: true });
    if (!fs.existsSync(bundledExecutable) || fs.statSync(bundledExecutable).size === 0) {
      await pipeline(
        createReadStream(path.join(bin, "chromium.br")),
        createBrotliDecompress(),
        createWriteStream(bundledExecutable),
      );
      await chmod(bundledExecutable, 0o755);
    }
    await extractTar(path.join(bin, "fonts.tar.br"), runtime);
    await extractTar(path.join(bin, "swiftshader.tar.br"), runtime);
    await extractTar(path.join(bin, "al2023.tar.br"), runtime);
    fs.writeFileSync(runtimeMarker, "ok\n");
  }
  return bundledExecutable;
}

const explicitPath = process.env.IMAS_CHROMIUM_PATH || process.env.CHROME_PATH;
// A system browser is used only when explicitly requested. The bundled browser
// avoids enterprise policies that can block localhost in managed installations.
const systemExecutable = explicitPath && fs.existsSync(explicitPath) ? explicitPath : null;
const usingSystemBrowser = Boolean(systemExecutable);
const executablePath = systemExecutable || await ensureBundledChromium();
const launchArgs = usingSystemBrowser
  ? ["--no-sandbox", "--disable-dev-shm-usage"]
  : chromiumPackage.args;
const launchEnv = usingSystemBrowser
  ? process.env
  : {
      ...process.env,
      FONTCONFIG_PATH: path.join(runtime, "fonts"),
      LD_LIBRARY_PATH: [path.join(runtime, "lib"), process.env.LD_LIBRARY_PATH].filter(Boolean).join(":"),
    };

const browser = await playwright.launch({ executablePath, args: launchArgs, headless: true, env: launchEnv });
const page = await browser.newPage({ viewport: { width: 1491, height: 1023 }, deviceScaleFactor: 1 });
const errors = [];
const warnings = [];
const apiCalls=[];
page.on("request",request=>{if(new URL(request.url()).pathname.startsWith("/api/"))apiCalls.push(request.url());});
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
  if (message.type() === "warning") warnings.push(message.text());
});
page.on("pageerror", (error) => errors.push(error.message));

await page.goto("http://127.0.0.1:4173", { waitUntil: "domcontentloaded", timeout: 30000 });
try {
  await page.getByText("Динамика решений и оценок").waitFor({ timeout: 30000 });
} catch (error) {
  const diagnostic = await page.evaluate(() => ({
    title: document.title,
    url: location.href,
    body: document.body?.innerText?.slice(0, 1200),
    scriptSrcs: Array.from(document.scripts, node => node.src),
    root: document.getElementById("root")?.outerHTML?.slice(0, 1500)
  }));
  console.error("IMAS_BROWSER_BOOT_DIAGNOSTIC", JSON.stringify({diagnostic, errors, warnings}));
  throw error;
}

const standardHeading = "Лабораторно-исследовательский стенд интеллектуальной мультиагентной системы поддержки принятия решений по обеспечению кибербезопасности";
async function assertStandardWorkspace(section) {
  const workspace = page.locator(".workspace");
  const structure = await workspace.evaluate(el => ({
    children:[...el.children].map(x=>({tag:x.tagName.toLowerCase(),sidebar:x.classList.contains("sidebar"),content:x.classList.contains("content")})),
    display:getComputedStyle(el).display,
    columns:getComputedStyle(el).gridTemplateColumns
  }));
  if(structure.children.length!==2 ||
     structure.children[0].tag!=="aside" || !structure.children[0].sidebar ||
     structure.children[1].tag!=="main" || !structure.children[1].content) {
    throw Error(section+": workspace must contain two direct siblings <aside.sidebar> + <main.content>: "+JSON.stringify(structure));
  }
  const aside = await workspace.locator(":scope > aside.sidebar").boundingBox();
  const main = await workspace.locator(":scope > main.content").boundingBox();
  if(!aside||!main||aside.width<150||main.width<350||main.x<aside.x+aside.width-2){
    throw Error(section+": workspace columns are not adjacent: "+JSON.stringify({aside,main}));
  }
  if((await page.locator("h1").count())!==1 ||
     (await page.locator("h1").first().innerText()).replace(/\s+/g," ").trim()!==standardHeading){
    throw Error(section+": the only h1 must be the unified laboratory heading");
  }
  if(!(await workspace.locator(":scope > main.content > nav.r27-experiment-navigation").count())){
    throw Error(section+": experiment navigation must be inside the content sibling");
  }
}
await assertStandardWorkspace("Расчет доверия");
const titleGeometry=await page.locator(".topbar").evaluate(el=>{
 const brand=el.querySelector(".brand h1"),toolbar=el.querySelector(".toolbar");
 const a=brand.getBoundingClientRect(),b=toolbar.getBoundingClientRect(),bar=el.getBoundingClientRect();
 const lines=[...brand.querySelectorAll(".brand-line")].map(x=>x.getBoundingClientRect());
 const select=document.getElementById("imas-experiment-select");
 return {
  text:brand.innerText.replace(/\s+/g," ").trim(),left:a.left,right:a.right,top:a.top,bottom:a.bottom,
  toolbarLeft:b.left,barLeft:bar.left,barRight:bar.right,barTop:bar.top,barBottom:bar.bottom,
  scrollWidth:brand.scrollWidth,clientWidth:brand.clientWidth,scrollHeight:brand.scrollHeight,clientHeight:brand.clientHeight,
  font:getComputedStyle(brand).fontSize,lines:lines.map(x=>({top:x.top,bottom:x.bottom})),
  selectFont:getComputedStyle(select).fontSize,
  labelFont:getComputedStyle(select.closest("label")).fontSize,
  optionFont:getComputedStyle(select.options[0]).fontSize
 };
});
if(titleGeometry.text!==standardHeading||
 titleGeometry.lines.length!==2||titleGeometry.lines[0].top>=titleGeometry.lines[1].top||
 titleGeometry.right>titleGeometry.toolbarLeft+2||
 titleGeometry.top<titleGeometry.barTop-2||titleGeometry.bottom>titleGeometry.barBottom+2||
 titleGeometry.scrollWidth>titleGeometry.clientWidth+2||
 titleGeometry.scrollHeight>titleGeometry.clientHeight+2||
 titleGeometry.font!=="18px"||
 titleGeometry.labelFont!=="12px"||titleGeometry.selectFont!=="12px"||titleGeometry.optionFont!=="12px"){
 throw Error("Two-line left brand and experiment selector must match the active layout: "+JSON.stringify(titleGeometry));
}
const trustSummary=page.locator(".trust-summary-table tbody tr");
if((await trustSummary.count())!==4)throw Error("One-run results must contain four shared trust methods");
const trustNames=await trustSummary.locator("td:first-child").allTextContents();
if(!trustNames.some(x=>x.includes("без доверительной фильтрации"))||
   !trustNames.some(x=>x.includes("комбинированный метод")))
 throw Error("One-run table conflates robust trimming with combined method");

// UP-02: editing is transactional. Replacing N or T must never mutate f, trim,
// attack start, or other fields, including during intermediate typing.
const inputN=page.getByRole("spinbutton",{name:"N — число легитимных агентов"});
const inputF=page.getByRole("spinbutton",{name:"f — число византийских агентов"});
const inputT=page.getByRole("spinbutton",{name:"Число шагов (T)"});
const inputAttack=page.getByRole("spinbutton",{name:"Время начала атаки (шаг)"});
const initialF=await inputF.inputValue(),initialAttack=await inputAttack.inputValue();
await inputN.fill("15");await inputN.press("Tab");
if((await inputN.inputValue())!=="15"||(await inputF.inputValue())!==initialF)
 throw Error("UP-02: editing N silently rewrote f");
await inputN.fill("50");await inputN.press("Tab");
await inputT.fill("3"); // Temporary intermediate input, without committing it.
await inputT.fill("300");await inputT.press("Tab");
if((await inputT.inputValue())!=="300"||(await inputAttack.inputValue())!==initialAttack)
 throw Error("UP-02: editing T silently rewrote attack_start_step");
await inputT.fill("200");await inputT.press("Tab");
// NZ-10: invalid numeric input must show a durable error and preserve old value.
await inputN.fill("7.5");await inputN.press("Tab");
await page.locator(".imas-validation-error").getByText("Недопустимое значение N", {exact:false}).waitFor();
if((await inputN.inputValue())!=="50")throw Error("NZ-10: fractional N committed");
if(!(await page.locator(".imas-validation-error").count()))throw Error("NZ-10: validation error lost on blur");
await inputN.fill("13");await inputN.press("Escape");
if((await inputN.inputValue())!=="50")throw Error("NZ-10: Escape committed discarded value");
if((await page.locator(".imas-validation-error").count()))throw Error("NZ-10: stale error after Escape");
await inputN.fill("16");await inputN.press("Enter");
if((await inputN.inputValue())!=="16")throw Error("NZ-10: Enter did not commit valid N");
await inputN.fill("50");await inputN.press("Tab");



// Compare the actual structural shell and computed design tokens, not only class names.
async function pageChromeSnapshot(){
 return await page.locator(".workspace").evaluate(workspace=>{
  const sidebar=workspace.querySelector(":scope > aside.sidebar");
  const content=workspace.querySelector(":scope > main.content");
  const nav=content?.querySelector(":scope > nav.r27-experiment-navigation");
  const heading=content?.querySelector(":scope > header.imas-experiment-heading");
  const progress=content?.querySelector(":scope > .progress-strip");
  const overview=content?.querySelector(":scope > .trust-overview-grid")||
    content?.querySelector(":scope > .r27-study-topline > .r27-topology-full");
  const topology=overview?.querySelector(":scope > section.r27-replay");
  const summary=overview?.querySelector(":scope > section.panel")||
    content?.querySelector(":scope > .r27-study-topline > section.r27-summary-panel")||
    content?.querySelector(":scope > section.r27-summary-panel");
  const kpis=content?.querySelector(":scope > .kpi-grid");
  const controls=sidebar?.querySelector(":scope > button.run-button");
  if(!sidebar||!content||!nav||!heading||!progress||!topology||!summary||!kpis||!controls){
   throw Error("Missing unified experiment shell element: "+JSON.stringify({sidebar:!!sidebar,content:!!content,nav:!!nav,heading:!!heading,progress:!!progress,topology:!!topology,summary:!!summary,kpis:!!kpis,controls:!!controls}));
  }
  const css=(node,names)=>Object.fromEntries(names.map(x=>[x,getComputedStyle(node)[x]]));
  const box=node=>{const r=node.getBoundingClientRect();return {width:r.width,height:r.height,x:r.x,y:r.y}};
  const childNames=node=>Array.from(node.children).map(x=>x.tagName.toLowerCase()+"."+(x.className&&typeof x.className==="string"?x.className.split(/\s+/).sort().join("."):""));
  return {
   workspace:css(workspace,["display","gridTemplateColumns"]),
   sidebarClass:sidebar.className.split(/\s+/).sort().join(" "),
   contentClass:content.className.split(/\s+/).sort().join(" "),
   sidebar:css(sidebar,["display","gridTemplateRows","backgroundColor","borderRightWidth"]),
   content:css(content,["display","overflowY","paddingLeft","paddingRight","backgroundColor"]),
   nav:css(nav,["display","paddingTop","paddingBottom","backgroundColor","borderBottomWidth","position"]),
   heading:css(heading,["display","paddingLeft","paddingTop","marginBottom"]),
   headingChildren:Array.from(heading.children).map(x=>x.tagName.toLowerCase()+"."+x.className),
   headingTitle:css(heading.querySelector("h2"),["fontSize","fontWeight","lineHeight","color"]),
   progress:css(progress,["minHeight","paddingTop","paddingBottom"]),
   overview:css(overview,["display","gridTemplateColumns","gap"]),
   topology:css(topology,["paddingTop","paddingLeft","borderRadius"]),
   summary:css(summary,["borderRadius","backgroundColor","borderTopWidth"]),
   summaryParts:childNames(summary),
   kpiClass:kpis.className.includes("kpi-grid"),
   kpiCount:kpis.querySelectorAll(":scope > .kpi").length,
   kpiParts:childNames(kpis.querySelector(":scope > .kpi")),
   sidebarParts:childNames(sidebar).slice(0,2),
   mainParts:childNames(content).slice(0,3),
   geometry:{sidebar:box(sidebar),content:box(content),nav:box(nav),heading:box(heading),topology:box(topology),summary:box(summary),kpis:box(kpis)}
  };
 });
}
const baselineChrome=await pageChromeSnapshot();
if(baselineChrome.kpiCount!==4)throw Error("Trust must have four KPI cards");
const navSignature=()=>page.locator('main.content > nav.r27-experiment-navigation').evaluate(node=>Array.from(node.children).filter(child=>!child.classList?.contains("r27-export-control")).map(child=>({tag:child.tagName.toLowerCase(),className:typeof child.className==="string"?child.className:"",role:child.getAttribute("role"),type:child.getAttribute("type")})));
const trustNavigation=await navSignature();
const toolbarSignature=()=>page.locator(".topbar .toolbar").evaluate(node=>Array.from(node.children).map(child=>({tag:child.tagName.toLowerCase(),className:child.className||"",title:child.title||""})));
const trustToolbar=await toolbarSignature();
// All six trust modes must preserve the shared page shell.
const modeGroup=page.getByRole("group",{name:"Режим эксперимента"});
const trustModes=[["trace","Один прогон"],["mc","Монте-Карло"],["sensitivity","Чувствительность"],["stability","Устойчивость и точность"],["adaptive","Адаптивные решения"],["data","Данные"]];
if((await modeGroup.getByRole("button").count())!==trustModes.length)throw Error("Six trust mode buttons must be visible");
for(const [id,name] of trustModes){
  const button=modeGroup.getByRole("button",{name,exact:true});
  await button.click();
  if((await button.getAttribute("aria-pressed"))!=="true")throw Error("Trust mode did not become active: "+name);
  if((await page.getByRole("combobox",{name:"Выбор эксперимента"}).inputValue())!=="trace")throw Error("Trust mode switch changed main experiment");
  if(JSON.stringify(await navSignature())!==JSON.stringify(trustNavigation))throw Error("Main navigation changed when switching trust mode: "+name);
  if((await page.locator("main[data-study='trust'] > .imas-experiment-heading").count())!==1)throw Error("Trust heading missing after mode switch: "+name);
  await assertStandardWorkspace(name);
  if(id==="stability"){
   await page.getByText("Устойчивость по Ляпунову и точность коллективных оценок").waitFor();
   const header=page.locator(".lyapunov-study .tab-action");
   if((await header.getByText("Четыре метода:",{exact:false}).count())!==1||
      (await header.getByText("Цель:",{exact:false}).count())!==1)
     throw Error("Research description and goal must be inside tab-action");
   if((await page.locator(".lyapunov-study > p.r27-note").count())!==0)
     throw Error("Research description must not be split outside tab-action");
   if((await page.getByRole("spinbutton",{name:"Коэффициент обратной связи k"}).count())!==1)
    throw Error("Stability tab must expose Lyapunov feedback control");
   if((await page.getByText("Динамическая активность атаки").count())!==1)
    throw Error("Stability tab must expose an attack phase editor");
  }
}
// An E1 job can continue behind another mode; finish it with E1 visible
// before starting E1-A, which deliberately uses the same origin lease.
await modeGroup.getByRole("button",{name:"Один прогон",exact:true}).click();
await page.waitForFunction(()=>{
 const stop=Array.from(document.querySelectorAll(".topbar .toolbar button"))
  .find(b=>b.textContent?.includes("Остановить"));
 return Boolean(stop&&stop.disabled);
},null,{timeout:60000});
// Wait for the mount-triggered baseline E1 run to release the shared
// same-origin Web Lock. Starting E1-A while E1 holds it must fail closed.
await page.waitForFunction(async()=>{
 const current=await navigator.locks.query();
 return !current.held.some(lock=>lock.name==="imas-lab-test-trust-storage-exclusive-v1");
},null,{timeout:60000});
// E1-A: actual React -> worker -> IndexedDB -> archival export workflow.
// Exercise E1-A with the initial E1 configuration (N=50, T=200).
await page.getByRole("group",{name:"Режим эксперимента"}).getByRole("button",{name:"Адаптивные решения"}).click();
const e1aRuns=page.getByRole("spinbutton",{name:"Повторения R",exact:true});
await e1aRuns.fill("2");await e1aRuns.press("Tab");
const e1aAction=page.locator(".tab-action").getByRole("button",{name:"Выполнить исследование"});
await e1aAction.click();
try{
 await page.getByRole("heading",{name:"Парные сравнения RMSE"}).waitFor({timeout:18000});
}catch(error){
 const messages=await page.locator(".imas-validation-error, .r27-note[role='status']").allTextContents();
 const locks=await page.evaluate(async()=>navigator.locks.query());
 const state=await page.locator(".tab-action").allTextContents();
 throw Error("E1-A browser computation did not finish: "+JSON.stringify({messages,state,locks}).slice(0,2200)+"; "+String(error));
}
await page.getByRole("heading",{name:"Итоговые показатели по методам"}).waitFor({timeout:45000});
const e1aRows=await page.locator("section.panel").filter({hasText:"Итоговые показатели по методам"}).locator("tbody tr").count();
if(e1aRows!==5)throw Error("E1-A: expected five paired method metrics, got "+e1aRows);
const e1aDownload=page.getByRole("button",{name:"Скачать полный JSON"});
const [e1aFile]=await Promise.all([page.waitForEvent("download",{timeout:15000}),e1aDownload.click()]);
const e1a=JSON.parse(fs.readFileSync(await e1aFile.path(),"utf8"));
if(e1a.archiveFormat!=="imas-adaptive-collective-decisions"||
 e1a.completedRuns!==2||e1a.partial||e1a.summary?.length!==5||e1a.trace?.length!==200||
 e1a.runs?.length!==2||e1a.paired?.length!==4)
 throw Error("E1-A: incomplete or inconsistent complete JSON research record");
if(e1a.trace.some(x=>!(x.alpha===null||(x.alpha>=0&&x.alpha<=1))||
 !(x.k===null||Number.isInteger(x.k))))
 throw Error("E1-A: invalid adaptive control parameters in exported trace");
await e1aAction.click();
await page.locator(".topbar .cache-badge").waitFor({timeout:15000});
const e1aAdaptiveSummary={methods:e1aRows,runs:e1a.completedRuns,
 cacheReloaded:Boolean(await page.locator(".topbar .cache-badge").count()),
 paired:e1a.paired.length};


// E1-A reduced decision-feedback loop: real React -> Worker simulation with
// independent trust/isolation per estimator and observable-only testimony.
await page.getByRole("combobox",{name:"Режим сравнительного исследования"}).selectOption("decision_feedback");
await page.getByRole("combobox",{name:"Стратегия поведения нарушителей"}).selectOption("coordinated");
await page.getByRole("combobox",{name:"Модель доверительных свидетельств"}).selectOption("behavior_linked");
await e1aRuns.fill("1");await e1aRuns.press("Tab");
if(await e1aAction.isDisabled())throw Error("E1-A feedback controls unexpectedly invalid");
await e1aAction.click();
try{
 await page.getByRole("heading",{name:"Независимая динамика доверия и изоляции"}).waitFor({timeout:60000});
}catch(error){
 const messages=await page.locator(".imas-validation-error, .r27-note[role='status']").allTextContents();
 throw Error("E1-A feedback browser mode failed: "+JSON.stringify(messages)+"; "+String(error));
}
const [coupledFile]=await Promise.all([page.waitForEvent("download",{timeout:15000}),e1aDownload.click()]);
const coupled=JSON.parse(fs.readFileSync(await coupledFile.path(),"utf8"));
if(coupled.options.comparisonMode!=="decision_feedback"||
 coupled.options.evidenceModel!=="behavior_linked"||
 coupled.runs?.[0]?.methodStates?.adaptive_robust?.length!==200||
 Object.keys(coupled.runs?.[0]?.methodStates||{}).length!==5||
 coupled.runs?.[0]?.scenarioDiagnosticsByMethod?.adaptive_robust?.feedbackDecisionUsed<=0)
 throw Error("E1-A: feedback archive missing independent states or feedback witness counters");
e1aAdaptiveSummary.feedbackVerified=true;

// E1-A online risk adaptation in a real browser. The exported series must
// contain only causal prequential controls, not the simulation oracle.
await page.getByRole("combobox",{name:"Режим сравнительного исследования"}).selectOption("estimator_only");
await page.getByRole("combobox",{name:"Стратегия поведения нарушителей"}).selectOption("legacy");
await page.getByRole("combobox",{name:"Модель доверительных свидетельств"}).selectOption("legacy");
await page.getByRole("combobox",{name:"Режим коэффициента alpha"}).selectOption("risk_aware");
await page.getByRole("spinbutton",{name:"Чувствительность к риску"}).fill("5");
await e1aRuns.fill("1");await e1aRuns.press("Tab");
await e1aAction.click();
try{
 await page.getByRole("heading",{name:"Парные сравнения RMSE"}).waitFor({timeout:60000});
 await page.getByText("Нормированная разность прогнозных ошибок").waitFor({timeout:20000});
}catch(error){
 const messages=await page.locator(".imas-validation-error, .r27-note[role='status']").allTextContents();
 throw Error("E1-A risk UI did not produce evidence: "+JSON.stringify(messages)+"; "+String(error));
}
const [riskFile]=await Promise.all([page.waitForEvent("download",{timeout:15000}),e1aDownload.click()]);
const riskRecord=JSON.parse(fs.readFileSync(await riskFile.path(),"utf8"));
if(riskRecord.options.alphaMode!=="risk_aware"||
 !riskRecord.models.risk?.includes("prequential")||
 riskRecord.trace?.length!==200||
 !riskRecord.trace.some(x=>x.riskPairs>=4&&Number.isFinite(x.riskContrast))||
 riskRecord.trace.some(x=>!(x.alpha>=0&&x.alpha<=1)))
 throw Error("E1-A browser risk trace missing valid causal risk diagnostics");
e1aAdaptiveSummary.riskBrowserVerified=true;
// E1-A network feedback: actual sidebar topology -> component reachability
// -> delayed worker feedback -> per-method decision-channel ledger -> JSON.
await page.locator("details.network-settings > summary").click();
await page.getByRole("checkbox",{name:"Учитывать сетевые ограничения"}).check();
await page.getByRole("combobox",{name:"Топология"}).selectOption("ring");
await page.getByRole("checkbox",{name:"Моделировать разделение сети"}).check();
await page.getByRole("combobox",{name:"Режим сравнительного исследования"}).selectOption("network_feedback");
await page.getByRole("combobox",{name:"Модель доверительных свидетельств"}).selectOption("behavior_linked");
await page.getByRole("spinbutton",{name:"Задержка доставки решения, шагов"}).fill("2");
await page.getByRole("spinbutton",{name:"Вероятность потери решения"}).fill("0.15");
await e1aRuns.fill("1");await e1aRuns.press("Tab");
if(await e1aAction.isDisabled())throw Error("E1-A network feedback controls unexpectedly invalid");
await e1aAction.click();
try{
 await page.getByRole("heading",{name:"Независимая динамика доверия и изоляции"}).waitFor({timeout:90000});
 await page.getByText("Доступность решения: адаптивное").waitFor({timeout:30000});
}catch(error){
 const messages=await page.locator(".imas-validation-error, .r27-note[role='status']").allTextContents();
 const state=await page.locator(".tab-action").allTextContents();
 throw Error("E1-A network feedback browser run failed: "+JSON.stringify({messages,state}).slice(0,1300)+"; "+String(error));
}
const [networkFile]=await Promise.all([page.waitForEvent("download",{timeout:15000}),e1aDownload.click()]);
const networkRecord=JSON.parse(fs.readFileSync(await networkFile.path(),"utf8"));
const networkDetails=networkRecord.runs?.[0]?.scenarioDiagnosticsByMethod?.adaptive_robust?.decisionChannel;
if(networkRecord.options.comparisonMode!=="network_feedback"||
 !networkRecord.configuration.network_enabled||
 networkRecord.configuration.network_topology!=="ring"||
 !networkRecord.configuration.partition_enabled||
 !networkRecord.models.decisionChannel?.includes("component-broadcast")||
 networkDetails?.history?.length!==200||networkDetails.attempted<=0||
 networkDetails.attempted!==(networkDetails.delivered+networkDetails.lost+
   networkDetails.blocked+networkDetails.expired+networkDetails.pending)||
 networkRecord.runs?.[0]?.methodStates?.adaptive_robust?.length!==200||
 networkDetails.history.some(x=>x.informed>x.reachable||x.informed<0))
 throw Error("E1-A: network feedback archive missing graph-conditioned provenance or violating separate packet conservation");
e1aAdaptiveSummary.networkFeedbackVerified=true;
// Restore the original no-network and no-partition configuration: the
// Lyapunov smoke subsequently shortens T below the partition end step.
await page.getByRole("checkbox",{name:"Моделировать разделение сети"}).uncheck();
await page.getByRole("checkbox",{name:"Учитывать сетевые ограничения"}).uncheck();

// Lyapunov: real Web Worker run and export, not merely static JSX verification.
await page.getByRole("group",{name:"Режим эксперимента"}).getByRole("button",{name:"Устойчивость и точность"}).click();
const stepInput=page.getByRole("spinbutton",{name:"Число шагов (T)"});
await stepInput.fill("40");await stepInput.press("Tab");
// "Время начала атаки" is the interval A between phases.
const gapInput=page.getByRole("spinbutton",{name:"Время начала атаки (шаг)"});
await gapInput.fill("5");await gapInput.press("Tab");
await page.getByRole("spinbutton",{name:"Число прогонов устойчивости"}).fill("1");
await page.getByRole("button",{name:"Типовой профиль on–off–усиление"}).click();
// A sixth and seventh phase must use T=(M+1)*A, independently of manual T.
for(const phase of [6,7]){
 await page.getByRole("button",{name:/Добавить фазу/}).click();
 if((await page.getByRole("spinbutton",{name:"Начало фазы "+phase}).count())!==1)
  throw Error("Cannot add phase "+phase);
 if((await stepInput.inputValue())!==String((phase+1)*5))
  throw Error("Automatic T must be (phase count + 1)*attack interval A");
}
if((await page.getByRole("spinbutton",{name:"Начало фазы 6"}).inputValue())!=="26"||
   (await page.getByRole("spinbutton",{name:"Начало фазы 7"}).inputValue())!=="31")
 throw Error("New phase must begin after the configured interval");
await stepInput.fill("70");await stepInput.press("Tab");
if((await stepInput.inputValue())!=="70")throw Error("Automatic T must permit manual override");
await stepInput.fill("40");await stepInput.press("Tab");
await page.getByRole("combobox",{name:"Закон изменения фазы 2"}).selectOption("linear");
if((await page.getByRole("combobox",{name:"Закон изменения фазы 2"}).locator('option:checked').innerText())!=="Линейное")
 throw Error("Linear profile must be labeled Линейное");
await page.getByRole("spinbutton",{name:"Конечная интенсивность фазы 2"}).fill("2");
if((await page.locator(".lyapunov-phase-grid > .lyapunov-phase").count())!==7)
 throw Error("Seven attack phases must share the single-row phase grid");
const phasePositions=await page.locator(".lyapunov-phase-grid > .lyapunov-phase").evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().top));
if(Math.max(...phasePositions)-Math.min(...phasePositions)>3)
 throw Error("Attack phases unexpectedly wrapped to multiple rows");
// Profile-only export is available even before computing a result.
const [phaseJsonFile]=await Promise.all([
 page.waitForEvent("download",{timeout:15000}),
 page.getByRole("button",{name:"Сохранить: Динамическая активность атаки"}).click()
]);
const phaseJson=JSON.parse(fs.readFileSync(await phaseJsonFile.path(),"utf8"));
if(phaseJson.numberOfPhases!==7||phaseJson.minimumPhaseGap!==5||
   phaseJson.phaseParameters.length!==7||phaseJson.simulationSteps!==40||phaseJson.automaticHorizon!==40)
 throw Error("Phase JSON export missed attack schedule and sidebar parameters");
const helpMarkers=page.locator(".lyapunov-inputs .parameter-tooltip");
if((await helpMarkers.count())!==4)throw Error("All four stability parameters need help tooltips");
await helpMarkers.first().hover();
await helpMarkers.first().locator('[role="tooltip"]').waitFor({state:"visible",timeout:5000});
await page.getByRole("spinbutton",{name:"Число прогонов устойчивости"}).fill("1");
await page.getByRole("button",{name:"Выполнить исследование"}).click();
try{
 await page.locator(".lyapunov-study .kpi-grid .kpi").first().waitFor({timeout:20000});
}catch(cause){
 const status=await page.locator(".lyapunov-study").innerText();
 throw Error("Lyapunov browser diagnosis: "+JSON.stringify({status:status.slice(0,1500),consoleErrors:errors.slice(-5)}),{cause});
}
const [lyapFile]=await Promise.all([
 page.waitForEvent("download",{timeout:15000}),
 page.getByRole("button",{name:"Экспорт JSON"}).click()
]);
const lyapData=JSON.parse(fs.readFileSync(await lyapFile.path(),"utf8"));
const progressInfo=await page.locator(".progress-strip").innerText();
if(!progressInfo.includes("100.0%"))throw Error("Stability progress bar must display 100% after completion");
if(lyapData.runs?.length!==1 || lyapData.summary?.length!==4 ||
  lyapData.series?.length!==lyapData.configuration.n_steps+1 ||
  !Number.isFinite(lyapData.nominal.unforced_lyapunov_factor) ||
  !lyapData.series.some(row=>row.attack_intensity>1) ||
  !lyapData.series.some(row=>row.attack_intensity===0) ||
  !(lyapData.series[8].attack_intensity>1&&lyapData.series[8].attack_intensity<2)){
 throw Error("Lyapunov worker: incomplete trajectories or incorrect dynamic activity");
}
// Export one specific chart, one table, and check the MIME formats.
const chartPanel=page.locator(".lyapunov-study .panel").filter({has:page.getByText("Профиль атакующего воздействия", {exact:true})}).first();
await chartPanel.getByRole("button",{name:/Сохранить объект:/}).click();
const [svgFile]=await Promise.all([page.waitForEvent("download"),chartPanel.getByRole("button",{name:"SVG",exact:true}).click()]);
const svgSource=fs.readFileSync(await svgFile.path(),"utf8");
if(!svgSource.includes("<svg")||!svgSource.includes("xmlns"))throw Error("Individual chart SVG export is invalid");
await chartPanel.getByRole("button",{name:/Сохранить объект:/}).click();
const [pngFile]=await Promise.all([page.waitForEvent("download"),chartPanel.getByRole("button",{name:"PNG",exact:true}).click()]);
const pngBytes=fs.readFileSync(await pngFile.path());
if(pngBytes.subarray(0,8).toString("hex")!=="89504e470d0a1a0a")throw Error("Individual chart PNG export is invalid");
const tablePanel=page.locator(".lyapunov-study .panel").filter({has:page.getByText("Сравнение показателей достижения цели исследования",{exact:true})}).first();
await tablePanel.getByRole("button",{name:/Сохранить объект:/}).click();
const [csvFile]=await Promise.all([page.waitForEvent("download"),tablePanel.getByRole("button",{name:"CSV",exact:true}).click()]);
const csvSource=fs.readFileSync(await csvFile.path(),"utf8");
if(!csvSource.includes("Доверительно-усечённое среднее")||!csvSource.includes("Покоординатное усечённое среднее"))
 throw Error("Individual four-method table CSV export is incomplete");
await tablePanel.getByRole("button",{name:/Сохранить объект:/}).click();
const [tablePng]=await Promise.all([page.waitForEvent("download"),tablePanel.getByRole("button",{name:"PNG",exact:true}).click()]);
if(fs.readFileSync(await tablePng.path()).subarray(0,8).toString("hex")!=="89504e470d0a1a0a")
 throw Error("Individual table PNG export is invalid");
// The universal picker also enumerates objects from manually authored panels.
await page.getByRole("button",{name:"Сохранить отдельный график, таблицу или схему"}).click();
const picker=page.getByRole("group",{name:"Выбор объекта для экспорта"});
if((await picker.getByRole("button",{name:/Сохранить \d+ в SVG/}).count())<1||
   (await picker.getByRole("button",{name:/Сохранить \d+ в CSV/}).count())<1)
 throw Error("Universal export picker must enumerate charts and tables");
await page.getByRole("button",{name:"Сохранить отдельный график, таблицу или схему"}).click();
await page.locator(".lyapunov-study").screenshot({path:path.join(here,"stability.png")});
const [archiveFile]=await Promise.all([
 page.waitForEvent("download",{timeout:15000}),
 page.getByRole("button",{name:"Сохранить полный протокол JSON"}).click()
]);
const archive=JSON.parse(fs.readFileSync(await archiveFile.path(),"utf8"));
if(archive.archiveFormat!=="imas-lyapunov-research-archive"||
   archive.inputs.trustConfiguration.n_steps!==40||
   archive.inputs.lyapunovParameters.phases.length!==7||
   archive.results.runs[0].trajectory.length!==40||
   archive.results.runs[0].feedback.proposed_robust.length!==41)
 throw Error("Full research archive does not contain sufficient inputs or per-run traces");
// A repeat of identical inputs must load the committed full result from IndexedDB.
await page.getByRole("button",{name:"Выполнить исследование"}).click();
await page.locator(".progress-strip").getByText("Результаты загружены из локального кэша").waitFor({timeout:15000});
if(!(await page.locator(".progress-strip").innerText()).includes("100.0%")||
 (await page.locator(".progress-strip em").innerText())!=="кэш")
 throw Error("Lyapunov result was not restored from persistent cache with 100% indicator");
const lyapunovVerification={methods:lyapData.summary.length,steps:lyapData.configuration.n_steps,runs:lyapData.runs.length,export:true,individualExports:["SVG","PNG","CSV","table-PNG"],universalPicker:true,phaseExport:true,archive:true};
await modeGroup.getByRole("button",{name:"Данные",exact:true}).click();
const registryRow=page.locator(".data-row").filter({hasText:"Реестр четырёх методов"});
const stabilityRow=page.locator(".data-row").filter({hasText:"Устойчивость и точность: полная запись"});
if((await registryRow.count())!==1||(await stabilityRow.getByRole("button",{name:"Скачать JSON"}).isDisabled()))
 throw Error("Data tab must preserve the shared four-method catalog and complete Lyapunov output");
await modeGroup.getByRole("button",{name:"Устойчивость и точность",exact:true}).click();
await stepInput.fill("200");await stepInput.press("Tab");
await gapInput.fill("20");await gapInput.press("Tab");
await page.getByRole("button",{name:"Типовой профиль on–off–усиление"}).click();
for(let phase=6;phase<=14;phase++)await page.getByRole("button",{name:/Добавить фазу/}).click();
if((await stepInput.inputValue())!=="300"||
 (await page.locator(".lyapunov-phase-grid > .lyapunov-phase").count())!==14)
 throw Error("Regression: 14 phases at 20 steps must produce T=300");
await stepInput.fill("200");await stepInput.press("Tab");
await modeGroup.getByRole("button",{name:"Один прогон",exact:true}).click();
await modeGroup.getByRole("button",{name:"Чувствительность",exact:true}).click();
const ablationMode=page.locator(".sensitivity-action select");
await ablationMode.selectOption("ablation");
if((await ablationMode.inputValue())!=="ablation")throw Error("UP-07/09 ablation mode missing from sensitivity control");
if(!(await page.getByText("Запустите абляционный эксперимент.").count()))throw Error("UP-07/09 ablation panel not mounted");
await modeGroup.getByRole("button",{name:"Один прогон",exact:true}).click();
if((await page.getByRole("combobox",{name:"Режим исследования"}).count())!==0)throw Error("Trust mode selector should not remain duplicated in sidebar");



const authorA = "Авторы · ктн Ушаков И.А. · Трофимова Н.А.";
const authorB = "Авторы · ктн Ушаков И.А. · ктн Харжевская А.В. · Егоров Е.В.";
if((await page.locator('main[data-study="trust"] > .imas-experiment-heading > .r27-kicker').innerText()).trim()!==authorA)throw Error("Incorrect authors for trust");
const trustTitle = "Математическая модель интеллектуальной мультиагентной системы поддержки принятия решений для защищенных информационных систем специального назначения";
if((await page.locator('main[data-study="trust"] > .imas-experiment-heading > h2.r27-study-title').innerText()).trim()!==trustTitle) throw Error("Trust experiment title is absent or differs from the required wording");

async function assertNavButtonsEqual(section){
 const help=page.locator(".r27-experiment-navigation .r27-nav-right");
 const mode=page.locator(".r27-experiment-navigation .r27-mode-tab").first();
 const [helpBox,modeBox,fonts]=await Promise.all([
  help.boundingBox(),mode.count().then(n=>n?mode.boundingBox():null),
  help.evaluate(el=>({helpSize:getComputedStyle(el).fontSize,modeSize:getComputedStyle(document.querySelector(".r27-mode-tab")||el).fontSize}))
 ]);
 if(!helpBox||Math.abs(helpBox.height-29)>1||
    (modeBox&&Math.abs(helpBox.height-modeBox.height)>1)||
    fonts.helpSize!==fonts.modeSize||fonts.helpSize!=="11px")
  throw Error(section+": Help and mode buttons must match height/font: "+JSON.stringify({helpBox,modeBox,fonts}));
}
await assertNavButtonsEqual("Расчет доверия");



const trustOverview = page.locator(".trust-overview-grid");
// Network-feedback UI verification intentionally changed the global E1
// configuration. The historical one-run view does not auto-recalculate a
// changed signature: explicitly refresh before asserting its trace panels.
if(!(await trustOverview.count()))
 await page.locator(".topbar .toolbar").getByRole("button",{name:"Запустить"}).click();
await trustOverview.waitFor({timeout:90000});
const topologyBox = await trustOverview.locator(".r27-replay").boundingBox();
const summaryBox = await trustOverview.locator(".panel").boundingBox();
const replay = trustOverview.locator(".r27-replay-compact");
const replaySvgButton=replay.getByRole("button",{name:"Экспорт графиков в SVG"});
if((await page.locator(".r27-experiment-navigation .r27-export-control").count())!==0||
   (await replaySvgButton.count())!==1)
 throw Error("SVG export must appear only in the compact replay header for trust tracing");
const replayHeader=await replay.locator(".r27-replay-heading").boundingBox();
const svgHeaderButton=await replaySvgButton.boundingBox();
if(!replayHeader||!svgHeaderButton||svgHeaderButton.y<replayHeader.y-1||
  svgHeaderButton.y>replayHeader.y+replayHeader.height+1||
  svgHeaderButton.x<replayHeader.x+replayHeader.width*.5)
 throw Error("SVG export button is not at the upper-right of compact replay");

const figureBox = await replay.locator(".r27-playback-figure").boundingBox();
const playbackInfo = await replay.locator(".r27-playback-aside").boundingBox();
const playbackControls = await replay.locator(".r27-playback-controls").boundingBox();
if(!figureBox||figureBox.height<380)throw Error("Compact network canvas not enlarged: "+JSON.stringify(figureBox));
if(!playbackInfo||playbackInfo.height>150)throw Error("Compact network state area too tall: "+JSON.stringify(playbackInfo));
if(!playbackControls||playbackControls.height>90)throw Error("Playback controls use too many rows: "+JSON.stringify(playbackControls));
if((await replay.locator(".r27-replay-notes summary").count())!==1)throw Error("Scientific network caveat should be preserved in collapsed details");

if (!topologyBox || !summaryBox || !(summaryBox.x > topologyBox.x + topologyBox.width - 2)) {
  throw new Error("Trust topology and summary table are not side-by-side");
}
if (!(topologyBox.width > summaryBox.width * 1.1)) throw new Error("The topology must have more width than the summary table: "+JSON.stringify({topologyBox,summaryBox}));
const pairedPanels = page.locator(".trust-synced-grid > .panel");
if ((await pairedPanels.count()) !== 2) throw new Error("Two synchronized charts are required");
const decisionBounds = await pairedPanels.nth(0).boundingBox();
const reputationBounds = await pairedPanels.nth(1).boundingBox();
if (!decisionBounds || !reputationBounds || Math.abs(decisionBounds.width - reputationBounds.width) > 2) {
  throw new Error("Decision and reputation chart panels must have equal widths");
}
const zoomGrid = page.locator(".trust-synced-grid");
const initialZoom = await zoomGrid.evaluate(node => ({start:+node.dataset.zoomFrom,end:+node.dataset.zoomTo,decision:+node.dataset.decisionPoints,reputation:+node.dataset.reputationPoints}));
if (initialZoom.end - initialZoom.start < 12) throw new Error("Trust simulation has insufficient steps to verify synchronized zoom");
await page.getByRole("spinbutton", {name:"Начальный шаг увеличения"}).fill(String(initialZoom.start + 4));
await page.getByRole("spinbutton", {name:"Конечный шаг увеличения"}).fill(String(initialZoom.end - 4));
const reducedZoom = await zoomGrid.evaluate(node => ({start:+node.dataset.zoomFrom,end:+node.dataset.zoomTo,decision:+node.dataset.decisionPoints,reputation:+node.dataset.reputationPoints}));
if (reducedZoom.start !== initialZoom.start+4 || reducedZoom.end !== initialZoom.end-4 ||
    reducedZoom.decision >= initialZoom.decision || reducedZoom.reputation >= initialZoom.reputation) {
  throw new Error("A common X range must filter both time series");
}
await page.getByRole("button",{name:"Показать весь интервал"}).click();
const resetZoom = await zoomGrid.evaluate(node => ({start:+node.dataset.zoomFrom,end:+node.dataset.zoomTo}));
if (resetZoom.start!==initialZoom.start || resetZoom.end!==initialZoom.end) throw new Error("Reset of synchronized zoom failed");

const firstPlot = page.locator(".trust-synced-grid .recharts-wrapper").first();
await firstPlot.scrollIntoViewIfNeeded();
const plot = await firstPlot.boundingBox();
if(!plot)throw Error("Missing decision chart for drag zoom");
const dragY = plot.y + Math.min(120, plot.height * .36);
await page.mouse.move(plot.x+plot.width*.34,dragY);
await page.mouse.down();
await page.mouse.move(plot.x+plot.width*.71,dragY,{steps:12});
await page.mouse.up();
const draggedZoom = await zoomGrid.evaluate(node => ({start:+node.dataset.zoomFrom,end:+node.dataset.zoomTo}));
if(draggedZoom.start <= initialZoom.start || draggedZoom.end >= initialZoom.end){
 throw Error("Mouse-selected X interval did not synchronize zoom: "+JSON.stringify(draggedZoom));
}
await page.getByRole("button",{name:"Показать весь интервал"}).click();



// Other E1-A browser tests may already have expanded the sidebar section.
const networkSidebar=page.locator("details.network-settings");
if((await networkSidebar.getAttribute("open"))===null)
 await networkSidebar.locator("summary").click();
await page.getByLabel("Число Sybil-идентичностей").waitFor();
await page.getByText("Статистика и вычисления", { exact: true }).click();
await page.getByLabel("Bootstrap-выборок").waitFor();
await page.getByLabel("Браузерных потоков (0 — авто)").waitFor();

const legacyControls = {
  sybil: await page.getByLabel("Число Sybil-идентичностей").count(),
  bootstrap: await page.getByLabel("Bootstrap-выборок").count(),
  parallelWorkers: await page.getByLabel("Браузерных потоков (0 — авто)").count(),
};
const dashboardScreenshot = path.join(here, "dashboard.png");
await page.screenshot({ path: dashboardScreenshot, fullPage: false });

await page.locator(".r27-experiment-navigation").getByRole("button", { name: "Справка", exact: true }).click();
await page.getByRole("heading", { name: "Единая справка по экспериментальному комплексу IMAS-lab" }).waitFor();
await page.locator(".r27-help-branch").count().then(count=>{if(count!==7)throw Error("Expected seven documentation tree groups");});
await page.getByRole("searchbox", {name:"Поиск по содержанию справки"}).fill("Модель доверия");
if(!(await page.getByRole("link", {name:"Модель доверия"}).count()))throw Error("Baseline mathematical help not indexed");
await page.getByRole("searchbox", {name:"Поиск по содержанию справки"}).fill("");
await page.locator(".r27-help-branch").filter({hasText:"Автоматические решения"}).locator("summary").first().click();
await page.getByRole("heading", {name:"Математическая модель локального наблюдения"}).waitFor();

const helpScreenshot = path.join(here, "help.png");
await page.screenshot({ path: helpScreenshot, fullPage: false });

const legacyHelpSections = await page.locator(".help-toc a").count();

const researchTabs = ["Автоматические решения", "Коллективное решение", "Опасные состояния", "Каскадные последствия", "Нарушение коллективного решения"];
const researchValues = ["study-uncertainty","study-probgraph","study-petri","study-cascade","study-misinformation"];
for (let i=0; i<researchTabs.length; i++) {
  await page.getByRole("combobox", { name: "Выбор эксперимента" }).selectOption(researchValues[i]);
  await page.locator("main.r27-experiment-content > .imas-experiment-heading > h2.r27-study-title").waitFor({ timeout: 10000 });
  await assertStandardWorkspace(researchTabs[i]);
  if(JSON.stringify(await navSignature())!==JSON.stringify(trustNavigation))throw Error(researchTabs[i]+": different experiment navigation markup");
  if((await page.getByRole("group",{name:"Режим эксперимента"}).getByText("Основной режим").count())!==1)throw Error("Research mode placeholder must preserve the shared navigation");
  if((await page.getByRole("group",{name:"Режим эксперимента"}).getByRole("button").count())!==0)throw Error("Trust-only modes displayed in unrelated experiment");
  if(JSON.stringify(await toolbarSignature())!==JSON.stringify(trustToolbar))throw Error(researchTabs[i]+": different toolbar markup");


  const currentChrome=await pageChromeSnapshot();
  const comparable=structure=>{
   const {geometry,...rest}=structure;
   // Dimensions and runtime states vary; compare shared structure, not active/idle calculation state.
   const mainParts=rest.mainParts.map(name=>name.includes("progress-strip")?name.replace(/\.(?:running|done)\b/g,""):name);
   return {...rest,mainParts,overview:{display:structure.overview.display,gap:structure.overview.gap}};
  };
  const base=comparable(baselineChrome),actual=comparable(currentChrome);
  // Compare the common shell, not the intentionally distinct scientific body.
  for(const key of ["overview","mainParts"]){delete base[key];delete actual[key];}
  if(JSON.stringify(base)!==JSON.stringify(actual)){
   const differences=Object.keys(base).filter(k=>JSON.stringify(base[k])!==JSON.stringify(actual[k])).map(k=>({component:k,trust:base[k],research:actual[k]}));
   throw Error("Different markup/design tokens for "+researchTabs[i]+": "+JSON.stringify(differences));
  }
  for(const key of ["sidebar","content","nav","kpis"]){
   const a=baselineChrome.geometry[key],b=currentChrome.geometry[key];
   if(Math.abs(a.width-b.width)>3){
    throw Error("Different "+key+" horizontal dimension for "+researchTabs[i]+": "+JSON.stringify({trust:a,research:b}));
   }
  }
  if(currentChrome.kpiCount!==4)throw Error("Every experiment must show the same four-column KPI grid");

  await assertNavButtonsEqual(researchTabs[i]);
  const authors=(await page.locator("main.r27-experiment-content > .imas-experiment-heading > .r27-kicker").innerText()).trim();
  if(authors!==((i===2||i===4)?authorB:authorA))throw Error("Wrong researcher attribution on "+researchTabs[i]+": "+authors);
  if ((await page.locator(".r27-theory-short").count())!==0) throw new Error("Inline mathematical theory must only be in unified help: "+researchTabs[i]);
  if ((await page.locator("main.r27-experiment-content .r27-formula").count())!==0) throw new Error("Unwanted formula on experiment page: "+researchTabs[i]);
  if (!(await page.locator(".r27-unified-settings input[type=number]").count())) throw new Error("Missing parameter inputs: " + researchTabs[i]);
  if (!(await page.locator(".r27-playback-svg").count())) throw new Error("Missing topology graph: " + researchTabs[i]);

  const researchMain = page.locator("main.r27-experiment-content");
  const surface = await researchMain.evaluate(el=>({
    overflowY:getComputedStyle(el).overflowY,
    nested:el.querySelectorAll(".r27-root,.r27-study-content,.r27-results").length,
    panelCount:el.querySelectorAll("section.panel").length,
    directHead:el.querySelector(":scope > header.imas-experiment-heading > h2.r27-study-title")?.textContent?.trim(),
    author:el.querySelector(":scope > header.imas-experiment-heading > .r27-kicker")?.textContent?.trim()
  }));
  if(surface.overflowY!=="auto" || surface.nested!==0 || surface.panelCount<1){
    throw Error(researchTabs[i]+": research layout must share the trust content scroller and independent panels: "+JSON.stringify(surface));
  }
  const researchOverview=researchMain.locator(":scope > .r27-study-topline > .r27-topology-full");
  const summaryInTopline=researchMain.locator(":scope > .r27-study-topline > section.panel.r27-summary-panel");
  const summaryBelowTopline=researchMain.locator(":scope > section.panel.r27-summary-panel");
  const petriStudy=researchValues[i]==="study-petri";
  if((await researchOverview.locator(":scope > .r27-replay-compact").count())!==1||
     (await summaryInTopline.count())!==(petriStudy?1:0)||
     (await summaryBelowTopline.count())!==(petriStudy?0:1)){
    throw Error(researchTabs[i]+": summary must be beside Petri replay only in E4; remaining studies retain below-summary placement");
  }
  if(petriStudy){
    const left=await researchOverview.boundingBox(),right=await summaryInTopline.boundingBox();
    if(!left||!right||Math.abs(left.y-right.y)>3||
       Math.abs(left.width-right.width)>3||Math.abs(right.x-left.x-left.width-12)>5){
      throw Error("E4: Petri graph and results table must occupy adjacent equal-width columns: "+JSON.stringify({left,right}));
    }
  }
  // All six studies must show exactly one SVG action in the replay header,
  // with none left in the navigation bar.
  const replayPanel=researchOverview.locator(":scope > .r27-replay-compact");
  const replayExport=replayPanel.locator(".r27-replay-heading-actions > button.r27-export-control");
  if((await page.locator(".r27-experiment-navigation .r27-export-control").count())!==0||
     (await researchMain.locator("button.r27-export-control").count())!==1||
     (await replayExport.count())!==1)
    throw Error(researchTabs[i]+": SVG export must live only in compact replay header");
  const headerRect=await replayPanel.locator(".r27-replay-heading").boundingBox();
  const buttonRect=await replayExport.boundingBox();
  if(!headerRect||!buttonRect||
     buttonRect.x<headerRect.x+headerRect.width*.5||
     buttonRect.x+buttonRect.width>headerRect.x+headerRect.width+2||
     buttonRect.y<headerRect.y-2||
     buttonRect.y>headerRect.y+headerRect.height+2)
    throw Error(researchTabs[i]+": SVG action not aligned to upper-right replay corner");
  const topbar=page.locator(".topbar");
  for(const label of ["Новый сид","Запустить","Остановить","Сбросить"]){
    if((await topbar.getByRole("button",{name:label,exact:true}).count())!==1){
      throw Error(researchTabs[i]+": absent shared toolbar action "+label);
    }
  }
  if((await topbar.getByText("Автономный локальный эксперимент").count())!==0){
    throw Error(researchTabs[i]+": legacy study-specific topbar must be removed");
  }
  if(researchValues[i]==="study-petri"){
    const policy=page.getByRole("combobox",{name:"Политика изоляции"});
    if((await policy.inputValue())!=="0")throw Error("UP-22 default Petri policy must remain nondeterministic");
    await policy.selectOption("1");
    if((await policy.inputValue())!=="1")throw Error("UP-22 mandatory Petri controller selection does not persist");
    await topbar.getByRole("button",{name:"Сбросить",exact:true}).click();
    if((await policy.inputValue())!=="0")throw Error("UP-22 Petri reset did not restore optional policy");
  }

}
await page.getByRole("combobox", { name: "Выбор эксперимента" }).selectOption("study-uncertainty");
const seedInput = page.locator(".r27-unified-settings input[aria-label=\"Начальное зерно генератора\"]");
const firstSeed = await seedInput.inputValue();
await page.locator(".topbar").getByRole("button",{name:"Новый сид",exact:true}).click();
if((await seedInput.inputValue())===firstSeed)throw Error("Common toolbar seed action has no effect on research study");
await page.locator(".topbar").getByRole("button",{name:"Сбросить",exact:true}).click();
await page.locator(".r27-unified-settings input[type=number]").nth(1).fill("10");
await page.locator(".topbar").getByRole("button", { name: "Запустить", exact: true }).click();
await page.locator(".r27-summary-panel .r27-table tbody tr").first().waitFor({timeout:30000});
await page.getByRole("button", {name:"Воспроизвести"}).click();
await page.getByRole("button", {name:"Пауза"}).waitFor({timeout:3000});
await page.getByRole("button", {name:"Пауза"}).click();
await page.getByRole("slider", {name:"Выбор такта"}).press("ArrowRight");
if(!(await page.locator(".r27-state-matrix").count()))throw Error("Missing state heatmap");
const researchComputed = await page.locator(".r27-summary-panel .r27-table tbody tr").count() >= 9;
const passportPanel=page.locator("section.panel").filter({hasText:"Паспорта ключевых показателей"});
const metricPassportRows=await passportPanel.locator("tbody tr").count();
if(metricPassportRows!==5)throw Error("UP-04: expected five executable metric passports for E2, got "+metricPassportRows);
const passportStatus=await passportPanel.innerText();
if(!passportStatus.includes("пройден"))throw Error("UP-04: accounting audit did not pass for E2");
const comparisonGrid=page.locator(".r27-study-topline");
const plotBox=await comparisonGrid.locator(":scope > .r27-topology-full").boundingBox();
const matrixBox=await comparisonGrid.locator(":scope > .r27-comparison-matrix").boundingBox();
if(!plotBox||!matrixBox||Math.abs(plotBox.width-matrixBox.width)>3||Math.abs(plotBox.y-matrixBox.y)>3||
   Math.abs(matrixBox.x-(plotBox.x+plotBox.width+12))>5)
 throw Error("UI-E2: chart and scenario matrix must be equal-width adjacent panels: "+JSON.stringify({plotBox,matrixBox}));
if((await page.locator(".r27-comparison-matrix").count())!==1)throw Error("UI-E2: duplicate comparison matrix");
const summaryAfterStudySummary=await page.locator("main[data-study='uncertainty']").evaluate(el=>{
 const summary=el.querySelector(":scope > .r27-summary-panel");
 const study=el.querySelector(":scope > .r27-study-summary");
 return Boolean(summary&&study&&study.nextElementSibling===summary);
});
if(!summaryAfterStudySummary)throw Error("UI-E2: summary must immediately follow study summary");

if((await page.locator(".r27-analytics > section.panel.r27-panel").count())<2)throw Error("Research study diagrams must use the shared panel component");
const topologyVisibleOnResearch = await page.locator(".r27-playback-svg").count();
const researchScreenshot = path.join(here, "research2027.png");
await page.screenshot({ path: researchScreenshot, fullPage: false });
await page.locator(".r27-experiment-navigation").getByRole("button", { name: "Справка", exact: true }).click();
await page.getByRole("heading", { name: "Единая справка по экспериментальному комплексу IMAS-lab" }).waitFor();
if((await page.locator(".r27-module-article").count())!==6)throw Error("Missing exactly six experiment manual articles");
if((await page.locator(".r27-manual-equation").count())<25)throw Error("Missing mathematical equations");
if((await page.locator(".r27-doc-simple").count())!==6)throw Error("UI-help: all six plain-language guides must appear");
if((await page.locator(".r27-experiment-navigation .r27-manual-return").count())!==1 ||
   (await page.locator(".r27-manual-body .r27-manual-return").count())!==0)
 throw Error("UI-help: return button must be inside navigation, not help body");
await page.getByRole("button",{name:"Вернуться к экспериментам"}).click();
if((await page.getByRole("combobox",{name:"Выбор эксперимента"}).inputValue())!=="study-uncertainty")
 throw Error("UI-help: return did not restore the last experiment");
await page.locator(".r27-experiment-navigation").getByRole("button",{name:"Справка",exact:true}).click();
await page.getByRole("heading",{name:"Единая справка по экспериментальному комплексу IMAS-lab"}).waitFor();


const report = {
  title: await page.title(),
  researchComparisonEqualWidth:true,
  researchSummaryAfterStudySummary:true,
  helpReturnToExperiment:true,
  helpSimpleExplanations:6,
  url: page.url(),
  browser: usingSystemBrowser ? executablePath : "bundled @sparticuz/chromium",
  bodyLength: (await page.locator("body").innerText()).trim().length,
  buttons: await page.getByRole("button").count(),
  fields: await page.locator("input, select").count(),
  helpSections: legacyHelpSections,
  requiredControls: legacyControls,
  researchTabs,
  researchComputed,
  topology: topologyVisibleOnResearch,
  researchHelp: await page.locator(".r27-manual-layout").count(),
  mathematicalModules: await page.locator(".r27-module-article").count(),
  errors,
  warnings,
  apiCalls,
  screenshots: { dashboard: dashboardScreenshot, help: helpScreenshot, research: researchScreenshot },
};

// NZ-13: execute all remaining research kernels through the real React/Worker UI,
// not merely their module-level unit tests or the static presence of controls.
report.researchRuns={};
for(const [studyId,name] of [
 ["study-probgraph","probgraph"],["study-petri","petri"],
 ["study-cascade","cascade"],["study-misinformation","misinformation"]
]){
 await page.getByRole("combobox",{name:"Выбор эксперимента"}).selectOption(studyId);
 if(name!=="petri")await page.getByRole("spinbutton",{name:"R — число прогонов"}).fill("10");
 await page.locator(".topbar").getByRole("button",{name:"Запустить",exact:true}).click();
 await page.locator(".r27-study-summary").waitFor({timeout:45000});
 const button=page.locator(".r27-result-tools").getByRole("button",{name:"Скачать JSON"});
 const [download]=await Promise.all([page.waitForEvent("download",{timeout:15000}),button.click()]);
 const result=JSON.parse(fs.readFileSync(await download.path(),"utf8"));
 if(result.id!==name||!result.metricIntegrity?.valid||result.rows?.length<2)
  throw Error("NZ-13: invalid end-to-end result for "+name);
 if(name!=="petri"&&result.config.runs!==10)
  throw Error("NZ-13: requested sample size not reflected in "+name);
 if(name==="petri"&&!["reachable","unreachable_within_bound","inconclusive"].includes(result.verdict))
  throw Error("NZ-13: Petri failed to expose formal verdict");
 if((name==="probgraph"||name==="cascade")&&(!result.replay?.runId||!result.replaySample))
  throw Error("NZ-11: actual paired trace is not exported for "+name);
 if(name==="probgraph"&&result.replay.frames.at(-1).value!==result.pairedRuns[0].methods[0].finalFraction)
  throw Error("NZ-11: graph replay does not reproduce baseline paired outcome");
 if(name==="cascade"&&result.replay.frames.at(-1).value!==result.pairedRuns[0].methods[0].loss)
  throw Error("NZ-11: cascade replay does not reproduce baseline paired loss");
 if(name!=="petri"){
  const widths=await page.locator(".r27-study-topline").evaluate(grid=>[...grid.children].map(x=>x.getBoundingClientRect().width));
  if(widths.length!==2||Math.abs(widths[0]-widths[1])>3)
   throw Error("UI: unequal graph and matrix widths for "+name+": "+JSON.stringify(widths));
  if((await page.locator("main[data-study='"+name+"'] > section.r27-summary-panel").count())!==1)
   throw Error("UI: relocated summary absent for "+name);
  const positioned=await page.locator("main[data-study='"+name+"']").evaluate(el=>
   el.querySelector(":scope > .r27-study-summary")?.nextElementSibling===
   el.querySelector(":scope > .r27-summary-panel"));
  if(!positioned)throw Error("UI: summary must follow study summary for "+name);
 }else{
  const petriTopline=page.locator("main[data-study='petri'] > .r27-study-topline");
  const graphBox=await petriTopline.locator(":scope > .r27-topology-full").boundingBox();
  const tablePanel=petriTopline.locator(":scope > .r27-summary-panel");
  const tableBox=await tablePanel.boundingBox();
  const actualRows=await tablePanel.locator("tbody tr").count();
  if(!graphBox||!tableBox||actualRows!==result.rows.length||
     Math.abs(graphBox.y-tableBox.y)>3||
     Math.abs(graphBox.width-tableBox.width)>3||
     Math.abs(tableBox.x-graphBox.x-graphBox.width-12)>5)
    throw Error("E4: summary must remain beside the Petri graph and show all "+result.rows.length+" rows: "+JSON.stringify({graphBox,tableBox,actualRows}));
  if((await page.locator("main[data-study='petri'] > section.r27-summary-panel").count())!==0)
    throw Error("E4: duplicate results table left below Petri graph");
  if((await page.locator(".r27-study-topline .r27-comparison-matrix").count())!==0)
   throw Error("E4 must not invent a probabilistic comparison matrix");
  const widths=await page.locator(".r27-analytics").evaluate(root=>[...root.children].slice(0,2).map(x=>x.getBoundingClientRect().width));
  if(widths.length!==2||Math.abs(widths[0]-widths[1])>3)
   throw Error("E4: formal history and agent state matrix must have equal widths");
 }

 report.researchRuns[name]={rows:result.rows.length,modelVersion:result.modelVersion,
  verified:result.metricIntegrity.valid,runId:result.replay?.runId||null};
}

// NZ-14: prove real Chromium IndexedDB persistence across navigation AND reload,
// not merely an in-process mock, using the same validated E2 configuration.
await page.getByRole("combobox",{name:"Выбор эксперимента"}).selectOption("study-uncertainty");
await page.getByRole("spinbutton",{name:"R — число прогонов"}).fill("10");
await page.locator(".topbar").getByRole("button",{name:"Запустить",exact:true}).click();
await page.locator(".progress-strip").getByText("Результат восстановлен из IndexedDB",{exact:false}).waitFor({timeout:30000});
report.researchCacheAfterNavigation=true;
await page.reload({waitUntil:"domcontentloaded"});
await page.getByRole("heading",{name:"Лабораторно-исследовательский стенд интеллектуальной мультиагентной системы поддержки принятия решений по обеспечению кибербезопасности"}).waitFor();
await page.getByRole("combobox",{name:"Выбор эксперимента"}).selectOption("study-uncertainty");
await page.getByRole("spinbutton",{name:"R — число прогонов"}).fill("10");
await page.locator(".topbar").getByRole("button",{name:"Запустить",exact:true}).click();
await page.locator(".progress-strip").getByText("Результат восстановлен из IndexedDB",{exact:false}).waitFor({timeout:30000});
report.researchCacheAfterReload=true;
if(!report.researchCacheAfterNavigation||!report.researchCacheAfterReload)
 throw Error("NZ-14: research IndexedDB cache was lost during navigation/reload");

// NZ-15: real Chromium UI and Worker must archive and export EVERY run,
// with observations and hidden ground truth strictly separated.
report.researchSourceArchives={};
for(const [studyId,name,N] of [
 ["study-uncertainty","uncertainty",21],["study-misinformation","misinformation",7]
]){
 await page.getByRole("combobox",{name:"Выбор эксперимента"}).selectOption(studyId);
 await page.getByRole("spinbutton",{name:"R — число прогонов"}).fill("10");
 const advanced=page.locator("aside.r27-unified-settings details.advanced").first();
 await advanced.locator("summary").click();
 await page.getByRole("combobox",{name:"Архивировать исходные прогоны"}).selectOption("1");
 await page.locator(".topbar").getByRole("button",{name:"Запустить",exact:true}).click();
 const sourceButton=page.locator(".r27-result-tools").getByRole("button",{name:"Скачать исходные прогоны"});
 await sourceButton.waitFor({timeout:45000});
 const [download]=await Promise.all([page.waitForEvent("download",{timeout:20000}),sourceButton.click()]);
 const exported=JSON.parse(fs.readFileSync(await download.path(),"utf8"));
 if(exported.config.record_source_runs!==1||exported.journal?.complete!==true||
    exported.journal.entries?.length!==40||exported.journal.studyId!==name)
  throw Error("NZ-15 incomplete raw journal: "+name);
 for(const entry of exported.journal.entries){
  const messages=name==="uncertainty"?entry.messages:entry.observations;
  if(messages?.length!==N||!entry.methodEstimates||![-1,1].includes(entry.truth))
   throw Error("NZ-15 malformed agent-level observations: "+name);
 }
 report.researchSourceArchives[name]={runs:exported.journal.entries.length,agents:N,
  schema:exported.journal.schemaVersion,modelVersion:exported.modelVersion};
}

// NZ-15: browser exports the complete paired source graph tapes for E3/E5
// and the bounded BFS marking journal for E4 (not a display-only mock).
report.graphSourceArchives={};
for(const [studyId,id,mult] of [
 ["study-probgraph","probgraph",4],["study-cascade","cascade",8]
]){
 await page.getByRole("combobox",{name:"Выбор эксперимента"}).selectOption(studyId);
 await page.getByRole("spinbutton",{name:"R — число прогонов"}).fill("3");
 const advanced=page.locator("aside.r27-unified-settings details.advanced").first();
 await advanced.locator("summary").click();
 await page.getByRole("combobox",{name:"Архивировать исходные прогоны"}).selectOption("1");
 await page.locator(".topbar").getByRole("button",{name:"Запустить",exact:true}).click();
 const button=page.locator(".r27-result-tools").getByRole("button",{name:"Скачать исходные прогоны"});
 await button.waitFor({timeout:45000});
 const [download]=await Promise.all([page.waitForEvent("download",{timeout:20000}),button.click()]);
 const exported=JSON.parse(fs.readFileSync(await download.path(),"utf8"));
 if(exported.journal?.schemaVersion!==2||exported.journal?.complete!==true||
    exported.journal.entries?.length!==mult*3||exported.journal.studyId!==id)
  throw Error("NZ-15 incomplete E3/E5 graph event tape: "+id);
 if(!exported.journal.entries.every(e=>e.eventTape.length===(id==="probgraph"?exported.config.steps:8)&&
  e.eventTape.every(t=>t.length===e.edges.length)))
  throw Error("NZ-15 incomplete edge events in "+id);
 report.graphSourceArchives[id]={runs:exported.journal.entries.length,
  events:exported.journal.edgeEventCount};
}
await page.getByRole("combobox",{name:"Выбор эксперимента"}).selectOption("study-petri");
const petriAdvanced=page.locator("aside.r27-unified-settings details.advanced").first();
await petriAdvanced.locator("summary").click();
await page.getByRole("combobox",{name:"Полный журнал маркировок"}).selectOption("1");
await page.locator(".topbar").getByRole("button",{name:"Запустить",exact:true}).click();
const markingButton=page.locator(".r27-result-tools").getByRole("button",{name:"Скачать журнал маркировок"});
await markingButton.waitFor({timeout:45000});
const [markingsDownload]=await Promise.all([page.waitForEvent("download",{timeout:20000}),markingButton.click()]);
const markings=JSON.parse(fs.readFileSync(await markingsDownload.path(),"utf8"));
if(markings.journal?.studyId!=="petri"||!markings.journal?.complete||
   !markings.journal.records?.length||
   markings.journal.records.length!==markings.journal.processed)
 throw Error("NZ-15 invalid E4 bounded-search evidence");
report.markingSourceArchive={processed:markings.journal.processed,enqueued:markings.journal.enqueued,
 verdict:markings.journal.verdict};

// UP-35: the toolbar must export a real SVG generated by the active chart,
// not just display an SVG-labelled button.
const svgExport=page.locator('main[data-study="petri"] .r27-replay-compact button.r27-export-control');
if(await svgExport.isDisabled())throw Error("UP-35 SVG export unexpectedly disabled for E4");
const [svgDownload]=await Promise.all([page.waitForEvent("download",{timeout:20000}),svgExport.click()]);
const svgXml=fs.readFileSync(await svgDownload.path(),"utf8");
if(!svgDownload.suggestedFilename().endsWith(".svg")||
   !svgXml.includes("<svg")||!svgXml.includes("</svg>")||
   /\bNaN\b|undefined/.test(svgXml))
 throw Error("UP-35: invalid exported research SVG");
report.researchSvgExport={file:svgDownload.suggestedFilename(),bytes:svgXml.length,valid:true};

// UP-35: exercise the full Vite/React → Worker pool → four-arm ablation
// route, not merely the mode dropdown. Keep the run deliberately small.
await page.getByRole("combobox",{name:"Выбор эксперимента"}).selectOption("trace");
await page.locator("aside.sidebar summary").filter({hasText:"Дополнительно"}).click();
const field=async(label,value)=>{
 const control=page.getByRole("spinbutton",{name:label,exact:true});
 await control.fill(String(value));await control.press("Tab");
};
await field("Усечение с каждой стороны",2);
await field("f — число византийских агентов",2);
await field("N — число легитимных агентов",11);
await field("Число шагов (T)",20);
await field("Время начала атаки (шаг)",3);
await page.locator("aside.sidebar summary").filter({hasText:"Статистика и вычисления"}).click();
await field("Прогонов на точку чувствительности",2);
await page.getByRole("group",{name:"Режим эксперимента"}).getByRole("button",{name:"Чувствительность"}).click();
await page.locator(".sensitivity-action select").selectOption("ablation");
await page.locator(".sensitivity-action").getByRole("button",{name:"Выполнить"}).click();
await page.getByText("Абляционный эксперимент: режим атаки × управляющая изоляция",{exact:true}).waitFor({timeout:45000});
report.ablationRows=await page.locator("section.panel").filter({hasText:"Абляционный эксперимент: режим атаки × управляющая изоляция"}).locator("tbody tr").count();
report.ablationWorkerSmoke=report.ablationRows===16;

if(!report.ablationWorkerSmoke)throw Error("UP-35: expected 4×4 ablation rows from Web Workers, got "+report.ablationRows);

// A repeated call must read the complete scientific result from the cache.
await page.locator(".sensitivity-action").getByRole("button",{name:"Выполнить"}).click();
await page.locator(".topbar .cache-badge").waitFor({timeout:15000});
report.ablationCacheHit=await page.locator(".topbar .cache-badge").count()===1;
if(!report.ablationCacheHit)throw Error("UP-35: repeated ablation was not cached");

// Reload discards the JS in-memory Map. A cache hit after reconstructing the
// identical configuration confirms that the result survived in IndexedDB.
await page.reload({waitUntil:"domcontentloaded"});
await page.getByRole("heading",{name:"Лабораторно-исследовательский стенд интеллектуальной мультиагентной системы поддержки принятия решений по обеспечению кибербезопасности"}).waitFor();
await page.locator("aside.sidebar summary").filter({hasText:"Дополнительно"}).click();
await field("Усечение с каждой стороны",2);
await field("f — число византийских агентов",2);
await field("N — число легитимных агентов",11);
await field("Число шагов (T)",20);
await field("Время начала атаки (шаг)",3);
await page.locator("aside.sidebar summary").filter({hasText:"Статистика и вычисления"}).click();
await field("Прогонов на точку чувствительности",2);
await page.getByRole("group",{name:"Режим эксперимента"}).getByRole("button",{name:"Чувствительность"}).click();
await page.locator(".sensitivity-action select").selectOption("ablation");
await page.locator(".sensitivity-action").getByRole("button",{name:"Выполнить"}).click();
await page.locator(".topbar .cache-badge").waitFor({timeout:15000});
report.ablationReloadedCacheHit=await page.locator(".topbar .cache-badge").count()===1;
if(!report.ablationReloadedCacheHit)throw Error("UP-35: IndexedDB did not retain completed ablation across page reload");

// UP-35: verify real Web Worker scheduling with 4 and 1 streams, including
// numerical equivalence of exported scientific results across pool sizes.
const readAblationExport=async()=>{
 await page.getByRole("group",{name:"Режим эксперимента"}).getByRole("button",{name:"Данные",exact:true}).click();
 const row=page.locator(".data-row").filter({hasText:"Абляция: атака и управляющая изоляция"});
 const [file]=await Promise.all([page.waitForEvent("download",{timeout:15000}),row.getByRole("button",{name:"Скачать JSON"}).click()]);
 const result=JSON.parse(fs.readFileSync(await file.path(),"utf8"));
 await page.getByRole("group",{name:"Режим эксперимента"}).getByRole("button",{name:"Чувствительность"}).click();
 await page.locator(".sensitivity-action select").selectOption("ablation");
 return result;
};
const poolResults={};
for(const pool of [4,1]){
 await field("Браузерных потоков (0 — авто)",pool);
 await page.locator(".sensitivity-action").getByRole("button",{name:"Выполнить"}).click();
 await page.getByText("Абляционный эксперимент: режим атаки × управляющая изоляция",{exact:true}).waitFor({timeout:45000});
 // Wait until the job finishes, not merely until the stale table becomes visible.
 await page.locator(".sensitivity-action").getByRole("button",{name:"Выполнить"}).waitFor({state:"visible",timeout:45000});
 await page.waitForFunction(()=>!document.querySelector(".sensitivity-action button")?.disabled,{timeout:45000});
 poolResults[pool]=await readAblationExport();
 if(poolResults[pool].parallel_workers_used!==pool)
  throw Error("UP-35: requested "+pool+" workers, got "+poolResults[pool].parallel_workers_used);
 if(poolResults[pool].completed_tasks!==8||poolResults[pool].ablation_rows.length!==16)
  throw Error("UP-35: incomplete real browser calculation at pool size "+pool);
}
report.workerPool4=poolResults[4].parallel_workers_used;
report.workerPool1=poolResults[1].parallel_workers_used;
report.workerPoolsEquivalent=JSON.stringify(poolResults[4].ablation_rows)===JSON.stringify(poolResults[1].ablation_rows)
 &&JSON.stringify(poolResults[4].ablation_contrasts)===JSON.stringify(poolResults[1].ablation_contrasts);
if(!report.workerPoolsEquivalent)throw Error("UP-35: 1-worker and 4-worker scientific outputs differ");



// E1 regression: run the actual factorial model through the React UI and
// Workers, not just the mathematical unit oracle. Six main factors and all
// six confidence intervals must be visible, with nonempty plotted bars.
await field("Прогонов на точку факторного плана",2);
await field("Точек факторного плана (32 или 64)",32);
await page.locator(".sensitivity-action select").selectOption("factorial");
await page.locator(".sensitivity-action").getByRole("button",{name:"Выполнить"}).click();
await page.locator('[data-factorial-ready="6"]').waitFor({timeout:90000});
const mainEffectsPanel=page.locator("section.panel").filter({hasText:"Главные эффекты факторов"}).first();
const intervalsPanel=page.locator("section.panel").filter({hasText:"Интервальные оценки главных эффектов"});
const effectBars=await mainEffectsPanel.locator(".recharts-bar-rectangle").count();
const intervalRows=await intervalsPanel.locator("tbody tr").count();
if(effectBars<6||intervalRows!==6)
 throw Error("E1 factorial: expected 6 graph bars and 6 effect intervals, got "+effectBars+" / "+intervalRows);
await page.getByRole("group",{name:"Режим эксперимента"}).getByRole("button",{name:"Данные"}).click();
const factorRow=page.locator(".data-row").filter({hasText:"Многофакторная чувствительность"});
const [factorFile]=await Promise.all([page.waitForEvent("download",{timeout:15000}),factorRow.getByRole("button",{name:"Скачать JSON"}).click()]);
const factorData=JSON.parse(fs.readFileSync(await factorFile.path(),"utf8"));
const planned=factorData.main_effects?.filter(x=>x.metric==="probability_correct"&&x.method==="proposed_robust")||[];
if(planned.length!==6||planned.some(x=>!x.estimable||!Number.isFinite(x.effect_high_minus_low)||!Number.isFinite(x.ci95_low)||!Number.isFinite(x.ci95_high)))
 throw Error("E1 factorial: incomplete numerical factors despite completed UI render");
report.factorialRendering={bars:effectBars,intervalRows,computed:planned.length,points:factorData.design_points?.length};
await page.getByRole("group",{name:"Режим эксперимента"}).getByRole("button",{name:"Чувствительность"}).click();
await page.locator(".sensitivity-action select").selectOption("factorial");

// UP-35: real, same-origin, two-tab exclusion using the browser Web Locks
// implementation. Tab A acquires the exact application lease, and tab B must
// be rejected by the application UI, not merely by a hand-written lock probe.
const lockedInFirstTab=await page.evaluate(async()=>{
 if(!navigator.locks?.request)return false;
 let acquired;
 const promise=new Promise(resolve=>{acquired=resolve;});
 void navigator.locks.request("imas-lab-test-trust-storage-exclusive-v1",
  {mode:"exclusive"},async lock=>{
   if(!lock){acquired(false);return;}
   window.__imasReleaseTestOriginLock=null;
   const hold=new Promise(resolve=>{window.__imasReleaseTestOriginLock=resolve;});
   acquired(true);
   await hold;
  });
 return promise;
});
if(!lockedInFirstTab)throw Error("UP-35: real Chromium Web Locks API unavailable");
const secondTab=await browser.newPage();
try{
 await secondTab.goto("http://127.0.0.1:4173",{waitUntil:"domcontentloaded",timeout:30000});
 await secondTab.getByRole("button",{name:"Запустить эксперимент",exact:true}).click();
 await secondTab.locator(".error-banner").getByText("Другое вычисление или очистка данных выполняется в другой вкладке.",{exact:false}).waitFor({timeout:15000});
 report.crossTabExclusiveLock=true;
}finally{
 await page.evaluate(()=>{window.__imasReleaseTestOriginLock?.();});
 await secondTab.close();
}
report.e1aAdaptive=e1aAdaptiveSummary;
report.unifiedFourMethods={oneRun:trustNames.length,stability:lyapunovVerification.methods,
 ablation:report.ablationRows,dataRegistry:true,monteCarloVerifiedByNodeTests:true};
report.lyapunovStudy=lyapunovVerification;
fs.writeFileSync(path.join(here, "verification.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close();

const controlsPresent = Object.values(report.requiredControls).every((count) => count > 0);
if (
  report.title !== "Лабораторно-исследовательский стенд интеллектуальной мультиагентной системы поддержки принятия решений по обеспечению кибербезопасности" ||
  report.bodyLength < 2000 ||
  report.helpSections < 18 ||
  !controlsPresent ||
  !report.researchComputed ||
  report.topology===0 ||
  report.researchHelp === 0 ||
  errors.length ||
  apiCalls.length
) process.exit(1);
