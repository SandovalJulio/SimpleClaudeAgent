// Prueba del planificador. Node puro, sin frameworks:  node test/scheduler.test.js
"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const scheduler = require("../src/main/scheduler.js");

const folder = fs.mkdtempSync(path.join(os.tmpdir(), "sched-test-"));
const config = { schedules: [] };

let saved = 0;
const emitted = [];
const notified = [];
const prompts = [];

scheduler.start({
  getConfig: () => config,
  saveConfig: () => {
    saved++;
  },
  runOnce: async (prompt) => {
    prompts.push(prompt);
    return { ok: true, text: "Resultado de prueba: todo en orden.", cost: 0.0123 };
  },
  notify: (title, body) => notified.push({ title, body }),
  emit: (event, data) => emitted.push({ event, data }),
  getFolder: () => folder,
});

function ok(msg) {
  console.log("  ok - " + msg);
}

(async function main() {
  // --- crear tarea "hour" -------------------------------------------------
  const before = new Date();
  let list = scheduler.save({ name: "Revisión horaria", prompt: "Dime la hora.", every: "hour" });
  assert.strictEqual(list.length, 1, "debe haber una tarea");

  const task = list[0];
  assert.ok(task.id, "la tarea recibe un id");
  assert.strictEqual(task.enabled, true, "la tarea nace habilitada");
  assert.strictEqual(task.lastRun, null, "aún no se ha ejecutado");
  ok("save() crea la tarea con id y valores por defecto");

  // nextRun = siguiente hora en punto
  const next = new Date(task.nextRun);
  assert.strictEqual(next.getMinutes(), 0, "nextRun cae en minuto 0");
  assert.strictEqual(next.getSeconds(), 0, "nextRun cae en segundo 0");
  assert.strictEqual(next.getMilliseconds(), 0, "nextRun sin milisegundos");
  assert.ok(next.getTime() > before.getTime(), "nextRun está en el futuro");
  const esperada = new Date(before.getTime());
  esperada.setMinutes(0, 0, 0);
  esperada.setHours(esperada.getHours() + 1);
  assert.strictEqual(next.getTime(), esperada.getTime(), "nextRun es la siguiente hora en punto");
  ok('every:"hour" -> nextRun es la siguiente hora en punto');

  assert.ok(saved > 0, "saveConfig() se llamó al guardar");
  ok("save() persiste la configuración");

  // --- validación ---------------------------------------------------------
  assert.throws(() => scheduler.save({ name: "", prompt: "x", every: "hour" }), /nombre/i);
  assert.throws(() => scheduler.save({ name: "x", prompt: "", every: "hour" }), /instrucción/i);
  assert.throws(() => scheduler.save({ name: "x", prompt: "y", every: "nunca" }), /frecuencia/i);
  assert.throws(() => scheduler.save({ name: "x", prompt: "y", every: "day", at: "25:00" }), /HH:MM/);
  assert.throws(
    () => scheduler.save({ name: "x", prompt: "y", every: "week", at: "09:00", weekday: 9 }),
    /día de la semana/i
  );
  ok("save() valida nombre, prompt, frecuencia, hora y día de la semana");

  // --- frecuencias day / week --------------------------------------------
  const diaria = scheduler.computeNext({ every: "day", at: "09:30" }, new Date("2026-09-08T10:00:00"));
  assert.strictEqual(diaria.getHours(), 9);
  assert.strictEqual(diaria.getMinutes(), 30);
  assert.strictEqual(diaria.getDate(), 9, "si ya pasó la hora, se va al día siguiente");

  const semanal = scheduler.computeNext(
    { every: "week", at: "09:00", weekday: 1 }, // lunes
    new Date("2026-09-08T10:00:00") // martes
  );
  assert.strictEqual(semanal.getDay(), 1, "cae en lunes");
  assert.strictEqual(semanal.getHours(), 9);
  assert.ok(semanal > new Date("2026-09-08T10:00:00"), "en el futuro");
  ok("computeNext() resuelve day y week correctamente");

  // --- run(id) ------------------------------------------------------------
  const res = await scheduler.run(task.id);
  assert.strictEqual(res.ok, true, "la ejecución fue correcta");
  assert.deepStrictEqual(prompts, ["Dime la hora."], "runOnce recibió el prompt");

  const logFile = path.join(folder, ".claude", "programadas", task.id + ".md");
  assert.ok(fs.existsSync(logFile), "el .md se escribió en .claude/programadas");
  const contenido = fs.readFileSync(logFile, "utf8");
  assert.ok(contenido.indexOf("## ") === 1 || contenido.indexOf("\n## ") === 0, "bloque con encabezado");
  assert.ok(contenido.indexOf("Revisión horaria") >= 0, "el encabezado lleva el nombre");
  assert.ok(contenido.indexOf("Resultado de prueba") >= 0, "el cuerpo lleva el texto del resultado");
  ok("run() escribe el registro en <carpeta>/.claude/programadas/<id>.md");

  const done = emitted.filter((e) => e.event === "schedule:done");
  assert.strictEqual(done.length, 1, "se emitió schedule:done una vez");
  const payload = done[0].data;
  assert.strictEqual(payload.id, task.id);
  assert.strictEqual(payload.name, "Revisión horaria");
  assert.strictEqual(payload.ok, true);
  assert.strictEqual(payload.cost, 0.0123);
  assert.ok(payload.summary.length > 0 && payload.summary.length <= 200, "resumen de máx. 200 letras");
  assert.strictEqual(payload.logFile, logFile);
  ok("run() emite schedule:done con el payload esperado");

  assert.strictEqual(notified.length, 1, "se notificó al sistema");
  assert.strictEqual(notified[0].title, "Revisión horaria");
  ok("run() lanza la notificación del sistema");

  const actual = scheduler.list()[0];
  assert.ok(actual.lastRun, "lastRun quedó registrado");
  assert.ok(new Date(actual.nextRun) > new Date(), "nextRun se recalculó al futuro");
  ok("run() actualiza lastRun y nextRun");

  // --- resumen recortado a 200 letras -------------------------------------
  const largo = "x".repeat(500);
  const t2 = scheduler.save({ name: "Larga", prompt: "p", every: "hour" });
  const id2 = t2[t2.length - 1].id;
  const antes = emitted.length;
  // Sustituye runOnce para esta ejecución.
  scheduler.start({
    getConfig: () => config,
    saveConfig: () => {},
    runOnce: async () => ({ ok: true, text: largo, cost: 0 }),
    notify: (t, b) => notified.push({ title: t, body: b }),
    emit: (e, d) => emitted.push({ event: e, data: d }),
    getFolder: () => folder,
  });
  await scheduler.run(id2);
  const p2 = emitted.slice(antes).filter((e) => e.event === "schedule:done").pop().data;
  assert.strictEqual(p2.summary.length, 200, "el resumen se recorta a 200 letras");
  ok("el resumen se limita a 200 letras");

  // --- tareas vencidas no se acumulan -------------------------------------
  const pendiente = scheduler.list().find((t) => t.id === id2);
  pendiente.nextRun = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(); // 5 h tarde
  const disparadas = scheduler.tick();
  assert.deepStrictEqual(disparadas, [id2], "la tarea vencida se dispara una sola vez");
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  assert.deepStrictEqual(scheduler.tick(), [], "tras ejecutarse ya no vuelve a dispararse");
  ok("las ejecuciones perdidas no se acumulan");

  // --- esquema JSON: salida estructurada en .md y .jsonl ------------------
  const schemaTxt = '{"type":"object","properties":{"resumen":{"type":"string"},"pendientes":{"type":"integer"}},"required":["resumen"]}';
  assert.throws(() => scheduler.save({ name: "Mal", prompt: "p", every: "hour", schema: "{no es json" }), /esquema JSON/, "esquema inválido rechazado");
  const t3 = scheduler.save({ name: "Estructurada", prompt: "Cuenta pendientes.", every: "hour", schema: schemaTxt });
  const task3 = t3[t3.length - 1];
  assert.strictEqual(task3.schema.type, "object", "el esquema se guarda parseado");
  let schemaRecibido = null;
  scheduler.start({
    getConfig: () => config, saveConfig: () => {}, getFolder: () => folder,
    runOnce: async (prompt, opts) => { schemaRecibido = opts.schema; return { ok: true, text: "Hecho.", cost: 0.001, structured: { resumen: "Dos pendientes", pendientes: 2 } }; },
    notify: () => {}, emit: (e, d) => emitted.push({ event: e, data: d }),
  });
  await scheduler.run(task3.id);
  await scheduler.run(task3.id);
  assert.deepStrictEqual(schemaRecibido, JSON.parse(schemaTxt), "runOnce recibe el esquema");
  const md = fs.readFileSync(path.join(folder, ".claude", "programadas", task3.id + ".md"), "utf8");
  assert.ok(md.includes('"pendientes": 2') && md.includes("Hecho."), "el .md incluye el JSON y el texto");
  const jsonl = fs.readFileSync(path.join(folder, ".claude", "programadas", task3.id + ".jsonl"), "utf8").trim().split("\n");
  assert.strictEqual(jsonl.length, 2, "una línea por ejecución en el .jsonl");
  const fila = JSON.parse(jsonl[1]);
  assert.strictEqual(fila.name, "Estructurada");
  assert.deepStrictEqual(fila.data, { resumen: "Dos pendientes", pendientes: 2 });
  assert.ok(!isNaN(Date.parse(fila.at)), "cada línea lleva fecha ISO");
  ok("esquema JSON: salida estructurada en .md y .jsonl");

  // --- remove -------------------------------------------------------------
  const quedan = scheduler.remove(task.id);
  assert.ok(!quedan.some((t) => t.id === task.id), "la tarea se eliminó");
  ok("remove() elimina la tarea");

  scheduler.stop();
  fs.rmSync(folder, { recursive: true, force: true });
  console.log("\nscheduler.test.js: todas las comprobaciones pasaron.");
})().catch((e) => {
  console.error("\nFALLÓ:", e && e.message);
  console.error(e);
  process.exit(1);
});
