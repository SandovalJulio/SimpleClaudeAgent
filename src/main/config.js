// Configuración persistente, carpeta de trabajo y catálogos (modelos, permisos, conexiones).
const path = require("path");
const fs = require("fs");
const os = require("os");

// Electron es opcional: bajo Node puro (`npm run web`) `require("electron")` devuelve la ruta del
// binario, no la API, asi que se decide por `process.versions.electron`. Sin el: rutas de sistema y
// cifrado base64 (safeStorage usa DPAPI/Keychain y no tiene equivalente fuera de Electron).
const el = process.versions.electron ? require("electron") : null;
const safeStorage = el ? el.safeStorage : null;
const userDataDir = () => {
  if (el) return el.app.getPath("userData");
  if (process.env.AGENTE_USER_DATA) return process.env.AGENTE_USER_DATA;
  const base = process.platform === "win32" ? process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming")
    : process.platform === "darwin" ? path.join(os.homedir(), "Library", "Application Support")
    : process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  const dir = path.join(base, "agente-escritorio");
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* ya existe */ }
  return dir;
};
const documentsDir = () => (el ? el.app.getPath("documents") : path.join(os.homedir(), "Documents"));

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
// Conexiones MCP. Las de `pkg` se ejecutan con npx; `fields` son credenciales que el usuario
// introduce en Configuración (se guardan cifradas con safeStorage). `env`/`headers` usan {clave}.
const CONNECTIONS = [
  { id: "web", label: "Navegador web", note: "Abre páginas, lee contenido y hace clics (Playwright)", pkg: "@playwright/mcp@latest" },
  { id: "memoria", label: "Grafo de conocimiento", note: "Memoria estructurada de entidades y relaciones", pkg: "@modelcontextprotocol/server-memory" },
  { id: "razonamiento", label: "Razonamiento paso a paso", note: "Descompone problemas complejos en pasos", pkg: "@modelcontextprotocol/server-sequential-thinking" },
  { id: "github", label: "GitHub", note: "Repositorios, issues y pull requests", url: "https://api.githubcopilot.com/mcp/",
    headers: { Authorization: "Bearer {token}" }, fields: [{ key: "token", label: "Token personal (PAT)", help: "github.com › Settings › Developer settings › Personal access tokens" }] },
  { id: "notion", label: "Notion", note: "Páginas y bases de datos", pkg: "@notionhq/notion-mcp-server",
    env: { OPENAPI_MCP_HEADERS: '{"Authorization":"Bearer {token}","Notion-Version":"2022-06-28"}' }, fields: [{ key: "token", label: "Token de integración", help: "notion.so/my-integrations" }] },
  { id: "slack", label: "Slack", note: "Canales y mensajes", pkg: "@modelcontextprotocol/server-slack",
    env: { SLACK_BOT_TOKEN: "{token}", SLACK_TEAM_ID: "{team}" }, fields: [{ key: "token", label: "Bot token (xoxb-…)" }, { key: "team", label: "Team ID", secret: false }] },
  { id: "brave", label: "Búsqueda Brave", note: "Búsqueda web alternativa con API", pkg: "@modelcontextprotocol/server-brave-search",
    env: { BRAVE_API_KEY: "{key}" }, fields: [{ key: "key", label: "API key", help: "brave.com/search/api" }] },
];
const fill = (tpl, values) => String(tpl).replace(/\{(\w+)\}/g, (_, k) => values[k] || "");
function mcpServerFor(c, values = {}) {
  if (c.url) {
    const headers = Object.fromEntries(Object.entries(c.headers || {}).map(([k, v]) => [k, fill(v, values)]));
    return { type: "http", url: c.url, headers };
  }
  const env = c.env ? Object.fromEntries(Object.entries(c.env).map(([k, v]) => [k, fill(v, values)])) : undefined;
  const base = process.platform === "win32"
    ? { command: "cmd", args: ["/c", "npx", "-y", c.pkg] }
    : { command: "npx", args: ["-y", c.pkg] };
  return env ? { ...base, env } : base;
}
// Estado de una conexión en config: { enabled, values: { clave: "enc:..." } } (boolean antiguo = enabled).
function connState(id) {
  const v = config.connections[id];
  return typeof v === "object" && v ? v : { enabled: !!v, values: {} };
}
function connValues(id) {
  const out = {};
  for (const [k, v] of Object.entries(connState(id).values || {})) out[k] = decrypt(v);
  return out;
}
function encrypt(text) {
  try { if (safeStorage && safeStorage.isEncryptionAvailable()) return "enc:" + safeStorage.encryptString(text).toString("base64"); } catch { /* sin cifrado */ }
  return "raw:" + Buffer.from(text, "utf8").toString("base64");
}
function decrypt(stored) {
  if (!stored) return "";
  try {
    if (stored.startsWith("enc:")) return safeStorage ? safeStorage.decryptString(Buffer.from(stored.slice(4), "base64")) : "";
    if (stored.startsWith("raw:")) return Buffer.from(stored.slice(4), "base64").toString("utf8");
  } catch { /* clave de otra máquina */ }
  return "";
}
// Configuración sin secretos, apta para el renderer.
function publicConfig() {
  const connections = {};
  for (const c of CONNECTIONS) {
    const s = connState(c.id);
    connections[c.id] = { enabled: s.enabled, has: Object.fromEntries((c.fields || []).map((f) => [f.key, !!s.values?.[f.key]])) };
  }
  const { apiKey, ...rest } = config;
  return { ...rest, connections, hasApiKey: !!apiKey };
}

// Clave de API. La guardada (cifrada en config.json) tiene prioridad; la del entorno
// (.env en desarrollo o variable ANTHROPIC_API_KEY) es el respaldo. El SDK la lee de process.env.
let envKey = "";
function loadApiKey() {
  envKey = process.env.ANTHROPIC_API_KEY || "";
  const saved = config.apiKey ? decrypt(config.apiKey) : "";
  if (saved) process.env.ANTHROPIC_API_KEY = saved;
}
function apiKeyStatus() {
  return { has: !!process.env.ANTHROPIC_API_KEY, source: config.apiKey ? "config" : envKey ? "env" : "none" };
}
function setApiKey(text) {
  const t = String(text || "").trim();
  if (t) { config.apiKey = encrypt(t); process.env.ANTHROPIC_API_KEY = t; }
  else { delete config.apiKey; if (envKey) process.env.ANTHROPIC_API_KEY = envKey; else delete process.env.ANTHROPIC_API_KEY; }
  save();
  return apiKeyStatus();
}

// Ajustes volátiles del compositor (se persisten en el renderer con localStorage).
const settings = { model: MODELS[0].id, effort: "medium", permission: "acceptEdits" };

// Configuración persistente (config.json en userData).
const DEFAULTS = {
  name: "", folder: "", connections: {}, schedules: [],
  maxBudgetUsd: 0, maxTurns: 0, sandbox: false, web: true, notifications: true,
  plugins: [], dirs: [],
  agents: true, // subagentes "lector" y "redactor"
  hooks: true,  // bloquear escrituras fuera de la carpeta y registrar cambios
  convMeta: {}, // sessionId -> { title?, pinned? } (nombre y fijado de conversaciones)
};

// Nombre personalizado y fijado por sesión del SDK. Se borra la entrada si queda vacía.
function setConvMeta(sessionId, patch = {}) {
  if (!sessionId || typeof sessionId !== "string") return config.convMeta;
  const m = { ...(config.convMeta[sessionId] || {}) };
  if ("title" in patch) { const t = String(patch.title || "").trim().slice(0, 80); if (t) m.title = t; else delete m.title; }
  if ("pinned" in patch) { if (patch.pinned) m.pinned = true; else delete m.pinned; }
  if (Object.keys(m).length) config.convMeta[sessionId] = m; else delete config.convMeta[sessionId];
  save();
  return config.convMeta;
}
let config = { ...DEFAULTS };
let folder = null;
const configPath = () => path.join(userDataDir(), "config.json");

function load() {
  try { config = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(configPath(), "utf8")) }; } catch { /* primera ejecución */ }
  if (config.folder && fs.existsSync(config.folder)) {
    folder = config.folder;
  } else {
    folder = path.join(documentsDir(), "Agente");
    try { fs.mkdirSync(folder, { recursive: true }); } catch { folder = documentsDir(); }
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
    // patch.connections[id] = boolean | { enabled?, values?: { clave: texto } }
    for (const c of CONNECTIONS) {
      if (!(c.id in patch.connections)) continue;
      const p = patch.connections[c.id];
      const s = connState(c.id);
      if (typeof p === "boolean") s.enabled = p;
      else if (p && typeof p === "object") {
        if (typeof p.enabled === "boolean") s.enabled = p.enabled;
        for (const f of c.fields || []) {
          if (p.values && f.key in p.values) {
            const text = String(p.values[f.key] || "").trim();
            if (text) s.values[f.key] = encrypt(text); else delete s.values[f.key];
          }
        }
      }
      config.connections[c.id] = s;
    }
  }
  for (const k of ["maxBudgetUsd", "maxTurns"]) if (typeof patch[k] === "number" && patch[k] >= 0) config[k] = patch[k];
  for (const k of ["sandbox", "web", "notifications", "agents", "hooks"]) if (typeof patch[k] === "boolean") config[k] = patch[k];
  for (const k of ["plugins", "dirs"]) if (Array.isArray(patch[k])) config[k] = patch[k].filter((p) => typeof p === "string" && fs.existsSync(p));
  save();
  return config;
}

module.exports = {
  MODELS, EFFORTS, PERMISSIONS, CONNECTIONS, mcpServerFor, connState, connValues, publicConfig,
  loadApiKey, apiKeyStatus, setApiKey, setConvMeta,
  settings, setSettings, setConfig, load, save,
  getConfig: () => config, getFolder: () => folder, setFolder, documentsDir,
};
