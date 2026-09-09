/* files.js — Archivos producidos por turno y panel lateral de vista previa / artifacts.
   Script clásico. Expone window.FilesPanel. */
(function () {
  "use strict";

  // ---------- utilidades (con respaldo si App aún no existe) ----------
  const A = () => window.App || {};
  const $ = (id) => (A().$ ? A().$(id) : document.getElementById(id));
  const esc = (t) =>
    A().esc
      ? A().esc(t)
      : String(t == null ? "" : t).replace(/[&<>"']/g, (c) =>
          ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
        );
  const baseName = (p) =>
    A().baseName ? A().baseName(p) : String(p || "").split(/[\\/]/).filter(Boolean).pop() || String(p || "");
  const relPath = (p) => (A().relPath ? A().relPath(p) || p : p);

  const ext = (p) => {
    const n = baseName(p);
    const i = n.lastIndexOf(".");
    return i > 0 ? n.slice(i + 1).toLowerCase() : "";
  };

  const IMAGES = ["png", "jpg", "jpeg", "gif", "webp"];
  const TEXTS = ["txt", "json", "csv"];
  const PREVIEWABLE = ["html", "htm", "md", "svg", "pdf"].concat(IMAGES, TEXTS);

  const ICONS = {
    html: "🌐", htm: "🌐", md: "📝", pdf: "📕", svg: "🖼️",
    png: "🖼️", jpg: "🖼️", jpeg: "🖼️", gif: "🖼️", webp: "🖼️",
    txt: "📄", json: "🧾", csv: "📊",
    js: "📜", mjs: "📜", cjs: "📜", ts: "📜", tsx: "📜", jsx: "📜",
    css: "🎨", py: "🐍", sh: "⌨️", ps1: "⌨️",
    zip: "🗜️", xlsx: "📊", docx: "📄", pptx: "📽️",
  };
  const icon = (p) => ICONS[ext(p)] || "📄";

  // file:/// con barras normales y codificado
  function fileUrl(p) {
    let s = String(p || "").replace(/\\/g, "/");
    if (!s.startsWith("/")) s = "/" + s;
    return "file://" + encodeURI(s).replace(/#/g, "%23").replace(/\?/g, "%3F");
  }

  const api = () => window.agente || {};
  const call = (name, arg) => {
    const a = api();
    if (typeof a[name] !== "function") return Promise.reject(new Error("No disponible: " + name));
    try {
      return Promise.resolve(a[name](arg));
    } catch (e) {
      return Promise.reject(e);
    }
  };

  function isPreviewable(ruta) {
    return PREVIEWABLE.indexOf(ext(ruta)) !== -1;
  }

  function isArtifact(ruta) {
    return String(ruta || "")
      .split(/[\\/]/)
      .some((seg) => seg.toLowerCase() === "artifacts");
  }

  // ---------- chips ----------
  function render(container, files, convId) {
    if (!container) return;
    container.innerHTML = "";
    const list = [];
    const seen = Object.create(null);
    (files || []).forEach((f) => {
      if (!f || typeof f !== "string") return;
      if (seen[f]) return;
      seen[f] = true;
      list.push(f);
    });
    if (!list.length) return;

    container.classList.add("fp-chips");
    if (convId != null) container.dataset.conv = String(convId);

    list.forEach((f) => {
      const chip = document.createElement("span");
      chip.className = "fp-chip";
      chip.title = relPath(f);
      const prev = isPreviewable(f)
        ? '<button type="button" class="fp-btn" data-act="preview">Vista previa</button>'
        : "";
      chip.innerHTML =
        '<span class="fp-icon" aria-hidden="true">' + esc(icon(f)) + "</span>" +
        '<span class="fp-name">' + esc(baseName(f)) + "</span>" +
        '<span class="fp-acts">' +
        '<button type="button" class="fp-btn" data-act="open">Abrir</button>' +
        '<button type="button" class="fp-btn" data-act="folder">Carpeta</button>' +
        prev +
        "</span>";
      chip.addEventListener("click", (ev) => {
        const b = ev.target.closest ? ev.target.closest("button[data-act]") : null;
        if (!b) return;
        ev.preventDefault();
        const act = b.dataset.act;
        if (act === "open") call("openFile", f).catch(() => {});
        else if (act === "folder") call("openPath", f).catch(() => {});
        else if (act === "preview") open(f);
      });
      container.appendChild(chip);
    });

    // Artifacts: abrir la primera vista previa automáticamente
    const art = list.filter((f) => isArtifact(f) && isPreviewable(f))[0];
    if (art) open(art);
  }

  // ---------- panel lateral ----------
  let current = null; // última ruta (para "Recargar")

  function root() {
    return $("panel-root") || document.getElementById("panel-root");
  }

  function close() {
    const r = root();
    if (r) {
      r.classList.remove("open");
      r.innerHTML = "";
    }
    document.body.classList.remove("panel-open");
  }

  function open(ruta) {
    const r = root();
    if (!r || !ruta) return;
    current = ruta;

    r.innerHTML =
      '<div class="fp-head">' +
      '<span class="fp-head-icon" aria-hidden="true">' + esc(icon(ruta)) + "</span>" +
      '<span class="fp-head-name" title="' + esc(relPath(ruta)) + '">' + esc(baseName(ruta)) + "</span>" +
      '<span class="fp-head-acts">' +
      '<button type="button" class="fp-btn" data-act="open">Abrir</button>' +
      '<button type="button" class="fp-btn" data-act="folder">Carpeta</button>' +
      '<button type="button" class="fp-btn" data-act="reload">Recargar</button>' +
      '<button type="button" class="fp-btn fp-close" data-act="close" title="Cerrar" aria-label="Cerrar">×</button>' +
      "</span></div>" +
      '<div class="fp-body"></div>';

    r.classList.add("open");
    document.body.classList.add("panel-open");

    const head = r.querySelector(".fp-head");
    head.addEventListener("click", (ev) => {
      const b = ev.target.closest ? ev.target.closest("button[data-act]") : null;
      if (!b) return;
      ev.preventDefault();
      const act = b.dataset.act;
      if (act === "open") call("openFile", current).catch(() => {});
      else if (act === "folder") call("openPath", current).catch(() => {});
      else if (act === "reload") open(current);
      else if (act === "close") close();
    });

    fill(r.querySelector(".fp-body"), ruta);
  }

  function fail(body, e) {
    body.innerHTML =
      '<div class="fp-error">No se pudo leer el archivo.<br><span>' +
      esc((e && e.message) || String(e || "")) +
      "</span></div>";
  }

  function fill(body, ruta) {
    if (!body) return;
    const e = ext(ruta);
    const url = fileUrl(ruta);

    if (IMAGES.indexOf(e) !== -1) {
      body.innerHTML = '<div class="fp-imgwrap"><img class="fp-img" alt="' + esc(baseName(ruta)) + '" src="' + esc(url) + '"></div>';
      return;
    }
    if (e === "html" || e === "htm" || e === "pdf" || e === "svg") {
      body.innerHTML =
        '<iframe class="fp-frame" sandbox="allow-scripts" src="' + esc(url) + '"></iframe>';
      return;
    }
    if (e === "md" || TEXTS.indexOf(e) !== -1) {
      body.innerHTML = '<div class="fp-loading">Cargando…</div>';
      const pedido = ruta;
      call("readFile", ruta).then(
        (res) => {
          if (current !== pedido) return;
          const text = res && typeof res === "object" ? res.text || "" : String(res || "");
          if (e === "md") {
            let html = "";
            try {
              html = window.marked && window.marked.parse ? window.marked.parse(text) : "<pre>" + esc(text) + "</pre>";
            } catch (err) {
              html = "<pre>" + esc(text) + "</pre>";
            }
            body.innerHTML = '<div class="fp-doc md"></div>';
            body.querySelector(".fp-doc").innerHTML = html;
          } else {
            let out = text;
            if (e === "json") {
              try {
                out = JSON.stringify(JSON.parse(text), null, 2);
              } catch (err) {
                out = text;
              }
            }
            body.innerHTML = '<pre class="fp-pre"></pre>';
            body.querySelector(".fp-pre").textContent = out;
          }
        },
        (err) => {
          if (current !== pedido) return;
          fail(body, err);
        }
      );
      return;
    }
    body.innerHTML =
      '<div class="fp-error">No hay vista previa para este tipo de archivo.<br><span>' +
      esc(relPath(ruta)) +
      "</span></div>";
  }

  document.addEventListener("keydown", (ev) => {
    if (ev.key !== "Escape") return;
    const r = root();
    if (r && r.classList.contains("open")) close();
  });

  // Panel con contenido HTML propio (p. ej. diferencias de archivos). `html` ya debe venir escapado.
  function openHtml(title, html) {
    const r = root();
    if (!r) return;
    current = null;
    r.innerHTML =
      '<div class="fp-head"><span class="fp-head-icon" aria-hidden="true">±</span>' +
      '<span class="fp-head-name" title="' + esc(title) + '">' + esc(title) + "</span>" +
      '<span class="fp-head-acts"><button type="button" class="fp-btn fp-close" data-act="close" title="Cerrar" aria-label="Cerrar">×</button></span></div>' +
      '<div class="fp-body fp-custom"></div>';
    r.classList.add("open");
    document.body.classList.add("panel-open");
    r.querySelector('[data-act="close"]').onclick = close;
    r.querySelector(".fp-body").innerHTML = html;
  }

  window.FilesPanel = { render, open, openHtml, close, isPreviewable };
})();
