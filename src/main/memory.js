// Skills (.claude/skills), memoria (CLAUDE.md) y perfil observado (.claude/perfil.json).
const path = require("path");
const fs = require("fs");
const os = require("os");

const SUGGEST_MIN = 5; // memorias mínimas para ofrecer "Obtener sugerencia"
const MEMORY_TEMPLATE = "# Memoria del agente\n\n## Perfil\n\n## Memoria\n";

// Instrucciones que se añaden al system prompt del SDK.
const SYSTEM_APPEND = `
Trabajas dentro de la carpeta del usuario. Reglas para skills:
- Una skill vive en .claude/skills/<nombre>/SKILL.md dentro de la carpeta actual,
  con frontmatter YAML (name, description) y debajo el workflow paso a paso.
- Si el usuario pide crear una skill ("quiero que cuando llame a X haga..."),
  escribe ese archivo con la herramienta Write. Si la skill ya existe, edítala.
- La "description" debe explicar cuándo usarla; el modelo la usa para invocarla.
- Si el usuario refina una skill existente, modifica el SKILL.md en vez de crear otra.

Memoria persistente (CLAUDE.md de la carpeta se carga automáticamente en cada sesión):
- Cuando el usuario te corrija o exprese una preferencia estable, guárdala de inmediato:
  * Si es sobre cómo se comporta una skill, edita el SKILL.md de esa skill.
  * Si es general (estilo, formato, herramientas), añade una viñeta breve en CLAUDE.md
    bajo "## Memoria" (crea el archivo o la sección si no existen). Sin duplicar.
- Perfil: cuando descubras algo nuevo y estable sobre el tipo de trabajo del usuario,
  añade una viñeta bajo "## Perfil". Máximo una por respuesta.
- Al terminar, confirma en una frase qué guardaste y dónde (si guardaste algo).

Artifacts: si el usuario pide una página, dashboard, informe visual, presentación o cualquier
resultado que se vea mejor renderizado, genera un archivo HTML autónomo (CSS y JS inline, sin
recursos externos) en artifacts/<nombre-corto>.html dentro de la carpeta. La app lo mostrará
en un panel de vista previa automáticamente.

Responde en español y de forma breve.
`;

function readSkills(dir, scope) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const file = path.join(dir, name, "SKILL.md");
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, "utf8");
    const fm = /^---\s*([\s\S]*?)\s*---/.exec(text);
    const get = (k) => fm && (new RegExp(`^${k}:\\s*(.+)$`, "m").exec(fm[1]) || [])[1];
    out.push({ name: (get("name") || name).trim(), description: (get("description") || "").trim(), scope, file });
  }
  return out;
}
function listSkills(folder) {
  return [
    ...(folder ? readSkills(path.join(folder, ".claude", "skills"), "proyecto") : []),
    ...readSkills(path.join(os.homedir(), ".claude", "skills"), "global"),
  ];
}

// Viñetas bajo "## <titulo>" de un markdown.
function sectionBullets(text, title) {
  const re = new RegExp(`^##\\s+${title}\\s*$([\\s\\S]*?)(?=^##\\s|(?![\\s\\S]))`, "m");
  const sec = re.exec(text);
  return sec
    ? sec[1].split(/\r?\n/).map((l) => l.trim()).filter((l) => /^[-*]\s/.test(l)).map((l) => l.replace(/^[-*]\s+/, ""))
    : [];
}

// Perfil observado por la app (sin gastar tokens).
const profilePath = (folder) => path.join(folder, ".claude", "perfil.json");
function loadProfile(folder) {
  try { return JSON.parse(fs.readFileSync(profilePath(folder), "utf8")); } catch { return { ext: {}, tools: {}, turns: 0 }; }
}
function saveProfile(folder, p) {
  try {
    fs.mkdirSync(path.dirname(profilePath(folder)), { recursive: true });
    fs.writeFileSync(profilePath(folder), JSON.stringify(p, null, 2));
  } catch { /* carpeta de solo lectura */ }
}
function noteExt(p, file) {
  const ext = path.extname(file || "").toLowerCase();
  if (ext && ext.length <= 8) p.ext[ext] = (p.ext[ext] || 0) + 1;
}
const topExt = (p, n = 6) => Object.entries(p.ext || {}).sort((a, b) => b[1] - a[1]).slice(0, n);
function profileSummary(p) {
  const ext = topExt(p).map(([e, n]) => `${e} (${n})`).join(", ");
  if (!ext && !p.turns) return "";
  return `\nPerfil observado por la app: ${p.turns} tareas previas en esta carpeta` + (ext ? `; archivos más usados: ${ext}.` : ".");
}

function listMemory(folder) {
  if (!folder) return { file: null, memory: [], profile: [], ext: [], turns: 0, suggestReady: false, suggestMin: SUGGEST_MIN };
  const file = path.join(folder, "CLAUDE.md");
  const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const memory = sectionBullets(text, "Memoria");
  const profile = sectionBullets(text, "Perfil");
  const p = loadProfile(folder);
  return { file, memory, profile, ext: topExt(p), turns: p.turns || 0, suggestReady: memory.length + profile.length >= SUGGEST_MIN, suggestMin: SUGGEST_MIN };
}
function readMemoryFile(folder) {
  if (!folder) return { file: null, text: "" };
  const file = path.join(folder, "CLAUDE.md");
  return { file, text: fs.existsSync(file) ? fs.readFileSync(file, "utf8") : MEMORY_TEMPLATE };
}
function writeMemoryFile(folder, text) {
  if (!folder) throw new Error("Primero elige una carpeta.");
  fs.writeFileSync(path.join(folder, "CLAUDE.md"), text, "utf8");
  return true;
}

module.exports = { SYSTEM_APPEND, listSkills, listMemory, readMemoryFile, writeMemoryFile, loadProfile, saveProfile, noteExt, profileSummary, sectionBullets };
