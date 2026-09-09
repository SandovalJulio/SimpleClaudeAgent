// Registro de canales, compartido por el proceso principal de Electron (main.js) y el servidor
// web (server.js). Todo lo que necesita el sistema operativo (selectores, abrir rutas, guardar)
// llega en `ctx`; cada anfitrión lo resuelve a su manera.
const path = require("path");
const fs = require("fs");

const cfg = require("./config");
const mem = require("./memory");
const agent = require("./agent");
const scheduler = require("./scheduler");

// `h(canal, fn)` registra; `ctx` aporta lo dependiente del anfitrión.
function register(h, ctx) {
  // El renderer nunca recibe secretos: `publicConfig()` sustituye credenciales por indicadores.
  h("state:get", () => ({ folder: cfg.getFolder(), settings: cfg.settings, models: cfg.MODELS, efforts: cfg.EFFORTS, permissions: cfg.PERMISSIONS, connections: cfg.CONNECTIONS, config: cfg.publicConfig(), apiKey: cfg.apiKeyStatus() }));
  h("settings:set", async (patch) => { const s = cfg.setSettings(patch); await agent.applySettings(); return s; });
  h("config:set", (patch) => { cfg.setConfig(patch); return cfg.publicConfig(); });

  // Clave de API: se valida con una consulta mínima antes de guardarla cifrada. Borrarla cierra las conversaciones.
  h("apikey:status", () => cfg.apiKeyStatus());
  h("apikey:set", async (key) => { const r = await agent.validateApiKey(key); if (r.ok) { agent.closeAll(); cfg.setApiKey(key); } return { ...r, status: cfg.apiKeyStatus() }; });
  h("apikey:clear", () => { agent.closeAll(); return cfg.setApiKey(""); });
  h("mcp:status", () => agent.status());

  h("export:save", (o) => ctx.saveExport(o || {}));
  h("folder:pick", async () => { const p = await ctx.pickFolder(); if (p) { agent.closeAll(); cfg.setFolder(p); } return cfg.getFolder(); });
  h("folder:set", (p) => { if (p && fs.existsSync(p)) { agent.closeAll(); cfg.setFolder(p); } return cfg.getFolder(); });
  h("files:pick", () => ctx.pickFiles());
  h("dir:pick", () => ctx.pickDirectory());
  h("path:open", (p) => ctx.openPath(p));
  h("file:open", (p) => ctx.openFile(p));
  h("url:open", (url) => { if (/^https?:\/\//i.test(url)) ctx.openExternal(url); });

  // Lectura para vista previa: solo dentro de la carpeta de trabajo o directorios adicionales, máx. 2 MB.
  h("file:read", (p) => {
    const abs = path.resolve(p);
    const roots = [cfg.getFolder(), ...cfg.getConfig().dirs].filter(Boolean).map((r) => path.resolve(r));
    if (!roots.some((r) => abs.toLowerCase().startsWith(r.toLowerCase() + path.sep))) throw new Error("Ruta fuera de la carpeta de trabajo.");
    const st = fs.statSync(abs);
    if (st.size > 2 * 1024 * 1024) throw new Error("Archivo demasiado grande para la vista previa (máx. 2 MB).");
    const ext = path.extname(abs).toLowerCase();
    const mime = { ".md": "text/markdown", ".json": "application/json", ".csv": "text/csv", ".html": "text/html", ".htm": "text/html", ".svg": "image/svg+xml" }[ext] || "text/plain";
    return { text: fs.readFileSync(abs, "utf8"), mime, size: st.size };
  });

  h("skills:list", () => mem.listSkills(cfg.getFolder()));
  h("memory:list", () => mem.listMemory(cfg.getFolder()));
  h("memory:read", () => mem.readMemoryFile(cfg.getFolder()));
  h("memory:write", (t) => mem.writeMemoryFile(cfg.getFolder(), t));

  h("conv:new", (o) => agent.create(o || {}));
  h("conv:send", (o) => agent.send(o));
  h("conv:stop", (id) => agent.stop(id));
  h("conv:compact", (id) => agent.compact(id));
  h("conv:close", (id) => agent.close(id));
  h("conv:rewind", (o) => agent.rewind(o));
  h("conv:diff", (o) => agent.diff(o));
  h("conv:reply", (o) => agent.reply(o));
  h("sessions:list", () => agent.sessions());
  h("sessions:messages", (id) => agent.sessionMessages(id));
  h("conv:meta", ({ sessionId, ...patch }) => cfg.setConvMeta(sessionId, patch));

  h("schedule:list", () => scheduler.list());
  h("schedule:save", (t) => scheduler.save(t));
  h("schedule:delete", (id) => scheduler.remove(id));
  h("schedule:run", (id) => scheduler.run(id));
  h("schedule:cancel", (id) => scheduler.cancel(id));

  // Solo el servidor web: el navegador no puede listar el disco, así que el selector de carpetas y
  // archivos del renderer (picker.js) lo hace con este canal.
  if (ctx.browse) h("fs:browse", (p) => browse(p));
}

// Lista un directorio para el selector web. Sin ruta: unidades (Windows) o la carpeta personal.
function browse(p) {
  const os = require("os");
  if (!p) {
    const home = os.homedir();
    const roots = [{ name: "Carpeta personal", path: home, dir: true }, { name: "Documentos", path: path.join(home, "Documents"), dir: true }];
    if (cfg.getFolder()) roots.unshift({ name: "Carpeta de trabajo", path: cfg.getFolder(), dir: true });
    if (process.platform === "win32") {
      for (const l of "CDEFGHIJKLMNOPQRSTUVWXYZ") { const d = l + ":\\"; if (fs.existsSync(d)) roots.push({ name: d, path: d, dir: true }); }
    } else roots.push({ name: "/", path: "/", dir: true });
    return { path: "", parent: null, entries: roots.filter((r) => fs.existsSync(r.path)) };
  }
  const abs = path.resolve(p);
  const entries = [];
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    try { entries.push({ name: e.name, path: path.join(abs, e.name), dir: e.isDirectory() }); } catch { /* sin permiso */ }
  }
  entries.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1));
  const parent = path.dirname(abs);
  return { path: abs, parent: parent === abs ? "" : parent, entries };
}

module.exports = { register };
