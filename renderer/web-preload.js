// Sustituto de preload.js cuando la app corre en el navegador (server.js). Expone el mismo
// `window.agente`: cada método es un POST a /api/<canal> y los eventos llegan por SSE.
(() => {
  const invoke = (ch) => async (...args) => {
    const r = await fetch("/api/" + ch, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(args) });
    const { value, error } = await r.json();
    if (error) throw new Error(error);
    return value;
  };

  const bus = new EventSource("/events");
  const on = (channel, cb) => bus.addEventListener(channel, (e) => cb(JSON.parse(e.data)));

  const agente = {
    web: true, // los módulos del renderer pueden distinguir el modo
    getState: invoke("state:get"),
    setSettings: invoke("settings:set"),
    setConfig: invoke("config:set"),
    apiKeyStatus: invoke("apikey:status"),
    apiKeySet: invoke("apikey:set"),
    apiKeyClear: invoke("apikey:clear"),
    setFolder: invoke("folder:set"),
    openPath: invoke("path:open"),
    openFile: invoke("file:open"),
    openExternal: invoke("url:open"),
    readFile: invoke("file:read"),
    listSkills: invoke("skills:list"),
    listMemory: invoke("memory:list"),
    readMemoryFile: invoke("memory:read"),
    writeMemoryFile: invoke("memory:write"),
    convNew: invoke("conv:new"),
    convSend: invoke("conv:send"),
    convStop: invoke("conv:stop"),
    convCompact: invoke("conv:compact"),
    convClose: invoke("conv:close"),
    convRewind: invoke("conv:rewind"),
    convDiff: invoke("conv:diff"),
    convReply: invoke("conv:reply"),
    mcpStatus: invoke("mcp:status"),
    listSessions: invoke("sessions:list"),
    sessionMessages: invoke("sessions:messages"),
    convMeta: invoke("conv:meta"),
    scheduleList: invoke("schedule:list"),
    scheduleSave: invoke("schedule:save"),
    scheduleDelete: invoke("schedule:delete"),
    scheduleRun: invoke("schedule:run"),
    scheduleCancel: invoke("schedule:cancel"),
    browse: invoke("fs:browse"),
    on,

    // --- lo que en Electron hacía el sistema ---
    // Selectores: los pinta picker.js, porque el navegador no da rutas del disco.
    pickFolder: async () => { const p = await window.Picker.open({ mode: "dir", title: "Elegir carpeta de trabajo" }); return p ? window.agente.setFolder(p) : null; },
    pickDirectory: () => window.Picker.open({ mode: "dir", title: "Elegir carpeta" }),
    pickFiles: async () => { const p = await window.Picker.open({ mode: "files", title: "Adjuntar archivos" }); return p || []; },
    // Arrastrar y soltar no expone la ruta absoluta en el navegador; el compositor descarta los nulos.
    getPathForFile: () => null,
    // Exportar: descarga del navegador en lugar de diálogo de guardado.
    exportSave: async ({ defaultName, text }) => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([text], { type: "text/markdown" }));
      a.download = defaultName || "conversacion.md";
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      return a.download;
    },
  };
  window.agente = agente;

  // Avisos del proceso: el navegador los muestra si el usuario da permiso y la pestaña no está a la vista.
  on("app:notify", ({ title, body }) => {
    if (!("Notification" in window) || Notification.permission !== "granted" || !document.hidden) return;
    new Notification(title, { body });
  });
  addEventListener("click", function pedir() {
    removeEventListener("click", pedir);
    if ("Notification" in window && Notification.permission === "default") Notification.requestPermission();
  });
})();
