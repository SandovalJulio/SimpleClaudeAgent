// Proceso principal: ventana, atajos, notificaciones y registro de IPC.
const { app, BrowserWindow, Menu, Notification, ipcMain, dialog, shell } = require("electron");
const path = require("path");
const fs = require("fs");

try { process.loadEnvFile(path.join(__dirname, ".env")); } catch { /* sin .env: variable del sistema */ }

const cfg = require("./src/main/config");
const mem = require("./src/main/memory");
const agent = require("./src/main/agent");
const scheduler = require("./src/main/scheduler");

if (process.env.AGENTE_USER_DATA) app.setPath("userData", process.env.AGENTE_USER_DATA); // pruebas

let win;
const emit = (channel, data) => { if (win && !win.isDestroyed()) win.webContents.send(channel, data); };
const notify = (title, body) => {
  if (!cfg.getConfig().notifications || !Notification.isSupported()) return;
  if (win && win.isFocused()) return; // solo cuando la app no está delante
  new Notification({ title, body, silent: false }).show();
};

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 960, minHeight: 620, title: "Agente", backgroundColor: "#f4f4f5",
    webPreferences: { preload: path.join(__dirname, "preload.js") },
  });
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
  win.webContents.on("before-input-event", (e, input) => {
    if (input.type !== "keyDown") return;
    if ((input.control && input.key.toLowerCase() === "r") || input.key === "F5") { win.webContents.reloadIgnoringCache(); e.preventDefault(); }
    if (input.control && input.shift && input.key.toLowerCase() === "i") { win.webContents.toggleDevTools(); e.preventDefault(); }
  });
  // Al recargar la interfaz, las conversaciones del proceso quedarían huérfanas: se cierran.
  win.webContents.on("did-start-navigation", (_e, _url, _inPlace, isMainFrame) => { if (isMainFrame) agent.closeAll(); });
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  cfg.load();
  agent.init({ emit, notify });
  scheduler.start({ getConfig: cfg.getConfig, saveConfig: cfg.save, runOnce: agent.runOnce, notify: (t, b) => Notification.isSupported() && new Notification({ title: t, body: b }).show(), emit, getFolder: cfg.getFolder });
  createWindow();
});
app.on("window-all-closed", () => { agent.closeAll(); app.quit(); });

// ---------- IPC ----------
const h = (ch, fn) => ipcMain.handle(ch, (_e, ...a) => fn(...a));

// El renderer nunca recibe secretos: `publicConfig()` sustituye credenciales por indicadores.
h("state:get", () => ({ folder: cfg.getFolder(), settings: cfg.settings, models: cfg.MODELS, efforts: cfg.EFFORTS, permissions: cfg.PERMISSIONS, connections: cfg.CONNECTIONS, config: cfg.publicConfig() }));
h("settings:set", async (patch) => { const s = cfg.setSettings(patch); await agent.applySettings(); return s; });
h("config:set", (patch) => { cfg.setConfig(patch); return cfg.publicConfig(); });
h("mcp:status", () => agent.status());

// Exportar texto a un archivo elegido por el usuario (conversaciones en Markdown).
h("export:save", async ({ defaultName, text }) => {
  const r = await dialog.showSaveDialog(win, { defaultPath: path.join(cfg.getFolder() || app.getPath("documents"), defaultName || "conversacion.md"), filters: [{ name: "Markdown", extensions: ["md"] }] });
  if (r.canceled) return null;
  fs.writeFileSync(r.filePath, text, "utf8");
  return r.filePath;
});

h("folder:pick", async () => {
  const r = await dialog.showOpenDialog(win, { properties: ["openDirectory"], defaultPath: cfg.getFolder() || undefined });
  if (!r.canceled) { agent.closeAll(); cfg.setFolder(r.filePaths[0]); }
  return cfg.getFolder();
});
h("folder:set", (p) => { if (p && fs.existsSync(p)) { agent.closeAll(); cfg.setFolder(p); } return cfg.getFolder(); });
h("files:pick", async () => {
  const r = await dialog.showOpenDialog(win, { properties: ["openFile", "multiSelections"], defaultPath: cfg.getFolder() || undefined });
  return r.canceled ? [] : r.filePaths;
});
h("dir:pick", async () => { const r = await dialog.showOpenDialog(win, { properties: ["openDirectory"] }); return r.canceled ? null : r.filePaths[0]; });
h("path:open", (p) => shell.showItemInFolder(p));
h("file:open", (p) => shell.openPath(p));
h("url:open", (url) => { if (/^https?:\/\//i.test(url)) shell.openExternal(url); });

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
h("conv:close", (id) => agent.close(id));
h("conv:rewind", (o) => agent.rewind(o));
h("conv:diff", (o) => agent.diff(o));
h("conv:reply", (o) => agent.reply(o));
h("sessions:list", () => agent.sessions());

h("schedule:list", () => scheduler.list());
h("schedule:save", (t) => scheduler.save(t));
h("schedule:delete", (id) => scheduler.remove(id));
h("schedule:run", (id) => scheduler.run(id));
h("schedule:cancel", (id) => scheduler.cancel(id));

// --- Empaquetado: .env junto al ejecutable y actualizaciones automáticas ---
// Solo aplica a la app instalada. Ver docs/EMPAQUETADO.md.
if (app.isPackaged) {
  // Dentro del asar __dirname no es una carpeta real, así que se busca el .env
  // junto al ejecutable instalado (además del que carga la línea 6).
  try { process.loadEnvFile(path.join(path.dirname(process.execPath), ".env")); } catch { /* sin .env: variable del sistema */ }

  app.whenReady().then(() => {
    try {
      const { autoUpdater } = require("electron-updater");
      autoUpdater.autoDownload = true;
      autoUpdater.on("error", () => { /* sin publish configurado o sin red: se ignora */ });
      autoUpdater.checkForUpdatesAndNotify();
    } catch { /* electron-updater ausente: la app sigue funcionando */ }
  });
}
