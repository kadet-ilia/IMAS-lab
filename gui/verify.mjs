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

const standardHeading = "IMAS_LaB_test · Лабораторный стенд ИМАС";
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
     (await page.locator("h1").first().innerText()).trim()!==standardHeading){
    throw Error(section+": the only h1 must be the unified laboratory heading");
  }
  if(!(await workspace.locator(":scope > main.content > nav.r27-experiment-navigation").count())){
    throw Error(section+": experiment navigation must be inside the content sibling");
  }
}
await assertStandardWorkspace("Расчет доверия");

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



// Compare the actual structural shell and computed design tokens, not only class names.
async function pageChromeSnapshot(){
 return await page.locator(".workspace").evaluate(workspace=>{
  const sidebar=workspace.querySelector(":scope > aside.sidebar");
  const content=workspace.querySelector(":scope > main.content");
  const nav=content?.querySelector(":scope > nav.r27-experiment-navigation");
  const heading=content?.querySelector(":scope > header.imas-experiment-heading");
  const progress=content?.querySelector(":scope > .progress-strip");
  const overview=content?.querySelector(":scope > .trust-overview-grid");
  const topology=overview?.querySelector(":scope > section.r27-replay");
  const summary=overview?.querySelector(":scope > section.panel");
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
const navSignature=()=>page.locator('main.content > nav.r27-experiment-navigation').evaluate(node=>Array.from(node.children).map(child=>({tag:child.tagName.toLowerCase(),className:typeof child.className==="string"?child.className:"",role:child.getAttribute("role"),type:child.getAttribute("type")})));
const trustNavigation=await navSignature();
const toolbarSignature=()=>page.locator(".topbar .toolbar").evaluate(node=>Array.from(node.children).map(child=>({tag:child.tagName.toLowerCase(),className:child.className||"",title:child.title||""})));
const trustToolbar=await toolbarSignature();
// Restore the original four visible trust modes while preserving the shared page shell.
const modeGroup=page.getByRole("group",{name:"Режим эксперимента"});
const trustModes=[["trace","Один прогон"],["mc","Монте-Карло"],["sensitivity","Чувствительность"],["data","Данные"]];
if((await modeGroup.getByRole("button").count())!==trustModes.length)throw Error("Four trust mode buttons must be visible");
for(const [id,name] of trustModes){
  const button=modeGroup.getByRole("button",{name,exact:true});
  await button.click();
  if((await button.getAttribute("aria-pressed"))!=="true")throw Error("Trust mode did not become active: "+name);
  if((await page.getByRole("combobox",{name:"Выбор эксперимента"}).inputValue())!=="trace")throw Error("Trust mode switch changed main experiment");
  if(JSON.stringify(await navSignature())!==JSON.stringify(trustNavigation))throw Error("Main navigation changed when switching trust mode: "+name);
  if((await page.locator("main[data-study='trust'] > .imas-experiment-heading").count())!==1)throw Error("Trust heading missing after mode switch: "+name);
  await assertStandardWorkspace(name);
}
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
 const help=await page.locator(".r27-experiment-navigation .r27-nav-right").boundingBox();
 const svg=await page.locator(".r27-experiment-navigation .r27-export-control").boundingBox();
 if(!help || !svg || Math.abs(help.width-svg.width)>1 || Math.abs(help.height-svg.height)>1){
  throw Error(section+": Help and SVG buttons differ: "+JSON.stringify({help,svg}));
 }
}
await assertNavButtonsEqual("Расчет доверия");



const trustOverview = page.locator(".trust-overview-grid");
await trustOverview.waitFor();
const topologyBox = await trustOverview.locator(".r27-replay").boundingBox();
const summaryBox = await trustOverview.locator(".panel").boundingBox();
const replay = trustOverview.locator(".r27-replay-compact");
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



await page.getByText("Сетевая модель и Sybil-атака", { exact: true }).click();
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
  if(JSON.stringify(base)!==JSON.stringify(actual)){
   const differences=Object.keys(base).filter(k=>JSON.stringify(base[k])!==JSON.stringify(actual[k])).map(k=>({component:k,trust:base[k],research:actual[k]}));
   throw Error("Different markup/design tokens for "+researchTabs[i]+": "+JSON.stringify(differences));
  }
  for(const key of ["sidebar","content","nav","topology","summary","kpis"]){
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
  const researchOverview=researchMain.locator(":scope > .trust-overview-grid");
  if((await researchOverview.locator(":scope > .r27-replay-compact").count())!==1||
     (await researchOverview.locator(":scope > section.panel.r27-summary-panel").count())!==1){
    throw Error(researchTabs[i]+": missing the unified topology/table layout");
  }
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
if((await page.locator(".r27-analytics > section.panel.r27-panel").count())<2)throw Error("Research study diagrams must use the shared panel component");
const topologyVisibleOnResearch = await page.locator(".r27-playback-svg").count();
const researchScreenshot = path.join(here, "research2027.png");
await page.screenshot({ path: researchScreenshot, fullPage: false });
await page.locator(".r27-experiment-navigation").getByRole("button", { name: "Справка", exact: true }).click();
await page.getByRole("heading", { name: "Единая справка по экспериментальному комплексу IMAS-lab" }).waitFor();
if((await page.locator(".r27-module-article").count())!==5)throw Error("Missing mathematical manual chapters");
if((await page.locator(".r27-manual-equation").count())<25)throw Error("Missing mathematical equations");

const report = {
  title: await page.title(),
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
report.ablationWorkerSmoke=report.ablationRows===12;
if(!report.ablationWorkerSmoke)throw Error("UP-35: expected 4×3 ablation rows from Web Workers, got "+report.ablationRows);

fs.writeFileSync(path.join(here, "verification.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close();

const controlsPresent = Object.values(report.requiredControls).every((count) => count > 0);
if (
  report.title !== "IMAS_LaB_test — Лабораторный стенд ИМАС" ||
  report.bodyLength < 2000 ||
  report.helpSections < 18 ||
  !controlsPresent ||
  !report.researchComputed ||
  report.topology===0 ||
  report.researchHelp === 0 ||
  errors.length ||
  apiCalls.length
) process.exit(1);
