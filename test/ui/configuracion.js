// Área "configuración": modal, clave de API, memorias, tareas programadas, interruptores, límites, tema.
module.exports = async ({ page, check, sleep, ACT }) => {
  await page.click("#open-config"); await sleep(500);
  check("abre configuración", await page.$eval("#overlay", (e) => e.classList.contains("open")));
  check("clave de API tomada del entorno", (await page.evaluate(() => window.agente.apiKeyStatus())).source === "env" && (await page.textContent("#cfg-key-status")).includes("entorno") && (await page.isHidden("#cfg-key-clear")));
  check("memorias cargadas en editor", (await page.inputValue("#mem-edit")).includes("## Memoria"));
  check("tareas programadas montadas", (await page.$eval("#cfg-schedules", (e) => e.children.length)) > 0);
  // Tarea programada con esquema JSON desde el formulario (sin ejecutarla: eso gasta tokens).
  await page.click('#cfg-schedules [data-act="new"]'); await sleep(300);
  await page.fill("#sch-name", "Conteo"); await page.fill("#sch-prompt", "Cuenta los archivos.");
  await page.fill("#sch-schema", '{"type":"object","properties":{"total":{"type":"integer"}},"required":["total"]}');
  await page.click('#cfg-schedules [data-act="save"]'); await sleep(500);
  const tasks = await page.evaluate(() => window.agente.scheduleList());
  const t = tasks.find((x) => x.name === "Conteo");
  check("tarea con esquema guardada", !!t && t.schema?.properties?.total?.type === "integer" && (await page.textContent("#cfg-schedules")).includes("Salida estructurada"), JSON.stringify(t?.schema));
  check("tarea lista con botón Ejecutar ahora", (await page.$$('#cfg-schedules [data-act="run"]')).length === 1);
  page.once("dialog", (d) => d.accept());
  await page.click('#cfg-schedules [data-act="del"]'); await sleep(400);
  check("tarea eliminada", (await page.evaluate(() => window.agente.scheduleList())).length === 0);
  check("interruptores de subagentes y hooks activos por defecto", (await page.$$('[data-cfg="agents"].on, [data-cfg="hooks"].on')).length === 2);
  await page.click('[data-cfg="agents"]'); await sleep(300);
  check("desactivar subagentes se guarda", (await page.evaluate(async () => (await window.agente.getState()).config)).agents === false);
  await page.click('[data-cfg="agents"]'); await sleep(200);
  await page.fill("#cfg-name", "Julio"); await page.dispatchEvent("#cfg-name", "change"); await sleep(200);
  await page.fill("#cfg-budget", "2.5"); await page.dispatchEvent("#cfg-budget", "change"); await sleep(200);
  await page.click('[data-cfg="web"]'); await sleep(300);
  const cfg = await page.evaluate(async () => (await window.agente.getState()).config);
  check("config guardada (nombre, tope, web)", cfg.name === "Julio" && cfg.maxBudgetUsd === 2.5 && cfg.web === false, JSON.stringify({ n: cfg.name, b: cfg.maxBudgetUsd, w: cfg.web }));
  await page.click('[data-cfg="web"]'); await sleep(200);
  const txt = (await page.inputValue("#mem-edit")) + "- usa tablas\n- formato breve\n";
  await page.fill("#mem-edit", txt); await page.click("#mem-save"); await sleep(400);
  check("guardar memorias", (await page.textContent("#mem-status")) === "Guardado.");
  await page.click('#theme-seg [data-theme="dark"]'); await sleep(200);
  check("tema oscuro", await page.$eval("html", (e) => e.classList.contains("dark")));
  await page.click('#theme-seg [data-theme="system"]');
  await page.click("#close-config"); await sleep(800);
  check("sugerencia visible con 5 memorias", (await page.isVisible(ACT("suggest"))) && !(await page.isVisible(ACT("explore"))));
};
