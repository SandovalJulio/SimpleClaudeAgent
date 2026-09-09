// Área "live" (UI_TEST_LIVE=1): consultas reales con Haiku. Permiso interactivo, archivo, diferencias, rewind,
// hook de registro, sugerencia, compactar, historial con nombre persistido, hook de bloqueo y subagente.
const fs = require("fs");
const os = require("os");
const path = require("path");

module.exports = async ({ page, check, sleep, WS, ACT }) => {
  const waitDone = async (max) => { for (let i = 0; i < max; i++) { await sleep(1000); if ((await page.$$(".thread.active .usage")).length > 0) return true; } return false; };

  // 1) Permiso interactivo: modo Preguntar + crear archivo -> tarjeta de permiso -> Permitir -> chip de archivo.
  await page.click("#perm-pill"); await sleep(200); await page.click('#menu [data-perm="default"]'); await sleep(400);
  await page.fill("#input", "Crea el archivo hola.txt en esta carpeta con el texto: hola mundo. Solo eso, sin explicaciones.");
  await page.keyboard.press("Enter");
  let card = null;
  for (let i = 0; i < 60 && !card; i++) { await sleep(1000); card = await page.$(".thread.active [class*='dlg-']"); }
  check("aparece tarjeta de permiso", !!card);
  if (card) { await page.getByRole("button", { name: "Permitir", exact: true }).first().click(); }
  check("turno con permiso completado", await waitDone(90));
  check("archivo creado en disco", fs.existsSync(path.join(WS, "hola.txt")));
  const changeLog = fs.existsSync(path.join(WS, ".claude", "cambios.log")) ? fs.readFileSync(path.join(WS, ".claude", "cambios.log"), "utf8") : "";
  check("hook registra el cambio en cambios.log", /\tWrite\thola\.txt/.test(changeLog), changeLog.trim().split("\n").pop());
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
  await page.click('.thread.active .dots [data-dot="suggest"]'); await page.click(ACT("suggest"));
  const done = await waitDone(120);
  const md = await page.$eval(".thread.active .msg.assistant .md", (e) => e.innerText).catch(() => "");
  check("consulta de sugerencia completada", done, (await page.$eval(".thread.active .usage", (e) => e.innerText).catch(() => "")).replace(/\s+/g, " ").slice(0, 100));
  check("respuesta con contenido", md.length > 40, md.slice(0, 80).replace(/\n/g, " "));
  // Compactar conversación (comando /compact del SDK): aviso de compactación en el hilo y vuelve a "Listo".
  await page.click("#conv-menu"); await sleep(250); await page.click('#menu [data-act="compact"]');
  let compacted = false;
  for (let i = 0; i < 90 && !compacted; i++) { await sleep(1000); compacted = (await page.$$(".thread.active .notice")).length > 0 && !(await page.$eval("#send", (e) => e.classList.contains("stop"))); }
  // Con dos turnos el SDK suele responder que la conversación es demasiado corta; ambas salidas prueban el comando.
  const compactMsg = await page.textContent(".thread.active .notice").catch(() => "sin aviso");
  check("compactar conversación (comando /compact procesado)", compacted && /compactada|demasiado corta/.test(compactMsg), compactMsg.slice(0, 90));
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

  // 3) Hook de bloqueo: una escritura fuera de la carpeta se deniega y deja aviso en el hilo.
  const outside = path.join(os.tmpdir(), "agente-fuera-" + Date.now() + ".txt");
  await page.click("#new-chat"); await sleep(600);
  await page.fill("#input", `Usa la herramienta Write para crear el archivo ${outside} con el texto "prueba". Si la herramienta lo rechaza, no intentes otra forma: di en una frase que fue bloqueado.`);
  await page.keyboard.press("Enter");
  check("turno de escritura externa completado", await waitDone(90));
  check("hook bloquea la escritura fuera de la carpeta", !fs.existsSync(outside) && (await page.$$(".thread.active .notice.warn")).length >= 1, (await page.textContent(".thread.active .notice.warn").catch(() => "sin aviso")).slice(0, 90));

  // 4) Subagente "lector": sus pasos aparecen sangrados en la línea de actividad.
  await page.click("#new-chat"); await sleep(600);
  await page.fill("#input", "Delega en el subagente lector (herramienta Agent, subagent_type lector) que liste los archivos de esta carpeta y espera su resultado. Después responde en una sola frase.");
  await page.keyboard.press("Enter");
  check("turno con subagente completado", await waitDone(150));
  // El subagente corre en segundo plano: sus pasos pueden llegar justo después del resultado del turno.
  let agentSteps = [];
  for (let i = 0; i < 30 && !agentSteps.length; i++) { agentSteps = await page.$$(".thread.active .step.sub"); if (!agentSteps.length) await sleep(1000); }
  check("pasos del subagente marcados en la actividad", agentSteps.length >= 1, `${agentSteps.length} pasos sub; agente: ${await page.textContent(".thread.active .step.sub .agent").catch(() => "-")}`);
};
