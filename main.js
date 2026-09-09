// Proceso principal: ventana, atajos, notificaciones y registro de IPC.
const { app, BrowserWindow, Menu, Notification, ipcMain, dialog, shell } = require("electron");
const path = require("path");
const fs = require("fs");

// Solo en desarrollo: .env junto a main.js. La app instalada guarda la clave cifrada en config.json.
try { process.loadEnvFile(path.join(__dirname, ".env")); } catch { /* sin .env: variable del sistema o clave guardada */ }
if (process.env.AGENTE_SIN_CLAVE) delete process.env.ANTHROPIC_API_KEY; // pruebas: simula la primera ejecución

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
    icon: path.join(__dirname, "build", "icon.png"), // icono de ventana y barra de tareas (el instalador usa el mismo)
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
  cfg.loadApiKey(); // antes de crear cualquier conversación: el SDK la toma de process.env
  // Skills de ejemplo en la carpeta por defecto, solo la primera vez (no en las pruebas: tocarían Documentos\Agente).
  if (!cfg.getConfig().skillsSeeded && !process.env.AGENTE_USER_DATA) { mem.seedExampleSkills(cfg.getFolder()); cfg.getConfig().skillsSeeded = true; cfg.save(); }
  agent.init({ emit, notify });
  scheduler.start({ getConfig: cfg.getConfig, saveConfig: cfg.save, runOnce: agent.runOnce, notify: (t, b) => Notification.isSupported() && new Notification({ title: t, body: b }).show(), emit, getFolder: cfg.getFolder });
  createWindow();
});
app.on("window-all-closed", () => { agent.closeAll(); app.quit(); });

// ---------- IPC ----------
// Los canales viven en src/main/ipc.js (compartidos con el servidor web); aquí solo se resuelve
// lo que depende de Electron: diálogos nativos y shell.
require("./src/main/ipc").register(
  (ch, fn) => ipcMain.handle(ch, (_e, ...a) => fn(...a)),
  {
    saveExport: async ({ defaultName, text }) => {
      const r = await dialog.showSaveDialog(win, { defaultPath: path.join(cfg.getFolder() || app.getPath("documents"), defaultName || "conversacion.md"), filters: [{ name: "Markdown", extensions: ["md"] }] });
      if (r.canceled) return null;
      fs.writeFileSync(r.filePath, text, "utf8");
      return r.filePath;
    },
    pickFolder: async () => {
      const r = await dialog.showOpenDialog(win, { properties: ["openDirectory"], defaultPath: cfg.getFolder() || undefined });
      return r.canceled ? null : r.filePaths[0];
    },
    pickFiles: async () => {
      const r = await dialog.showOpenDialog(win, { properties: ["openFile", "multiSelections"], defaultPath: cfg.getFolder() || undefined });
      return r.canceled ? [] : r.filePaths;
    },
    pickDirectory: async () => { const r = await dialog.showOpenDialog(win, { properties: ["openDirectory"] }); return r.canceled ? null : r.filePaths[0]; },
    openPath: (p) => shell.showItemInFolder(p),
    openFile: (p) => shell.openPath(p),
    openExternal: (url) => shell.openExternal(url),
  },
);

// --- Empaquetado: actualizaciones automáticas (solo la app instalada). Ver docs/EMPAQUETADO.md.
if (app.isPackaged) {
  app.whenReady().then(() => {
    try {
      const { autoUpdater } = require("electron-updater");
      autoUpdater.autoDownload = true;
      autoUpdater.on("error", () => { /* sin publish configurado o sin red: se ignora */ });
      autoUpdater.checkForUpdatesAndNotify();
    } catch { /* electron-updater ausente: la app sigue funcionando */ }
  });
}
