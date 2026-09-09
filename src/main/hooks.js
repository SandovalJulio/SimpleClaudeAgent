// Hooks del SDK (opción `hooks`): bloquear escrituras fuera de la carpeta de trabajo y de los
// directorios adicionales (PreToolUse) y registrar cada archivo modificado en
// <carpeta>/.claude/cambios.log (PostToolUse) con fecha, herramienta y ruta.
const path = require("path");
const fs = require("fs");

const WRITE_MATCHER = "Write|Edit|MultiEdit|NotebookEdit";

// Ruta absoluta del archivo que toca la herramienta (Write/Edit usan file_path; NotebookEdit, notebook_path).
function targetPath(cwd, input = {}) {
  const p = input.file_path || input.notebook_path;
  return p ? path.resolve(cwd || process.cwd(), String(p)) : null;
}
const norm = (p) => path.resolve(p).replace(/[\\/]+$/, "").toLowerCase();
function inside(abs, roots) {
  const a = norm(abs);
  return roots.filter(Boolean).some((r) => { const n = norm(r); return a === n || a.startsWith(n + path.sep); });
}

// { folder, dirs, onBlocked(texto) } -> objeto `hooks` para las opciones del SDK.
function buildHooks({ folder, dirs = [], onBlocked = () => {} }) {
  const roots = [folder, ...dirs];

  async function guardWrite(input) {
    const abs = targetPath(input.cwd || folder, input.tool_input);
    if (!abs || inside(abs, roots)) return {};
    const reason = `Escritura bloqueada fuera de la carpeta de trabajo: ${abs}. Añade esa carpeta en Configuración › Directorios adicionales si quieres permitirla.`;
    try { onBlocked(reason); } catch { /* el aviso no debe romper el hook */ }
    return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } };
  }

  async function logChange(input) {
    const abs = targetPath(input.cwd || folder, input.tool_input);
    if (!abs || !folder) return {};
    const rel = path.relative(folder, abs) || abs;
    const who = input.agent_type ? `\t(subagente ${input.agent_type})` : "";
    const line = `${new Date().toISOString()}\t${input.tool_name}\t${rel}${who}\n`;
    try {
      const file = path.join(folder, ".claude", "cambios.log");
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.appendFileSync(file, line, "utf8");
    } catch { /* carpeta de solo lectura: no es crítico */ }
    return {};
  }

  return {
    PreToolUse: [{ matcher: WRITE_MATCHER, hooks: [guardWrite], timeout: 10 }],
    PostToolUse: [{ matcher: WRITE_MATCHER, hooks: [logChange], timeout: 10 }],
  };
}

module.exports = { buildHooks, targetPath, inside, WRITE_MATCHER };
