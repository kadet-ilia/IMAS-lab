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
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
  if (message.type() === "warning") warnings.push(message.text());
});
page.on("pageerror", (error) => errors.push(error.message));

await page.goto("http://127.0.0.1:4173", { waitUntil: "domcontentloaded", timeout: 30000 });
try {
  await page.getByText("Динамика решений и оценок").waitFor({ timeout: 12000 });
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

const standardHeading = "IMAS-lab · Лабораторный стенд ИМАС";
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

const authorA = "Авторы · ктн Ушаков И.А. · Трофимова Н.А.";
const authorB = "Авторы · ктн Ушаков И.А. · ктн Харжевская А.В. · Егоров Е.В.";
if((await page.locator('main[data-study="trust"] > .r27-kicker').innerText()).trim()!==authorA)throw Error("Incorrect authors for trust");
const trustTitle = "Математическая модель интеллектуальной мультиагентной системы поддержки принятия решений для защищенных информационных систем специального назначения";
if((await page.locator('main[data-study="trust"] > h2.r27-study-title').innerText()).trim()!==trustTitle) throw Error("Trust experiment title is absent or differs from the required wording");

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
await page.getByLabel("Параллельных процессов (0 — авто)").waitFor();

const legacyControls = {
  sybil: await page.getByLabel("Число Sybil-идентичностей").count(),
  bootstrap: await page.getByLabel("Bootstrap-выборок").count(),
  parallelWorkers: await page.getByLabel("Параллельных процессов (0 — авто)").count(),
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
  await page.locator("main.r27-experiment-content > h2.r27-study-title").waitFor({ timeout: 10000 });
  await assertStandardWorkspace(researchTabs[i]);
  await assertNavButtonsEqual(researchTabs[i]);
  const authors=(await page.locator("main.r27-experiment-content > .r27-kicker").innerText()).trim();
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
    directHead:el.querySelector(":scope > h2.r27-study-title")?.textContent?.trim(),
    author:el.querySelector(":scope > .r27-kicker")?.textContent?.trim()
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

}
await page.getByRole("combobox", { name: "Выбор эксперимента" }).selectOption("study-uncertainty");
const seedInput = page.getByRole("spinbutton", {name:"Начальное зерно генератора"});
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
  screenshots: { dashboard: dashboardScreenshot, help: helpScreenshot, research: researchScreenshot },
};

fs.writeFileSync(path.join(here, "verification.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close();

const controlsPresent = Object.values(report.requiredControls).every((count) => count > 0);
if (
  report.title !== "Модельный эксперимент ИМАС" ||
  report.bodyLength < 2000 ||
  report.helpSections < 18 ||
  !controlsPresent ||
  !report.researchComputed ||
  report.topology===0 ||
  report.researchHelp === 0 ||
  errors.length
) process.exit(1);
