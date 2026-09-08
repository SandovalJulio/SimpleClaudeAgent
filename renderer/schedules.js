/* Sección "Tareas programadas" dentro de Configuración.
   Script clásico: define window.SchedulesUI = { mount(container) }. */
(function () {
  "use strict";

  var App = window.App || {};
  var esc =
    typeof App.esc === "function"
      ? App.esc
      : function (s) {
          return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
            return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
          });
        };

  var DIAS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

  var root = null; // contenedor de montaje
  var tasks = []; // última lista conocida
  var editing = null; // borrador del formulario, o null si está cerrado
  var busy = {}; // ids ejecutándose desde la UI
  var wired = false; // el listener de schedule:done se registra una sola vez

  /* ------------------------------------------------------------ helpers */

  function api() {
    return window.agente || {};
  }

  function toast(text, kind) {
    if (window.App && typeof window.App.toast === "function") window.App.toast(text, kind);
  }

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function hhmm(d) {
    return pad2(d.getHours()) + ":" + pad2(d.getMinutes());
  }

  function sameDay(a, b) {
    return (
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate()
    );
  }

  function freqLabel(t) {
    if (t.every === "hour") return "Cada hora";
    if (t.every === "week") {
      var d = DIAS[Number(t.weekday) >= 0 && Number(t.weekday) <= 6 ? Number(t.weekday) : 1];
      return d + " a las " + (t.at || "09:00");
    }
    return "Diario a las " + (t.at || "09:00");
  }

  // "en 3 h", "en 12 min", "mañana 09:00", "vie 09:00"
  function nextLabel(iso) {
    if (!iso) return "—";
    var when = new Date(iso);
    if (isNaN(when)) return "—";
    var now = new Date();
    var diff = when.getTime() - now.getTime();
    if (diff <= 0) return "pendiente";

    var mins = Math.round(diff / 60000);
    if (mins < 1) return "en menos de 1 min";
    if (mins < 60) return "en " + mins + " min";

    var manana = new Date(now.getTime());
    manana.setDate(manana.getDate() + 1);
    if (sameDay(when, now)) return "en " + Math.round(mins / 60) + " h";
    if (sameDay(when, manana)) return "mañana " + hhmm(when);

    var hours = mins / 60;
    if (hours < 48) return "en " + Math.round(hours) + " h";
    return DIAS[when.getDay()].slice(0, 3).toLowerCase() + " " + hhmm(when);
  }

  function lastLabel(iso) {
    if (!iso) return "Nunca se ha ejecutado";
    var d = new Date(iso);
    if (isNaN(d)) return "Nunca se ha ejecutado";
    var now = new Date();
    if (sameDay(d, now)) return "Última: hoy " + hhmm(d);
    var ayer = new Date(now.getTime());
    ayer.setDate(ayer.getDate() - 1);
    if (sameDay(d, ayer)) return "Última: ayer " + hhmm(d);
    return "Última: " + pad2(d.getDate()) + "/" + pad2(d.getMonth() + 1) + " " + hhmm(d);
  }

  function blank() {
    return {
      id: "",
      name: "",
      prompt: "",
      every: "day",
      at: "09:00",
      weekday: 1,
      enabled: true,
    };
  }

  function byId(id) {
    for (var i = 0; i < tasks.length; i++) if (tasks[i] && tasks[i].id === id) return tasks[i];
    return null;
  }

  /* ------------------------------------------------------------- pintado */

  function render() {
    if (!root) return;
    var html = "";

    html += '<div class="sch-head">';
    html += '<div class="sch-title">Tareas programadas</div>';
    html +=
      '<button class="btn" data-act="new"' +
      (editing ? " disabled" : "") +
      ">Nueva tarea</button>";
    html += "</div>";
    html +=
      '<p class="sch-hint">Cada tarea lanza una consulta de un solo turno en la carpeta de trabajo y guarda el resultado en <code>.claude/programadas/</code>.</p>';

    html += '<div class="sch-list">';
    if (!tasks.length) {
      html += '<div class="sch-empty">Todavía no hay tareas programadas.</div>';
    } else {
      for (var i = 0; i < tasks.length; i++) html += taskRow(tasks[i]);
    }
    html += "</div>";

    if (editing) html += form(editing);

    root.innerHTML = html;
    wire();
  }

  function taskRow(t) {
    var running = !!busy[t.id];
    var h = '<div class="sch-item' + (t.enabled ? "" : " off") + '" data-id="' + esc(t.id) + '">';
    h += '<div class="sch-item-main">';
    h += '<div class="sch-name">' + esc(t.name) + "</div>";
    h += '<div class="sch-meta">';
    h += "<span>" + esc(freqLabel(t)) + "</span>";
    h +=
      '<span class="sch-dot">·</span><span>' +
      (t.enabled ? "Próxima " + esc(nextLabel(t.nextRun)) : "Desactivada") +
      "</span>";
    h += '<span class="sch-dot">·</span><span>' + esc(lastLabel(t.lastRun)) + "</span>";
    h += "</div>";
    h += '<div class="sch-prompt">' + esc(t.prompt) + "</div>";
    h += "</div>";
    h += '<div class="sch-actions">';
    h +=
      '<button class="switch' +
      (t.enabled ? " on" : "") +
      '" data-act="toggle" title="Activar o desactivar"></button>';
    h +=
      '<button class="btn" data-act="run"' +
      (running ? " disabled" : "") +
      ">" +
      (running ? "Ejecutando…" : "Ejecutar ahora") +
      "</button>";
    h += '<button class="btn ghost" data-act="edit">Editar</button>';
    h += '<button class="btn ghost sch-del" data-act="del">Eliminar</button>';
    h += "</div>";
    h += "</div>";
    return h;
  }

  function form(d) {
    var h = '<div class="sch-form">';
    h += '<div class="sch-form-title">' + (d.id ? "Editar tarea" : "Nueva tarea") + "</div>";

    h += '<div class="row">';
    h += '<div class="lbl"><b>Nombre</b><span>Cómo aparecerá en la lista y en la notificación.</span></div>';
    h +=
      '<input class="field" id="sch-name" type="text" maxlength="80" placeholder="Resumen del día" value="' +
      esc(d.name) +
      '">';
    h += "</div>";

    h += '<div class="row sch-row-block">';
    h += '<div class="lbl"><b>Instrucción</b><span>Lo que se le pedirá al agente en cada ejecución.</span></div>';
    h +=
      '<textarea class="field sch-textarea" id="sch-prompt" rows="4" placeholder="Revisa los cambios de hoy y escribe un resumen.">' +
      esc(d.prompt) +
      "</textarea>";
    h += "</div>";

    h += '<div class="row">';
    h += '<div class="lbl"><b>Frecuencia</b><span>Cada cuánto se repite.</span></div>';
    h += '<select class="field" id="sch-every">';
    h += opt("hour", "Cada hora", d.every);
    h += opt("day", "Diario", d.every);
    h += opt("week", "Semanal", d.every);
    h += "</select>";
    h += "</div>";

    h += '<div class="row" id="sch-row-at"' + (d.every === "hour" ? ' hidden' : "") + ">";
    h += '<div class="lbl"><b>Hora</b><span>Hora local del equipo.</span></div>';
    h += '<input class="field" id="sch-at" type="time" value="' + esc(d.at || "09:00") + '">';
    h += "</div>";

    h += '<div class="row" id="sch-row-wd"' + (d.every === "week" ? "" : " hidden") + ">";
    h += '<div class="lbl"><b>Día de la semana</b><span>Solo para tareas semanales.</span></div>';
    h += '<select class="field" id="sch-weekday">';
    for (var i = 0; i < 7; i++) h += opt(String(i), DIAS[i], String(d.weekday));
    h += "</select>";
    h += "</div>";

    h += '<div class="sch-form-actions">';
    h += '<button class="btn ghost" data-act="cancel">Cancelar</button>';
    h += '<button class="btn primary" data-act="save">Guardar</button>';
    h += "</div>";
    h += "</div>";
    return h;
  }

  function opt(value, label, current) {
    return (
      '<option value="' +
      esc(value) +
      '"' +
      (String(current) === String(value) ? " selected" : "") +
      ">" +
      esc(label) +
      "</option>"
    );
  }

  /* -------------------------------------------------------------- eventos */

  function wire() {
    if (!root) return;

    var nuevo = root.querySelector('[data-act="new"]');
    if (nuevo)
      nuevo.onclick = function () {
        editing = blank();
        render();
      };

    var items = root.querySelectorAll(".sch-item");
    for (var i = 0; i < items.length; i++) bindItem(items[i]);

    var f = root.querySelector(".sch-form");
    if (f) bindForm(f);
  }

  function bindItem(el) {
    var id = el.getAttribute("data-id");

    var sw = el.querySelector('[data-act="toggle"]');
    if (sw)
      sw.onclick = function () {
        var t = byId(id);
        if (!t) return;
        var copy = clone(t);
        copy.enabled = !t.enabled;
        persist(copy);
      };

    var runBtn = el.querySelector('[data-act="run"]');
    if (runBtn)
      runBtn.onclick = function () {
        var t = byId(id);
        if (!t || busy[id]) return;
        busy[id] = true;
        render();
        Promise.resolve(api().scheduleRun ? api().scheduleRun(id) : null)
          .catch(function (e) {
            toast("No se pudo ejecutar: " + ((e && e.message) || e), "err");
          })
          .then(function () {
            delete busy[id];
            return refresh();
          });
      };

    var editBtn = el.querySelector('[data-act="edit"]');
    if (editBtn)
      editBtn.onclick = function () {
        var t = byId(id);
        if (!t) return;
        editing = clone(t);
        render();
        var name = root.querySelector("#sch-name");
        if (name) name.focus();
      };

    var delBtn = el.querySelector('[data-act="del"]');
    if (delBtn)
      delBtn.onclick = function () {
        var t = byId(id);
        if (!t) return;
        if (!window.confirm('¿Eliminar la tarea "' + t.name + '"?')) return;
        Promise.resolve(api().scheduleDelete ? api().scheduleDelete(id) : [])
          .then(function (list) {
            if (editing && editing.id === id) editing = null;
            apply(list);
            toast("Tarea eliminada.", "ok");
          })
          .catch(function (e) {
            toast("No se pudo eliminar: " + ((e && e.message) || e), "err");
          });
      };
  }

  function bindForm(f) {
    var every = f.querySelector("#sch-every");
    if (every)
      every.onchange = function () {
        var v = every.value;
        var rowAt = f.querySelector("#sch-row-at");
        var rowWd = f.querySelector("#sch-row-wd");
        if (rowAt) rowAt.hidden = v === "hour";
        if (rowWd) rowWd.hidden = v !== "week";
      };

    var cancel = f.querySelector('[data-act="cancel"]');
    if (cancel)
      cancel.onclick = function () {
        editing = null;
        render();
      };

    var save = f.querySelector('[data-act="save"]');
    if (save)
      save.onclick = function () {
        var draft = readForm(f);
        if (!draft.name) return toast("Escribe un nombre para la tarea.", "err");
        if (!draft.prompt) return toast("Escribe la instrucción de la tarea.", "err");
        if (draft.every !== "hour" && !/^\d{2}:\d{2}$/.test(draft.at))
          return toast("Elige una hora válida.", "err");
        editing = draft;
        persist(draft, true);
      };
  }

  function readForm(f) {
    var g = function (sel) {
      var el = f.querySelector(sel);
      return el ? el.value : "";
    };
    return {
      id: editing && editing.id ? editing.id : "",
      name: String(g("#sch-name")).trim(),
      prompt: String(g("#sch-prompt")).trim(),
      every: g("#sch-every") || "day",
      at: g("#sch-at") || "09:00",
      weekday: Number(g("#sch-weekday")) || 0,
      enabled: editing ? editing.enabled !== false : true,
    };
  }

  function clone(t) {
    return {
      id: t.id,
      name: t.name,
      prompt: t.prompt,
      every: t.every,
      at: t.at || "09:00",
      weekday: Number(t.weekday) || 0,
      enabled: t.enabled !== false,
      lastRun: t.lastRun || null,
      nextRun: t.nextRun || null,
    };
  }

  function persist(task, closeForm) {
    var payload = clone(task);
    if (!payload.id) delete payload.id;
    return Promise.resolve(api().scheduleSave ? api().scheduleSave(payload) : [])
      .then(function (list) {
        if (closeForm) {
          editing = null;
          toast("Tarea guardada.", "ok");
        }
        apply(list);
      })
      .catch(function (e) {
        toast("No se pudo guardar: " + ((e && e.message) || e), "err");
      });
  }

  function apply(list) {
    tasks = Array.isArray(list) ? list : [];
    render();
  }

  function refresh() {
    return Promise.resolve(api().scheduleList ? api().scheduleList() : [])
      .then(apply)
      .catch(function () {
        apply([]);
      });
  }

  /* --------------------------------------------------------------- montaje */

  function mount(container) {
    root = container || (window.App && window.App.$ ? window.App.$("schedules-root") : null);
    if (!root) return;
    editing = null;

    if (!wired && api().on) {
      wired = true;
      api().on("schedule:done", function (d) {
        d = d || {};
        if (d.id) delete busy[d.id];
        toast(
          (d.name || "Tarea") + ": " + (d.ok ? d.summary || "completada" : "falló"),
          d.ok ? "ok" : "err"
        );
        refresh();
      });
    }

    render();
    refresh();
  }

  window.SchedulesUI = { mount: mount, refresh: refresh };
})();
