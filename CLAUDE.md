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
npm test                     # prueba de UI sobre el Electron real, sin gastar tokens (~30 comprobaciones)
UI_TEST_LIVE=1 npm test      # además consultas reales con Haiku: permiso interactivo, rewind, historial (centavos)
node test/scheduler.test.js  # prueba unitaria del planificador
node --check <archivo.js>    # verificación de sintaxis (no hay linter configurado)
```

- Requiere `.env` con `ANTHROPIC_API_KEY` junto a `main.js` (cargado con `process.loadEnvFile`).
- En esta shell suele existir `ELECTRON_RUN_AS_NODE`; para lanzar Electron a mano hay que quitarla:
  `env -u ELECTRON_RUN_AS_NODE npx electron .`. Con `--enable-logging=stderr` se ven los errores del renderer.
- `AGENTE_USER_DATA=<dir>` redirige `userData` (config.json) para no tocar la configuración real. La prueba lo usa.
- Con la app abierta: `Ctrl+R` recarga el renderer (cierra las conversaciones abiertas), `Ctrl+Shift+I` DevTools.
- La prueba de UI se conecta al Electron real por CDP con `playwright-core` (`--remote-debugging-port`),
  puerto aleatorio, y mata el árbol de procesos al terminar. No abre navegadores propios.

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

**Sesiones/historial**: `listSessions({dir})` del SDK. Con rutas cortas de Windows (`JULIOC~1`) no
casa por `dir`; hay un respaldo que filtra por `cwd`. El renderer oculta las sesiones que ya están
abiertas como conversación.

**Conexiones MCP** (`config.CONNECTIONS`) se lanzan con `cmd /c npx -y <pkg>` en Windows; sus
herramientas se permiten con el prefijo `mcp__<id>`. `sessions:list` y el SDK también cargan los
servidores MCP del usuario de `~/.claude` (aparecen como `needs-auth`); no es un error.

**Renderer**: `app.js` define `window.App` (estado, `$`, `esc`, popover único `#menu`, bus interno
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
`asarUnpack`. Ver `docs/EMPAQUETADO.md`. `publish.owner` es un placeholder hasta que exista el repo.

## Trampas conocidas
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
