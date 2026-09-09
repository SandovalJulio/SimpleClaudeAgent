// Estado global, utilidades compartidas y arranque. Los demás módulos usan window.App.
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const baseName = (p) => String(p || "").split(/[\\/]/).filter(Boolean).pop() || "";

  const state = {
    folder: null, settings: {}, config: {}, models: [], efforts: [], permissions: [], connections: [],
    skills: [], memoryInfo: null, convs: new Map(), activeConv: null, cost: 0,
  };

  // Bus interno del renderer.
  const handlers = {};
  const on = (ev, cb) => ((handlers[ev] ||= []).push(cb));
  const emit = (ev, data) => (handlers[ev] || []).forEach((cb) => cb(data));

  function relPath(p) {
    if (!p || !state.folder) return p || "";
    const norm = (s) => String(s).replace(/\\/g, "/").replace(/\/$/, "");
    const a = norm(p), b = norm(state.folder);
    return a.toLowerCase().startsWith(b.toLowerCase() + "/") ? a.slice(b.length + 1) : p;
  }

  // Popover flotante único.
  const menu = $("menu");
  let menuAnchor = null, menuKind = null;
  function openMenu(anchor, kind, html) {
    menuAnchor = anchor; menuKind = kind;
    menu.innerHTML = html;
    menu.classList.add("open");
    const r = anchor.getBoundingClientRect();
    const below = window.innerHeight - r.bottom;
    menu.style.left = Math.max(12, Math.min(r.left, window.innerWidth - menu.offsetWidth - 12)) + "px";
    if (below > menu.offsetHeight + 16) { menu.style.bottom = ""; menu.style.top = (r.bottom + 8) + "px"; }
    else { menu.style.top = ""; menu.style.bottom = (window.innerHeight - r.top + 8) + "px"; }
  }
  function closeMenu() { menu.classList.remove("open"); menuAnchor = null; menuKind = null; }
  document.addEventListener("click", (e) => { if (!menu.contains(e.target) && !menuAnchor?.contains(e.target)) closeMenu(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeMenu(); });

  function toast(text, type) {
    const t = document.createElement("div"); t.className = "toast" + (type ? " " + type : ""); t.textContent = text;
    $("toasts").appendChild(t);
    setTimeout(() => t.remove(), 4000);
  }

  // Tema y fuente.
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  function applyTheme() {
    const t = localStorage.getItem("theme") || "system";
    document.documentElement.classList.toggle("dark", t === "dark" || (t === "system" && mq.matches));
    emit("theme:changed", t);
  }
  mq.addEventListener("change", applyTheme);
  function applyFont() { document.documentElement.dataset.font = localStorage.getItem("font") || "sans"; }

  // Enlaces externos.
  document.addEventListener("click", (e) => {
    const a = e.target.closest("a[href]");
    if (a && /^https?:/i.test(a.href)) { e.preventDefault(); window.agente.openExternal(a.href); }
  });

  function setFolderUI(f) {
    state.folder = f;
    $("ws-label").textContent = f ? baseName(f) : "Sin carpeta";
    $("ws-path").textContent = f || "";
    $("crumb-folder").textContent = f ? baseName(f) : "Sin carpeta";
    emit("folder:changed", f);
  }

  async function loadSkills() {
    state.skills = await window.agente.listSkills();
    const box = $("skills");
    $("skills-cnt").textContent = state.skills.length ? `· ${state.skills.length}` : "";
    box.innerHTML = state.skills.length ? "" : '<div class="empty">Aún no hay skills. Pídele al agente que cree una.</div>';
    for (const s of state.skills) {
      const b = document.createElement("button");
      b.className = "skill"; b.title = s.file + "\nClic: insertar · Clic derecho: abrir archivo";
      b.innerHTML = `<div class="n">/${esc(s.name)} <span class="tag">${s.scope}</span></div>` + (s.description ? `<div class="d">${esc(s.description)}</div>` : "");
      b.onclick = () => emit("skill:pick", s.name);
      b.oncontextmenu = (e) => { e.preventDefault(); window.agente.openPath(s.file); };
      box.appendChild(b);
    }
  }
  async function loadMemory() {
    state.memoryInfo = await window.agente.listMemory();
    emit("memory:changed", state.memoryInfo);
  }
  const refreshSide = () => { loadSkills(); loadMemory(); emit("history:refresh"); };

  window.App = { $, esc, state, openMenu, closeMenu, get menuKind() { return menuKind; }, get menuAnchor() { return menuAnchor; }, toast, relPath, baseName, on, emit, setFolderUI, refreshSide, applyTheme, applyFont };

  // Arranque.
  window.addEventListener("DOMContentLoaded", async () => {
    applyTheme(); applyFont();
    const s = await window.agente.getState();
    Object.assign(state, { settings: s.settings, config: s.config, models: s.models, efforts: s.efforts, permissions: s.permissions, connections: s.connections, apiKey: s.apiKey });
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem("settings") || "null"); } catch { /* ignorar */ }
    if (saved) state.settings = await window.agente.setSettings(saved);
    setFolderUI(s.folder);
    emit("app:ready");
    refreshSide();
    $("pick").onclick = async () => { const f = await window.agente.pickFolder(); if (f !== state.folder) { setFolderUI(f); emit("convs:reset"); refreshSide(); } };
    $("open-ws").onclick = () => state.folder && window.agente.openPath(state.folder);
    $("refresh").onclick = refreshSide;
  });
})();
