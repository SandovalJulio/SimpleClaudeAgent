// Servidor local: la misma app sin Electron. Sirve renderer/ y traduce los canales de ipc.js a
// HTTP (POST /api/<canal>) y los eventos main -> renderer a SSE (/events). Escucha solo en
// 127.0.0.1: quien alcance el puerto controla el agente con todos sus permisos.
const http = require("http");
const path = require("path");
const fs = require("fs");
const { execFile } = require("child_process");

try { process.loadEnvFile(path.join(__dirname, ".env")); } catch { /* sin .env: variable del sistema o clave guardada */ }
if (process.env.AGENTE_SIN_CLAVE) delete process.env.ANTHROPIC_API_KEY; // pruebas: simula la primera ejecución

const cfg = require("./src/main/config");
const mem = require("./src/main/memory");
const agent = require("./src/main/agent");
const scheduler = require("./src/main/scheduler");

const PORT = Number(process.env.AGENTE_PORT) || 4599;
const ROOT = __dirname;

// ---------- eventos hacia el renderer ----------
const clients = new Set();
const emit = (channel, data) => {
  const frame = `event: ${channel}\ndata: ${JSON.stringify(data === undefined ? null : data)}\n\n`;
  for (const res of clients) { try { res.write(frame); } catch { clients.delete(res); } }
};
// Sin Notification de Electron: lo muestra el navegador (web-preload.js pide permiso).
const notify = (title, body) => { if (cfg.getConfig().notifications) emit("app:notify", { title, body }); };

// ---------- abrir rutas y enlaces en el sistema ----------
const openWith = (target, select) => {
  if (process.platform === "win32") {
    if (select) execFile("explorer.exe", ["/select,", target], () => {});
    else execFile("cmd", ["/c", "start", "", target], { windowsHide: true }, () => {});
  } else if (process.platform === "darwin") execFile("open", select ? ["-R", target] : [target], () => {});
  else execFile("xdg-open", [select ? path.dirname(target) : target], () => {});
};

// ---------- canales ----------
const handlers = new Map();
require("./src/main/ipc").register((ch, fn) => handlers.set(ch, fn), {
  // El navegador no puede abrir un diálogo nativo: los selectores los pinta picker.js en el
  // renderer usando el canal `fs:browse`, así que aquí no llegan nunca.
  browse: true,
  pickFolder: () => null,
  pickFiles: () => [],
  pickDirectory: () => null,
  saveExport: () => null, // el renderer descarga el archivo con un Blob
  openPath: (p) => openWith(p, true),
  openFile: (p) => openWith(p, false),
  openExternal: (url) => openWith(url, false),
});

// ---------- estáticos ----------
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json" };
// El renderer se escribió para el preload de Electron: se le inyectan el puente HTTP y el selector.
const INJECT = '<script src="web-preload.js"></script>\n  <script src="picker.js"></script>\n  <script src="app.js"></script>';

function serveStatic(url, res) {
  // index.html vive en renderer/ pero se sirve en la raíz: sus rutas relativas se resuelven ahí.
  // La excepción es node_modules/ (index.html carga marked con ../node_modules/...).
  const base = url.startsWith("/node_modules/") ? ROOT : path.join(ROOT, "renderer");
  const abs = path.resolve(base, url === "/" ? "index.html" : url.slice(1));
  const ok = [path.join(ROOT, "renderer"), path.join(ROOT, "node_modules")].some((r) => abs.startsWith(r + path.sep));
  if (!ok || !fs.existsSync(abs) || fs.statSync(abs).isDirectory()) { res.writeHead(404).end("no encontrado"); return; }
  let body = fs.readFileSync(abs);
  if (abs.endsWith("index.html")) body = Buffer.from(body.toString("utf8").replace('<script src="app.js"></script>', INJECT), "utf8");
  res.writeHead(200, { "content-type": MIME[path.extname(abs)] || "application/octet-stream", "cache-control": "no-store" });
  res.end(body);
}

// ---------- servidor ----------
const server = http.createServer(async (req, res) => {
  if (req.url === "/events") {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
    res.write(": conectado\n\n");
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }
  if (req.method === "POST" && req.url.startsWith("/api/")) {
    const fn = handlers.get(decodeURIComponent(req.url.slice(5)));
    if (!fn) { res.writeHead(404, { "content-type": "application/json" }).end('{"error":"canal desconocido"}'); return; }
    let raw = "";
    for await (const c of req) { raw += c; if (raw.length > 8e6) { res.writeHead(413).end(); return; } }
    res.writeHead(200, { "content-type": "application/json" });
    try {
      const value = await fn(...(raw ? JSON.parse(raw) : []));
      res.end(JSON.stringify({ value: value === undefined ? null : value }));
    } catch (e) { res.end(JSON.stringify({ error: String(e && e.message || e) })); }
    return;
  }
  if (req.method === "GET") return serveStatic(req.url.split("?")[0], res);
  res.writeHead(405).end();
});

cfg.load();
cfg.loadApiKey(); // antes de crear cualquier conversación: el SDK la toma de process.env
if (!cfg.getConfig().skillsSeeded && !process.env.AGENTE_USER_DATA) { mem.seedExampleSkills(cfg.getFolder()); cfg.getConfig().skillsSeeded = true; cfg.save(); }
agent.init({ emit, notify });
scheduler.start({ getConfig: cfg.getConfig, saveConfig: cfg.save, runOnce: agent.runOnce, notify, emit, getFolder: cfg.getFolder });

server.listen(PORT, "127.0.0.1", () => {
  const url = `http://127.0.0.1:${PORT}`;
  console.log(`Agente en ${url}  (Ctrl+C para salir)`);
  if (!process.env.AGENTE_NO_OPEN) openWith(url, false);
});
const salir = () => { agent.closeAll(); server.close(); process.exit(0); };
process.on("SIGINT", salir);
process.on("SIGTERM", salir);
