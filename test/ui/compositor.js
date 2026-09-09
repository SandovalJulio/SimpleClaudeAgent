// Área "compositor": tarjetas de inicio, menú "/", píldoras de modelo, razonamiento y permisos.
module.exports = async ({ page, check, sleep, ACT }) => {
  // Tarjetas de inicio: carrusel con puntos; se navega al punto (data-dot) antes de pulsar la tarjeta.
  const DOT = (a) => `.thread.active .dots [data-dot="${a}"]`;
  check("carrusel: una tarjeta visible y cinco puntos", (await page.$$eval(".thread.active .chips .chip", (els) => els.filter((e) => getComputedStyle(e).display !== "none").length)) === 1 && (await page.$$(".thread.active .dots [data-dot]")).length === 5);
  await page.click(".thread.active .dots [data-nav=\"1\"]"); await sleep(400);
  check("carrusel: flecha avanza", await page.$eval(".thread.active .chip.current", (e) => e.dataset.act === "create"));
  await page.click(DOT("create")); await page.click(ACT("create")); await sleep(300);
  const sel = await page.$eval("#input", (e) => e.value.slice(e.selectionStart, e.selectionEnd));
  check("crear skill rellena plantilla", (await page.inputValue("#input")).startsWith("Crea una skill llamada") && sel === "NOMBRE", sel);
  await page.click(DOT("improve")); await page.click(ACT("improve")); await sleep(300);
  check("mejorar skill abre menú", await page.$eval("#menu", (e) => e.classList.contains("open")));
  await page.click("#menu [data-skill]"); await sleep(200);
  check("elegir skill en mejorar", (await page.inputValue("#input")).startsWith("Mejora la skill /demo-skill"));
  await page.click(DOT("artifact")); await page.click(ACT("artifact")); await sleep(200);
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
};
