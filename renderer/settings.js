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
          <div class="row"><div class="lbl"><b>Directorios adicionales</b><span>Otras carpetas a las que el agente puede acceder además de la de trabajo.</span><div id="cfg-dirs" class="paths"></div></div><button id="add-dir" class="btn">Añadir</button></div>
          <div class="row"><div class="lbl"><b>Plugins</b><span>Carpetas de plugins locales de Claude Code (skills, comandos y agentes de terceros).</span><div id="cfg-plugins" class="paths"></div></div><button id="add-plugin" class="btn">Añadir</button></div>
        </div>

        <div class="cfg-section">
          <h3>Conexiones</h3>
          <p class="desc">Herramientas externas que el agente puede usar. No requieren claves; se descargan con <code>npx</code> la primera vez.</p>
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
    renderSwitches(); renderPaths(); renderConnections();
    await loadMemoryEditor();
    if (!$("cfg-schedules").dataset.mounted && window.SchedulesUI) { window.SchedulesUI.mount($("cfg-schedules")); $("cfg-schedules").dataset.mounted = "1"; }
    renderTheme();
    $("cfg-font").value = localStorage.getItem("font") || "sans";
    overlay.classList.add("open");
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

  function renderConnections() {
    const box = $("cfg-connections"); box.innerHTML = "";
    for (const c of state.connections) {
      const on = !!state.config.connections?.[c.id];
      const row = document.createElement("div"); row.className = "row";
      row.innerHTML = `<div class="lbl"><b>${esc(c.label)}</b><span>${esc(c.note)}</span><code>${esc(c.pkg)}</code></div><button class="switch ${on ? "on" : ""}" role="switch" aria-checked="${on}"></button>`;
      row.querySelector(".switch").onclick = () => setConfig({ connections: { [c.id]: !on } });
      box.appendChild(row);
    }
  }

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
