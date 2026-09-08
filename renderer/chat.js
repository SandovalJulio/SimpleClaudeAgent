// Conversaciones en paralelo: cada una tiene su hilo (DOM) y su estado; la barra lateral las lista.
(() => {
  const { $, esc, state, on, emit, relPath, toast } = window.App;
  const area = $("thread-area");
  marked.use({ gfm: true, breaks: true, renderer: { html: () => "" } });

  const EFFORT_LABEL = { low: "Bajo", medium: "Medio", high: "Alto" };
  const TOOL_ICON = { Read: "📄", Write: "✍️", Edit: "✏️", Bash: "⌨️", Glob: "🔍", Grep: "🔎", Skill: "⚡", WebSearch: "🌐", WebFetch: "🌐", AskUserQuestion: "❓", ExitPlanMode: "📋", TodoWrite: "☑️" };

  // ---------- Markdown ----------
  function renderMd(el, text) {
    el.innerHTML = marked.parse(text || "");
    el.querySelectorAll("table").forEach((t) => {
      if (t.parentElement.classList.contains("table-wrap")) return;
      const w = document.createElement("div"); w.className = "table-wrap"; t.replaceWith(w); w.appendChild(t);
    });
    el.querySelectorAll("pre").forEach((pre) => {
      if (pre.querySelector(".copy")) return;
      const b = document.createElement("button"); b.className = "copy"; b.textContent = "Copiar";
      b.onclick = async () => { await navigator.clipboard.writeText(pre.querySelector("code")?.innerText || pre.innerText); b.textContent = "Copiado"; setTimeout(() => (b.textContent = "Copiar"), 1200); };
      pre.appendChild(b);
    });
  }

  // ---------- Conversaciones ----------
  // conv = { id, title, busy, el(thread), inner, turn, cost, sessionId, hasMessages, lastUuid }
  function createConv({ resume, fork } = {}) {
    return window.agente.convNew({ resume, fork }).then(({ convId }) => {
      const el = document.createElement("div"); el.className = "thread"; el.id = "conv-" + convId;
      const inner = document.createElement("div"); inner.className = "inner"; el.appendChild(inner);
      inner.appendChild($("hero-tpl").content.cloneNode(true));
      area.appendChild(el);
      const conv = { id: convId, title: resume ? "Conversación recuperada" : "Nueva conversación", busy: false, el, inner, turn: null, cost: 0, sessionId: null, hasMessages: !!resume, lastUuid: null };
      if (resume) inner.querySelector(".hero")?.remove();
      state.convs.set(convId, conv);
      inner.querySelectorAll(".chip").forEach((c) => (c.onclick = () => emit("chip:" + c.dataset.act, conv)));
      updateSuggestChip(conv);
      activate(convId);
      renderConvList();
      return conv;
    });
  }
  function activate(convId) {
    state.activeConv = convId;
    for (const c of state.convs.values()) c.el.classList.toggle("active", c.id === convId);
    const conv = state.convs.get(convId);
    $("crumb-title").textContent = conv?.title || "Nueva conversación";
    setStatus(conv?.busy);
    renderConvList();
    emit("conv:activated", { convId });
  }
  function setStatus(busy) {
    $("status-text").textContent = busy ? "Trabajando…" : "Listo";
    $("status-dot").className = "dot" + (busy ? " busy" : "");
  }
  function closeConv(convId) {
    const conv = state.convs.get(convId); if (!conv) return;
    window.agente.convClose(convId);
    conv.el.remove(); state.convs.delete(convId);
    if (state.activeConv === convId) {
      const next = [...state.convs.keys()].pop();
      if (next) activate(next); else createConv();
    }
    renderConvList();
    setTimeout(loadHistory, 600); // la sesión cerrada pasa al historial
  }
  function renderConvList() {
    const box = $("convs"); box.innerHTML = "";
    $("convs-cnt").textContent = state.convs.size > 1 ? `· ${state.convs.size}` : "";
    for (const c of state.convs.values()) {
      const b = document.createElement("button");
      b.className = "conv" + (c.id === state.activeConv ? " active" : "");
      b.innerHTML = `<span class="dot ${c.busy ? "busy" : ""}"></span><span class="t">${esc(c.title)}</span><span class="x" title="Cerrar">×</span>`;
      b.onclick = () => activate(c.id);
      b.querySelector(".x").onclick = (e) => { e.stopPropagation(); closeConv(c.id); };
      box.appendChild(b);
    }
  }
  const active = () => state.convs.get(state.activeConv);
  function updateSuggestChip(conv) {
    const ready = !!state.memoryInfo?.suggestReady;
    const s = conv.inner.querySelector('[data-act="suggest"]'), e = conv.inner.querySelector('[data-act="explore"]');
    if (s && e) { s.hidden = !ready; e.hidden = ready; }
  }
  on("memory:changed", () => state.convs.forEach(updateSuggestChip));

  // ---------- Historial ----------
  async function loadHistory() {
    const box = $("history");
    try {
      const list = await window.agente.listSessions();
      const openIds = new Set([...state.convs.values()].map((c) => c.sessionId));
      const items = list.filter((s) => !openIds.has(s.sessionId)).slice(0, 15);
      box.innerHTML = items.length ? "" : '<div class="empty">Sin conversaciones anteriores.</div>';
      for (const s of items) {
        const b = document.createElement("button"); b.className = "hist"; b.title = "Clic: continuar · Clic derecho: bifurcar (copia nueva)";
        b.innerHTML = `<span class="t">${esc(s.summary || "Sin título")}</span><span class="d">${new Date(s.lastModified).toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" })}</span>`;
        b.onclick = () => createConv({ resume: s.sessionId }).then((c) => { c.title = s.summary || c.title; c.sessionId = s.sessionId; activate(c.id); });
        b.oncontextmenu = (e) => { e.preventDefault(); createConv({ resume: s.sessionId, fork: true }).then((c) => { c.title = "Copia: " + (s.summary || ""); activate(c.id); }); };
        box.appendChild(b);
      }
    } catch (e) { box.innerHTML = `<div class="empty">No se pudo leer el historial.</div>`; }
  }
  on("history:refresh", loadHistory);

  // ---------- Mensajes ----------
  function scrollBottom(conv, force) {
    const t = conv.el;
    if (force || t.scrollHeight - t.scrollTop - t.clientHeight < 140) t.scrollTop = t.scrollHeight;
  }
  function addUser(conv, text, files, uuid) {
    conv.inner.querySelector(".hero")?.remove();
    conv.hasMessages = true;
    const m = document.createElement("div"); m.className = "msg user"; m.dataset.uuid = uuid;
    const col = document.createElement("div"); col.className = "col";
    if (files.length) {
      const fs = document.createElement("div"); fs.className = "files";
      fs.innerHTML = files.map((f) => `<span class="file" title="${esc(f)}">📎<span>${esc(window.App.baseName(f))}</span></span>`).join("");
      col.appendChild(fs);
    }
    const b = document.createElement("div"); b.className = "bubble"; b.textContent = text;
    col.appendChild(b); m.appendChild(col); conv.inner.appendChild(m);
    if (conv.title === "Nueva conversación" || conv.title === "Conversación recuperada") { conv.title = text.length > 60 ? text.slice(0, 60) + "…" : text; if (conv.id === state.activeConv) $("crumb-title").textContent = conv.title; renderConvList(); }
    scrollBottom(conv, true);
  }
  function startTurn(conv, userUuid) {
    const m = document.createElement("div"); m.className = "msg assistant";
    m.innerHTML = '<div class="avatar">A</div><div class="body"></div>';
    conv.inner.appendChild(m);
    conv.turn = { body: m.querySelector(".body"), textEl: null, textRaw: "", activity: null, steps: new Map(), progress: null, userUuid, suggestions: null };
    scrollBottom(conv, true);
  }
  function turnOf(conv) { if (!conv.turn) startTurn(conv, conv.lastUuid); return conv.turn; }

  function appendDelta(conv, t) {
    const turn = turnOf(conv);
    if (!turn.textEl) {
      turn.textEl = document.createElement("div"); turn.textEl.className = "md";
      turn.body.appendChild(turn.textEl); turn.textRaw = ""; turn.activity = null;
    }
    turn.textRaw += t;
    renderMd(turn.textEl, turn.textRaw);
    scrollBottom(conv);
  }
  function toolSummary(name, i = {}) {
    if (i.file_path) return relPath(i.file_path);
    if (name === "Bash") return i.description || i.command || "";
    if (i.pattern) return i.pattern;
    if (i.query) return i.query;
    if (i.url) return i.url;
    if (name === "Skill") return "/" + (i.skill || i.command || "");
    return JSON.stringify(i).slice(0, 80);
  }
  function addTool(conv, { id, name, input }) {
    const turn = turnOf(conv);
    if (!turn.activity) {
      const d = document.createElement("details"); d.className = "activity"; d.open = true;
      d.innerHTML = '<summary><span class="spinner"></span><span class="label">Trabajando…</span><svg class="chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg></summary><div class="steps"></div>';
      turn.body.appendChild(d); turn.activity = d; turn.textEl = null;
    }
    const row = document.createElement("div"); row.className = "step";
    const sum = toolSummary(name, input);
    row.innerHTML = `<span class="ico">${TOOL_ICON[name] || "🔧"}</span><span class="name">${esc(name.replace(/^mcp__/, ""))}</span><span class="sum" title="${esc(sum)}">${esc(sum)}</span><span class="st"><span class="spinner"></span></span>`;
    turn.activity.querySelector(".steps").appendChild(row);
    turn.steps.set(id, row);
    const n = turn.activity.querySelectorAll(".step").length;
    turn.activity.querySelector(".label").textContent = turn.progressText || `Trabajando… ${n} paso${n > 1 ? "s" : ""}`;
    scrollBottom(conv);
  }
  function toolDone(conv, { id, error }) {
    const row = conv.turn?.steps.get(id); if (!row) return;
    row.querySelector(".st").innerHTML = error
      ? '<svg class="st err" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 6l12 12M18 6L6 18"/></svg>'
      : '<svg class="st ok" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 13l4 4L19 7"/></svg>';
  }
  function progress(conv, text) {
    if (!text) return;
    const turn = turnOf(conv);
    turn.progressText = text;
    if (turn.activity) turn.activity.querySelector(".label").textContent = text;
    $("status-text").textContent = conv.id === state.activeConv ? text.slice(0, 60) : $("status-text").textContent;
  }
  function suggestion(conv, text) {
    const turn = conv.turn || conv.lastTurn; if (!turn) return;
    if (!turn.suggestions) { turn.suggestions = document.createElement("div"); turn.suggestions.className = "suggestions"; turn.body.appendChild(turn.suggestions); }
    const b = document.createElement("button"); b.className = "sugg"; b.textContent = text;
    b.onclick = () => emit("composer:set", text);
    turn.suggestions.appendChild(b);
    scrollBottom(conv);
  }
  function finishTurn(conv, r) {
    const turn = conv.turn; conv.busy = false; setStatusIfActive(conv);
    if (turn) {
      for (const d of turn.body.querySelectorAll("details.activity")) {
        const n = d.querySelectorAll(".step").length;
        d.querySelector(".label").textContent = `${n} paso${n > 1 ? "s" : ""} realizado${n > 1 ? "s" : ""}`;
        d.querySelector("summary .spinner")?.remove(); d.open = false;
      }
      if (r.error) { const e = document.createElement("div"); e.className = "error"; e.textContent = "Error: " + r.error; turn.body.appendChild(e); }
      if (r.subtype === "aborted") { const e = document.createElement("div"); e.className = "meta"; e.textContent = "Detenido por el usuario."; turn.body.appendChild(e); }
      if (r.files?.length && window.FilesPanel) { const box = document.createElement("div"); box.className = "files-out"; turn.body.appendChild(box); window.FilesPanel.render(box, r.files, conv.id); }
      if (typeof r.cost === "number") {
        conv.cost += r.cost; state.cost += r.cost; $("cost").textContent = "$" + state.cost.toFixed(4);
        const m = state.models.find((x) => x.id === r.model);
        const fmt = (n) => (n || 0).toLocaleString("es-MX");
        const u = document.createElement("div"); u.className = "usage"; u.title = "Costo de esta respuesta según el SDK";
        u.innerHTML = `<span>$${r.cost.toFixed(4)}</span><span><span class="k">Modelo</span>${esc(m ? m.label : r.model)} · ${EFFORT_LABEL[r.effort] || r.effort}</span>` +
          `<span><span class="k">Entrada</span>${fmt(r.tokensIn)} tok</span><span><span class="k">Salida</span>${fmt(r.tokensOut)} tok</span>` +
          `<span><span class="k">Tiempo</span>${((r.duration || 0) / 1000).toFixed(1)} s</span><span><span class="k">Turnos</span>${r.turns || 1}</span>`;
        turn.body.appendChild(u);
      }
      // Acciones del turno: deshacer cambios en archivos (checkpoints del SDK).
      if (r.files?.length && r.userUuid) {
        const acts = document.createElement("div"); acts.className = "turn-actions";
        const undo = document.createElement("button"); undo.className = "link"; undo.textContent = "↶ Revertir archivos de esta respuesta";
        undo.onclick = async () => {
          const dry = await window.agente.convRewind({ convId: conv.id, uuid: r.userUuid, dryRun: true });
          if (!dry.canRewind) return toast(dry.error || "No se puede revertir.", "err");
          if (!confirm(`Se restaurarán ${dry.filesChanged?.length || 0} archivo(s) al estado anterior a este mensaje. ¿Continuar?`)) return;
          const res = await window.agente.convRewind({ convId: conv.id, uuid: r.userUuid });
          toast(res.canRewind ? `Revertidos ${res.filesChanged?.length || 0} archivo(s).` : (res.error || "No se pudo revertir."), res.canRewind ? "ok" : "err");
          if (res.canRewind) { undo.textContent = "Archivos revertidos"; undo.disabled = true; }
        };
        acts.appendChild(undo); turn.body.appendChild(acts);
      }
      conv.lastTurn = turn;
    }
    conv.turn = null;
    window.App.refreshSide();
    if (conv.id === state.activeConv) emit("composer:focus");
  }
  function setStatusIfActive(conv) { if (conv.id === state.activeConv) setStatus(conv.busy); renderConvList(); }

  // ---------- Envío ----------
  async function send(text, files = []) {
    text = (text || "").trim(); if (!text) return;
    let conv = active(); if (!conv) conv = await createConv();
    if (conv.busy) return toast("Espera a que termine la respuesta o detenla.", "err");
    conv.busy = true; setStatusIfActive(conv);
    try { await window.agente.convSend({ convId: conv.id, text, files }); }
    catch (e) { conv.busy = false; setStatusIfActive(conv); toast(e.message.replace(/^.*Error: /, ""), "err"); }
  }
  const stop = () => active() && window.agente.convStop(active().id);

  // ---------- Eventos del agente ----------
  const withConv = (fn) => (d) => { const c = state.convs.get(d.convId); if (c) fn(c, d); };
  window.agente.on("conv:init", withConv((c, d) => { c.sessionId = d.sessionId; }));
  window.agente.on("conv:busy", withConv((c, d) => { c.busy = d.busy; setStatusIfActive(c); }));
  window.agente.on("conv:user", withConv((c, d) => { c.lastUuid = d.uuid; addUser(c, d.text, d.files || [], d.uuid); startTurn(c, d.uuid); }));
  window.agente.on("conv:delta", withConv((c, d) => appendDelta(c, d.text)));
  window.agente.on("conv:tool", withConv((c, d) => addTool(c, d)));
  window.agente.on("conv:tool-done", withConv((c, d) => toolDone(c, d)));
  window.agente.on("conv:progress", withConv((c, d) => progress(c, d.text)));
  window.agente.on("conv:suggestion", withConv((c, d) => suggestion(c, d.text)));
  window.agente.on("conv:result", withConv((c, d) => finishTurn(c, d)));
  window.agente.on("conv:mode", (d) => { state.settings.permission = d.permission; emit("settings:changed"); toast("Plan aprobado: el agente pasa a modo " + (state.permissions.find((p) => p.id === d.permission)?.label || d.permission)); });
  window.agente.on("conv:ask", (d) => { const c = state.convs.get(d.convId); if (c) { c.inner.querySelector(".hero")?.remove(); } window.Dialogs?.handle(d); if (c) scrollBottom(c, true); });
  window.agente.on("conv:closed", withConv((c, d) => { if (d.reason === "error" || d.reason === "ended") { c.busy = false; setStatusIfActive(c); } }));

  // ---------- Controles ----------
  $("new-chat").onclick = () => createConv();
  on("convs:reset", () => { for (const c of [...state.convs.values()]) { c.el.remove(); } state.convs.clear(); createConv(); });
  on("app:ready", () => createConv());

  window.Chat = { send, stop, active, createConv, activate, closeConv };
})();
