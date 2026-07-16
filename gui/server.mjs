import express from "express";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const runsDir = path.join(root, "runs");
const cacheDir = path.join(root, "cache");
const app = express();
const port = Number(process.env.PORT || 4173);
const jobs = new Map();
const UTF8_BOM = "\uFEFF";

fs.mkdirSync(runsDir, { recursive: true });
fs.mkdirSync(cacheDir, { recursive: true });
app.use(express.json({ limit: "4mb" }));

function stamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function requestHash(payload) {
  const text = JSON.stringify(canonicalize(payload));
  return crypto.createHash("sha256").update(text).digest("hex");
}

function csvEscape(value) {
  if (value === null || value === undefined) return "";
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[\n\r,;"]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function rowsToCsv(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return "";
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  return [headers.join(";"), ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(";"))].join("\n") + "\n";
}

function writeCsv(runId, suffix, rows) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const name = `run_${runId}${suffix}.csv`;
  fs.writeFileSync(path.join(runsDir, name), UTF8_BOM + rowsToCsv(rows), "utf8");
  return `runs/${name}`;
}

function persistResult(action, payload, body, partial = false) {
  const seed = payload?.config?.seed ?? "seed";
  const marker = partial ? "partial" : action;
  const runId = `${stamp()}_${seed}_${marker}`;
  const jsonName = `run_${runId}.json`;
  fs.writeFileSync(path.join(runsDir, jsonName), JSON.stringify({ request: payload, result: body }, null, 2), "utf8");

  const primaryRows = action === "trace"
    ? body.series
    : action === "monte_carlo"
      ? body.runs
      : body.mode === "factorial"
        ? body.design_points
        : body.sensitivity;

  const files = {
    json: `runs/${jsonName}`,
    primary: writeCsv(runId, "", primaryRows),
    trajectory: writeCsv(runId, "_trajectory", body.trajectory_statistics),
    bootstrap: writeCsv(runId, "_bootstrap", body.bootstrap_comparisons),
    distributions: writeCsv(runId, "_distributions", body.distributions?.map(({ histogram, ...row }) => row)),
    mainEffects: writeCsv(runId, "_main_effects", body.main_effects),
    interactions: writeCsv(runId, "_interactions", body.interaction_effects),
    network: writeCsv(runId, "_network", body.network_series),
  };
  body.log_file = files.primary || files.json;
  body.json_log_file = files.json;
  if (files.trajectory) body.trajectory_log_file = files.trajectory;
  if (files.bootstrap) body.bootstrap_log_file = files.bootstrap;
  if (files.distributions) body.distribution_log_file = files.distributions;
  if (files.mainEffects) body.effects_log_file = files.mainEffects;
  if (files.network) body.network_log_file = files.network;
  return files;
}

function publicJob(job, includeResult = true) {
  return {
    id: job.id,
    state: job.state,
    action: job.action,
    created_at: job.createdAt,
    updated_at: job.updatedAt,
    progress: job.progress,
    cache_hit: Boolean(job.cacheHit),
    stop_requested: Boolean(job.stopRequested),
    error: job.error || null,
    result: includeResult && ["completed", "stopped"].includes(job.state) ? job.result : undefined,
  };
}

function parseProgress(job, chunk) {
  job.stderrBuffer += chunk;
  const lines = job.stderrBuffer.split(/\r?\n/u);
  job.stderrBuffer = lines.pop() || "";
  for (const line of lines) {
    if (line.startsWith("IMAS_PROGRESS\t")) {
      try {
        job.progress = JSON.parse(line.slice("IMAS_PROGRESS\t".length));
        job.updatedAt = new Date().toISOString();
      } catch {
        job.diagnostics.push(line);
      }
    } else if (line.trim()) {
      job.diagnostics.push(line);
    }
  }
}

function resolvePythonExecutable() {
  if (process.env.PYTHON) return process.env.PYTHON;
  const candidates = process.platform === "win32"
    ? [path.join(root, ".venv", "Scripts", "python.exe")]
    : [path.join(root, ".venv", "bin", "python")];
  const localPython = candidates.find((candidate) => fs.existsSync(candidate));
  if (localPython) return localPython;
  return process.platform === "win32" ? "python" : "python3";
}

function startJob(payload) {
  const id = crypto.randomUUID();
  const hash = requestHash(payload);
  const cachePath = path.join(cacheDir, `${hash}.json`);
  const checkpointPath = path.join(cacheDir, `${hash}.checkpoint.json`);
  const stopPath = path.join(cacheDir, `${hash}.${id}.stop`);
  const now = new Date().toISOString();
  const action = payload.action || "trace";
  const job = {
    id,
    hash,
    action,
    payload,
    state: "queued",
    createdAt: now,
    updatedAt: now,
    progress: { stage: "queued", completed: 0, total: 1, percent: 0, message: "Задание поставлено в очередь" },
    cacheHit: false,
    stopRequested: false,
    result: null,
    error: null,
    diagnostics: [],
    stdout: "",
    stderrBuffer: "",
    child: null,
    stopPath,
    checkpointPath,
  };
  jobs.set(id, job);

  if (fs.existsSync(cachePath)) {
    try {
      job.result = JSON.parse(fs.readFileSync(cachePath, "utf8"));
      job.state = "completed";
      job.cacheHit = true;
      job.progress = { stage: "cache", completed: 1, total: 1, percent: 100, message: "Результат загружен из кэша", eta_seconds: 0 };
      job.updatedAt = new Date().toISOString();
      return job;
    } catch {
      fs.rmSync(cachePath, { force: true });
    }
  }

  fs.rmSync(stopPath, { force: true });
  const python = resolvePythonExecutable();
  const child = spawn(python, ["-X", "utf8", path.join(root, "gui_bridge.py")], {
    cwd: root,
    env: {
      ...process.env,
      MPLCONFIGDIR: path.join(root, ".matplotlib-cache"),
      IMAS_STOP_FILE: stopPath,
      IMAS_CHECKPOINT_FILE: checkpointPath,
      IMAS_CACHE_KEY: hash,
      PYTHONUTF8: "1",
      PYTHONIOENCODING: "utf-8",
    },
  });
  job.child = child;
  job.state = "running";
  job.progress = { stage: "starting", completed: 0, total: 1, percent: 0, message: "Запуск вычислительного процесса" };
  job.updatedAt = new Date().toISOString();

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { job.stdout += chunk; });
  child.stderr.on("data", (chunk) => parseProgress(job, chunk));
  child.on("error", (error) => {
    job.state = "failed";
    job.error = `${error.message}. Запустите приложение через start_gui.bat, чтобы создать .venv и установить зависимости Python.`;
    job.updatedAt = new Date().toISOString();
  });
  child.on("close", (code) => {
    job.child = null;
    fs.rmSync(stopPath, { force: true });
    if (job.state === "failed") return;
    try {
      const body = JSON.parse((job.stdout || "{}").replace(/^\uFEFF/u, ""));
      if (code !== 0 || body.error) {
        throw new Error(body.error || job.diagnostics.join("\n") || `Python process exited with code ${code}`);
      }
      const partial = Boolean(body.partial || job.stopRequested);
      persistResult(action, payload, body, partial);
      job.result = body;
      job.state = partial ? "stopped" : "completed";
      job.progress = {
        ...(job.progress || {}),
        stage: partial ? "stopped" : "completed",
        completed: body.completed_runs ?? body.completed_tasks ?? job.progress?.completed ?? 1,
        total: body.requested_runs ?? body.requested_tasks ?? job.progress?.total ?? 1,
        percent: partial ? job.progress?.percent ?? 0 : 100,
        eta_seconds: 0,
        message: partial ? "Расчет остановлен; частичные результаты сохранены" : "Расчет завершен",
      };
      job.updatedAt = new Date().toISOString();
      if (!partial) {
        fs.writeFileSync(cachePath, JSON.stringify(body), "utf8");
        fs.rmSync(checkpointPath, { force: true });
      }
    } catch (error) {
      job.state = job.stopRequested ? "stopped" : "failed";
      job.error = `${error.message}. Запустите приложение через start_gui.bat, чтобы создать .venv и установить зависимости Python.`;
      job.updatedAt = new Date().toISOString();
    }
  });
  child.stdin.end(Buffer.from(JSON.stringify(payload), "utf8"));
  return job;
}

app.post("/api/jobs", (request, response) => {
  const job = startJob(request.body || {});
  response.status(202).json(publicJob(job, false));
});

app.get("/api/jobs/:id", (request, response) => {
  const job = jobs.get(request.params.id);
  if (!job) return response.status(404).json({ error: "Задание не найдено" });
  response.json(publicJob(job, true));
});

app.delete("/api/jobs/:id", (request, response) => {
  const job = jobs.get(request.params.id);
  if (!job) return response.status(404).json({ error: "Задание не найдено" });
  if (!["queued", "running", "stopping"].includes(job.state)) return response.json(publicJob(job, false));
  job.stopRequested = true;
  job.state = "stopping";
  job.updatedAt = new Date().toISOString();
  fs.writeFileSync(job.stopPath, "stop\n", "utf8");
  const child = job.child;
  setTimeout(() => {
    if (child && child.exitCode === null) child.kill("SIGTERM");
  }, 15000).unref();
  response.status(202).json(publicJob(job, false));
});

// Совместимый синхронный маршрут для внешних сценариев и старых проверок.
app.post("/api/experiment", (request, response) => {
  const job = startJob(request.body || {});
  const deadline = Date.now() + 30 * 60 * 1000;
  const timer = setInterval(() => {
    if (["completed", "stopped"].includes(job.state)) {
      clearInterval(timer);
      response.status(200).json(job.result);
    } else if (job.state === "failed") {
      clearInterval(timer);
      response.status(400).json({ error: job.error });
    } else if (Date.now() > deadline) {
      clearInterval(timer);
      response.status(504).json({ error: "Превышено время ожидания" });
    }
  }, 150);
  request.on("close", () => {
    if (!response.writableEnded && ["queued", "running"].includes(job.state)) {
      job.stopRequested = true;
      fs.writeFileSync(job.stopPath, "stop\n", "utf8");
    }
  });
});

app.get("/api/cache", (_request, response) => {
  const entries = fs.readdirSync(cacheDir).filter((name) => name.endsWith(".json") && !name.endsWith(".checkpoint.json"));
  response.json({ entries: entries.length });
});

app.use(express.static(path.join(here, "dist")));
app.use((_request, response) => response.sendFile(path.join(here, "dist", "index.html")));

setInterval(() => {
  const cutoff = Date.now() - 6 * 60 * 60 * 1000;
  for (const [id, job] of jobs) {
    if (new Date(job.updatedAt).getTime() < cutoff && !["running", "stopping"].includes(job.state)) jobs.delete(id);
  }
}, 30 * 60 * 1000).unref();

app.listen(port, "127.0.0.1", () => {
  console.log(`IMAS dashboard: http://127.0.0.1:${port}`);
});
