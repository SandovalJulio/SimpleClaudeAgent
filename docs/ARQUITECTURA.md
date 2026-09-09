# Arquitectura y contratos

App Electron sobre el Claude Agent SDK. Sin frameworks ni bundler: CommonJS en el proceso
principal, scripts clásicos en el renderer (cargados en orden por `renderer/index.html`).
Cada archivo hace una cosa. Si un archivo pasa de ~400 líneas, se divide.

```
main.js                  Entrada: ventana, atajos, notificaciones, registro de IPC.
preload.js               Expone window.agente (invoke + on) al renderer.
src/main/config.js       Configuración persistente, carpeta de trabajo, catálogos (modelos, permisos, conexiones).
src/main/memory.js       Skills (.claude/skills), memoria (CLAUDE.md), perfil (.claude/perfil.json).
src/main/agent.js        Conversaciones: una query en modo streaming-input por conversación; eventos; permisos; rewind; sesiones.
src/main/scheduler.js    Tareas programadas (ejecuta consultas de un solo turno).
renderer/index.html      Marcado base con contenedores de montaje.
renderer/styles.css      Estilos base (tokens, layout, chat, compositor, configuración).
renderer/app.js          Estado global, utilidades ($, esc, menús flotantes, tema), arranque.
renderer/chat.js         Conversaciones en paralelo (pestañas), mensajes, actividad, costo, sugerencias, historial.
renderer/composer.js     Compositor: adjuntos, arrastrar y soltar, dictado, menú "/", píldoras.
renderer/settings.js     Modal de configuración.
renderer/dialogs.js      Diálogos del agente: permisos, preguntas, plan, elicitación MCP.   (subagente)
renderer/files.js        Archivos producidos por turno y panel de vista previa / artifacts.  (subagente)
renderer/schedules.js    Sección "Tareas programadas" dentro de Configuración.               (subagente)
test/ui.js               Prueba de UI con playwright-core sobre el Electron real.
```

## Utilidades globales del renderer (definidas en app.js, disponibles para todos los módulos)

```js
window.App = {
  $,                    // $(id) -> elemento
  esc,                  // esc(texto) -> HTML escapado
  state,                // { folder, settings, models, efforts, permissions, connections, skills, convs, activeConv, ... }
  openMenu(anchor, kind, html), closeMenu(),   // popover flotante único (#menu)
  toast(texto, tipo?),  // aviso breve abajo a la derecha; tipo: "ok" | "err" | undefined
  relPath(p),           // ruta relativa a la carpeta de trabajo si aplica
  baseName(p),
  on(evento, cb), emit(evento, data),          // bus interno del renderer (no IPC)
};
```
Eventos del bus interno: `conv:activated {convId}`, `settings:changed`, `folder:changed`.

## IPC: renderer -> main (`window.agente.<nombre>(...)`, todos devuelven Promise)

| Método | Devuelve | Notas |
|---|---|---|
| `getState()` | `{ folder, settings, models, efforts, permissions, connections, config }` | Estado inicial. |
| `setSettings(patch)` | `settings` | `{model, effort, permission}`. Si hay conversaciones activas aplica `setModel` / `setPermissionMode` en caliente. |
| `setConfig(patch)` | `config` (sin secretos) | `{name, connections:{id: bool | {enabled?, values?}}, maxBudgetUsd, maxTurns, sandbox, web, plugins:[ruta], dirs:[ruta], notifications}`. |
| `pickFolder()` / `setFolder(ruta)` | `folder` | Cambiar carpeta cierra las conversaciones abiertas. |
| `pickFiles()` | `[rutas]` | Diálogo nativo de archivos. |
| `pickDirectory()` | `ruta | null` | Diálogo nativo de carpeta (para plugins y directorios adicionales). |
| `openPath(ruta)` / `openExternal(url)` | — | Mostrar en explorador / abrir en navegador. |
| `openFile(ruta)` | — | Abrir con la app predeterminada. |
| `readFile(ruta)` | `{ text, mime, size }` | Solo dentro de la carpeta de trabajo o dirs adicionales; máx. 2 MB. Para vista previa. |
| `listSkills()` | `[{name, description, scope, file}]` | |
| `listMemory()` | `{ file, memory, profile, ext, turns, suggestReady, suggestMin }` | |
| `readMemoryFile()` / `writeMemoryFile(texto)` | `{file, text}` / `true` | |
| `convNew({ resume?, fork? })` | `{ convId }` | Crea una conversación (proceso del SDK en streaming-input). `resume` = sessionId previo. |
| `convSend({ convId, text, files })` | `true` | Encola el mensaje del usuario. Los adjuntos van como rutas. |
| `convStop(convId)` | — | `interrupt()` del turno en curso. |
| `convClose(convId)` | — | Termina el proceso. |
| `convRewind({ convId, uuid, dryRun })` | `RewindFilesResult` | Revierte archivos al estado previo al mensaje de usuario `uuid`. |
| `convDiff({ convId, uuid })` | `[{file, rel, created, deleted, patch, added, removed}]` | Diferencias de los archivos que cambió el turno. Las instantáneas "antes" se toman al llegar el `tool_use` (antes de ejecutarse) y "después" al terminar el turno. |
| `mcpStatus()` | `[{id, status}]` | Estado de cada conexión: connected, failed, needs-auth, pending, disabled. |
| `exportSave({ defaultName, text })` | `ruta | null` | Diálogo de guardar y escritura del texto. |
| `convReply({ reqId, ...respuesta })` | — | Respuesta a un diálogo pendiente (ver eventos `conv:ask`). |
| `listSessions()` | `[{ sessionId, summary, lastModified }]` | Historial de la carpeta actual, más reciente primero. |
| `scheduleList()` | `[tarea]` | Ver sección Tareas programadas. |
| `scheduleSave(tarea)` | `[tarea]` | Crea o actualiza (por `id`). |
| `scheduleDelete(id)` | `[tarea]` | |
| `scheduleRun(id)` | — | Ejecuta ahora. Emite `schedule:running` y `schedule:done`. |
| `scheduleCancel(id)` | `bool` | Aborta la ejecución en curso. |

## Eventos: main -> renderer (`window.agente.on(nombre, cb)`; cb recibe un objeto)

Todos los eventos de conversación llevan `convId`.

| Evento | Datos | Cuándo |
|---|---|---|
| `conv:init` | `{convId, sessionId}` | El SDK inicializó la sesión. |
| `conv:busy` | `{convId, busy}` | Empieza / termina un turno. |
| `conv:user` | `{convId, uuid, text, files}` | Eco del mensaje del usuario ya encolado (con su uuid para rewind). |
| `conv:delta` | `{convId, text}` | Fragmento de texto en streaming. |
| `conv:tool` | `{convId, id, name, input}` | El agente invoca una herramienta. |
| `conv:tool-done` | `{convId, id, error}` | Resultado de la herramienta. |
| `conv:progress` | `{convId, text}` | Resumen corto de progreso (agentProgressSummaries). |
| `conv:result` | `{convId, subtype, cost, turns, duration, model, effort, tokensIn, tokensOut, error, files:[rutas escritas], userUuid}` | Fin del turno. `files` = archivos creados/modificados en el turno. |
| `conv:suggestion` | `{convId, text}` | Sugerencia de siguiente mensaje. |
| `conv:ask` | `{convId, reqId, kind, payload}` | El agente necesita al usuario. Responder con `convReply({reqId, ...})`. Ver abajo. |
| `conv:closed` | `{convId, reason}` | El proceso terminó. |
| `schedule:done` | `{id, name, ok, cost, summary, logFile}` | Terminó una tarea programada. |
| `schedule:running` | `{id, running}` | Empieza o termina una ejecución (para mostrar "Cancelar"). |
| `mcp:status` | `[{id, status}]` | Estado de conexiones tras iniciar una conversación. |

### `conv:ask` — tipos (`kind`) y respuesta esperada (`convReply`)

| kind | payload | respuesta |
|---|---|---|
| `permission` | `{ toolName, input, summary, canAlways }` | `{ reqId, allow: bool, always?: bool, message?: string }` |
| `question` | `{ questions: [{question, header, options:[{label, description}], multiSelect}] }` | `{ reqId, answers: { [question]: "texto" } }` o `{ reqId, cancel: true }`. Multi-selección: etiquetas unidas por ", ". Siempre debe permitirse una respuesta libre ("Otro"). |
| `plan` | `{ plan: string }` (markdown; puede venir vacío: entonces mostrar el último texto del agente) | `{ reqId, approve: bool, message?: string }` |
| `elicitation` | `{ serverName, message, mode: "form"|"url", url?, requestedSchema? }` | form: `{ reqId, action: "accept", content: {...} }` / `{ reqId, action: "decline" }`; url: abrir con `openExternal` y responder `{ reqId, action: "accept" }` cuando el usuario confirme. |

Si el usuario cierra el diálogo sin responder, enviar la respuesta negativa (`allow:false`, `cancel:true`, `approve:false`, `action:"cancel"`).

## Tareas programadas (`scheduler.js`)

```js
tarea = { id, name, prompt, schema: objeto|null, every: "hour"|"day"|"week", at: "HH:MM", weekday: 0-6, enabled: bool, lastRun: ISO|null, nextRun: ISO }
```
`schema` (JSON Schema) activa la salida estructurada (`outputFormat` del SDK); el resultado se guarda
también en `<id>.jsonl`.

## Conexiones con credenciales

`CONNECTIONS` en `config.js` admite `fields` (credenciales) y `env` / `headers` con plantillas `{clave}`.
En `config.json`, `connections[id] = { enabled, values: { clave: "enc:<base64>" } }`, cifrado con
`safeStorage`. El renderer solo recibe `publicConfig()`, donde `values` se sustituye por `has: {clave: bool}`.
Para guardar una credencial: `setConfig({ connections: { [id]: { values: { clave: texto } } } })`.
Se guardan en la configuración de la app (`config.schedules`). El planificador revisa cada 60 s.
Cada ejecución es una consulta de un solo turno (no streaming) con `runOnce(prompt)` que expone
`agent.js`, en la carpeta de trabajo actual, con el modelo y permisos configurados, y añade el
resultado a `<carpeta>/.claude/programadas/<id>.md`. Al terminar emite `schedule:done` y una
notificación del sistema.

## Archivos producidos y artifacts (`files.js`)

`chat.js` llama a `window.FilesPanel.render(container, files, convId)` con las rutas de `conv:result.files`.
Debe pintar chips por archivo (nombre, extensión, botón abrir con `openFile`, mostrar en carpeta con `openPath`)
y, para `.html .htm .md .svg .png .jpg .jpeg .gif .webp .pdf .txt .json .csv`, un botón **Vista previa**
que abre el panel lateral derecho (`#panel-root`) con el contenido: iframe `sandbox` para html/pdf/imágenes
(vía `file://`), `marked` para md, `<pre>` para texto. `window.FilesPanel.open(ruta)` y `.close()`.

Artifacts: el agente recibe la instrucción de guardar cualquier "artifact" (página, dashboard, informe visual,
presentación) como HTML autónomo en `<carpeta>/artifacts/<nombre>.html`. Cuando un archivo producido está en
`artifacts/`, abrir la vista previa automáticamente al terminar el turno.

## Diálogos (`dialogs.js`)

`window.Dialogs.handle(evento)` recibe cada `conv:ask` y muestra una tarjeta dentro del hilo de esa
conversación (`#conv-<convId> .inner`) al final, no un modal, para poder seguir leyendo. Al responder,
llama a `window.agente.convReply(...)` y sustituye la tarjeta por un resumen de una línea de la decisión.
Estilo: tarjeta `.card`-like, botones `.btn` / `.btn.primary`. Usar tokens CSS de `styles.css`
(`--bg-card`, `--border`, `--text-2`, `--accent`, `--err`). Las tarjetas deben poder convivir varias a la vez
(conversaciones en paralelo).

## Sección Tareas programadas en Configuración (`schedules.js`)

`window.SchedulesUI.mount(container)` pinta lista de tareas (nombre, frecuencia legible, próxima ejecución,
interruptor activo, botones Ejecutar ahora / Editar / Eliminar) y un formulario para crear o editar
(nombre, prompt, frecuencia, hora, día de la semana). Usa `scheduleList/Save/Delete/Run`.
Se refresca al recibir `schedule:done` y muestra `App.toast`.
