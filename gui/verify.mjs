import fs, { createReadStream, createWriteStream } from "node:fs";
import { mkdir, chmod } from "node:fs/promises";
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
  const tar = spawn("tar", ["--no-same-owner", "-xf", "-", "-C", destination]);
  const completed = new Promise((resolve, reject) => {
    tar.on("close", resolve);
    tar.on("error", reject);
  });
  await pipeline(createReadStream(source), createBrotliDecompress(), tar.stdin);
  const code = await completed;
  if (code !== 0) throw new Error(`tar extraction failed: ${source}`);
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
await page.getByText("Динамика решений и оценок").waitFor({ timeout: 30000 });

await page.getByText("Сетевая модель и Sybil-атака", { exact: true }).click();
await page.getByLabel("Число Sybil-идентичностей").waitFor();
await page.getByText("Статистика и вычисления", { exact: true }).click();
await page.getByLabel("Bootstrap-выборок").waitFor();
await page.getByLabel("Параллельных процессов (0 — авто)").waitFor();

const dashboardScreenshot = path.join(here, "dashboard.png");
await page.screenshot({ path: dashboardScreenshot, fullPage: false });

await page.locator(".r27-experiment-navigation").getByRole("button", { name: "Справка", exact: true }).click();
await page.locator(".r27-experiment-navigation").getByRole("button", { name: "Справка исходной модели 3.2", exact: true }).click();
await page.getByRole("heading", { name: "Справка по модельному эксперименту ИМАС" }).waitFor();
const helpScreenshot = path.join(here, "help.png");
await page.screenshot({ path: helpScreenshot, fullPage: false });

const legacyHelpSections = await page.locator(".help-toc a").count();
const legacyControls = {
  sybil: await page.getByLabel("Число Sybil-идентичностей").count(),
  bootstrap: await page.getByLabel("Bootstrap-выборок").count(),
  parallelWorkers: await page.getByLabel("Параллельных процессов (0 — авто)").count(),
};
const researchTabs = ["Автоматические решения", "Коллективное решение", "Опасные состояния", "Каскадные последствия", "Нарушение коллективного решения"];
const researchValues = ["study-uncertainty","study-probgraph","study-petri","study-cascade","study-misinformation"];
for (let i=0; i<researchTabs.length; i++) {
  await page.getByRole("combobox", { name: "Выбор эксперимента" }).selectOption(researchValues[i]);
  await page.locator(".r27-heading h1").waitFor({ timeout: 10000 });
  if (!(await page.locator(".r27-field input").count())) throw new Error("Missing parameter inputs: " + researchTabs[i]);
  if (!(await page.locator(".r27-playback-svg").count())) throw new Error("Missing topology graph: " + researchTabs[i]);
}
await page.getByRole("combobox", { name: "Выбор эксперимента" }).selectOption("study-uncertainty");
await page.locator(".r27-field input").nth(1).fill("10");
await page.getByRole("button", { name: "Запустить расчёт", exact: true }).click();
await page.getByText("Сводная таблица результатов").waitFor({ timeout: 30000 });
await page.getByRole("button", {name:"▶ Воспроизвести"}).click();
await page.getByRole("button", {name:"Пауза"}).waitFor({timeout:3000});
await page.getByRole("button", {name:"Пауза"}).click();
await page.getByRole("slider", {name:"Выбор такта"}).fill("3");
if(!(await page.locator(".r27-state-matrix").count()))throw Error("Missing state heatmap");
const researchComputed = await page.locator(".r27-table tbody tr").count() >= 9;
const researchScreenshot = path.join(here, "research2027.png");
await page.screenshot({ path: researchScreenshot, fullPage: false });
await page.locator(".r27-experiment-navigation").getByRole("button", { name: "Справка", exact: true }).click();
await page.getByRole("heading", { name: "Справка по пяти вычислительным экспериментам 2027 года" }).waitFor();

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
  topology: await page.locator(".r27-playback-svg").count(),
  researchHelp: await page.locator(".r27-help-content").count(),
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
  report.researchHelp === 0 ||
  errors.length
) process.exit(1);
