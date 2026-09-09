# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Qué es

App de escritorio Electron sobre `@anthropic-ai/claude-agent-sdk`. Filosofía: código mínimo, sin
frameworks ni bundler. CommonJS en el proceso principal; scripts clásicos (IIFE, `window.*`) en el
renderer, cargados en orden por `renderer/index.html`. Cada archivo hace una cosa; si pasa de ~400
líneas, se divide. Toda la UI y los comentarios están en español.

## Comandos

```bash
npm start                    # arranca la app (no hay compilación; cerrar y relanzar para cambios en main/)
npm test                     # prueba de UI sobre el Electron real, sin gastar tokens (~46 comprobaciones, por áreas)
UI_TEST_LIVE=1 npm test      # además el área live con Haiku: permiso, rewind, hooks, compactar, subagente (centavos)
npm test -- conexiones live  # solo esas áreas (test/ui/<área>.js; arranque siempre corre)
node test/scheduler.test.js  # planificador; también test/hooks.test.js y test/seed.test.js (sin SDK)
node --check <archivo.js>    # verificación de sintaxis (no hay linter configurado)
```

- Clave de API: en desarrollo, `.env` con `ANTHROPIC_API_KEY` junto a `main.js` (`process.loadEnvFile`); si no
  hay, la app muestra la bienvenida (`renderer/welcome.js`) y guarda la clave cifrada en `config.json`
  (`cfg.loadApiKey()` la pone en `process.env` antes de crear conversaciones). `AGENTE_SIN_CLAVE=1` simula la
  primera ejecución. La app instalada no usa `.env`.
- En esta shell suele existir `ELECTRON_RUN_AS_NODE`; para lanzar Electron a mano hay que quitarla:
  `env -u ELECTRON_RUN_AS_NODE npx electron .`. Con `--enable-logging=stderr` se ven los errores del renderer.
- `AGENTE_USER_DATA=<dir>` redirige `userData` (config.json) para no tocar la configuración real. La prueba lo usa.
- Con la app abierta: `Ctrl+R` recarga el renderer (cierra las conversaciones abiertas), `Ctrl+Shift+I` DevTools.
- La prueba de UI se conecta al Electron real por CDP con `playwright-core` (`--remote-debugging-port`),
  puerto aleatorio, y mata el árbol de procesos al terminar. No abre navegadores propios. `test/ui.js` es el
  runner; cada área es un módulo `test/ui/<área>.js` que recibe `{ page, check, sleep, WS, ACT }`; una
  excepción en un área no detiene las demás.

## Arquitectura

Los contratos IPC y de eventos están en `docs/ARQUITECTURA.md`. Léelo antes de tocar cualquier
cosa que cruce la frontera main ↔ renderer. Resumen de lo que no se ve leyendo un solo archivo:

**Una conversación = una `query()` del SDK en modo streaming-input** (`src/main/agent.js`). El
`prompt` es un generador asíncrono al que se le encolan mensajes de usuario con `conv.push()`; el
proceso del CLI queda vivo entre turnos. Eso es lo que habilita `interrupt()`, `setModel()`,
`setPermissionMode()` y `rewindFiles()` (solo existen en streaming-input). Cada conversación tiene
`convId` propio y **todos** los eventos hacia el renderer lo llevan. Cambiar de carpeta cierra todas.

**Diálogos con el usuario** pasan por `canUseTool` / `onElicitation` en `agent.js`: se emite
`conv:ask {reqId, kind, payload}` y se espera `convReply({reqId,...})` (mapa `pending`). Tres casos
especiales dentro de `canUseTool`: `AskUserQuestion` se responde devolviendo `updatedInput.answers`;
`ExitPlanMode` aprobado hace `setPermissionMode` al modo de ejecución y emite `conv:mode`; el resto
es un permiso normal. En modo `default` ("Preguntar") las herramientas de escritura y Bash se
quitan de `allowedTools` para que el SDK pregunte. El renderer pinta las tarjetas en `dialogs.js`.

**Rewind**: el uuid del mensaje de usuario lo genera la app (`crypto.randomUUID()`) y se pone en el
`SDKUserMessage` que se encola; ese mismo uuid viaja en `conv:user` y `conv:result.userUuid` y es
el que se pasa a `rewindFiles`. Requiere `enableFileCheckpointing: true` (ya está).

**Memoria**: no hay base de datos. `CLAUDE.md` de la carpeta de trabajo (secciones `## Memoria` y
`## Perfil`) lo carga el SDK vía `settingSources: ["user","project"]`; el agente lo edita por
instrucción del `SYSTEM_APPEND` en `memory.js`. El perfil sin tokens (`.claude/perfil.json`) lo
mantiene `agent.js` contando extensiones y herramientas, y se resume en el system prompt.
"Obtener sugerencia" solo aparece con `SUGGEST_MIN` (5) viñetas entre ambas secciones.

**Subagentes y hooks**: `src/main/agents.js` define `lector` (Haiku, solo lectura) y `redactor` y el texto
`AGENTS_APPEND` de delegación; `buildOptions` los añade con `config.agents` (y la herramienta `Agent`). Los
mensajes con `parent_tool_use_id` vienen de un subagente: `conv:tool` lleva `parent` y `agent`, y `chat.js`
pinta el paso sangrado (`.step.sub`). Los subagentes corren en segundo plano: sus pasos pueden llegar tras
el `result` del turno. `src/main/hooks.js` (`config.hooks`): PreToolUse deniega escrituras fuera de la
carpeta y de `dirs` y emite `conv:notice`; PostToolUse anota `.claude/cambios.log`. Bash no pasa por ahí.

**Compactar**: `agent.compact(convId)` encola el mensaje de usuario `/compact` (el CLI lo procesa como
comando). Llegan `system/status` (`compacting`, `compact_result`) y `system/compact_boundary`; con pocos
turnos el SDK responde "Not enough messages to compact" y la app avisa. Los eventos de límite de tasa
(`rate_limit_event`) y los reintentos (`system/api_retry`) se traducen a `conv:status` para la barra de estado.

**Sesiones/historial**: `src/main/sessions.js`. `list()` usa `listSessions({dir})` del SDK y `messages(id)` usa
`getSessionMessages` (texto y tool_use, sin subagentes) para que `renderer/convlist.js` repinte el hilo al
reanudar (`ConvList.resume` → `replay` con los internos que expone `window.Chat`). La barra lateral tiene una
sola lista: filas `.conv.open` (abiertas) y `.conv.hist` (anteriores). Con rutas cortas de Windows (`JULIOC~1`) no
casa por `dir`; hay un respaldo que filtra por `cwd`. El renderer oculta las sesiones que ya están
abiertas como conversación. Nombre y fijado se guardan en `config.convMeta[sessionId]` (`conv:meta`), se
fusionan en `sessions:list` (fijadas primero) y se aplican al reanudar; una conversación renombrada antes
de su primer turno se persiste al llegar `conv:init`.

**Conexiones MCP** (`config.CONNECTIONS`) se lanzan con `cmd /c npx -y <pkg>` en Windows; sus
herramientas se permiten con el prefijo `mcp__<id>`. `sessions:list` y el SDK también cargan los
servidores MCP del usuario de `~/.claude` (aparecen como `needs-auth`); no es un error.

**Renderer**: la barra lateral solo tiene "Nueva conversación", una lista única de conversaciones
(abiertas y anteriores, `convlist.js`) con búsqueda y "Configuración"; la carpeta de trabajo es la píldora `#ws-pill` de la
barra superior (menú con ruta, cambiar, abrir) y las skills se listan en Configuración › Skills (`#skills`,
lo pinta `app.js`). Configuración (`settings.js`) es un modal con `nav.cfg-nav` y paneles `.cfg-pane[data-pane]`;
`Settings.open(pane?)` abre en "general" por defecto. El indicador de estado (`#status-text`) está oculto
salvo avisos del SDK (`conv:status`). `app.js` define `window.App` (estado, `$`, `esc`, popover único `#menu`, bus interno
`on/emit`, toasts, tema). Los módulos se comunican por ese bus (`chip:*`, `composer:set`,
`conv:activated`, `memory:changed`, `history:refresh`) y por `window.Chat / Composer / Dialogs /
FilesPanel / SchedulesUI`. Cada conversación tiene su `.thread#conv-<id>` absoluto dentro de
`#thread-area`; solo la `.active` se muestra. El panel de vista previa (`files.js`) vive en
`#panel-root`; los archivos en `artifacts/` se abren solos.

**Configuración**: `src/main/config.js` guarda `config.json` en `userData` (carpeta, nombre,
conexiones, límites, plugins, dirs, tareas programadas). Los ajustes del compositor (modelo,
razonamiento, permisos) son volátiles en main y se persisten en `localStorage` del renderer, que
los reenvía al arrancar. El `body` es un grid de una fila: cualquier contenedor auxiliar nuevo en
`index.html` debe ser `position: fixed` o quedará en una fila extra.

**Diferencias y rewind**: `agent.js` guarda por turno una instantánea del texto de cada archivo
escrito, tomada cuando llega el `tool_use` (antes de que la herramienta se ejecute) y otra al final
del turno (`conv.snapshots`, clave = uuid del mensaje de usuario). `convDiff` las compara con el
paquete `diff`. El rewind real lo hace el SDK con sus checkpoints; las instantáneas son solo para mostrar.

**Credenciales de conexiones**: cifradas con `safeStorage` en `config.json`; el renderer recibe
`publicConfig()` con indicadores `has`, nunca los valores. `mcpServerFor(c, values)` rellena `{clave}`
en `env`/`headers`. GitHub es un servidor MCP HTTP remoto; el resto son paquetes npx.

**Empaquetado**: `npm run dist` (electron-builder, NSIS). El binario del CLI del SDK va en
`asarUnpack`; `build/skills-ejemplo/**` se incluye y `memory.seedExampleSkills` lo copia a la carpeta por
defecto solo la primera vez (`config.skillsSeeded`; no en pruebas con `AGENTE_USER_DATA`). Ver
`docs/EMPAQUETADO.md`. `publish.owner` es un placeholder hasta que exista el repo.

## Trampas conocidas
- Si la app (o `npm test`) se lanza desde una terminal de Claude Code hereda `CLAUDECODE` y `CLAUDE_CODE_*`;
  el CLI del SDK se comporta como sesión hija, usa el login OAuth del padre e **ignora `ANTHROPIC_API_KEY`**
  (`apiKeySource: "none"`). `agent.cleanEnv()` las quita en cada `query()`; el test también las quita al lanzar.
- Con una clave inválida el CLI reintenta el 401 diez veces con espera creciente (minutos). `validateApiKey`
  aborta al primer `system/api_retry` de autenticación.
- `prompt()`, `alert()` y compañía no existen en el renderer de Electron (`prompt() is not supported`).
  El renombrado usa edición en línea (`contenteditable`); los ítems de conversación son `div`, no
  `button`, porque el texto dentro de un `<button>` no es editable. `renderConvList` no repinta
  mientras `renaming` está activo, porque los dos clics previos al doble clic destruirían el elemento.

- `[hidden]` está forzado con `!important` en `styles.css` porque las clases con `display:flex` lo
  anulaban. No quites esa regla.
- Escribir archivos con heredocs de Bash en esta máquina convierte `\n` literales en saltos reales;
  usa la herramienta Write/Edit para JS.
- Los modelos, precios y catálogos (`MODELS`, `PERMISSIONS`, `CONNECTIONS`) viven solo en
  `src/main/config.js`; el renderer los recibe por `getState()`.
- Dictado: Electron no trae el servicio de voz de Google; el botón usa `webkitSpeechRecognition` con
  aviso de fallback a Win+H. No intentes "arreglarlo" con otra API del navegador.
