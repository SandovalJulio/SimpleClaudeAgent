// Entorno de la prueba de UI: carpeta de trabajo y datos de usuario temporales, arranque del Electron
// real con depuración remota, conexión por CDP con playwright-core y apagado limpio.
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { chromium } = require("playwright-core");

const APP_DIR = path.resolve(__dirname, "..", "..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Carpeta de trabajo con una skill y tres memorias (la prueba de configuración añade dos más).
function makeWorkspace() {
  const WS = fs.mkdtempSync(path.join(os.tmpdir(), "agente-ws-"));
  fs.mkdirSync(path.join(WS, ".claude", "skills", "demo-skill"), { recursive: true });
  fs.writeFileSync(path.join(WS, ".claude", "skills", "demo-skill", "SKILL.md"), "---\nname: demo-skill\ndescription: Skill de prueba para la UI\n---\nDi hola.\n");
  fs.writeFileSync(path.join(WS, "CLAUDE.md"), "# Memoria\n\n## Perfil\n- prepara CVs\n\n## Memoria\n- responde corto\n- sin emojis\n");
  return WS;
}

function launch() {
  const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "agente-userdata-"));
  const electron = path.join(APP_DIR, "node_modules", ".bin", process.platform === "win32" ? "electron.cmd" : "electron");
  const env = { ...process.env, AGENTE_USER_DATA: USER_DATA }; delete env.ELECTRON_RUN_AS_NODE;
  // Si la prueba corre dentro de Claude Code, el CLI del SDK heredaría su sesión (la app también las limpia).
  for (const k of Object.keys(env)) if (/^(CLAUDECODE|CLAUDE_CODE_|CLAUDE_PID$|CLAUDE_EFFORT$)/.test(k)) delete env[k];
  const PORT = 9400 + Math.floor(Math.random() * 500);
  const proc = spawn(`"${electron}" . --remote-debugging-port=${PORT}`, { cwd: APP_DIR, env, shell: true, stdio: "ignore" });
  return { proc, PORT, USER_DATA };
}

async function connect(PORT) {
  let browser = null;
  for (let i = 0; i < 30 && !browser; i++) { try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`); } catch { await sleep(500); } }
  if (!browser) return null;
  const page = browser.contexts()[0].pages()[0];
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/favicon/.test(m.text())) errors.push("console: " + m.text()); });
  return { browser, page, errors };
}

// Mata el árbol de procesos de Electron y borra las carpetas temporales.
async function shutdown({ proc, PORT }, dirs = []) {
  try {
    if (process.platform === "win32") {
      await new Promise((r) => spawn("taskkill", ["/F", "/T", "/PID", String(proc.pid)], { stdio: "ignore" }).on("exit", r));
      await new Promise((r) => spawn("powershell", ["-NoProfile", "-Command", `Get-CimInstance Win32_Process -Filter "name='electron.exe'" | Where-Object { $_.CommandLine -like '*remote-debugging-port=${PORT}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`], { stdio: "ignore" }).on("exit", r));
    } else proc.kill("SIGKILL");
  } catch { /* ignorar */ }
  await sleep(800);
  for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignorar */ } }
}

module.exports = { APP_DIR, sleep, makeWorkspace, launch, connect, shutdown };
