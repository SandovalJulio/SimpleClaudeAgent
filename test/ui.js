// Prueba de UI: lanza el Electron real con depuración remota y hace clic en los botones, por áreas.
// Uso: npm test                       -> sin gastar tokens
//      UI_TEST_LIVE=1 npm test        -> además el área "live": consultas reales con Haiku (unos centavos)
//      npm test -- conversaciones live -> solo esas áreas (la de arranque siempre corre: fija la carpeta)
// Un fallo o excepción en un área no impide ejecutar las demás; al final hay un resumen por área.
const { sleep, makeWorkspace, launch, connect, shutdown } = require("./ui/entorno");

const AREAS = ["arranque", "compositor", "conversaciones", "configuracion", "conexiones"];
const LIVE = process.env.UI_TEST_LIVE === "1";
const only = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const wanted = new Set(only.length ? ["arranque", ...only] : [...AREAS, ...(LIVE ? ["live"] : [])]);
if (only.includes("live") && !LIVE) process.env.UI_TEST_LIVE = "1";

const WS = makeWorkspace();
const app = launch();
const ACT = (a) => `.thread.active [data-act="${a}"]`;
const results = []; // { area, ok, name, extra }
let area = "";
const check = (name, ok, extra = "") => results.push({ area, ok: !!ok, name, extra });

(async () => {
  const conn = await connect(app.PORT);
  if (!conn) { console.log("No se pudo conectar a Electron"); await shutdown(app, [WS, app.USER_DATA]); process.exit(1); }
  const { browser, page, errors } = conn;
  await sleep(1500);
  const ctx = { page, check, sleep, WS, ACT, LIVE };

  for (const name of [...AREAS, "live"]) {
    if (!wanted.has(name)) continue;
    area = name;
    const before = results.length;
    try {
      // Estado limpio entre áreas: sin menús ni modal abiertos, y una conversación activa.
      await page.evaluate(() => { window.App.closeMenu(); window.Settings?.close(); if (!window.Chat?.active()) window.Chat?.createConv(); }).catch(() => {});
      await require(`./ui/${name}`)(ctx);
    } catch (e) {
      results.push({ area, ok: false, name: "EXCEPCIÓN", extra: e.message.split("\n")[0].slice(0, 160) });
    }
    if (results.length === before) results.push({ area, ok: true, name: "(sin comprobaciones)", extra: "" });
  }

  for (const r of results) console.log(`${r.ok ? "OK " : "FAIL"} [${r.area}] ${r.name}${r.extra ? " -> " + r.extra : ""}`);
  console.log("\nResumen por área:");
  for (const a of [...AREAS, "live"]) {
    const rs = results.filter((r) => r.area === a);
    if (!rs.length) { if (a !== "live" || LIVE) console.log(`  ${a.padEnd(15)} no ejecutada`); continue; }
    const fails = rs.filter((r) => !r.ok).length;
    console.log(`  ${a.padEnd(15)} ${fails ? "FALLA" : "OK   "}  ${rs.length - fails}/${rs.length}`);
  }
  console.log("errores de página:", errors.length ? "\n" + errors.join("\n") : "ninguno");
  await browser.close().catch(() => {});
  await shutdown(app, [WS, app.USER_DATA]);
  process.exit(results.some((r) => !r.ok) || errors.length ? 1 : 0);
})().catch(async (e) => { console.log("EXCEPCIÓN GLOBAL:", e.message); await shutdown(app, [WS, app.USER_DATA]); process.exit(1); });
