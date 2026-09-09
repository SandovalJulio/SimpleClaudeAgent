// Área "arranque": carpeta por defecto y restaurada, skills, conversación inicial, bienvenida (clave de API).
const path = require("path");

module.exports = async ({ page, check, sleep, WS, ACT }) => {
  await page.evaluate(() => localStorage.removeItem("settings"));
  check("carpeta por defecto al arrancar", (await page.getAttribute("#ws-pill", "title")).includes("Agente"), await page.getAttribute("#ws-pill", "title"));
  await page.evaluate((ws) => window.agente.setFolder(ws), WS);
  await page.reload(); await sleep(1800);
  check("carpeta restaurada en la píldora", (await page.textContent("#ws-label")) === path.basename(WS), await page.textContent("#ws-label"));
  await page.click("#ws-pill"); await sleep(250);
  check("menú de carpeta con ruta, cambiar y abrir", (await page.textContent("#menu #ws-path")) === WS && (await page.$$("#menu [data-act]")).length === 2);
  await page.click("#ws-pill"); await sleep(150);
  check("sin tarjeta de carpeta ni gasto en la barra lateral", !(await page.$("aside #pick")) && !(await page.$("aside #cost")) && (await page.$eval("#new-chat", (e) => e.classList.contains("flat"))));
  check("sin lista de skills en la barra lateral", !(await page.$("aside .skill")) && !(await page.$("#export")));
  await page.click("#open-config"); await sleep(400); await page.click('.cfg-nav [data-pane="skills"]'); await sleep(200);
  check("skills listadas en Configuración › Skills", (await page.$$("#skills .skill")).length === 1 && (await page.isVisible("#skills")));
  await page.click("#skills .skill"); await sleep(300);
  check("elegir skill cierra configuración e inserta /skill", !(await page.$eval("#overlay", (e) => e.classList.contains("open"))) && (await page.inputValue("#input")) === "/demo-skill ");
  await page.fill("#input", "");
  check("indicador Listo/Trabajando oculto", await page.isHidden("#status-text"));
  check("conversación inicial creada", (await page.$$("#convs .conv")).length === 1 && !!(await page.$(".thread.active .hero")));
  check("sugerencia oculta con 3 memorias", !(await page.isVisible(ACT("suggest"))) && (await page.isVisible(ACT("explore"))));
  // Clave de API: con .env la bienvenida no aparece; forzada, rechaza formatos inválidos sin llamar al SDK.
  check("bienvenida oculta con clave", !(await page.isVisible("#welcome")));
  await page.evaluate(() => window.Welcome.show()); await page.fill("#welcome-key", "abc"); await page.click("#welcome-save"); await sleep(300);
  check("bienvenida rechaza formato inválido", (await page.isVisible("#welcome")) && (await page.textContent("#welcome-status")).includes("formato"));
  await page.evaluate(() => window.Welcome.hide());
};
