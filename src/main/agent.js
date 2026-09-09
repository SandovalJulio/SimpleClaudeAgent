// Conversaciones sobre el Claude Agent SDK.
// Cada conversación es una query en modo streaming-input: el proceso del SDK queda vivo,
// se le encolan mensajes de usuario y permite interrupt / setModel / setPermissionMode / rewindFiles.
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const Diff = require("diff");
const { query, listSessions } = require("@anthropic-ai/claude-agent-sdk");
const cfg = require("./config");
const mem = require("./memory");

const convs = new Map();   // convId -> conv
const pending = new Map(); // reqId -> resolve (diálogos esperando al usuario)
const mcpStatus = new Map(); // nombre de servidor -> estado (último conocido)
const IMAGE_EXT = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp" };
const MAX_IMAGE = 5 * 1024 * 1024;
let emit = () => {};       // (evento, datos) -> renderer
let notify = () => {};     // (titulo, cuerpo)

function init({ emit: e, notify: n }) { emit = e; notify = n; }

const WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);

// Entorno para el proceso del CLI. Si la app se lanza desde dentro de Claude Code (o de la prueba
// que corre ahí), hereda CLAUDECODE / CLAUDE_CODE_* y el CLI se comporta como sesión hija: usa el
// login OAuth del padre e ignora ANTHROPIC_API_KEY. Se quitan para que la clave de la app mande.
function cleanEnv(extra = {}) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!/^(CLAUDECODE|CLAUDE_CODE_|CLAUDE_PID$|CLAUDE_EFFORT$|CLAUDE_AGENT_SDK_VERSION$|AI_AGENT$)/.test(k)) env[k] = v;
  return { ...env, ...extra };
}

// ---------- Opciones del SDK ----------
function buildOptions(conv, { resume, fork, oneShot } = {}) {
  const folder = cfg.getFolder();
  const config = cfg.getConfig();
  const { model, effort, permission } = cfg.settings;
  const profile = conv.profile;

  const active = cfg.CONNECTIONS.filter((c) => cfg.connState(c.id).enabled);
  const mcpServers = Object.fromEntries(active.map((c) => [c.id, cfg.mcpServerFor(c, cfg.connValues(c.id))]));
  const tools = ["Read", "Glob", "Grep", "Skill", "Write", "Edit", "Bash", "AskUserQuestion", "ExitPlanMode", "TodoWrite"];
  if (config.web) tools.push("WebSearch", "WebFetch");
  tools.push(...active.map((c) => `mcp__${c.id}`));
  // En "Preguntar" solo las herramientas de lectura van preaprobadas; el resto pasa por canUseTool.
  const allowedTools = permission === "default" ? tools.filter((t) => !WRITE_TOOLS.has(t) && t !== "Bash") : tools;

  const append = mem.SYSTEM_APPEND +
    (config.name ? `\nEl usuario se llama ${config.name}; dirígete a él por su nombre cuando sea natural.` : "") +
    mem.profileSummary(profile);

  return {
    model, effort, cwd: folder, env: cleanEnv(),
    settingSources: ["user", "project"],
    systemPrompt: { type: "preset", preset: "claude_code", append },
    allowedTools,
    permissionMode: permission,
    ...(permission === "bypassPermissions" ? { allowDangerouslySkipPermissions: true } : {}),
    canUseTool: oneShot ? undefined : (name, input, opts) => canUseTool(conv, name, input, opts),
    onElicitation: oneShot ? undefined : (req) => ask(conv, "elicitation", req).then((r) => (r?.action ? r : { action: "cancel" })),
    includePartialMessages: true,
    enableFileCheckpointing: true,
    promptSuggestions: !oneShot,
    agentProgressSummaries: true,
    ...(config.maxBudgetUsd > 0 ? { maxBudgetUsd: config.maxBudgetUsd } : {}),
    ...(config.maxTurns > 0 ? { maxTurns: config.maxTurns } : {}),
    ...(config.sandbox ? { sandbox: { enabled: true, failIfUnavailable: false } } : {}),
    ...(config.plugins.length ? { plugins: config.plugins.map((p) => ({ type: "local", path: p })) } : {}),
    ...(config.dirs.length ? { additionalDirectories: config.dirs } : {}),
    ...(active.length ? { mcpServers } : {}),
    ...(resume ? { resume, forkSession: !!fork } : {}),
    abortController: conv.abort,
  };
}

// ---------- Diálogos con el usuario (permisos, preguntas, plan, elicitación) ----------
function ask(conv, kind, payload) {
  const reqId = crypto.randomUUID();
  return new Promise((resolve) => {
    pending.set(reqId, resolve);
    emit("conv:ask", { convId: conv.id, reqId, kind, payload });
  });
}
function reply({ reqId, ...answer }) {
  const r = pending.get(reqId);
  if (r) { pending.delete(reqId); r(answer); }
}
function toolSummary(name, input = {}) {
  if (input.file_path) return input.file_path;
  if (name === "Bash") return input.description || input.command || "";
  if (input.pattern) return input.pattern;
  return JSON.stringify(input).slice(0, 120);
}
async function canUseTool(conv, toolName, input, { suggestions } = {}) {
  const deny = (message) => ({ behavior: "deny", message });
  if (toolName === "AskUserQuestion") {
    const r = await ask(conv, "question", { questions: input.questions || [] });
    if (!r || r.cancel || !r.answers) return deny("El usuario no respondió las preguntas.");
    return { behavior: "allow", updatedInput: { ...input, answers: r.answers } };
  }
  if (toolName === "ExitPlanMode") {
    const r = await ask(conv, "plan", { plan: input.plan || "" });
    if (!r?.approve) return deny(r?.message || "El usuario rechazó el plan.");
    // Aprobado: pasar al modo de ejecución para el resto de la conversación.
    const next = cfg.settings.permission === "plan" ? "acceptEdits" : cfg.settings.permission;
    try { await conv.q.setPermissionMode(next); } catch { /* ignorar */ }
    emit("conv:mode", { convId: conv.id, permission: next });
    return { behavior: "allow", updatedInput: input };
  }
  const r = await ask(conv, "permission", { toolName, input, summary: toolSummary(toolName, input), canAlways: !!(suggestions && suggestions.length) });
  if (!r?.allow) return deny(r?.message || "El usuario rechazó la acción.");
  return { behavior: "allow", updatedInput: input, ...(r.always && suggestions ? { updatedPermissions: suggestions } : {}) };
}

// ---------- Clave de API ----------
const AUTH_ERRORS = {
  authentication_failed: "La clave no es válida o fue revocada.",
  billing_error: "La cuenta tiene un problema de facturación o no tiene crédito.",
  account_on_hold: "La cuenta está suspendida.",
  rate_limit: "Límite de tasa alcanzado; prueba en unos minutos.",
  overloaded: "La API está saturada; prueba en unos minutos.",
};
// Comprueba una clave con la consulta más pequeña posible: Haiku, un turno, sin herramientas ni ajustes.
// El CLI reintenta los 401 con espera creciente (minutos), así que se aborta al primer reintento por autenticación.
async function validateApiKey(key) {
  key = String(key || "").trim();
  if (!/^\S{20,}$/.test(key)) return { ok: false, error: "La clave no tiene un formato válido." };
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 45000);
  let failure = null;
  try {
    const q = query({ prompt: "Responde únicamente: ok", options: {
      model: cfg.MODELS[0].id, maxTurns: 1, tools: [], settingSources: [], systemPrompt: "Responde solo con la palabra ok.",
      persistSession: false, env: cleanEnv({ ANTHROPIC_API_KEY: key }), abortController: abort,
    } });
    for await (const m of q) {
      if (m.type === "system" && m.subtype === "init" && m.apiKeySource !== "ANTHROPIC_API_KEY") failure = "El SDK no usó la clave indicada (origen: " + m.apiKeySource + ").";
      if (m.type === "system" && m.subtype === "api_retry" && (m.error in AUTH_ERRORS || m.error === "invalid_request" || m.attempt >= 3)) failure = AUTH_ERRORS[m.error] || `Sin respuesta válida de la API (${m.error}, HTTP ${m.error_status || "?"}).`;
      if (m.type === "assistant" && m.error) failure = AUTH_ERRORS[m.error] || m.error;
      if (failure) { abort.abort(); break; }
      if (m.type === "result") return m.subtype === "success" && !m.is_error ? { ok: true } : { ok: false, error: (m.result || m.subtype || "").slice(0, 200) };
    }
    return { ok: false, error: failure || "El SDK no respondió." };
  } catch (e) {
    if (failure) return { ok: false, error: failure };
    return { ok: false, error: abort.signal.aborted ? "Tiempo de espera agotado (¿hay conexión?)." : String(e.message || e) };
  } finally { clearTimeout(timer); }
}

// ---------- Conversaciones ----------
function create({ resume, fork } = {}) {
  const folder = cfg.getFolder();
  if (!folder) throw new Error("Primero elige una carpeta de trabajo.");
  if (!cfg.apiKeyStatus().has) throw new Error("Falta la clave de API. Añádela en Configuración.");
  const id = crypto.randomUUID();
  const queue = []; let wake = null; let closed = false;
  async function* input() {
    while (!closed) {
      if (queue.length) yield queue.shift();
      else await new Promise((r) => (wake = r));
    }
  }
  const conv = {
    id, folder, sessionId: null, busy: false, closed: false,
    abort: new AbortController(), profile: mem.loadProfile(folder),
    turn: null,        // { userUuid, files:Set, before:{ruta: texto|null} }
    snapshots: new Map(), // userUuid -> { before, after } para ver diferencias
    push(msg) { queue.push(msg); const w = wake; wake = null; w?.(); },
    close(reason = "closed") {
      if (closed) return;
      closed = true; conv.closed = true;
      const w = wake; wake = null; w?.();
      try { conv.q.close(); } catch { /* ya cerrado */ }
      convs.delete(id);
      emit("conv:closed", { convId: id, reason });
    },
  };
  conv.q = query({ prompt: input(), options: buildOptions(conv, { resume, fork }) });
  convs.set(id, conv);
  pump(conv).catch((e) => {
    emit("conv:result", { convId: id, subtype: "error", error: String(e.message || e) });
    conv.close("error");
  });
  return { convId: id };
}

function send({ convId, text, files = [] }) {
  const conv = convs.get(convId);
  if (!conv) throw new Error("La conversación ya no existe.");
  // Imágenes pequeñas van como bloques de imagen reales; el resto, como rutas para Read.
  const images = [], others = [];
  for (const f of files) {
    mem.noteExt(conv.profile, f);
    const mime = IMAGE_EXT[path.extname(f).toLowerCase()];
    let size = 0; try { size = fs.statSync(f).size; } catch { /* no existe */ }
    (mime && size > 0 && size <= MAX_IMAGE ? images : others).push(f);
  }
  let prompt = text;
  if (others.length) prompt += "\n\nArchivos adjuntos por el usuario (léelos si son relevantes):\n" + others.map((f) => "- " + f).join("\n");
  if (images.length) prompt += "\n\n(El usuario adjuntó " + images.length + " imagen(es), incluidas en este mensaje.)";
  const content = images.length
    ? [{ type: "text", text: prompt }, ...images.map((f) => ({ type: "image", source: { type: "base64", media_type: IMAGE_EXT[path.extname(f).toLowerCase()], data: fs.readFileSync(f).toString("base64") } }))]
    : prompt;
  const uuid = crypto.randomUUID();
  conv.turn = { userUuid: uuid, files: new Set(), before: {}, started: Date.now() };
  conv.busy = true;
  emit("conv:busy", { convId, busy: true });
  emit("conv:user", { convId, uuid, text, files });
  conv.push({ type: "user", uuid, session_id: conv.sessionId || "", parent_tool_use_id: null, message: { role: "user", content } });
  return true;
}

async function pump(conv) {
  for await (const m of conv.q) {
    const convId = conv.id;
    if (m.type === "system" && m.subtype === "init") {
      conv.sessionId = m.session_id;
      for (const s of m.mcp_servers || []) mcpStatus.set(s.name, s.status);
      emit("conv:init", { convId, sessionId: m.session_id });
      emit("mcp:status", statusList());
    } else if (m.type === "system" && m.subtype === "task_progress") {
      emit("conv:progress", { convId, text: m.summary || m.description || "" });
    } else if (m.type === "stream_event") {
      const ev = m.event;
      if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") emit("conv:delta", { convId, text: ev.delta.text });
    } else if (m.type === "assistant") {
      for (const block of m.message.content) {
        if (block.type !== "tool_use") continue;
        conv.profile.tools[block.name] = (conv.profile.tools[block.name] || 0) + 1;
        const fp = block.input?.file_path;
        if (fp) {
          mem.noteExt(conv.profile, fp);
          if (WRITE_TOOLS.has(block.name) && conv.turn) {
            const abs = path.resolve(conv.folder, fp);
            conv.turn.files.add(abs);
            // Instantánea "antes": el tool_use llega antes de que la herramienta se ejecute.
            if (!(abs in conv.turn.before)) conv.turn.before[abs] = readText(abs);
          }
        }
        emit("conv:tool", { convId, id: block.id, name: block.name, input: block.input });
      }
    } else if (m.type === "user") {
      const content = Array.isArray(m.message?.content) ? m.message.content : [];
      for (const block of content) if (block.type === "tool_result") emit("conv:tool-done", { convId, id: block.tool_use_id, error: !!block.is_error });
    } else if (m.type === "prompt_suggestion") {
      emit("conv:suggestion", { convId, text: m.suggestion });
    } else if (m.type === "result") {
      conv.profile.turns = (conv.profile.turns || 0) + 1;
      conv.profile.updatedAt = new Date().toISOString();
      mem.saveProfile(conv.folder, conv.profile);
      const u = m.usage || {};
      const t = conv.turn || {};
      const files = [...(t.files || [])];
      if (t.userUuid && files.length) {
        const after = {}; for (const f of files) after[f] = readText(f);
        conv.snapshots.set(t.userUuid, { before: t.before || {}, after });
      }
      conv.busy = false; conv.turn = null;
      emit("conv:result", {
        convId, subtype: m.subtype, cost: m.total_cost_usd, turns: m.num_turns, duration: m.duration_ms,
        model: cfg.settings.model, effort: cfg.settings.effort,
        tokensIn: (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0),
        tokensOut: u.output_tokens || 0,
        error: m.subtype !== "success" ? (m.result || m.subtype) : (m.is_error ? m.result : null),
        files, userUuid: t.userUuid || null,
      });
      emit("conv:busy", { convId, busy: false });
      const summary = (m.result || "").replace(/\s+/g, " ").slice(0, 140);
      notify("El agente terminó", summary || "Respuesta lista.");
    }
  }
  conv.close("ended");
}

// Texto de un archivo para diferencias (null si no existe; se omiten binarios y > 2 MB).
function readText(abs) {
  try {
    const st = fs.statSync(abs);
    if (st.size > 2 * 1024 * 1024) return "(archivo demasiado grande para mostrar diferencias)";
    const buf = fs.readFileSync(abs);
    if (buf.subarray(0, 8000).includes(0)) return "(archivo binario)";
    return buf.toString("utf8");
  } catch { return null; }
}
// Diferencias de los archivos modificados en el turno identificado por el uuid del mensaje de usuario.
function diff({ convId, uuid }) {
  const c = convs.get(convId);
  const snap = c?.snapshots.get(uuid);
  if (!snap) return [];
  return Object.keys(snap.after).map((file) => {
    const before = snap.before[file] ?? "", after = snap.after[file] ?? "";
    const rel = path.relative(c.folder, file) || file;
    const patch = Diff.createTwoFilesPatch(rel, rel, before, after, snap.before[file] == null ? "(nuevo)" : "", snap.after[file] == null ? "(eliminado)" : "", { context: 3 });
    const lines = patch.split("\n").slice(4);
    return { file, rel, created: snap.before[file] == null, deleted: snap.after[file] == null, patch, added: lines.filter((l) => l.startsWith("+")).length, removed: lines.filter((l) => l.startsWith("-")).length };
  });
}
function statusList() {
  return cfg.CONNECTIONS.map((c) => ({ id: c.id, status: cfg.connState(c.id).enabled ? (mcpStatus.get(c.id) || "pending") : "disabled" }));
}
// Estado fresco de las conexiones MCP (pregunta a la conversación más reciente si la hay).
async function status() {
  const c = [...convs.values()].pop();
  if (c) { try { for (const s of await c.q.mcpServerStatus()) mcpStatus.set(s.name, s.status); } catch { /* proceso arrancando */ } }
  return statusList();
}

async function stop(convId) { const c = convs.get(convId); if (c?.busy) await c.q.interrupt(); }
function close(convId) { convs.get(convId)?.close("closed"); }
function closeAll() { for (const c of [...convs.values()]) c.close("folder-changed"); }
async function rewind({ convId, uuid, dryRun }) {
  const c = convs.get(convId);
  if (!c) throw new Error("La conversación ya no existe.");
  return c.q.rewindFiles(uuid, { dryRun: !!dryRun });
}
// Cambios de modelo / permisos aplicados en caliente a las conversaciones abiertas.
async function applySettings() {
  for (const c of convs.values()) {
    try { await c.q.setModel(cfg.settings.model); } catch { /* proceso arrancando */ }
    try { await c.q.setPermissionMode(cfg.settings.permission); } catch { /* idem */ }
  }
}
async function sessions() {
  const dir = cfg.getFolder();
  let list = await listSessions({ dir, limit: 30 });
  if (!list.length) {
    // Respaldo: rutas con nombre corto de Windows (JULIOC~1) no casan por `dir`; filtramos por cwd.
    const norm = (p) => path.resolve(p).replace(/[\\/]+$/, "").toLowerCase();
    list = (await listSessions({ limit: 300 })).filter((s) => s.cwd && norm(s.cwd) === norm(dir)).slice(0, 30);
  }
  return list.map((s) => ({ sessionId: s.sessionId, summary: s.summary, lastModified: s.lastModified }));
}

// Consulta de un solo turno, sin UI (tareas programadas).
// opts.schema: JSON Schema -> salida estructurada en `structured`. opts.signal: AbortSignal para cancelar.
async function runOnce(prompt, { schema, signal } = {}) {
  if (!cfg.apiKeyStatus().has) return { ok: false, text: "", cost: 0, error: "Falta la clave de API.", structured: null };
  const abort = new AbortController();
  if (signal) signal.addEventListener("abort", () => abort.abort(), { once: true });
  const conv = { id: "once", folder: cfg.getFolder(), profile: mem.loadProfile(cfg.getFolder()), abort };
  const opts = buildOptions(conv, { oneShot: true });
  opts.permissionMode = cfg.settings.permission === "default" || cfg.settings.permission === "plan" ? "acceptEdits" : cfg.settings.permission;
  opts.allowedTools = opts.allowedTools.filter((t) => t !== "AskUserQuestion" && t !== "ExitPlanMode");
  delete opts.canUseTool; delete opts.onElicitation; delete opts.includePartialMessages;
  if (schema) opts.outputFormat = { type: "json_schema", schema };
  let out = { ok: false, text: "", cost: 0, error: null, structured: null };
  try {
    for await (const m of query({ prompt, options: opts })) {
      if (m.type === "result") out = { ok: m.subtype === "success" && !m.is_error, text: m.result || "", cost: m.total_cost_usd || 0, error: m.subtype !== "success" ? m.subtype : null, structured: m.structured_output ?? null };
    }
  } catch (e) { out.error = abort.signal.aborted ? "Cancelada por el usuario." : String(e.message || e); }
  return out;
}

module.exports = { init, create, send, stop, close, closeAll, rewind, reply, applySettings, sessions, runOnce, diff, status, validateApiKey, count: () => convs.size };
