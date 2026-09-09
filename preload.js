const { contextBridge, ipcRenderer, webUtils } = require("electron");

const invoke = (ch) => (...args) => ipcRenderer.invoke(ch, ...args);

contextBridge.exposeInMainWorld("agente", {
  // estado y configuración
  getState: invoke("state:get"),
  setSettings: invoke("settings:set"),
  setConfig: invoke("config:set"),
  apiKeyStatus: invoke("apikey:status"),
  apiKeySet: invoke("apikey:set"),
  apiKeyClear: invoke("apikey:clear"),
  // carpeta y archivos
  pickFolder: invoke("folder:pick"),
  setFolder: invoke("folder:set"),
  pickFiles: invoke("files:pick"),
  pickDirectory: invoke("dir:pick"),
  openPath: invoke("path:open"),
  openFile: invoke("file:open"),
  openExternal: invoke("url:open"),
  readFile: invoke("file:read"),
  getPathForFile: (file) => webUtils.getPathForFile(file), // arrastrar y soltar
  // skills y memoria
  listSkills: invoke("skills:list"),
  listMemory: invoke("memory:list"),
  readMemoryFile: invoke("memory:read"),
  writeMemoryFile: invoke("memory:write"),
  // conversaciones
  convNew: invoke("conv:new"),
  convSend: invoke("conv:send"),
  convStop: invoke("conv:stop"),
  convCompact: invoke("conv:compact"),
  convClose: invoke("conv:close"),
  convRewind: invoke("conv:rewind"),
  convDiff: invoke("conv:diff"),
  mcpStatus: invoke("mcp:status"),
  exportSave: invoke("export:save"),
  convReply: invoke("conv:reply"),
  listSessions: invoke("sessions:list"),
  convMeta: invoke("conv:meta"),
  // tareas programadas
  scheduleList: invoke("schedule:list"),
  scheduleSave: invoke("schedule:save"),
  scheduleDelete: invoke("schedule:delete"),
  scheduleRun: invoke("schedule:run"),
  scheduleCancel: invoke("schedule:cancel"),
  // eventos main -> renderer
  on: (channel, cb) => { ipcRenderer.on(channel, (_e, data) => cb(data)); },
});
