// Pantalla de bienvenida: pide y valida la clave de API cuando no hay ninguna (primera ejecución).
// La validación la hace el proceso principal con una consulta mínima al SDK; si pasa, se guarda cifrada.
(() => {
  const { $, state, on, emit, toast } = window.App;
  const root = $("welcome-root");
  root.innerHTML = `
  <div id="welcome" class="welcome" hidden>
    <div class="welcome-card" role="dialog" aria-modal="true">
      <img class="logo" src="logo.svg" alt="" />
      <h1>Bienvenido a Agente</h1>
      <p>Para empezar hace falta una clave de API de Anthropic. Se guarda <b>cifrada en este equipo</b> y solo se usa para hablar con la API.</p>
      <input id="welcome-key" class="field" type="password" placeholder="sk-ant-…" autocomplete="off" spellcheck="false" />
      <div class="welcome-actions">
        <button id="welcome-save" class="btn primary">Validar y continuar</button>
        <a href="https://console.anthropic.com/settings/keys">Obtener una clave</a>
      </div>
      <div id="welcome-status" class="welcome-status"></div>
    </div>
  </div>`;

  const box = $("welcome"), input = $("welcome-key"), status = $("welcome-status"), btn = $("welcome-save");
  function show() { box.hidden = false; status.textContent = ""; input.value = ""; setTimeout(() => input.focus(), 50); }
  function hide() { box.hidden = true; }

  async function save() {
    const key = input.value.trim();
    if (!key) { status.textContent = "Escribe la clave antes de continuar."; return; }
    btn.disabled = true; status.textContent = "Comprobando la clave con una consulta mínima…";
    try {
      const r = await window.agente.apiKeySet(key);
      if (!r.ok) { status.textContent = "No se pudo validar: " + (r.error || "error desconocido"); return; }
      state.apiKey = r.status;
      hide(); toast("Clave guardada de forma cifrada.", "ok");
      emit("apikey:ready");
    } catch (e) { status.textContent = "Error: " + e.message.replace(/^.*Error: /, ""); }
    finally { btn.disabled = false; }
  }
  btn.onclick = save;
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") save(); });

  on("app:ready", () => { if (state.apiKey && !state.apiKey.has) show(); });
  on("apikey:cleared", show);

  window.Welcome = { show, hide, save };
})();
