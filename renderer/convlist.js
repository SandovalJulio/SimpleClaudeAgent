// Lista única de conversaciones en la barra lateral: las abiertas (con proceso del SDK) y las anteriores
// (sesiones guardadas del SDK) en una misma lista. Abrir una anterior la reanuda y repinta su transcripción.
(() => {
  const { $, esc, state, on } = window.App;
  let sessions = []; // historial del SDK: { sessionId, summary, lastModified, title, pinned }

  async function load() {
    try { sessions = await window.agente.listSessions(); } catch { sessions = []; }
    render();
  }

  // Filas: abiertas (conv) y anteriores (sesión no abierta). Fijadas primero, luego abiertas, luego por fecha.
  function rows() {
    const q = ($("history-search").value || "").trim().toLowerCase();
    const openBySession = new Map([...state.convs.values()].filter((c) => c.sessionId).map((c) => [c.sessionId, c]));
    const out = [...state.convs.values()].map((c) => ({ kind: "open", key: c.id, conv: c, title: c.title, pinned: !!c.pinned, when: Infinity }));
    for (const s of sessions) if (!openBySession.has(s.sessionId)) out.push({ kind: "hist", key: s.sessionId, session: s, title: s.title || s.summary || "Sin título", pinned: !!s.pinned, when: Date.parse(s.lastModified) || 0 });
    return out
      .filter((r) => !q || r.title.toLowerCase().includes(q))
      .sort((a, b) => (b.pinned - a.pinned) || (b.when - a.when))
      .slice(0, q ? 60 : 40);
  }

  function render() {
    if (window.Chat?.isRenaming()) return; // no destruir el elemento editable
    const box = $("convs"); box.innerHTML = "";
    const list = rows();
    $("convs-cnt").textContent = state.convs.size > 1 ? `· ${state.convs.size} abiertas` : "";
    if (!list.length) { box.innerHTML = `<div class="empty">${$("history-search").value ? "Sin coincidencias." : "Sin conversaciones anteriores."}</div>`; return; }
    for (const r of list) {
      // div y no button: el texto dentro de un <button> no puede editarse en línea.
      const b = document.createElement("div"); b.setAttribute("role", "button"); b.tabIndex = 0;
      const c = r.conv;
      b.className = "conv " + r.kind + (c && c.id === state.activeConv ? " active" : "") + (r.pinned ? " pinned" : "");
      b.title = r.kind === "open" ? "Doble clic: renombrar · Clic derecho: fijar" : "Clic: continuar · Doble clic: renombrar · Clic derecho: fijar";
      const when = r.kind === "hist" ? `<span class="d">${new Date(r.when).toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" })}</span>` : "";
      b.innerHTML = `<span class="dot ${c?.busy ? "busy" : ""}"></span><span class="t">${esc(r.title)}</span>${when}<span class="pin" title="${r.pinned ? "Desfijar" : "Fijar"}">📌</span>` +
        (r.kind === "open" ? `<span class="x" title="Cerrar">×</span>` : `<span class="fork" title="Bifurcar: copia nueva sin tocar la original">⑂</span>`);
      if (r.kind === "open") {
        b.onclick = () => window.Chat.activate(c.id);
        b.ondblclick = (e) => { e.preventDefault(); window.Chat.renameConv(c, b.querySelector(".t")); };
        b.oncontextmenu = (e) => { e.preventDefault(); window.Chat.togglePin(c); };
        b.querySelector(".pin").onclick = (e) => { e.stopPropagation(); window.Chat.togglePin(c); };
        b.querySelector(".x").onclick = (e) => { e.stopPropagation(); window.Chat.closeConv(c.id); };
      } else {
        const s = r.session;
        b.onclick = () => resume(s);
        b.ondblclick = (e) => { e.preventDefault(); renameSession(s, b.querySelector(".t")); };
        const pin = () => { s.pinned = !s.pinned; window.agente.convMeta({ sessionId: s.sessionId, pinned: s.pinned }).catch(() => {}); render(); };
        b.oncontextmenu = (e) => { e.preventDefault(); pin(); };
        b.querySelector(".pin").onclick = (e) => { e.stopPropagation(); pin(); };
        b.querySelector(".fork").onclick = (e) => { e.stopPropagation(); window.Chat.createConv({ resume: s.sessionId, fork: true }).then((c2) => { if (c2) { c2.title = "Copia: " + r.title; window.Chat.activate(c2.id); render(); } }); };
      }
      box.appendChild(b);
    }
  }

  // Renombrar una sesión anterior en línea (misma mecánica que las abiertas): se guarda en config por sessionId.
  function renameSession(s, target) {
    const original = s.title || s.summary || "";
    target.contentEditable = "true"; target.textContent = original; target.focus();
    document.getSelection()?.selectAllChildren(target);
    let done = false;
    const finish = (save) => {
      if (done) return; done = true; target.contentEditable = "false";
      const name = target.textContent.trim().slice(0, 80);
      if (save && name && name !== original) { s.title = name; window.agente.convMeta({ sessionId: s.sessionId, title: name }).catch(() => {}); }
      render();
    };
    target.onblur = () => finish(true);
    target.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); finish(true); } if (e.key === "Escape") finish(false); };
  }

  // Reanudar: crea la conversación con `resume` y repinta la transcripción guardada.
  async function resume(s) {
    const already = [...state.convs.values()].find((c) => c.sessionId === s.sessionId);
    if (already) return window.Chat.activate(already.id);
    const conv = await window.Chat.createConv({ resume: s.sessionId });
    if (!conv) return;
    conv.sessionId = s.sessionId; conv.pinned = !!s.pinned; conv.renamed = !!s.title;
    try { replay(conv, await window.agente.sessionMessages(s.sessionId)); } catch { /* sin transcripción: el hilo queda vacío */ }
    conv.title = s.title || s.summary || conv.title;
    if (conv.id === state.activeConv) $("crumb-title").textContent = conv.title;
    render();
  }

  // Repinta mensajes de usuario y respuestas (texto y herramientas) de una transcripción.
  function replay(conv, msgs) {
    const C = window.Chat;
    for (const m of msgs) {
      if (m.role === "user") { C.addUser(conv, m.text, [], m.uuid); continue; }
      C.startTurn(conv, null);
      for (const t of m.tools) { C.addTool(conv, { id: t.id, name: t.name, input: t.input }); C.toolDone(conv, { id: t.id, error: false }); }
      if (m.text) C.appendDelta(conv, m.text);
      C.collapseActivity(conv.turn);
      conv.turn = null;
    }
    conv.hasMessages = msgs.length > 0 || conv.hasMessages;
    if (msgs.length) { const sep = document.createElement("div"); sep.className = "meta"; sep.textContent = "Conversación reanudada."; conv.inner.appendChild(sep); }
    conv.el.scrollTop = conv.el.scrollHeight;
  }

  on("history:refresh", load);
  $("history-search").addEventListener("input", render);

  window.ConvList = { render, load, resume, replay };
})();
