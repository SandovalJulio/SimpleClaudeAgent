// Modal de configuración: nombre, memorias, preferencias, límites, herramientas, conexiones, tareas programadas.
(() => {
  const { $, esc, state, on, toast, relPath } = window.App;
  const root = $("settings-root");
  root.innerHTML = `
  <div id="overlay" class="overlay">
    <div class="modal" role="dialog" aria-modal="true">
      <div class="modal-head"><h2>Configuración</h2><button id="close-config" class="ib" title="Cerrar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
      <div class="modal-body">
        <div class="cfg-section"><div class="row"><div class="lbl"><b>¿Cómo quieres que el agente te llame?</b></div><input id="cfg-name" class="field" placeholder="Tu nombre" /></div></div>

        <div class="cfg-section">
          <h3>Clave de API</h3>
          <div class="row"><div class="lbl"><b>Clave de API de Anthropic</b><span id="cfg-key-status"></span>
            <div class="cred"><div class="credrow"><input id="cfg-key" class="field" type="password" placeholder="sk-ant-…" autocomplete="off" spellcheck="false" /><button id="cfg-key-save" class="btn ghost">Guardar</button><button id="cfg-key-clear" class="btn ghost">Borrar</button></div>
            <span class="help">Se comprueba con una consulta mínima y se guarda cifrada en este equipo. Nunca se muestra en la interfaz.</span></div></div></div>
        </div>

        <div class="cfg-section">
          <h3>Memorias</h3>
          <p class="desc">Lo que el agente ha aprendido de ti: correcciones, preferencias y perfil. Se guarda en <code id="mem-file">CLAUDE.md</code> de la carpeta de trabajo y se aplica en cada conversación. Puedes editarlo libremente.</p>
          <div id="mem-summary" class="mem-summary"></div>
          <textarea id="mem-edit" class="mem-edit" spellcheck="false"></textarea>
          <div class="mem-actions"><button id="mem-save" class="btn primary">Guardar memorias</button><button id="mem-reload" class="btn">Recargar</button><span id="mem-status"></span></div>
        </div>

        <div class="cfg-section">
          <h3>Preferencias</h3>
          <div class="row"><div class="lbl"><b>Apariencia</b></div>
            <div class="seg2" id="theme-seg">
              <button data-theme="system" title="Sistema"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg></button>
              <button data-theme="light" title="Claro"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg></button>
              <button data-theme="dark" title="Oscuro"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg></button>
            </div></div>
          <div class="row"><div class="lbl"><b>Fuente del chat</b></div><select id="cfg-font" class="field"><option value="sans">Sistema</option><option value="serif">Serif</option><option value="mono">Monoespaciada</option></select></div>
          <div class="row"><div class="lbl"><b>Notificaciones del sistema</b><span>Aviso al terminar una respuesta cuando la app no está delante.</span></div><button class="switch" data-cfg="notifications"></button></div>
        </div>

        <div class="cfg-section">
          <h3>Límites por conversación</h3>
          <div class="row"><div class="lbl"><b>Tope de gasto (USD)</b><span>0 = sin límite. El agente se detiene al alcanzarlo.</span></div><input id="cfg-budget" class="field num" type="number" min="0" step="0.5" /></div>
          <div class="row"><div class="lbl"><b>Máximo de turnos</b><span>0 = sin límite. Pasos herramienta-respuesta por mensaje.</span></div><input id="cfg-turns" class="field num" type="number" min="0" step="1" /></div>
        </div>

        <div class="cfg-section">
          <h3>Herramientas</h3>
          <div class="row"><div class="lbl"><b>Búsqueda web</b><span>Herramientas WebSearch y WebFetch del SDK.</span></div><button class="switch" data-cfg="web"></button></div>
          <div class="row"><div class="lbl"><b>Sandbox para comandos</b><span>Aísla los comandos Bash del resto del sistema. Si el sistema no lo soporta, se ejecutan sin aislar.</span></div><button class="switch" data-cfg="sandbox"></button></div>
          <div class="row"><div class="lbl"><b>Subagentes</b><span>«lector» (Haiku, solo lectura: explora y resume) y «redactor» (modelo principal: escribe documentos largos). El agente delega cuando conviene; la línea de actividad marca sus pasos.</span></div><button class="switch" data-cfg="agents"></button></div>
          <div class="row"><div class="lbl"><b>Protección y registro de escrituras</b><span>Bloquea escrituras fuera de la carpeta de trabajo y de los directorios adicionales (con aviso en el hilo) y anota cada archivo modificado en <code>.claude/cambios.log</code>.</span></div><button class="switch" data-cfg="hooks"></button></div>
          <div class="row"><div class="lbl"><b>Directorios adicionales</b><span>Otras carpetas a las que el agente puede acceder además de la de trabajo.</span><div id="cfg-dirs" class="paths"></div></div><button id="add-dir" class="btn">Añadir</button></div>
          <div class="row"><div class="lbl"><b>Plugins</b><span>Carpetas de plugins locales de Claude Code (skills, comandos y agentes de terceros).</span><div id="cfg-plugins" class="paths"></div></div><button id="add-plugin" class="btn">Añadir</button></div>
        </div>

        <div class="cfg-section">
          <h3>Conexiones</h3>
          <p class="desc">Herramientas externas que el agente puede usar. Las tres primeras no requieren claves. GitHub, Notion, Slack y Brave necesitan un token, que se guarda cifrado en este equipo y nunca se muestra en la interfaz. Las de <code>npx</code> se descargan la primera vez.</p>
          <div id="cfg-connections"></div>
        </div>

        <div class="cfg-section">
          <h3>Tareas programadas</h3>
          <p class="desc">Ejecuta un mensaje o skill de forma periódica en la carpeta de trabajo. El resultado se guarda en <code>.claude/programadas/</code> y se notifica.</p>
          <div id="cfg-schedules"></div>
        </div>
      </div>
    </div>
  </div>`;

  const overlay = $("overlay");
  async function open() {
    const s = await window.agente.getState();
    state.config = s.config;
    $("cfg-name").value = state.config.name || "";
    $("cfg-budget").value = state.config.maxBudgetUsd || 0;
    $("cfg-turns").value = state.config.maxTurns || 0;
    renderSwitches(); renderPaths(); renderConnections(); renderApiKey();
    await loadMemoryEditor();
    if (!$("cfg-schedules").dataset.mounted && window.SchedulesUI) { window.SchedulesUI.mount($("cfg-schedules")); $("cfg-schedules").dataset.mounted = "1"; }
    renderTheme();
    $("cfg-font").value = localStorage.getItem("font") || "sans";
    overlay.classList.add("open");
    refreshMcpStatus();
  }
  function close() { overlay.classList.remove("open"); window.App.refreshSide(); }
  $("open-config").onclick = open;
  $("close-config").onclick = close;
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && overlay.classList.contains("open")) close(); });

  async function setConfig(patch) { state.config = await window.agente.setConfig(patch); renderSwitches(); renderPaths(); renderConnections(); }
  $("cfg-name").addEventListener("change", () => setConfig({ name: $("cfg-name").value }));
  $("cfg-budget").addEventListener("change", () => setConfig({ maxBudgetUsd: Math.max(0, Number($("cfg-budget").value) || 0) }));
  $("cfg-turns").addEventListener("change", () => setConfig({ maxTurns: Math.max(0, Math.floor(Number($("cfg-turns").value) || 0)) }));

  // Clave de API: estado (origen), guardar (valida en main) y borrar (cierra las conversaciones).
  const KEY_SOURCE = { config: "Guardada cifrada en este equipo.", env: "Tomada del entorno (.env o variable ANTHROPIC_API_KEY).", none: "No configurada: el agente no puede funcionar." };
  function renderApiKey() {
    const st = state.apiKey || { has: false, source: "none" };
    $("cfg-key-status").textContent = KEY_SOURCE[st.source] || KEY_SOURCE.none;
    $("cfg-key-clear").hidden = st.source !== "config";
    $("cfg-key").value = "";
  }
  $("cfg-key-save").onclick = async () => {
    const key = $("cfg-key").value.trim();
    if (!key) return toast("Escribe la clave antes de guardar.", "err");
    $("cfg-key-status").textContent = "Comprobando la clave…";
    const r = await window.agente.apiKeySet(key);
    if (!r.ok) { $("cfg-key-status").textContent = "No se pudo validar: " + (r.error || "error desconocido"); return; }
    state.apiKey = r.status; renderApiKey(); toast("Clave guardada de forma cifrada.", "ok");
    window.App.emit("convs:reset"); // las conversaciones abiertas se cerraron en main
  };
  $("cfg-key-clear").onclick = async () => {
    state.apiKey = await window.agente.apiKeyClear(); renderApiKey();
    toast(state.apiKey.has ? "Clave borrada; se usa la del entorno." : "Clave borrada.", "ok");
    window.App.emit("convs:reset");
    if (!state.apiKey.has) { close(); window.App.emit("apikey:cleared"); }
  };

  function renderSwitches() {
    root.querySelectorAll("[data-cfg]").forEach((b) => {
      const k = b.dataset.cfg, on = !!state.config[k];
      b.classList.toggle("on", on); b.setAttribute("aria-checked", on);
      b.onclick = () => setConfig({ [k]: !state.config[k] });
    });
  }
  function renderPaths() {
    for (const [key, boxId] of [["dirs", "cfg-dirs"], ["plugins", "cfg-plugins"]]) {
      const box = $(boxId); box.innerHTML = "";
      for (const p of state.config[key] || []) {
        const row = document.createElement("div"); row.className = "pathrow";
        row.innerHTML = `<span title="${esc(p)}">${esc(p)}</span><button class="link" title="Quitar">×</button>`;
        row.querySelector("button").onclick = () => setConfig({ [key]: state.config[key].filter((x) => x !== p) });
        box.appendChild(row);
      }
    }
  }
  $("add-dir").onclick = async () => { const d = await window.agente.pickDirectory(); if (d) setConfig({ dirs: [...(state.config.dirs || []), d] }); };
  $("add-plugin").onclick = async () => { const d = await window.agente.pickDirectory(); if (d) setConfig({ plugins: [...(state.config.plugins || []), d] }); };

  // Conexiones: interruptor, estado real del servidor MCP y credenciales (se guardan cifradas en el proceso principal).
  const STATUS_LABEL = { connected: "Conectada", failed: "Con error", "needs-auth": "Requiere autenticación", pending: "Conectando…", disabled: "Desactivada" };
  let mcpStatus = {};
  function renderConnections() {
    const box = $("cfg-connections"); box.innerHTML = "";
    for (const c of state.connections) {
      const st = state.config.connections?.[c.id] || { enabled: false, has: {} };
      const on = !!st.enabled;
      const status = on ? (mcpStatus[c.id] || "pending") : "disabled";
      const row = document.createElement("div"); row.className = "row";
      const fields = (c.fields || []).map((f) => `
        <div class="credrow">
          <input class="field" type="${f.secret === false ? "text" : "password"}" data-key="${f.key}" placeholder="${esc(f.label)}${st.has?.[f.key] ? " (guardado)" : ""}" autocomplete="off" />
          <button class="btn ghost" data-save="${f.key}">Guardar</button>
        </div>${f.help ? `<span class="help">${esc(f.help)}</span>` : ""}`).join("");
      row.innerHTML = `<div class="lbl"><b><span class="mcp-dot ${status}" title="${STATUS_LABEL[status]}"></span>${esc(c.label)}</b><span>${esc(c.note)} · ${STATUS_LABEL[status]}</span><code>${esc(c.pkg || c.url)}</code>${fields ? `<div class="cred">${fields}</div>` : ""}</div>
        <button class="switch ${on ? "on" : ""}" role="switch" aria-checked="${on}"></button>`;
      row.querySelector(".switch").onclick = () => {
        const missing = (c.fields || []).filter((f) => !st.has?.[f.key]);
        if (!on && missing.length) return toast(`Guarda primero: ${missing.map((f) => f.label).join(", ")}.`, "err");
        setConfig({ connections: { [c.id]: { enabled: !on } } });
      };
      row.querySelectorAll("[data-save]").forEach((b) => (b.onclick = async () => {
        const input = row.querySelector(`input[data-key="${b.dataset.save}"]`);
        if (!input.value.trim()) return toast("Escribe un valor antes de guardar.", "err");
        await setConfig({ connections: { [c.id]: { values: { [b.dataset.save]: input.value } } } });
        toast("Credencial guardada de forma cifrada.", "ok");
      }));
      box.appendChild(row);
    }
  }
  async function refreshMcpStatus() {
    try { for (const s of await window.agente.mcpStatus()) mcpStatus[s.id] = s.status; renderConnections(); } catch { /* sin conversaciones abiertas */ }
  }
  window.agente.on("mcp:status", (list) => { for (const s of list) mcpStatus[s.id] = s.status; if (overlay.classList.contains("open")) renderConnections(); });

  // Tema y fuente
  function renderTheme() { const t = localStorage.getItem("theme") || "system"; root.querySelectorAll("#theme-seg button").forEach((b) => b.classList.toggle("active", b.dataset.theme === t)); }
  root.querySelectorAll("#theme-seg button").forEach((b) => (b.onclick = () => { localStorage.setItem("theme", b.dataset.theme); window.App.applyTheme(); renderTheme(); }));
  $("cfg-font").onchange = (e) => { localStorage.setItem("font", e.target.value); window.App.applyFont(); };

  // Memorias
  async function loadMemoryEditor() {
    const info = await window.agente.listMemory(); state.memoryInfo = info;
    const parts = [`<span class="ext" title="El botón Obtener sugerencia aparece al llegar a ${info.suggestMin} memorias">Sugerencias<b>${info.suggestReady ? "activas" : `${info.memory.length + info.profile.length} de ${info.suggestMin}`}</b></span>`];
    if (info.profile.length) parts.push(`<span class="ext">Perfil<b>${info.profile.length}</b></span>`);
    if (info.memory.length) parts.push(`<span class="ext">Correcciones<b>${info.memory.length}</b></span>`);
    if (info.turns) parts.push(`<span class="ext">Tareas<b>${info.turns}</b></span>`);
    for (const [e, n] of info.ext) parts.push(`<span class="ext">${esc(e)}<b>${n}</b></span>`);
    $("mem-summary").innerHTML = `<div class="exts">${parts.join("")}</div>`;
    const { file, text } = await window.agente.readMemoryFile();
    $("mem-file").textContent = file ? relPath(file) || "CLAUDE.md" : "CLAUDE.md";
    $("mem-edit").value = text; $("mem-edit").disabled = !file; $("mem-save").disabled = !file; $("mem-status").textContent = "";
  }
  $("mem-reload").onclick = loadMemoryEditor;
  $("mem-save").onclick = async () => {
    try { await window.agente.writeMemoryFile($("mem-edit").value); $("mem-status").textContent = "Guardado."; setTimeout(() => ($("mem-status").textContent = ""), 1500); }
    catch (e) { $("mem-status").textContent = "Error: " + e.message.replace(/^.*Error: /, ""); }
  };

  window.Settings = { open, close };
})();
