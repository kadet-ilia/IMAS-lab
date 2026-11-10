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
 if(!help || !svg || Math.abs(help.width-85)>1 || Math.abs(help.height-35)>1 ||
    Math.abs(svg.width-85)>1 || Math.abs(svg.height-35)>1){
  throw Error(section+": Help and SVG buttons must both be 85×35 px: "+JSON.stringify({help,svg}));
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
await page.locator(".r27-help-branch").count().then(count=>{if(count!==8)throw Error("Expected eight documentation tree groups including the article model");});
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
  if((await researchOverview.locator(":scope > .r27-replay-compact").count())!==1||
     (await researchMain.locator(":scope > section.panel.r27-summary-panel").count())!==1){
    throw Error(researchTabs[i]+": missing topology or relocated full-width summary");
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
// The article engine is NOT a seventh experiment; it is the second model of E1.
await page.getByRole("combobox",{name:"Выбор эксперимента"}).selectOption("trace");
if((await page.getByRole("combobox",{name:"Выбор эксперимента"}).locator("option").count())!==6)
 throw Error("An article model must not add a seventh experiment menu item");
const trustModelControl=page.getByRole("combobox",{name:"Модель"});
await trustModelControl.selectOption("article");
if((await page.getByRole("combobox",{name:"Выбор эксперимента"}).inputValue())!=="trace")
 throw Error("Selecting article model must preserve experiment E1");
await page.getByLabel("Число прогонов R").fill("2");
await page.getByRole("button",{name:"Проверка утверждений 1–2"}).click();
await page.locator(".article-claims").waitFor();
await page.locator(".sidebar").getByRole("button",{name:"Запустить эксперимент"}).click();
await page.locator(".article-table tbody tr").first().waitFor({timeout:30000});
if((await page.locator(".article-table tbody tr").count())!==4)
 throw Error("E1 article model must display four aggregation methods");
await page.locator(".article-chart svg").first().waitFor({timeout:10000});
if((await page.locator(".article-chart svg").count())<2)
 throw Error("Article mode E1 must render error and trust charts inside the existing layout");
await page.screenshot({path:path.join(here,"article-trust.png"),fullPage:false});
await trustModelControl.selectOption("legacy");
await page.getByLabel("Число Sybil-идентичностей").count(); // original E1 controls are retained.
if((await page.locator(".article-trust-settings").count())!==0)
 throw Error("Article configuration must be hidden when legacy trust model is selected");
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
if((await page.locator(".r27-module-article").count())!==7)throw Error("Missing six experiment and one article-model manual chapters");
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
await page.getByRole("heading",{name:"IMAS_LaB_test · Лабораторный стенд ИМАС"}).waitFor();
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
const svgExport=page.locator(".r27-experiment-navigation .r27-export-control");
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
report.ablationWorkerSmoke=report.ablationRows===12;

if(!report.ablationWorkerSmoke)throw Error("UP-35: expected 4×3 ablation rows from Web Workers, got "+report.ablationRows);

// A repeated call must read the complete scientific result from the cache.
await page.locator(".sensitivity-action").getByRole("button",{name:"Выполнить"}).click();
await page.locator(".topbar .cache-badge").waitFor({timeout:15000});
report.ablationCacheHit=await page.locator(".topbar .cache-badge").count()===1;
if(!report.ablationCacheHit)throw Error("UP-35: repeated ablation was not cached");

// Reload discards the JS in-memory Map. A cache hit after reconstructing the
// identical configuration confirms that the result survived in IndexedDB.
await page.reload({waitUntil:"domcontentloaded"});
await page.getByRole("heading",{name:"IMAS_LaB_test · Лабораторный стенд ИМАС"}).waitFor();
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
 if(poolResults[pool].completed_tasks!==8||poolResults[pool].ablation_rows.length!==12)
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
const planned=factorData.main_effects?.filter(x=>x.metric==="probability_correct")||[];
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
