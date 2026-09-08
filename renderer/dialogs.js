/* dialogs.js — Diálogos del agente: permisos, preguntas, plan, elicitación MCP.
   Script clásico. Expone window.Dialogs = { handle(evento) }.
   Cada `conv:ask` pinta una tarjeta al final del hilo de su conversación; al responder
   se llama window.agente.convReply(...) y la tarjeta se sustituye por un resumen. */
(function () {
  "use strict";

  /* ---------- utilidades (usa window.App si existe) ---------- */

  function esc(s) {
    var A = window.App;
    if (A && typeof A.esc === "function") return A.esc(s);
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function relPath(p) {
    var A = window.App;
    if (A && typeof A.relPath === "function") {
      try { return A.relPath(p) || String(p || ""); } catch (e) { /* respaldo */ }
    }
    return String(p == null ? "" : p);
  }

  function byId(id) {
    var A = window.App;
    if (A && typeof A.$ === "function") { try { return A.$(id); } catch (e) { /* respaldo */ } }
    return document.getElementById(id);
  }

  function toast(msg, kind) {
    var A = window.App;
    if (A && typeof A.toast === "function") { try { A.toast(msg, kind); return; } catch (e) { /* nada */ } }
  }

  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }

  function cut(s, n) {
    s = String(s == null ? "" : s);
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
  }

  function oneLine(s) {
    return String(s == null ? "" : s).replace(/\s+/g, " ").trim();
  }

  /* ---------- contenedor y desplazamiento ---------- */

  function containerFor(convId) {
    var conv = document.getElementById("conv-" + convId);
    var inner = conv ? conv.querySelector(".inner") : null;
    if (inner) return inner;
    var fallback = byId("thread-area");
    if (fallback) {
      var fi = fallback.querySelector ? fallback.querySelector(".inner") : null;
      return fi || fallback;
    }
    return null;
  }

  function isScrollable(node) {
    if (!node || node.nodeType !== 1) return false;
    var ov;
    try { ov = getComputedStyle(node).overflowY; } catch (e) { return false; }
    if (!/(auto|scroll|overlay)/.test(ov)) return false;
    return node.scrollHeight > node.clientHeight + 4;
  }

  function scrollerFor(node) {
    var n = node;
    while (n && n !== document.body && n !== document.documentElement) {
      if (isScrollable(n)) return n;
      n = n.parentElement;
    }
    return document.scrollingElement || document.documentElement;
  }

  function nearBottom(sc) {
    if (!sc) return false;
    return sc.scrollHeight - sc.scrollTop - sc.clientHeight < 140;
  }

  function append(container, node) {
    var sc = scrollerFor(container);
    var stick = nearBottom(sc);
    container.appendChild(node);
    if (stick && sc) {
      try { sc.scrollTop = sc.scrollHeight; } catch (e) { /* nada */ }
    }
  }

  /* ---------- armazón de la tarjeta ---------- */

  var ICON = {
    permission: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7 3v6c0 4.2-2.9 7.6-7 9-4.1-1.4-7-4.8-7-9V6z"/></svg>',
    question: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.2a2.6 2.6 0 1 1 3.4 2.5c-.6.2-.9.8-.9 1.4v.4"/><path d="M12 17h.01"/></svg>',
    plan: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h10M4 12h10M4 19h7"/><path d="M17 17.5l2 2 3.5-4"/></svg>',
    elicitation: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 9h6M7 13h10"/></svg>'
  };

  var CLOSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';

  function makeCard(kind, title, tag) {
    var card = el("div", "dlg-card dlg-" + kind);
    card.setAttribute("role", "group");
    var head = el("div", "dlg-head");
    head.innerHTML =
      '<span class="dlg-ico">' + (ICON[kind] || ICON.question) + "</span>" +
      '<span class="dlg-title">' + esc(title) + "</span>" +
      (tag ? '<span class="dlg-chip">' + esc(tag) + "</span>" : "") +
      '<button type="button" class="dlg-x" title="Cerrar" aria-label="Cerrar">' + CLOSE + "</button>";
    var body = el("div", "dlg-body");
    var actions = el("div", "dlg-actions");
    card.appendChild(head);
    card.appendChild(body);
    card.appendChild(actions);
    card._body = body;
    card._actions = actions;
    card._close = head.querySelector(".dlg-x");
    return card;
  }

  function button(label, cls) {
    var b = el("button", "btn" + (cls ? " " + cls : ""), esc(label));
    b.type = "button";
    return b;
  }

  /* ---------- respuesta ---------- */

  function convReply(data) {
    var a = window.agente;
    if (!a || typeof a.convReply !== "function") {
      console.warn("[dialogs] window.agente.convReply no disponible", data);
      return;
    }
    try {
      var r = a.convReply(data);
      if (r && typeof r.catch === "function") r.catch(function (e) { console.error("[dialogs] convReply", e); });
    } catch (e) {
      console.error("[dialogs] convReply", e);
    }
  }

  /* Responde una vez y sustituye la tarjeta por una línea de resumen. */
  function settle(card, reqId, answer, summary, tone) {
    if (!card || card.dataset.done === "1") return;
    card.dataset.done = "1";
    var data = { reqId: reqId };
    for (var k in answer) if (Object.prototype.hasOwnProperty.call(answer, k)) data[k] = answer[k];
    convReply(data);
    var line = el("div", "dlg-done" + (tone ? " dlg-done-" + tone : ""));
    line.innerHTML = '<span class="dlg-done-mark">' + (tone === "err" ? "✕" : "✓") + "</span>" +
      '<span class="dlg-done-text">' + esc(oneLine(summary)) + "</span>";
    if (card.parentNode) card.parentNode.replaceChild(line, card);
  }

  /* ---------- permission ---------- */

  var PATH_TOOLS = { Write: 1, Edit: 1, MultiEdit: 1, Read: 1, NotebookEdit: 1, NotebookRead: 1 };

  function inputSummary(toolName, input) {
    // Devuelve { html, short } — html para la tarjeta, short para el resumen final.
    input = input || {};
    if (PATH_TOOLS[toolName] && input.file_path) {
      var rp = relPath(input.file_path);
      return { html: '<code class="dlg-path">' + esc(rp) + "</code>", short: rp };
    }
    if (toolName === "Bash" && input.command != null) {
      var cmd = String(input.command);
      return { html: "<pre class=\"dlg-pre\">" + esc(cmd) + "</pre>", short: oneLine(cmd) };
    }
    var json;
    try { json = JSON.stringify(input); } catch (e) { json = String(input); }
    if (json === undefined) json = "";
    if (json === "{}" || json === "") return { html: "", short: "" };
    var shown = cut(json, 400);
    return { html: '<code class="dlg-json">' + esc(shown) + "</code>", short: cut(oneLine(json), 80) };
  }

  function renderPermission(ctx) {
    var p = ctx.payload || {};
    var tool = p.toolName || "herramienta";
    var info = inputSummary(tool, p.input);
    var card = makeCard("permission", "Permiso de herramienta", tool);

    var html = "";
    if (p.summary) html += '<p class="dlg-p">' + esc(p.summary) + "</p>";
    if (info.html) html += '<div class="dlg-input">' + info.html + "</div>";
    if (!html) html += '<p class="dlg-p dlg-muted">El agente quiere usar <b>' + esc(tool) + "</b>.</p>";
    card._body.innerHTML = html;

    var shortDesc = info.short ? tool + " · " + cut(info.short, 70) : tool;

    var deny = button("Rechazar", "dlg-danger");
    deny.addEventListener("click", function () {
      settle(card, ctx.reqId, { allow: false, message: "El usuario rechazó la acción" },
        "Rechazado: " + shortDesc, "err");
    });
    card._close.addEventListener("click", function () {
      settle(card, ctx.reqId, { allow: false, message: "El usuario rechazó la acción" },
        "Rechazado: " + shortDesc, "err");
    });

    var allow = button("Permitir", "primary");
    allow.addEventListener("click", function () {
      settle(card, ctx.reqId, { allow: true }, "Permitido: " + shortDesc, "ok");
    });

    card._actions.appendChild(deny);
    if (p.canAlways) {
      var always = button("Permitir siempre");
      always.addEventListener("click", function () {
        settle(card, ctx.reqId, { allow: true, always: true },
          "Permitido siempre: " + shortDesc, "ok");
      });
      card._actions.appendChild(always);
    }
    card._actions.appendChild(allow);
    return card;
  }

  /* ---------- question ---------- */

  function renderQuestion(ctx) {
    var p = ctx.payload || {};
    var questions = Array.isArray(p.questions) ? p.questions : [];
    if (!questions.length) questions = [{ question: "¿Cómo quieres continuar?", options: [] }];

    var card = makeCard("question", questions.length > 1 ? "Preguntas del agente" : "Pregunta del agente");
    var blocks = [];

    questions.forEach(function (q, qi) {
      var multi = !!q.multiSelect;
      var opts = Array.isArray(q.options) ? q.options : [];
      var wrap = el("div", "dlg-q");
      var head = "";
      if (q.header) head += '<span class="dlg-chip">' + esc(q.header) + "</span>";
      wrap.innerHTML =
        '<div class="dlg-q-head">' + head +
        '<span class="dlg-q-text">' + esc(q.question || "") + "</span></div>" +
        '<div class="dlg-opts"></div>' +
        '<label class="dlg-other"><span class="dlg-other-lbl">Otro</span>' +
        '<input type="text" class="dlg-input-text" placeholder="Escribe tu respuesta…" /></label>';

      var optsBox = wrap.querySelector(".dlg-opts");
      var other = wrap.querySelector(".dlg-input-text");
      var picked = [];  // etiquetas seleccionadas, en orden
      var btns = [];

      opts.forEach(function (o, oi) {
        var label = (o && typeof o === "object") ? String(o.label == null ? "" : o.label) : String(o == null ? "" : o);
        var desc = (o && typeof o === "object" && o.description) ? String(o.description) : "";
        var b = el("button", "dlg-opt" + (multi ? " dlg-multi" : ""));
        b.type = "button";
        b.setAttribute("role", multi ? "checkbox" : "radio");
        b.setAttribute("aria-checked", "false");
        b.innerHTML =
          '<span class="dlg-mark" aria-hidden="true"></span>' +
          '<span class="dlg-opt-body"><span class="dlg-opt-label">' + esc(label) + "</span>" +
          (desc ? '<span class="dlg-opt-desc">' + esc(desc) + "</span>" : "") + "</span>";
        b.addEventListener("click", function () {
          if (card.dataset.done === "1") return;
          if (multi) {
            var ix = picked.indexOf(label);
            if (ix >= 0) picked.splice(ix, 1); else picked.push(label);
          } else {
            picked = (picked.length === 1 && picked[0] === label) ? [] : [label];
            other.value = "";
          }
          paint();
        });
        btns.push({ el: b, label: label });
        optsBox.appendChild(b);
        void oi;
      });
      if (!opts.length) optsBox.remove();

      other.addEventListener("input", function () {
        if (!multi && other.value.trim()) { picked = []; }
        paint();
      });

      function value() {
        var parts = picked.slice();
        var free = other.value.trim();
        if (free) parts.push(free);
        return parts.join(", ");
      }

      function paint() {
        btns.forEach(function (b) {
          var on = picked.indexOf(b.label) >= 0;
          b.el.classList.toggle("on", on);
          b.el.setAttribute("aria-checked", on ? "true" : "false");
        });
        update();
      }

      blocks.push({ key: q.question || ("Pregunta " + (qi + 1)), value: value, node: wrap });
      card._body.appendChild(wrap);
    });

    var send = button("Enviar respuestas", "primary");
    send.disabled = true;

    function update() {
      var ok = blocks.every(function (b) { return b.value().length > 0; });
      send.disabled = !ok;
    }

    send.addEventListener("click", function () {
      var answers = {};
      var resumen = [];
      blocks.forEach(function (b) {
        var v = b.value();
        answers[b.key] = v;
        resumen.push(v);
      });
      settle(card, ctx.reqId, { answers: answers },
        "Respondido: " + cut(resumen.join(" · "), 120), "ok");
    });

    function cancel() {
      settle(card, ctx.reqId, { cancel: true }, "Preguntas canceladas", "err");
    }
    var cancelBtn = button("Cancelar", "ghost");
    cancelBtn.addEventListener("click", cancel);
    card._close.addEventListener("click", cancel);

    card._actions.appendChild(cancelBtn);
    card._actions.appendChild(send);
    update();
    return card;
  }

  /* ---------- plan ---------- */

  var PLAN_EMPTY = "El agente ha terminado de planificar. Revisa su último mensaje.";

  function renderPlan(ctx) {
    var p = ctx.payload || {};
    var plan = typeof p.plan === "string" ? p.plan.trim() : "";
    var card = makeCard("plan", "Plan propuesto");

    var box = el("div", "dlg-plan md");
    if (!plan) {
      box.innerHTML = '<p class="dlg-p dlg-muted">' + esc(PLAN_EMPTY) + "</p>";
    } else if (window.marked && typeof window.marked.parse === "function") {
      try {
        box.innerHTML = window.marked.parse(plan);
      } catch (e) {
        box.innerHTML = "<pre class=\"dlg-pre\">" + esc(plan) + "</pre>";
      }
    } else {
      box.innerHTML = "<pre class=\"dlg-pre\">" + esc(plan) + "</pre>";
    }
    card._body.appendChild(box);

    var note = el("label", "dlg-field");
    note.innerHTML = '<span class="dlg-lbl">Comentario (opcional)</span>' +
      '<textarea class="dlg-ta" rows="2" placeholder="Ajustes o motivo del rechazo…"></textarea>';
    var ta = note.querySelector("textarea");
    card._body.appendChild(note);

    function reject() {
      var msg = ta.value.trim();
      var ans = { approve: false, message: msg || "El usuario rechazó el plan" };
      settle(card, ctx.reqId, ans, msg ? "Plan rechazado: " + cut(msg, 90) : "Plan rechazado", "err");
    }

    var no = button("Rechazar", "dlg-danger");
    no.addEventListener("click", reject);
    card._close.addEventListener("click", reject);

    var yes = button("Aprobar y ejecutar", "primary");
    yes.addEventListener("click", function () {
      var msg = ta.value.trim();
      var ans = { approve: true };
      if (msg) ans.message = msg;
      settle(card, ctx.reqId, ans, msg ? "Plan aprobado: " + cut(msg, 90) : "Plan aprobado", "ok");
    });

    card._actions.appendChild(no);
    card._actions.appendChild(yes);
    return card;
  }

  /* ---------- elicitation ---------- */

  function schemaType(def) {
    var t = def && def.type;
    if (Array.isArray(t)) t = t.filter(function (x) { return x !== "null"; })[0];
    return t || (def && def.enum ? "string" : "string");
  }

  function fieldFor(name, def, required) {
    def = def || {};
    var t = schemaType(def);
    var label = def.title || name;
    var wrap = el("label", "dlg-field");
    var head = '<span class="dlg-lbl">' + esc(label) + (required ? ' <b class="dlg-req">*</b>' : "") + "</span>";
    var control;

    if (Array.isArray(def.enum) && def.enum.length) {
      control = el("select", "dlg-sel");
      if (!required) control.appendChild(new Option("—", ""));
      def.enum.forEach(function (v) {
        var o = new Option(String(v), String(v));
        control.appendChild(o);
      });
      if (def["default"] != null) control.value = String(def["default"]);
    } else if (t === "boolean") {
      wrap.classList.add("dlg-field-check");
      control = document.createElement("input");
      control.type = "checkbox";
      control.className = "dlg-check";
      if (def["default"] === true) control.checked = true;
    } else if (t === "number" || t === "integer") {
      control = document.createElement("input");
      control.type = "number";
      control.className = "dlg-input-text";
      if (t === "integer") control.step = "1";
      if (def.minimum != null) control.min = String(def.minimum);
      if (def.maximum != null) control.max = String(def.maximum);
      if (def["default"] != null) control.value = String(def["default"]);
    } else {
      control = document.createElement("input");
      control.type = def.format === "email" ? "email" : (def.format === "uri" ? "url" : "text");
      control.className = "dlg-input-text";
      if (def["default"] != null) control.value = String(def["default"]);
      if (def.description) control.placeholder = cut(String(def.description), 80);
    }
    control.name = name;

    if (wrap.classList.contains("dlg-field-check")) {
      wrap.appendChild(control);
      wrap.insertAdjacentHTML("beforeend", head);
    } else {
      wrap.insertAdjacentHTML("beforeend", head);
      wrap.appendChild(control);
    }
    if (def.description && t !== "string") {
      wrap.insertAdjacentHTML("beforeend", '<span class="dlg-hint">' + esc(String(def.description)) + "</span>");
    } else if (def.description && t === "string" && !Array.isArray(def.enum) && String(def.description).length > 80) {
      wrap.insertAdjacentHTML("beforeend", '<span class="dlg-hint">' + esc(String(def.description)) + "</span>");
    }

    return {
      node: wrap,
      name: name,
      type: t,
      required: !!required,
      control: control,
      read: function () {
        if (t === "boolean" && control.type === "checkbox") return control.checked;
        var v = control.value;
        if (v === "" || v == null) return undefined;
        if (t === "number" || t === "integer") {
          var n = Number(v);
          return isNaN(n) ? undefined : n;
        }
        return v;
      }
    };
  }

  function renderElicitation(ctx) {
    var p = ctx.payload || {};
    var server = p.serverName || "MCP";
    var mode = p.mode === "url" ? "url" : "form";
    var card = makeCard("elicitation", "Petición del servidor", server);

    if (p.message) card._body.appendChild(el("p", "dlg-p", esc(p.message)));

    function cancel() {
      settle(card, ctx.reqId, { action: "cancel" }, "Petición cancelada (" + server + ")", "err");
    }
    card._close.addEventListener("click", cancel);

    if (mode === "url") {
      var url = String(p.url || "");
      if (url) {
        card._body.appendChild(el("div", "dlg-input", '<code class="dlg-json">' + esc(cut(url, 200)) + "</code>"));
      }
      var open = button("Abrir en el navegador");
      open.addEventListener("click", function () {
        var a = window.agente;
        if (a && typeof a.openExternal === "function") {
          try { a.openExternal(url); } catch (e) { console.error("[dialogs] openExternal", e); }
        }
        toast("Abriendo el navegador…");
      });
      var cancelBtn = button("Cancelar", "ghost");
      cancelBtn.addEventListener("click", cancel);
      var done = button("Ya lo hice", "primary");
      done.addEventListener("click", function () {
        settle(card, ctx.reqId, { action: "accept" }, "Confirmado en " + server, "ok");
      });
      card._actions.appendChild(cancelBtn);
      card._actions.appendChild(open);
      card._actions.appendChild(done);
      return card;
    }

    // modo formulario
    var schema = p.requestedSchema || {};
    var props = schema.properties || {};
    var req = Array.isArray(schema.required) ? schema.required : [];
    var fields = [];
    var form = el("div", "dlg-form");
    Object.keys(props).forEach(function (name) {
      var f = fieldFor(name, props[name], req.indexOf(name) >= 0);
      fields.push(f);
      form.appendChild(f.node);
    });
    if (!fields.length) {
      form.appendChild(el("p", "dlg-p dlg-muted", esc("El servidor no pidió ningún dato; solo tu confirmación.")));
    }
    card._body.appendChild(form);

    var decline = button("Rechazar", "dlg-danger");
    decline.addEventListener("click", function () {
      settle(card, ctx.reqId, { action: "decline" }, "Rechazado (" + server + ")", "err");
    });

    var send = button("Enviar", "primary");
    send.addEventListener("click", function () {
      var content = {};
      var falta = null;
      fields.forEach(function (f) {
        f.node.classList.remove("dlg-bad");
        var v = f.read();
        if (f.required && (v === undefined || v === "")) {
          f.node.classList.add("dlg-bad");
          if (!falta) falta = f.name;
          return;
        }
        if (v !== undefined) content[f.name] = v;
      });
      if (falta) {
        toast("Faltan campos obligatorios", "err");
        return;
      }
      var n = Object.keys(content).length;
      settle(card, ctx.reqId, { action: "accept", content: content },
        "Enviado a " + server + (n ? " (" + n + (n === 1 ? " campo)" : " campos)") : ""), "ok");
    });

    card._actions.appendChild(decline);
    card._actions.appendChild(send);
    return card;
  }

  /* ---------- entrada pública ---------- */

  var RENDERERS = {
    permission: renderPermission,
    question: renderQuestion,
    plan: renderPlan,
    elicitation: renderElicitation
  };

  function handle(evt) {
    if (!evt || !evt.reqId) return;
    var kind = evt.kind;
    var make = RENDERERS[kind];
    if (!make) {
      console.warn("[dialogs] tipo de conv:ask desconocido:", kind);
      return;
    }
    var container = containerFor(evt.convId);
    if (!container) {
      console.warn("[dialogs] no hay contenedor para la conversación", evt.convId);
      return;
    }
    var card;
    try {
      card = make({ convId: evt.convId, reqId: evt.reqId, payload: evt.payload || {} });
    } catch (e) {
      console.error("[dialogs] error pintando el diálogo", kind, e);
      return;
    }
    if (!card) return;
    card.dataset.reqId = evt.reqId;
    card.dataset.kind = kind;
    append(container, card);
  }

  window.Dialogs = { handle: handle };
})();
