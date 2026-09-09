"use strict";

// Planificador de tareas programadas.
// Las tareas viven en `config.schedules` y se ejecutan como consultas de un solo
// turno con `runOnce(prompt)`. Cada ejecución se registra en
// `<carpeta>/.claude/programadas/<id>.md`.
//
//   tarea = { id, name, prompt, every: "hour"|"day"|"week", at: "HH:MM",
//             weekday: 0-6, enabled: bool, lastRun: ISO|null, nextRun: ISO }

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const TICK_MS = 60 * 1000;
const EVERY = ["hour", "day", "week"];

let deps = null; // { getConfig, saveConfig, runOnce, notify, emit, getFolder }
let timer = null;
const running = new Set(); // ids en ejecución (evita solapes)
const controllers = new Map(); // id -> AbortController (para cancelar)

/* ------------------------------------------------------------------ utils */

function noop() {}

function dep(name) {
  const fn = deps && deps[name];
  return typeof fn === "function" ? fn : noop;
}

function config() {
  const cfg = (deps && typeof deps.getConfig === "function" && deps.getConfig()) || {};
  if (!Array.isArray(cfg.schedules)) cfg.schedules = [];
  return cfg;
}

function schedules() {
  return config().schedules;
}

function persist() {
  try {
    dep("saveConfig")();
  } catch (e) {
    // Persistir no debe tumbar el planificador.
  }
}

function parseAt(at) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(at == null ? "" : at).trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return { h: h, m: min };
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

/* --------------------------------------------------------------- próximas */

// Siguiente ejecución, estrictamente posterior a `from`.
function computeNext(task, from) {
  const base = from instanceof Date && !isNaN(from) ? new Date(from.getTime()) : new Date();
  const every = EVERY.indexOf(task && task.every) >= 0 ? task.every : "day";

  if (every === "hour") {
    const d = new Date(base.getTime());
    d.setMinutes(0, 0, 0);
    d.setHours(d.getHours() + 1);
    return d;
  }

  const at = parseAt(task && task.at) || { h: 9, m: 0 };

  if (every === "day") {
    const d = new Date(base.getTime());
    d.setHours(at.h, at.m, 0, 0);
    if (d.getTime() <= base.getTime()) d.setDate(d.getDate() + 1);
    return d;
  }

  // week
  let wd = Number(task && task.weekday);
  if (!Number.isInteger(wd) || wd < 0 || wd > 6) wd = 1;
  const d = new Date(base.getTime());
  d.setHours(at.h, at.m, 0, 0);
  let delta = (wd - d.getDay() + 7) % 7;
  if (delta === 0 && d.getTime() <= base.getTime()) delta = 7;
  d.setDate(d.getDate() + delta);
  return d;
}

function refreshNext(task, from) {
  task.nextRun = computeNext(task, from || new Date()).toISOString();
  return task.nextRun;
}

/* ------------------------------------------------------------- validación */

function validate(task) {
  const t = task && typeof task === "object" ? task : {};
  const name = String(t.name == null ? "" : t.name).trim();
  const prompt = String(t.prompt == null ? "" : t.prompt).trim();
  if (!name) throw new Error("El nombre no puede estar vacío.");
  if (!prompt) throw new Error("La instrucción no puede estar vacía.");

  const every = String(t.every == null ? "" : t.every).trim();
  if (EVERY.indexOf(every) < 0) throw new Error('La frecuencia debe ser "hour", "day" o "week".');

  let at = "09:00";
  if (every !== "hour" || (t.at != null && String(t.at).trim())) {
    const p = parseAt(t.at);
    if (!p) throw new Error('La hora debe tener el formato "HH:MM".');
    at = pad2(p.h) + ":" + pad2(p.m);
  }

  let weekday = 1;
  const wd = Number(t.weekday);
  if (every === "week") {
    if (!Number.isInteger(wd) || wd < 0 || wd > 6) {
      throw new Error("El día de la semana debe estar entre 0 (domingo) y 6 (sábado).");
    }
    weekday = wd;
  } else if (Number.isInteger(wd) && wd >= 0 && wd <= 6) {
    weekday = wd;
  }

  // Esquema JSON opcional: salida estructurada (se guarda además en <id>.jsonl).
  let schema = null;
  if (t.schema != null && String(t.schema).trim()) {
    try { schema = typeof t.schema === "string" ? JSON.parse(t.schema) : t.schema; } catch { throw new Error("El esquema JSON no es válido."); }
    if (!schema || typeof schema !== "object") throw new Error("El esquema JSON debe ser un objeto.");
  }

  return {
    id: t.id ? String(t.id) : crypto.randomUUID(),
    name: name,
    prompt: prompt,
    schema: schema,
    every: every,
    at: at,
    weekday: weekday,
    enabled: t.enabled === undefined ? true : !!t.enabled,
    lastRun: t.lastRun || null,
    nextRun: t.nextRun || null,
  };
}

/* -------------------------------------------------------------- registro */

function logFileFor(id) {
  let folder = "";
  try {
    folder = dep("getFolder")() || "";
  } catch (e) {
    folder = "";
  }
  if (!folder) folder = process.cwd();
  return path.join(String(folder), ".claude", "programadas", String(id) + ".md");
}

function appendLog(task, body) {
  const file = logFileFor(task.id);
  const block =
    "\n## " + new Date().toISOString() + " · " + task.name + "\n\n" +
    String(body == null ? "" : body).trim() + "\n";
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, block, "utf8");
  } catch (e) {
    // Si no se puede escribir el registro, la ejecución sigue siendo válida.
  }
  return file;
}

// Salida estructurada: una línea JSON por ejecución en <id>.jsonl (fácil de importar a tablas).
function appendJsonl(task, data) {
  const file = logFileFor(task.id).replace(/\.md$/, ".jsonl");
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), name: task.name, data: data }) + "\n", "utf8");
  } catch (e) { /* no crítico */ }
}

// Cancela una ejecución en curso.
function cancel(id) {
  const c = controllers.get(id);
  if (!c) return false;
  c.abort();
  return true;
}

function summarize(text) {
  const s = String(text == null ? "" : text).replace(/\s+/g, " ").trim();
  return s.length > 200 ? s.slice(0, 200) : s;
}

/* ------------------------------------------------------------------- API */

function list() {
  return schedules().slice();
}

function find(id) {
  const arr = schedules();
  for (let i = 0; i < arr.length; i++) if (arr[i] && arr[i].id === id) return arr[i];
  return null;
}

function save(task) {
  const clean = validate(task);
  const arr = schedules();
  let i = -1;
  for (let k = 0; k < arr.length; k++) if (arr[k] && arr[k].id === clean.id) i = k;
  if (i >= 0) {
    clean.lastRun = arr[i].lastRun || clean.lastRun || null;
    arr[i] = clean;
  } else {
    arr.push(clean);
  }
  refreshNext(clean, new Date());
  persist();
  return list();
}

function remove(id) {
  const arr = schedules();
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] && arr[i].id === id) {
      arr.splice(i, 1);
      break;
    }
  }
  persist();
  return list();
}

async function run(id) {
  const task = find(id);
  if (!task) return { ok: false, error: "Tarea no encontrada." };
  if (running.has(task.id)) return { ok: false, error: "La tarea ya se está ejecutando." };

  running.add(task.id);
  const ctrl = new AbortController();
  controllers.set(task.id, ctrl);
  try { dep("emit")("schedule:running", { id: task.id, running: true }); } catch (e) { /* ignorar */ }
  let ok = false;
  let cost = 0;
  let text = "";
  let error = null;
  let structured = null;

  try {
    const res = (await dep("runOnce")(task.prompt, { schema: task.schema || undefined, signal: ctrl.signal })) || {};
    ok = !!res.ok && !res.error;
    cost = Number(res.cost) || 0;
    text = res.text == null ? "" : String(res.text);
    error = res.error ? String(res.error) : null;
    structured = res.structured == null ? null : res.structured;
    if (!ok && !error) error = "La ejecución no devolvió resultado.";
  } catch (e) {
    ok = false;
    error = (e && e.message) || String(e);
  } finally {
    running.delete(task.id);
    controllers.delete(task.id);
    try { dep("emit")("schedule:running", { id: task.id, running: false }); } catch (e) { /* ignorar */ }
  }

  let body = ok ? text || "(sin texto)" : "**Error:** " + (error || "desconocido");
  if (ok && structured != null) {
    body = "```json\n" + JSON.stringify(structured, null, 2) + "\n```\n\n" + body;
    appendJsonl(task, structured);
  }
  const logFile = appendLog(task, body);

  const now = new Date();
  task.lastRun = now.toISOString();
  refreshNext(task, now);
  persist();

  const summary = summarize(ok ? text : error);
  const payload = {
    id: task.id,
    name: task.name,
    ok: ok,
    cost: cost,
    summary: summary,
    logFile: logFile,
  };

  try {
    dep("emit")("schedule:done", payload);
  } catch (e) {}
  try {
    dep("notify")(task.name, summary || (ok ? "Tarea completada." : "La tarea falló."));
  } catch (e) {}

  return { ok: ok, text: text, cost: cost, error: error, logFile: logFile, summary: summary };
}

function tick() {
  const now = Date.now();
  const pending = [];
  const arr = schedules();
  for (let i = 0; i < arr.length; i++) {
    const task = arr[i];
    if (!task || !task.enabled) continue;
    if (running.has(task.id)) continue;
    const due = Date.parse(task.nextRun);
    if (!Number.isFinite(due)) {
      refreshNext(task, new Date());
      continue;
    }
    // Una sola ejecución aunque se hayan perdido varias (app cerrada).
    if (due <= now) pending.push(task.id);
  }
  for (let i = 0; i < pending.length; i++) {
    Promise.resolve(run(pending[i])).catch(function () {});
  }
  return pending;
}

function start(options) {
  deps = options || {};
  stop();

  // Normaliza lo guardado: ids, enabled, nextRun válido.
  const now = new Date();
  let dirty = false;
  const arr = schedules();
  for (let i = 0; i < arr.length; i++) {
    const task = arr[i];
    if (!task) continue;
    if (!task.id) {
      task.id = crypto.randomUUID();
      dirty = true;
    }
    if (task.enabled === undefined) {
      task.enabled = true;
      dirty = true;
    }
    if (!task.nextRun || !Number.isFinite(Date.parse(task.nextRun))) {
      refreshNext(task, now);
      dirty = true;
    }
  }
  if (dirty) persist();

  timer = setInterval(tick, TICK_MS);
  if (timer && typeof timer.unref === "function") timer.unref();
  return { stop: stop, tick: tick };
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { start, stop, list, save, remove, run, cancel, tick, computeNext };
