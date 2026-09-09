// Área "conversaciones": paralelas, fijar, renombrar, cerrar, meta persistida, menú ⋯, búsqueda en historial.
module.exports = async ({ page, check, sleep }) => {
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
  // Menú ⋯ de la conversación: solo Compactar y Descargar, ambos deshabilitados sin sesión ni mensajes.
  await page.click("#conv-menu"); await sleep(250);
  check("menú de conversación: compactar y descargar", (await page.$$("#menu [data-act]")).length === 2 && (await page.$eval('#menu [data-act="compact"]', (e) => e.disabled)) && (await page.$eval('#menu [data-act="export"]', (e) => e.disabled)));
  await page.click("#conv-menu"); await sleep(150);
  // Buscar en historial (sin sesiones aún: muestra "Sin coincidencias")
  await page.fill("#history-search", "zzzz"); await sleep(200);
  check("búsqueda en historial filtra", (await page.textContent("#history")).includes("Sin coincidencias"));
  await page.fill("#history-search", "");
};
