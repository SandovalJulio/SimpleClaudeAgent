// Historial de sesiones del SDK: lista de la carpeta actual (con nombre y fijado guardados en config)
// y transcripción simplificada de una sesión para repintar el hilo al reanudar.
const path = require("path");
const { listSessions, getSessionMessages } = require("@anthropic-ai/claude-agent-sdk");
const cfg = require("./config");

async function list() {
  const dir = cfg.getFolder();
  let list = await listSessions({ dir, limit: 30 });
  if (!list.length) {
    // Respaldo: rutas con nombre corto de Windows (JULIOC~1) no casan por `dir`; filtramos por cwd.
    const norm = (p) => path.resolve(p).replace(/[\\/]+$/, "").toLowerCase();
    list = (await listSessions({ limit: 300 })).filter((s) => s.cwd && norm(s.cwd) === norm(dir)).slice(0, 30);
  }
  // Nombre personalizado y fijado guardados en config (fijadas primero, luego por fecha).
  const meta = cfg.getConfig().convMeta || {};
  return list
    .map((s) => ({ sessionId: s.sessionId, summary: s.summary, lastModified: s.lastModified, title: meta[s.sessionId]?.title || null, pinned: !!meta[s.sessionId]?.pinned }))
    .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
}

// Transcripción de una sesión guardada, simplificada para repintar el hilo al reanudar:
// [{ role: "user"|"assistant", uuid, text, tools: [{ id, name, input }] }]. Se omiten los mensajes de subagentes.
async function messages(sessionId) {
  let list = [];
  try { list = await getSessionMessages(sessionId, { dir: cfg.getFolder() }); } catch { /* sin transcripción */ }
  if (!list.length) { try { list = await getSessionMessages(sessionId); } catch { /* idem */ } }
  const out = [];
  for (const m of list) {
    if (m.parent_tool_use_id || (m.type !== "user" && m.type !== "assistant")) continue;
    const content = m.message?.content;
    const blocks = typeof content === "string" ? [{ type: "text", text: content }] : Array.isArray(content) ? content : [];
    const text = blocks.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
    const tools = blocks.filter((b) => b.type === "tool_use").map((b) => ({ id: b.id, name: b.name, input: b.input }));
    if (!text && !tools.length) continue; // p. ej. solo tool_result
    if (m.type === "user" && /^<(local-command|command-name|system-reminder)/.test(text)) continue; // mensajes internos del CLI
    out.push({ role: m.type, uuid: m.uuid, text, tools });
  }
  return out;
}

module.exports = { list, messages };
