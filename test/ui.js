// Prueba de UI: lanza el Electron real con depuración remota y hace clic en los botones.
// Uso: npm test                -> sin gastar tokens
//      UI_TEST_LIVE=1 npm test -> además consultas reales con Haiku (unos centavos)
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { chromium } = require("playwright-core");

const APP_DIR = path.resolve(__dirname, "..");
const LIVE = process.env.UI_TEST_LIVE === "1";

// Carpeta de trabajo de prueba con una skill y tres memorias; datos de usuario aparte.
const WS = fs.mkdtempSync(path.join(os.tmpdir(), "agente-ws-"));
fs.mkdirSync(path.join(WS, ".claude", "skills", "demo-skill"), { recursive: true });
fs.writeFileSync(path.join(WS, ".claude", "skills", "demo-skill", "SKILL.md"), "---\nname: demo-skill\ndescription: Skill de prueba para la UI\n---\nDi hola.\n");
fs.writeFileSync(path.join(WS, "CLAUDE.md"), "# Memoria\n\n## Perfil\n- prepara CVs\n\n## Memoria\n- responde corto\n- sin emojis\n");
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "agente-userdata-"));

const electron = path.join(APP_DIR, "node_modules", ".bin", process.platform === "win32" ? "electron.cmd" : "electron");
const env = { ...process.env, AGENTE_USER_DATA: USER_DATA }; delete env.ELECTRON_RUN_AS_NODE;
// Si la prueba corre dentro de Claude Code, el CLI del SDK heredaría su sesión (la app también las limpia).
for (const k of Object.keys(env)) if (/^(CLAUDECODE|CLAUDE_CODE_|CLAUDE_PID$|CLAUDE_EFFORT$)/.test(k)) delete env[k];
const PORT = 9400 + Math.floor(Math.random() * 500);
const proc = spawn(`"${electron}" . --remote-debugging-port=${PORT}`, { cwd: APP_DIR, env, shell: true, stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, extra = "") => results.push(`${ok ? "OK " : "FAIL"} ${name}${extra ? " -> " + extra : ""}`);
const ACT = (a) => `.thread.active [data-act="${a}"]`;

(async () => {
  let browser;
  for (let i = 0; i < 30 && !browser; i++) { try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`); } catch { await sleep(500); } }
  if (!browser) { console.log("No se pudo conectar a Electron"); await shutdown(); process.exit(1); }
  const page = browser.contexts()[0].pages()[0];
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/favicon/.test(m.text())) errors.push("console: " + m.text()); });
  await sleep(1500);

  // Carpeta por defecto al arrancar; luego fijamos la de prueba.
  await page.evaluate(() => localStorage.removeItem("settings"));
  check("carpeta por defecto al arrancar", !!(await page.textContent("#ws-path")), await page.textContent("#ws-path"));
  await page.evaluate((ws) => window.agente.setFolder(ws), WS);
  await page.reload(); await sleep(1800);
  check("carpeta restaurada", (await page.textContent("#ws-label")) === path.basename(WS), await page.textContent("#ws-label"));
  check("skills listadas", (await page.$$(".skill")).length === 1);
  check("conversación inicial creada", (await page.$$("#convs .conv")).length === 1 && !!(await page.$(".thread.active .hero")));
  check("sugerencia oculta con 3 memorias", !(await page.isVisible(ACT("suggest"))) && (await page.isVisible(ACT("explore"))));
  // Clave de API: con .env la bienvenida no aparece; forzada, rechaza formatos inválidos sin llamar al SDK.
  check("bienvenida oculta con clave", !(await page.isVisible("#welcome")));
  await page.evaluate(() => window.Welcome.show()); await page.fill("#welcome-key", "abc"); await page.click("#welcome-save"); await sleep(300);
  check("bienvenida rechaza formato inválido", (await page.isVisible("#welcome")) && (await page.textContent("#welcome-status")).includes("formato"));
  await page.evaluate(() => window.Welcome.hide());

  // Tarjetas de inicio
  await page.click(ACT("create")); await sleep(300);
  const sel = await page.$eval("#input", (e) => e.value.slice(e.selectionStart, e.selectionEnd));
  check("crear skill rellena plantilla", (await page.inputValue("#input")).startsWith("Crea una skill llamada") && sel === "NOMBRE", sel);
  await page.click(ACT("improve")); await sleep(300);
  check("mejorar skill abre menú", await page.$eval("#menu", (e) => e.classList.contains("open")));
  await page.click("#menu [data-skill]"); await sleep(200);
  check("elegir skill en mejorar", (await page.inputValue("#input")).startsWith("Mejora la skill /demo-skill"));
  await page.click(ACT("artifact")); await sleep(200);
  check("artifact rellena plantilla", (await page.inputValue("#input")).startsWith("Crea un artifact"));

  // Menú "/"
  await page.fill("#input", ""); await page.click("#slash"); await sleep(300);
  check("botón / abre menú", await page.$eval("#menu", (e) => e.classList.contains("open") && !!e.querySelector("[data-skill]")));
  await page.click("#menu [data-skill]"); await sleep(200);
  check("elegir skill con /", (await page.inputValue("#input")) === "/demo-skill ");
  await page.fill("#input", ""); await page.type("#input", "/de"); await sleep(300);
  check("escribir / filtra skills", await page.$eval("#menu", (e) => e.classList.contains("open") && e.querySelectorAll("[data-skill]").length === 1));
  await page.keyboard.press("Enter"); await sleep(200);
  check("Enter elige skill filtrada", (await page.inputValue("#input")) === "/demo-skill ");
  await page.fill("#input", "");

  // Píldoras
  await page.click("#model-pill"); await sleep(300);
  check("píldora modelo abre menú", await page.$eval("#menu", (e) => e.classList.contains("open") && !!e.querySelector("[data-model]")));
  await page.click('#menu [data-model="claude-sonnet-5"]'); await sleep(400);
  check("cambiar modelo", (await page.textContent("#model-label")) === "Sonnet 5", await page.textContent("#model-label"));
  await page.click("#model-pill"); await sleep(300); await page.click('#menu [data-effort="high"]'); await sleep(400);
  check("cambiar razonamiento", (await page.textContent("#effort-label")) === "Alto");
  await page.click("#model-pill"); await sleep(200); await page.click('#menu [data-model="claude-haiku-4-5"]'); await sleep(300);
  await page.click("#perm-pill"); await sleep(300);
  check("píldora permisos: 4 modos", (await page.$$("#menu [data-perm]")).length === 4);
  await page.click('#menu [data-perm="plan"]'); await sleep(400);
  check("cambiar permisos", (await page.textContent("#perm-label")) === "Planificar", await page.textContent("#perm-label"));
  await page.click("#perm-pill"); await sleep(200); await page.click('#menu [data-perm="acceptEdits"]'); await sleep(300);

  // Conversaciones en paralelo
  await page.click("#new-chat"); await sleep(600);
  check("segunda conversación", (await page.$$("#convs .conv")).length === 2 && (await page.$$(".thread")).length === 2);
  await page.click("#convs .conv:first-child"); await sleep(200);
  check("cambiar de conversación", await page.$eval("#convs .conv:first-child", (e) => e.classList.contains("active")));
  // Fijar y renombrar
  await page.click("#convs .conv:last-child", { button: "right" }); await sleep(200);
  check("fijar conversación la pone primera", await page.$eval("#convs .conv:first-child", (e) => e.classList.contains("pinned")));
  await page.dblclick("#convs .conv:first-child .t"); await sleep(200);
  await page.keyboard.type("Mi tarea"); await page.keyboard.press("Enter"); await sleep(300);
  check("renombrar conversación", (await page.textContent("#convs .conv:first-child .t")) === "Mi tarea", await page.textContent("#convs .conv:first-child .t"));
  await page.hover("#convs .conv:last-child"); await page.click("#convs .conv:last-child .x"); await sleep(400);
  check("cerrar conversación", (await page.$$("#convs .conv")).length === 1);
  // Nombre y fijado persistidos por sessionId en config.json (las conversaciones sin turno aún no tienen sesión).
  await page.evaluate(() => window.agente.convMeta({ sessionId: "sesion-prueba", title: "Nombre guardado", pinned: true }));
  let meta = (await page.evaluate(async () => (await window.agente.getState()).config)).convMeta;
  check("meta de conversación guardada", meta["sesion-prueba"]?.title === "Nombre guardado" && meta["sesion-prueba"]?.pinned === true, JSON.stringify(meta));
  await page.evaluate(() => window.agente.convMeta({ sessionId: "sesion-prueba", title: "", pinned: false }));
  meta = (await page.evaluate(async () => (await window.agente.getState()).config)).convMeta;
  check("meta vacía se elimina", !("sesion-prueba" in meta));
  // Buscar en historial (sin sesiones aún: muestra "Sin coincidencias")
  await page.fill("#history-search", "zzzz"); await sleep(200);
  check("búsqueda en historial filtra", (await page.textContent("#history")).includes("Sin coincidencias"));
  await page.fill("#history-search", "");

  // Configuración
  await page.click("#open-config"); await sleep(500);
  check("abre configuración", await page.$eval("#overlay", (e) => e.classList.contains("open")));
  check("clave de API tomada del entorno", (await page.evaluate(() => window.agente.apiKeyStatus())).source === "env" && (await page.textContent("#cfg-key-status")).includes("entorno") && (await page.isHidden("#cfg-key-clear")));
  check("memorias cargadas en editor", (await page.inputValue("#mem-edit")).includes("## Memoria"));
  check("conexiones listadas", (await page.$$("#cfg-connections .switch")).length === 7);
  // Conexión con credencial: no se activa sin token; con token guardado (cifrado) sí, y el renderer no recibe el secreto.
  const gh = (await page.$$("#cfg-connections .row"))[3];
  await gh.$eval(".switch", (e) => e.click()); await sleep(300);
  check("conexión con token no se activa sin credencial", !(await gh.$eval(".switch", (e) => e.classList.contains("on"))));
  await gh.$eval('input[data-key="token"]', (e) => { e.value = "ghp_prueba123"; });
  await gh.$eval('[data-save="token"]', (e) => e.click()); await sleep(400);
  const gh2 = (await page.$$("#cfg-connections .row"))[3];
  check("credencial guardada sin exponerla", (await gh2.$eval('input[data-key="token"]', (e) => e.placeholder)).includes("(guardado)") && (await page.evaluate(async () => JSON.stringify((await window.agente.getState()).config))).includes("ghp_") === false);
  await gh2.$eval(".switch", (e) => e.click()); await sleep(400);
  check("conexión con token se activa", await (await page.$$("#cfg-connections .row"))[3].$eval(".switch", (e) => e.classList.contains("on")));
  await (await page.$$("#cfg-connections .row"))[3].$eval(".switch", (e) => e.click()); await sleep(300);
  check("tareas programadas montadas", (await page.$eval("#cfg-schedules", (e) => e.children.length)) > 0);
  await page.fill("#cfg-name", "Julio"); await page.dispatchEvent("#cfg-name", "change"); await sleep(200);
  await page.fill("#cfg-budget", "2.5"); await page.dispatchEvent("#cfg-budget", "change"); await sleep(200);
  await page.click('[data-cfg="web"]'); await sleep(300);
  const cfg = await page.evaluate(async () => (await window.agente.getState()).config);
  check("config guardada (nombre, tope, web)", cfg.name === "Julio" && cfg.maxBudgetUsd === 2.5 && cfg.web === false, JSON.stringify({ n: cfg.name, b: cfg.maxBudgetUsd, w: cfg.web }));
  await page.click('[data-cfg="web"]'); await sleep(200);
  await page.click("#cfg-connections .switch"); await sleep(300);
  check("activar conexión", await page.$eval("#cfg-connections .switch", (e) => e.classList.contains("on")));
  await page.click("#cfg-connections .switch"); await sleep(300);
  const txt = (await page.inputValue("#mem-edit")) + "- usa tablas\n- formato breve\n";
  await page.fill("#mem-edit", txt); await page.click("#mem-save"); await sleep(400);
  check("guardar memorias", (await page.textContent("#mem-status")) === "Guardado.");
  await page.click('#theme-seg [data-theme="dark"]'); await sleep(200);
  check("tema oscuro", await page.$eval("html", (e) => e.classList.contains("dark")));
  await page.click('#theme-seg [data-theme="system"]');
  await page.click("#close-config"); await sleep(800);
  check("sugerencia visible con 5 memorias", (await page.isVisible(ACT("suggest"))) && !(await page.isVisible(ACT("explore"))));

  if (LIVE) {
    // 1) Permiso interactivo: modo Preguntar + crear archivo -> tarjeta de permiso -> Permitir -> chip de archivo.
    await page.click("#perm-pill"); await sleep(200); await page.click('#menu [data-perm="default"]'); await sleep(400);
    await page.fill("#input", "Crea el archivo hola.txt en esta carpeta con el texto: hola mundo. Solo eso, sin explicaciones.");
    await page.keyboard.press("Enter");
    let card = null;
    for (let i = 0; i < 60 && !card; i++) { await sleep(1000); card = await page.$(".thread.active [class*='dlg-']"); }
    check("aparece tarjeta de permiso", !!card);
    if (card) { await page.getByRole("button", { name: "Permitir", exact: true }).first().click(); }
    let done = false;
    for (let i = 0; i < 90 && !done; i++) { await sleep(1000); done = (await page.$$(".thread.active .usage")).length > 0; }
    check("turno con permiso completado", done);
    check("archivo creado en disco", fs.existsSync(path.join(WS, "hola.txt")));
    check("chip de archivo producido", (await page.$$(".thread.active .fp-chip")).length >= 1);
    check("botón revertir presente", (await page.$$(".thread.active .turn-actions .link")).length === 2);
    // Ver cambios: abre el panel con la diferencia del archivo nuevo.
    await page.getByRole("button", { name: "± Ver cambios" }).first().click(); await sleep(800);
    check("panel de diferencias", (await page.$$("#panel-root .diff-file")).length >= 1 && (await page.textContent("#panel-root")).includes("hola mundo"));
    await page.click("#panel-root [data-act='close']"); await sleep(200);
    // Revertir archivos (checkpoints del SDK): acepta el confirm() y comprueba que el archivo desaparece.
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: /Revertir archivos/ }).first().click(); await sleep(2500);
    check("revertir elimina el archivo creado", !fs.existsSync(path.join(WS, "hola.txt")));
    await page.click("#perm-pill"); await sleep(200); await page.click('#menu [data-perm="acceptEdits"]'); await sleep(300);

    // 2) Sugerencia (usa memoria) en una conversación nueva.
    await page.click("#new-chat"); await sleep(600);
    await page.click(ACT("suggest"));
    done = false;
    for (let i = 0; i < 120 && !done; i++) { await sleep(1000); done = (await page.$$(".thread.active .usage")).length > 0; }
    const md = await page.$eval(".thread.active .msg.assistant .md", (e) => e.innerText).catch(() => "");
    check("consulta de sugerencia completada", done, (await page.$eval(".thread.active .usage", (e) => e.innerText).catch(() => "")).replace(/\s+/g, " ").slice(0, 100));
    check("respuesta con contenido", md.length > 40, md.slice(0, 80).replace(/\n/g, " "));
    // Historial: el SDK persiste las sesiones; las abiertas se ocultan, así que cerramos una y debe aparecer.
    const sessions = await page.evaluate(() => window.agente.listSessions());
    check("SDK lista sesiones de la carpeta", sessions.length >= 2, String(sessions.length));
    // Renombrar y fijar la conversación activa (ya tiene sessionId): debe persistir y verse en el historial.
    await page.click("#convs .conv.active", { button: "right" }); await sleep(200);
    await page.dblclick("#convs .conv.pinned .t"); await sleep(200);
    await page.keyboard.press("Control+A"); await page.keyboard.type("Sugerencia guardada"); await page.keyboard.press("Enter"); await sleep(400);
    await page.hover("#convs .conv.pinned"); await page.click("#convs .conv.pinned .x"); await sleep(1200);
    check("historial muestra la sesión cerrada", (await page.$$("#history .hist")).length >= 1);
    const first = await page.textContent("#history .hist:first-child .t");
    check("historial muestra nombre y fijado persistidos", first.includes("📌") && first.includes("Sugerencia guardada"), first);
    // Reabrir desde el historial crea una conversación recuperada con el nombre guardado.
    await page.click("#history .hist"); await sleep(1500);
    check("reanudar sesión desde historial", (await page.$$("#convs .conv")).length === 2);
    check("reanudada con nombre y fijado", (await page.textContent("#convs .conv.active .t")) === "Sugerencia guardada" && (await page.$eval("#convs .conv.active", (e) => e.classList.contains("pinned"))));
  }

  console.log(results.join("\n"));
  console.log("errores de página:", errors.length ? "\n" + errors.join("\n") : "ninguno");
  await browser.close().catch(() => {});
  await shutdown();
  process.exit(results.some((r) => r.startsWith("FAIL")) || errors.length ? 1 : 0);
})().catch(async (e) => { console.log("EXCEPCIÓN:", e.message); console.log(results.join("\n")); await shutdown(); process.exit(1); });

async function shutdown() {
  try {
    if (process.platform === "win32") {
      await new Promise((r) => spawn("taskkill", ["/F", "/T", "/PID", String(proc.pid)], { stdio: "ignore" }).on("exit", r));
      await new Promise((r) => spawn("powershell", ["-NoProfile", "-Command", `Get-CimInstance Win32_Process -Filter "name='electron.exe'" | Where-Object { $_.CommandLine -like '*remote-debugging-port=${PORT}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`], { stdio: "ignore" }).on("exit", r));
    } else proc.kill("SIGKILL");
  } catch { /* ignorar */ }
  await sleep(800);
  try { fs.rmSync(WS, { recursive: true, force: true }); } catch { /* ignorar */ }
  try { fs.rmSync(USER_DATA, { recursive: true, force: true }); } catch { /* ignorar */ }
}
