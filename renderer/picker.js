// Selector de carpetas y archivos para el modo navegador (server.js): sustituye a los diálogos
// nativos de Electron recorriendo el disco con el canal `fs:browse`. Autónomo: se carga antes que
// app.js, así que no usa nada de window.App.
window.Picker = (() => {
  const CSS = `
  .pk-back{position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:9000}
  .pk{background:var(--bg,#fff);color:var(--fg,#18181b);width:min(640px,92vw);height:min(560px,86vh);border-radius:12px;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,.35);font-size:13px}
  .pk h3{margin:0;padding:14px 16px;font-size:14px;border-bottom:1px solid var(--bd,#e4e4e7)}
  .pk-path{display:flex;gap:8px;padding:8px 12px;border-bottom:1px solid var(--bd,#e4e4e7);align-items:center}
  .pk-path input{flex:1;min-width:0;padding:6px 8px;border:1px solid var(--bd,#e4e4e7);border-radius:6px;background:transparent;color:inherit;font:inherit}
  .pk-list{flex:1;overflow:auto;padding:6px}
  .pk-row{display:flex;gap:8px;align-items:center;padding:7px 10px;border-radius:6px;cursor:pointer}
  .pk-row:hover{background:var(--hover,#f4f4f5)}
  .pk-row.sel{background:var(--accent,#2563eb);color:#fff}
  .pk-row .ic{width:16px;text-align:center;opacity:.7}
  .pk-foot{display:flex;gap:8px;justify-content:flex-end;padding:12px 16px;border-top:1px solid var(--bd,#e4e4e7)}
  .pk-foot button{padding:7px 14px;border-radius:7px;border:1px solid var(--bd,#e4e4e7);background:transparent;color:inherit;cursor:pointer;font:inherit}
  .pk-foot button.pri{background:var(--accent,#2563eb);border-color:transparent;color:#fff}
  .pk-empty{padding:20px;opacity:.6;text-align:center}`;

  let styled = false;
  function open({ mode = "dir", title = "Elegir" } = {}) {
    if (!styled) { const s = document.createElement("style"); s.textContent = CSS; document.head.appendChild(s); styled = true; }
    return new Promise((resolve) => {
      const back = document.createElement("div");
      back.className = "pk-back";
      back.innerHTML = `<div class="pk"><h3></h3>
        <div class="pk-path"><button class="up" title="Subir">↑</button><input spellcheck="false" placeholder="Escribe o pega una ruta y pulsa Enter" /></div>
        <div class="pk-list"></div>
        <div class="pk-foot"><button class="cancel">Cancelar</button><button class="ok pri"></button></div></div>`;
      back.querySelector("h3").textContent = title;
      const list = back.querySelector(".pk-list");
      const input = back.querySelector("input");
      const ok = back.querySelector(".ok");
      document.body.appendChild(back);

      let cur = "";      // carpeta mostrada
      let parent = null; // carpeta superior
      const picked = new Set(); // solo en modo "files"

      const label = () => { ok.textContent = mode === "dir" ? "Usar esta carpeta" : `Adjuntar${picked.size ? " (" + picked.size + ")" : ""}`; ok.disabled = mode === "dir" ? !cur : !picked.size; };

      async function go(p) {
        list.innerHTML = '<div class="pk-empty">Cargando…</div>';
        let r;
        try { r = await window.agente.browse(p || ""); }
        catch (e) { list.innerHTML = `<div class="pk-empty">${e.message}</div>`; return; }
        cur = r.path; parent = r.parent; input.value = r.path;
        list.innerHTML = "";
        if (!r.entries.length) list.innerHTML = '<div class="pk-empty">Carpeta vacía</div>';
        for (const e of r.entries) {
          if (mode === "dir" && !e.dir) continue;
          const row = document.createElement("div");
          row.className = "pk-row" + (picked.has(e.path) ? " sel" : "");
          row.innerHTML = '<span class="ic"></span><span class="nm"></span>';
          row.querySelector(".ic").textContent = e.dir ? "📁" : "📄";
          row.querySelector(".nm").textContent = e.name;
          row.onclick = () => {
            if (e.dir) return go(e.path);
            if (picked.has(e.path)) { picked.delete(e.path); row.classList.remove("sel"); } else { picked.add(e.path); row.classList.add("sel"); }
            label();
          };
          list.appendChild(row);
        }
        label();
      }

      const close = (v) => { back.remove(); document.removeEventListener("keydown", esc); resolve(v); };
      const esc = (e) => { if (e.key === "Escape") close(null); };
      document.addEventListener("keydown", esc);
      back.onclick = (e) => { if (e.target === back) close(null); };
      back.querySelector(".up").onclick = () => go(parent);
      back.querySelector(".cancel").onclick = () => close(null);
      ok.onclick = () => close(mode === "dir" ? cur || null : [...picked]);
      input.onkeydown = (e) => { if (e.key === "Enter") go(input.value.trim()); };

      go("");
    });
  }
  return { open };
})();
