// Prueba unitaria de los hooks (sin SDK ni tokens): bloqueo fuera de la carpeta y registro de cambios.
// Uso: node test/hooks.test.js
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { buildHooks, inside } = require("../src/main/hooks");

const folder = fs.mkdtempSync(path.join(os.tmpdir(), "agente-hooks-"));
const extra = fs.mkdtempSync(path.join(os.tmpdir(), "agente-extra-"));
const outside = path.join(os.tmpdir(), "fuera-" + Date.now() + ".txt");
const blocked = [];
const hooks = buildHooks({ folder, dirs: [extra], onBlocked: (t) => blocked.push(t) });
const pre = hooks.PreToolUse[0].hooks[0], post = hooks.PostToolUse[0].hooks[0];
const call = (fn, tool_name, tool_input, extraInput = {}) => fn({ hook_event_name: "PreToolUse", session_id: "s", transcript_path: "", cwd: folder, tool_name, tool_input, tool_use_id: "t1", ...extraInput }, "t1", { signal: new AbortController().signal });

(async () => {
  // inside(): igualdad, subcarpeta, mayúsculas (Windows) y fuera.
  assert.ok(inside(path.join(folder, "a.txt"), [folder]));
  assert.ok(inside(folder, [folder]));
  assert.ok(inside(path.join(folder.toUpperCase(), "sub", "b.md"), [folder]));
  assert.ok(!inside(outside, [folder]));
  assert.ok(!inside(folder + "-otro" + path.sep + "x", [folder]), "prefijo de nombre no cuenta como dentro");

  // PreToolUse: dentro de la carpeta y en el directorio adicional se permite; fuera se deniega con aviso.
  assert.deepStrictEqual(await call(pre, "Write", { file_path: "docs/a.md" }), {});
  assert.deepStrictEqual(await call(pre, "Edit", { file_path: path.join(extra, "b.md") }), {});
  assert.deepStrictEqual(await call(pre, "Bash", { command: "ls" }), {}, "sin ruta no se bloquea (el matcher ya filtra)");
  const deny = await call(pre, "Write", { file_path: outside });
  assert.strictEqual(deny.hookSpecificOutput.permissionDecision, "deny");
  assert.ok(deny.hookSpecificOutput.permissionDecisionReason.includes(outside));
  assert.strictEqual(blocked.length, 1);
  const denyNb = await call(pre, "NotebookEdit", { notebook_path: outside });
  assert.strictEqual(denyNb.hookSpecificOutput.permissionDecision, "deny");

  // PostToolUse: registra fecha, herramienta y ruta relativa; marca al subagente si lo hay.
  await call(post, "Write", { file_path: path.join(folder, "docs", "a.md") }, { hook_event_name: "PostToolUse", tool_response: {} });
  await call(post, "Edit", { file_path: "b.txt" }, { hook_event_name: "PostToolUse", tool_response: {}, agent_type: "redactor", agent_id: "x" });
  const log = fs.readFileSync(path.join(folder, ".claude", "cambios.log"), "utf8").trim().split("\n");
  assert.strictEqual(log.length, 2);
  assert.ok(/^\d{4}-\d{2}-\d{2}T.*\tWrite\tdocs[\\/]a\.md$/.test(log[0]), log[0]);
  assert.ok(/\tEdit\tb\.txt\t\(subagente redactor\)$/.test(log[1]), log[1]);

  fs.rmSync(folder, { recursive: true, force: true }); fs.rmSync(extra, { recursive: true, force: true });
  console.log("hooks.test.js: 14 comprobaciones OK");
})().catch((e) => { console.error("FALLA:", e.message); process.exit(1); });
