// Conversaciones sobre el Claude Agent SDK.
// Cada conversación es una query en modo streaming-input: el proceso del SDK queda vivo,
// se le encolan mensajes de usuario y permite interrupt / setModel / setPermissionMode / rewindFiles.
const path = require("path");
const crypto = require("crypto");
const { query, listSessions } = require("@anthropic-ai/claude-agent-sdk");
const cfg = require("./config");
const mem = require("./memory");

const convs = new Map();   // convId -> conv
const pending = new Map(); // reqId -> resolve (diálogos esperando al usuario)
let emit = () => {};       // (evento, datos) -> renderer
let notify = () => {};     // (titulo, cuerpo)

function init({ emit: e, notify: n }) { emit = e; notify = n; }

const WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);

// ---------- Opciones del SDK ----------
function buildOptions(conv, { resume, fork, oneShot } = {}) {
  const folder = cfg.getFolder();
  const config = cfg.getConfig();
  const { model, effort, permission } = cfg.settings;
  const profile = conv.profile;

  const active = cfg.CONNECTIONS.filter((c) => config.connections[c.id]);
  const mcpServers = Object.fromEntries(active.map((c) => [c.id, cfg.mcpServerFor(c)]));
  const tools = ["Read", "Glob", "Grep", "Skill", "Write", "Edit", "Bash", "AskUserQuestion", "ExitPlanMode", "TodoWrite"];
  if (config.web) tools.push("WebSearch", "WebFetch");
  tools.push(...active.map((c) => `mcp__${c.id}`));
  // En "Preguntar" solo las herramientas de lectura van preaprobadas; el resto pasa por canUseTool.
  const allowedTools = permission === "default" ? tools.filter((t) => !WRITE_TOOLS.has(t) && t !== "Bash") : tools;

  const append = mem.SYSTEM_APPEND +
    (config.name ? `\nEl usuario se llama ${config.name}; dirígete a él por su nombre cuando sea natural.` : "") +
    mem.profileSummary(profile);

  return {
    model, effort, cwd: folder,
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

// ---------- Conversaciones ----------
function create({ resume, fork } = {}) {
  const folder = cfg.getFolder();
  if (!folder) throw new Error("Primero elige una carpeta de trabajo.");
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
    turn: null, // { userUuid, files:Set }
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
  let prompt = text;
  if (files.length) {
    prompt += "\n\nArchivos adjuntos por el usuario (léelos si son relevantes):\n" + files.map((f) => "- " + f).join("\n");
    for (const f of files) mem.noteExt(conv.profile, f);
  }
  const uuid = crypto.randomUUID();
  conv.turn = { userUuid: uuid, files: new Set(), started: Date.now() };
  conv.busy = true;
  emit("conv:busy", { convId, busy: true });
  emit("conv:user", { convId, uuid, text, files });
  conv.push({ type: "user", uuid, session_id: conv.sessionId || "", parent_tool_use_id: null, message: { role: "user", content: prompt } });
  return true;
}

async function pump(conv) {
  for await (const m of conv.q) {
    const convId = conv.id;
    if (m.type === "system" && m.subtype === "init") {
      conv.sessionId = m.session_id;
      emit("conv:init", { convId, sessionId: m.session_id });
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
        if (fp) { mem.noteExt(conv.profile, fp); if (WRITE_TOOLS.has(block.name) && conv.turn) conv.turn.files.add(path.resolve(conv.folder, fp)); }
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
  const list = await listSessions({ dir: cfg.getFolder(), limit: 30 });
  return list.map((s) => ({ sessionId: s.sessionId, summary: s.summary, lastModified: s.lastModified }));
}

// Consulta de un solo turno, sin UI (tareas programadas).
async function runOnce(prompt) {
  const conv = { id: "once", folder: cfg.getFolder(), profile: mem.loadProfile(cfg.getFolder()), abort: new AbortController() };
  const opts = buildOptions(conv, { oneShot: true });
  opts.permissionMode = cfg.settings.permission === "default" || cfg.settings.permission === "plan" ? "acceptEdits" : cfg.settings.permission;
  opts.allowedTools = opts.allowedTools.filter((t) => t !== "AskUserQuestion" && t !== "ExitPlanMode");
  delete opts.canUseTool; delete opts.onElicitation; delete opts.includePartialMessages;
  let out = { ok: false, text: "", cost: 0, error: null };
  try {
    for await (const m of query({ prompt, options: opts })) {
      if (m.type === "result") out = { ok: m.subtype === "success" && !m.is_error, text: m.result || "", cost: m.total_cost_usd || 0, error: m.subtype !== "success" ? m.subtype : null };
    }
  } catch (e) { out.error = String(e.message || e); }
  return out;
}

module.exports = { init, create, send, stop, close, closeAll, rewind, reply, applySettings, sessions, runOnce, count: () => convs.size };
