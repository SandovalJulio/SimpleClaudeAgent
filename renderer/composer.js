// Compositor: texto, adjuntos (botón y arrastrar/soltar), dictado, menú "/", píldoras de modelo y permisos.
(() => {
  const { $, esc, state, on, emit, openMenu, closeMenu, toast, baseName } = window.App;
  const input = $("input"), send = $("send");
  const attached = [];
  const EFFORT_LABEL = { low: "Bajo", medium: "Medio", high: "Alto" };

  function autosize() { input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 220) + "px"; }
  function setInput(text, selStart, selEnd) { input.value = text; autosize(); input.focus(); if (selStart != null) input.setSelectionRange(selStart, selEnd ?? selStart); }
  on("composer:set", (t) => setInput(t, t.length));
  on("composer:focus", () => input.focus());

  // ---------- Estado ocupado / botón enviar ----------
  function renderBusy() {
    const busy = !!window.Chat?.active()?.busy;
    send.className = "send" + (busy ? " stop" : "");
    send.title = busy ? "Detener" : "Enviar";
    send.innerHTML = busy
      ? '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 19V5M5 12l7-7 7 7"/></svg>';
  }
  window.agente.on("conv:busy", renderBusy);
  window.agente.on("conv:result", renderBusy);
  on("conv:activated", renderBusy);

  async function submit(text) {
    text = (text ?? input.value).trim(); if (!text) return;
    const files = attached.splice(0); renderAttached();
    input.value = ""; autosize(); closeMenu();
    await window.Chat.send(text, files);
  }
  send.onclick = () => (window.Chat.active()?.busy ? window.Chat.stop() : submit());

  // ---------- Ajustes: modelo, razonamiento, permisos ----------
  function renderSettings() {
    const st = state.settings;
    const m = state.models.find((x) => x.id === st.model) || {};
    $("model-label").textContent = m.label || st.model;
    $("effort-label").textContent = EFFORT_LABEL[st.effort] || st.effort;
    $("perm-label").textContent = (state.permissions.find((x) => x.id === st.permission) || {}).label || st.permission;
    try { localStorage.setItem("settings", JSON.stringify(st)); } catch { /* ignorar */ }
  }
  async function applySettings(patch) { state.settings = await window.agente.setSettings(patch); renderSettings(); emit("settings:changed"); }
  on("settings:changed", renderSettings);
  on("app:ready", renderSettings);

  const toggle = (anchor, kind, build) => { if ($("menu").classList.contains("open") && window.App.menuAnchor === anchor) return closeMenu(); build(); };
  $("model-pill").onclick = (e) => toggle(e.currentTarget, "model", () => {
    const st = state.settings;
    const models = state.models.map((x) => `<button class="mi ${x.id === st.model ? "active" : ""}" data-model="${x.id}">
        <svg class="check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 13l4 4L19 7"/></svg>
        <span class="ml"><b>${esc(x.label)}</b><span>${esc(x.note)}</span></span><span class="price" title="USD por millón de tokens: entrada / salida">$${x.in} / $${x.out}</span></button>`).join("");
    const efforts = state.efforts.map((ef) => `<button class="${ef === st.effort ? "active" : ""}" data-effort="${ef}">${EFFORT_LABEL[ef] || ef}</button>`).join("");
    openMenu(e.currentTarget, "model", `<div class="head">Modelo</div>${models}<div class="sep"></div><div class="head">Razonamiento</div><div class="seg">${efforts}</div>`);
    $("menu").querySelectorAll("[data-model]").forEach((b) => (b.onclick = () => { applySettings({ model: b.dataset.model }); closeMenu(); }));
    $("menu").querySelectorAll("[data-effort]").forEach((b) => (b.onclick = () => { applySettings({ effort: b.dataset.effort }); closeMenu(); }));
  });
  $("perm-pill").onclick = (e) => toggle(e.currentTarget, "perm", () => {
    const st = state.settings;
    openMenu(e.currentTarget, "perm", `<div class="head">Permisos</div>` + state.permissions.map((p) => `<button class="mi ${p.id === st.permission ? "active" : ""}" data-perm="${p.id}">
        <svg class="check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 13l4 4L19 7"/></svg>
        <span class="ml"><b>${esc(p.label)}</b><span>${esc(p.note)}</span></span></button>`).join(""));
    $("menu").querySelectorAll("[data-perm]").forEach((b) => (b.onclick = () => { applySettings({ permission: b.dataset.perm }); closeMenu(); }));
  });

  // ---------- Skills: menú "/" ----------
  function openSkillsMenu(anchor, filter = "", onPick = pickSkill, title = "Skills") {
    const list = state.skills.filter((s) => s.name.toLowerCase().includes(filter.toLowerCase()));
    const html = `<div class="head">${title}</div>` + (list.length
      ? list.map((s, i) => `<button class="mi ${i === 0 ? "focus" : ""}" data-skill="${esc(s.name)}"><span class="ml"><b class="mono">/${esc(s.name)}</b><span>${esc(s.description || s.scope)}</span></span><span class="price">${s.scope}</span></button>`).join("")
      : `<div class="empty">Sin skills${filter ? ` que coincidan con “${esc(filter)}”` : ""}. Usa “Crear una skill” para empezar.</div>`);
    openMenu(anchor, "skills", html);
    $("menu")._onPick = onPick;
    $("menu").querySelectorAll("[data-skill]").forEach((b) => (b.onclick = () => { closeMenu(); onPick(b.dataset.skill); }));
  }
  const pickSkill = (name) => setInput(`/${name} `);
  on("skill:pick", pickSkill);
  $("slash").onclick = (e) => toggle(e.currentTarget, "skills", () => openSkillsMenu(e.currentTarget));
  input.addEventListener("input", () => {
    autosize();
    const v = input.value;
    if (/^\/[^\s]*$/.test(v)) openSkillsMenu($("slash"), v.slice(1));
    else if (window.App.menuKind === "skills" && window.App.menuAnchor === $("slash")) closeMenu();
  });
  input.addEventListener("keydown", (e) => {
    const menu = $("menu");
    if (menu.classList.contains("open") && window.App.menuKind === "skills") {
      const items = [...menu.querySelectorAll("[data-skill]")];
      const idx = items.findIndex((b) => b.classList.contains("focus"));
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); items[idx]?.classList.remove("focus"); items[(idx + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.classList.add("focus"); return; }
      if ((e.key === "Enter" || e.key === "Tab") && items[idx]) { e.preventDefault(); const f = menu._onPick || pickSkill; closeMenu(); f(items[idx].dataset.skill); return; }
    }
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
  });

  // ---------- Adjuntos: botón y arrastrar/soltar ----------
  function renderAttached() {
    const box = $("attached"); box.innerHTML = "";
    attached.forEach((f, i) => {
      const c = document.createElement("span"); c.className = "file"; c.title = f;
      c.innerHTML = `📎<span>${esc(baseName(f))}</span><button class="x" title="Quitar">×</button>`;
      c.querySelector(".x").onclick = () => { attached.splice(i, 1); renderAttached(); };
      box.appendChild(c);
    });
  }
  function addFiles(paths) { for (const p of paths) if (p && !attached.includes(p)) attached.push(p); renderAttached(); return paths.length; }
  async function attachFiles() { return addFiles(await window.agente.pickFiles()); }
  $("attach").onclick = attachFiles;
  let dragDepth = 0;
  document.addEventListener("dragenter", (e) => { e.preventDefault(); dragDepth++; document.body.classList.add("dragging"); });
  document.addEventListener("dragover", (e) => { e.preventDefault(); });
  document.addEventListener("dragleave", () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove("dragging"); } });
  document.addEventListener("drop", (e) => {
    e.preventDefault(); dragDepth = 0; document.body.classList.remove("dragging");
    const paths = [...(e.dataTransfer?.files || [])].map((f) => { try { return window.agente.getPathForFile(f); } catch { return null; } }).filter(Boolean);
    if (paths.length) { addFiles(paths); input.focus(); toast(`${paths.length} archivo(s) adjuntado(s)`); }
  });

  // ---------- Dictado por voz ----------
  // Chromium en Electron no incluye el servicio de reconocimiento de Google, así que la API puede fallar.
  // Si falla, se indica el dictado del sistema (Win+H en Windows), que escribe directamente en el cuadro.
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null;
  $("mic").onclick = () => {
    if (rec) { rec.stop(); return; }
    if (!SR) return toast("Dictado no disponible aquí. Usa el dictado del sistema: Win+H con el cursor en el cuadro.", "err");
    rec = new SR(); rec.lang = "es-MX"; rec.interimResults = true; rec.continuous = true;
    const base = input.value; let finalText = "";
    rec.onresult = (ev) => { let interim = ""; for (const r of ev.results) (r.isFinal ? (finalText += r[0].transcript + " ") : (interim += r[0].transcript)); setInput((base + " " + finalText + interim).trim()); };
    rec.onerror = (ev) => { toast(ev.error === "not-allowed" ? "Permiso de micrófono denegado." : "Dictado no disponible (" + ev.error + "). Usa Win+H con el cursor en el cuadro.", "err"); stopRec(); };
    rec.onend = stopRec;
    function stopRec() { rec = null; $("mic").classList.remove("rec"); }
    try { rec.start(); $("mic").classList.add("rec"); } catch { stopRec(); }
  };

  // ---------- Tarjetas de inicio ----------
  on("chip:explore", () => submit("Explora esta carpeta y dame un resumen de qué contiene, cómo está organizada y qué skills o memoria ya existen."));
  on("chip:suggest", () => submit("Revisa la memoria y el perfil que tienes de mí (CLAUDE.md), las skills existentes y el perfil de archivos observado. Con eso, dame uno o dos consejos concretos y accionables: una skill nueva que me ahorraría trabajo repetitivo, o una forma de ser más productivo con lo que ya hago. Para cada consejo: qué es, por qué encaja conmigo y qué te pediría para implementarlo. Sé breve."));
  on("chip:create", () => { const t = "Crea una skill llamada \"NOMBRE\" que, cuando la invoque, haga lo siguiente:\n1. \n2. \n3. \n\nGuárdala en esta carpeta y confírmame cómo invocarla."; const i = t.indexOf("NOMBRE"); setInput(t, i, i + 6); });
  on("chip:attach", async () => { if (await attachFiles()) setInput("Sobre los archivos adjuntos: "); });
  on("chip:improve", () => { const anchor = document.querySelector(".thread.active [data-act=improve]") || $("slash"); openSkillsMenu(anchor, "", (name) => { const t = `Mejora la skill /${name}: quiero que `; setInput(t, t.length); }, "¿Qué skill quieres mejorar?"); });
  on("chip:artifact", () => { const t = "Crea un artifact (HTML autónomo en artifacts/) que muestre: "; setInput(t, t.length); });

  autosize();
  window.Composer = { setInput, addFiles, submit };
})();
