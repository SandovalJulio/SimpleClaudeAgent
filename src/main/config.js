// Configuración persistente, carpeta de trabajo y catálogos (modelos, permisos, conexiones).
const { app } = require("electron");
const path = require("path");
const fs = require("fs");

// Modelos del selector (precio USD por millón de tokens).
const MODELS = [
  { id: "claude-haiku-4-5", label: "Haiku 4.5", note: "Rápido y económico", in: 1, out: 5 },
  { id: "claude-sonnet-5", label: "Sonnet 5", note: "Equilibrado", in: 2, out: 10 },
  { id: "claude-opus-5", label: "Opus 5", note: "Máxima capacidad", in: 5, out: 25 },
];
const EFFORTS = ["low", "medium", "high"];
const PERMISSIONS = [
  { id: "plan", label: "Planificar", note: "Solo lee y propone un plan; tú lo apruebas antes de ejecutar" },
  { id: "default", label: "Preguntar", note: "Pide permiso antes de escribir archivos o ejecutar comandos" },
  { id: "acceptEdits", label: "Auto", note: "Edita archivos sin preguntar; pregunta en comandos delicados" },
  { id: "bypassPermissions", label: "Total", note: "Sin confirmaciones (cuidado)" },
];
// Conexiones MCP sencillas: se ejecutan con npx, sin claves.
const CONNECTIONS = [
  { id: "web", label: "Navegador web", note: "Abre páginas, lee contenido y hace clics (Playwright)", pkg: "@playwright/mcp@latest" },
  { id: "memoria", label: "Grafo de conocimiento", note: "Memoria estructurada de entidades y relaciones", pkg: "@modelcontextprotocol/server-memory" },
  { id: "razonamiento", label: "Razonamiento paso a paso", note: "Descompone problemas complejos en pasos", pkg: "@modelcontextprotocol/server-sequential-thinking" },
];
function mcpServerFor(c) {
  return process.platform === "win32"
    ? { command: "cmd", args: ["/c", "npx", "-y", c.pkg] }
    : { command: "npx", args: ["-y", c.pkg] };
}

// Ajustes volátiles del compositor (se persisten en el renderer con localStorage).
const settings = { model: MODELS[0].id, effort: "medium", permission: "acceptEdits" };

// Configuración persistente (config.json en userData).
const DEFAULTS = {
  name: "", folder: "", connections: {}, schedules: [],
  maxBudgetUsd: 0, maxTurns: 0, sandbox: false, web: true, notifications: true,
  plugins: [], dirs: [],
};
let config = { ...DEFAULTS };
let folder = null;
const configPath = () => path.join(app.getPath("userData"), "config.json");

function load() {
  try { config = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(configPath(), "utf8")) }; } catch { /* primera ejecución */ }
  if (config.folder && fs.existsSync(config.folder)) {
    folder = config.folder;
  } else {
    folder = path.join(app.getPath("documents"), "Agente");
    try { fs.mkdirSync(folder, { recursive: true }); } catch { folder = app.getPath("documents"); }
  }
}
function save() {
  try { fs.writeFileSync(configPath(), JSON.stringify(config, null, 2)); } catch { /* ignorar */ }
}
function setFolder(p) {
  folder = p;
  config.folder = p;
  save();
}
function setSettings(patch = {}) {
  if (MODELS.some((m) => m.id === patch.model)) settings.model = patch.model;
  if (EFFORTS.includes(patch.effort)) settings.effort = patch.effort;
  if (PERMISSIONS.some((p) => p.id === patch.permission)) settings.permission = patch.permission;
  return settings;
}
function setConfig(patch = {}) {
  if (typeof patch.name === "string") config.name = patch.name.trim().slice(0, 60);
  if (patch.connections && typeof patch.connections === "object") {
    for (const c of CONNECTIONS) if (c.id in patch.connections) config.connections[c.id] = !!patch.connections[c.id];
  }
  for (const k of ["maxBudgetUsd", "maxTurns"]) if (typeof patch[k] === "number" && patch[k] >= 0) config[k] = patch[k];
  for (const k of ["sandbox", "web", "notifications"]) if (typeof patch[k] === "boolean") config[k] = patch[k];
  for (const k of ["plugins", "dirs"]) if (Array.isArray(patch[k])) config[k] = patch[k].filter((p) => typeof p === "string" && fs.existsSync(p));
  save();
  return config;
}

module.exports = {
  MODELS, EFFORTS, PERMISSIONS, CONNECTIONS, mcpServerFor,
  settings, setSettings, setConfig, load, save,
  getConfig: () => config, getFolder: () => folder, setFolder,
};
