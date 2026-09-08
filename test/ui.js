// Prueba de UI: lanza Electron con depuración remota y hace clic en los botones.
const { spawn } = require("child_process");
const path = require("path");
const { chromium } = require("playwright-core");

// Uso: npm test            -> prueba la UI sin gastar tokens
//      UI_TEST_LIVE=1 npm test -> además lanza una consulta real (cuesta unos centavos)
const fs = require("fs");
const os = require("os");
process.env.APP_DIR = path.resolve(__dirname, "..");
const LIVE = process.env.UI_TEST_LIVE === "1";

// Carpeta de trabajo de prueba con una skill y tres memorias.
const WS = fs.mkdtempSync(path.join(os.tmpdir(), "agente-ws-"));
fs.mkdirSync(path.join(WS, ".claude", "skills", "demo-skill"), { recursive: true });
fs.writeFileSync(path.join(WS, ".claude", "skills", "demo-skill", "SKILL.md"),
  "---\nname: demo-skill\ndescription: Skill de prueba para la UI\n---\nDi hola.\n");
fs.writeFileSync(path.join(WS, "CLAUDE.md"),
  "# Memoria\n\n## Perfil\n- prepara CVs\n\n## Memoria\n- responde corto\n- sin emojis\n");

const electron = path.join(process.env.APP_DIR, "node_modules", ".bin", process.platform === "win32" ? "electron.cmd" : "electron");
// Datos de usuario aparte: la prueba no toca la configuración real de la app.
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "agente-userdata-"));
const env = { ...process.env, AGENTE_USER_DATA: USER_DATA }; delete env.ELECTRON_RUN_AS_NODE;
// Puerto aleatorio para no conectarse por error a una instancia anterior.
const PORT = 9400 + Math.floor(Math.random() * 500);
const proc = spawn(`"${electron}" . --remote-debugging-port=${PORT}`, { cwd: process.env.APP_DIR, env, shell: true, stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, extra = "") => { results.push(`${ok ? "OK " : "FAIL"} ${name}${extra ? " -> " + extra : ""}`); };

(async () => {
  let browser;
  for (let i = 0; i < 30 && !browser; i++) {
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`); } catch { await sleep(500); }
  }
  if (!browser) { console.log("No se pudo conectar a Electron"); await shutdown(); process.exit(1); }
  const page = browser.contexts()[0].pages()[0];
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });

  // Al arrancar siempre hay carpeta (la última usada o Documentos\Agente): nunca se pide sola.
  await page.evaluate(() => localStorage.removeItem("settings"));
  const initial = await page.textContent("#ws-path");
  check("carpeta por defecto al arrancar", !!initial && initial !== "Elige la carpeta sobre la que trabajará el agente.", initial);
  check("botón de elegir oculto", !(await page.isVisible("#hero-pick")));

  // Fijar la carpeta de prueba sin diálogo nativo y recargar.
  await page.evaluate((ws) => window.agente.setFolder(ws), WS);
  await page.reload(); await sleep(1500);

  check("carpeta restaurada", (await page.textContent("#ws-label")) === path.basename(WS), await page.textContent("#ws-label"));
  check("skills listadas", (await page.$$(".skill")).length === 1);
  check("sugerencia oculta con 3 memorias", !(await page.isVisible("#chip-suggest")) && (await page.isVisible("#chip-explore")));

  // Chip: crear skill -> plantilla en textarea con NOMBRE seleccionado
  await page.click("#chip-create"); await sleep(300);
  const v1 = await page.inputValue("#input");
  const sel = await page.$eval("#input", (e) => e.value.slice(e.selectionStart, e.selectionEnd));
  check("chip crear skill rellena plantilla", v1.startsWith("Crea una skill llamada") && sel === "NOMBRE", sel);

  // Chip: mejorar skill -> menú de skills; elegir -> texto
  await page.click("#chip-improve"); await sleep(300);
  check("chip mejorar abre menú", await page.$eval("#menu", (e) => e.classList.contains("open")));
  await page.click("#menu [data-skill]"); await sleep(200);
  check("elegir skill en mejorar", (await page.inputValue("#input")).startsWith("Mejora la skill /demo-skill"), await page.inputValue("#input"));

  // Botón "/" -> menú; elegir -> "/demo-skill "
  await page.click("#slash"); await sleep(300);
  check("botón / abre menú", await page.$eval("#menu", (e) => e.classList.contains("open") && !!e.querySelector("[data-skill]")));
  await page.click("#menu [data-skill]"); await sleep(200);
  check("elegir skill con /", (await page.inputValue("#input")) === "/demo-skill ", await page.inputValue("#input"));

  // Escribir "/de" filtra
  await page.fill("#input", ""); await page.type("#input", "/de"); await sleep(300);
  check("escribir / filtra skills", await page.$eval("#menu", (e) => e.classList.contains("open") && e.querySelectorAll("[data-skill]").length === 1));
  await page.keyboard.press("Enter"); await sleep(200);
  check("Enter elige skill filtrada", (await page.inputValue("#input")) === "/demo-skill ");
  await page.fill("#input", "");

  // Píldora de modelo -> menú; cambiar a Sonnet y razonamiento alto
  await page.click("#model-pill"); await sleep(300);
  check("píldora modelo abre menú", await page.$eval("#menu", (e) => e.classList.contains("open") && !!e.querySelector("[data-model]")));
  await page.click('#menu [data-model="claude-sonnet-5"]'); await sleep(300);
  check("cambiar modelo", (await page.textContent("#model-label")) === "Sonnet 5", await page.textContent("#model-label"));
  await page.click("#model-pill"); await sleep(300);
  await page.click('#menu [data-effort="high"]'); await sleep(300);
  check("cambiar razonamiento", (await page.textContent("#effort-label")) === "Alto", await page.textContent("#effort-label"));
  await page.click("#model-pill"); await sleep(200);
  await page.click('#menu [data-model="claude-haiku-4-5"]'); await sleep(200);

  // Píldora de permisos
  await page.click("#perm-pill"); await sleep(300);
  await page.click('#menu [data-perm="plan"]'); await sleep(300);
  check("cambiar permisos", (await page.textContent("#perm-label")) === "Solo lectura", await page.textContent("#perm-label"));
  await page.click("#perm-pill"); await sleep(200);
  await page.click('#menu [data-perm="acceptEdits"]'); await sleep(200);

  // Configuración
  await page.click("#open-config"); await sleep(400);
  check("abre configuración", await page.$eval("#overlay", (e) => e.classList.contains("open")));
  check("memorias cargadas en editor", (await page.inputValue("#mem-edit")).includes("## Memoria"));
  check("conexiones listadas", (await page.$$("#cfg-connections .switch")).length === 3);
  await page.fill("#cfg-name", "Julio"); await page.dispatchEvent("#cfg-name", "change"); await sleep(200);
  await page.click("#cfg-connections .switch"); await sleep(300);
  check("activar conexión", await page.$eval("#cfg-connections .switch", (e) => e.classList.contains("on")));
  await page.click("#cfg-connections .switch"); await sleep(300);
  // Editar memorias y guardar -> barra lateral refleja 5 entradas -> aparece sugerencia
  const txt = (await page.inputValue("#mem-edit")) + "- usa tablas\n- formato breve\n";
  await page.fill("#mem-edit", txt); await page.click("#mem-save"); await sleep(400);
  check("guardar memorias", (await page.textContent("#mem-status")) === "Guardado.");
  await page.click('#theme-seg [data-theme="dark"]'); await sleep(200);
  check("tema oscuro", await page.$eval("html", (e) => e.classList.contains("dark")));
  await page.click('#theme-seg [data-theme="system"]');
  await page.click("#close-config"); await sleep(600);
  check("memoria no visible en barra lateral", !(await page.$("#memory")));
  check("sugerencia visible con 5 memorias", (await page.isVisible("#chip-suggest")) && !(await page.isVisible("#chip-explore")));

  if (LIVE) {
    // Envío real (Haiku): el chip de sugerencia lanza una consulta completa
    await page.click("#chip-suggest");
    let done = false;
    for (let i = 0; i < 120 && !done; i++) { await sleep(1000); done = (await page.textContent("#status-text")) === "Listo" && (await page.$$(".usage")).length > 0; }
    const md = await page.$eval(".msg.assistant .md", (e) => e.innerText).catch(() => "");
    const usage = await page.$eval(".usage", (e) => e.innerText).catch(() => "");
    check("consulta real completada", done, usage.replace(/\s+/g, " ").slice(0, 120));
    check("respuesta con contenido", md.length > 40, md.slice(0, 100).replace(/\n/g, " "));
    check("burbuja de usuario", (await page.$$(".msg.user")).length === 1);
    await page.click("#new-chat"); await sleep(1500);
    check("nueva conversación limpia", (await page.$$(".msg")).length === 0 && !!(await page.$("#hero")));
  }

  console.log(results.join("\n"));
  console.log("errores de página:", errors.length ? "\n" + errors.join("\n") : "ninguno");
  await browser.close().catch(() => {});
  await shutdown();
  process.exit(results.some((r) => r.startsWith("FAIL")) || errors.length ? 1 : 0);
})().catch(async (e) => { console.log("EXCEPCIÓN:", e.message); console.log(results.join("\n")); await shutdown(); process.exit(1); });

// Cierra Electron (todo el árbol de procesos) y borra la carpeta temporal.
async function shutdown() {
  try {
    if (process.platform === "win32") {
      // Mata el árbol del shell y, por si Electron se soltó de él, cualquier electron.exe de este proyecto.
      await new Promise((r) => spawn("taskkill", ["/F", "/T", "/PID", String(proc.pid)], { stdio: "ignore" }).on("exit", r));
      await new Promise((r) => spawn("powershell", ["-NoProfile", "-Command",
        `Get-CimInstance Win32_Process -Filter "name='electron.exe'" | Where-Object { $_.CommandLine -like '*remote-debugging-port=${PORT}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`],
        { stdio: "ignore" }).on("exit", r));
    } else proc.kill("SIGKILL");
  } catch {}
  await sleep(800);
  try { fs.rmSync(WS, { recursive: true, force: true }); } catch {}
  try { fs.rmSync(USER_DATA, { recursive: true, force: true }); } catch {}
}
