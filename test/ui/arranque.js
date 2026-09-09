// Área "arranque": carpeta por defecto y restaurada, skills, conversación inicial, bienvenida (clave de API).
const path = require("path");

module.exports = async ({ page, check, sleep, WS, ACT }) => {
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
};
