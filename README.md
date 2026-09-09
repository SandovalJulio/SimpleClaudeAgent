# Agente

Un agente de escritorio para Windows, macOS y Linux construido sobre el **Claude Agent SDK**, con
una interfaz al estilo de Claude Cowork. Elige una carpeta, describe la tarea y el agente lee,
escribe, ejecuta comandos, crea **skills** reutilizables y **recuerda tus correcciones**.

El proyecto es deliberadamente pequeño: **~5 100 líneas en total (pruebas incluidas), sin frameworks, sin
bundler, sin TypeScript, sin base de datos**. Todo lo difícil (el bucle del agente, las herramientas, los
permisos, las sesiones, los checkpoints de archivos, MCP) lo aporta el SDK. La app solo pone una
ventana, un puente IPC y una interfaz.

> Este proyecto no está afiliado a Anthropic. Necesitas tu propia clave de API.

---

## Índice

- [Por qué es simple](#por-qué-es-simple)
- [Instalación](#instalación)
- [Primer uso](#primer-uso)
- [Funciones](#funciones)
- [Skills](#skills)
- [Memoria y perfil](#memoria-y-perfil)
- [Artifacts](#artifacts)
- [Tareas programadas](#tareas-programadas)
- [Conexiones (MCP)](#conexiones-mcp)
- [Configuración](#configuración)
- [Costos](#costos)
- [Estructura del código](#estructura-del-código)
- [Extender el proyecto](#extender-el-proyecto)
- [Pruebas](#pruebas)
- [Limitaciones conocidas](#limitaciones-conocidas)
- [Licencia](#licencia)

---

## Por qué es simple

| Decisión | Consecuencia |
|---|---|
| El SDK ejecuta el bucle del agente | No hay código propio de herramientas, reintentos ni gestión de contexto. |
| Skills y memoria son archivos Markdown | Se leen, editan y versionan con cualquier editor. Sin base de datos. |
| Scripts clásicos en el renderer | Abres `renderer/index.html` y entiendes qué se carga y en qué orden. |
| Un módulo por responsabilidad | Ningún archivo pasa de ~600 líneas. Los contratos están en `docs/ARQUITECTURA.md`. |
| Configuración en un JSON | `config.json` en la carpeta de datos del usuario. Borrarlo devuelve la app al estado inicial. |

Dependencias de ejecución: `@anthropic-ai/claude-agent-sdk`, `marked`, `diff` (vista de cambios) y
`electron-updater` (actualizaciones del instalador). Nada más.

## Instalación

**Instalador (Windows).** `npm run dist` genera `dist/Agente Setup <versión>.exe` con icono. La app
busca actualizaciones en las releases de GitHub del repositorio configurado en `package.json`.
Detalles en `docs/EMPAQUETADO.md`. Sin certificado de firma, Windows mostrará "Editor desconocido".

**Desde el código.** Requisitos: Node 18 o superior y una clave de API de Anthropic.

```bash
git clone https://github.com/<tu-usuario>/agente.git
cd agente
npm install
```

Arranca:

```bash
npm start
```

La primera vez, la app pide la clave de API en una pantalla de bienvenida, la comprueba con una
consulta mínima (Haiku, menos de un centavo) y la guarda **cifrada** en su configuración. Como
alternativa para desarrollo puedes crear un `.env` junto a `main.js` con `ANTHROPIC_API_KEY=sk-ant-...`
o definir esa variable de entorno; la clave guardada tiene prioridad. Se cambia o borra en
**Configuración › Clave de API**.

No hay paso de compilación. Para ver cambios en el proceso principal, cierra la app y vuelve a
ejecutar `npm start`. Con la app abierta, `Ctrl+R` recarga la interfaz y `Ctrl+Shift+I` abre las
herramientas de desarrollo.

## Primer uso

1. Introduce tu clave de API en la pantalla de bienvenida (solo la primera vez).
2. La app arranca con la carpeta `Documentos\Agente` como espacio de trabajo y copia ahí dos skills
   de ejemplo (`/resumir-documento` y `/ordenar-carpeta`). Cámbiala desde la barra lateral si quieres
   trabajar sobre otra.
3. Escribe una tarea o pulsa una tarjeta de inicio.
4. Para crear tu primera skill, pulsa **Crear una skill**, pon un nombre y describe los pasos.
   Aparecerá en la barra lateral y podrás invocarla con `/nombre`.
5. Corrige al agente cuando haga algo que no te guste. Lo guardará en la memoria de la carpeta y lo
   aplicará en las siguientes conversaciones.

## Funciones

### Conversación
- **Conversaciones en paralelo.** Varias a la vez, cada una con su propio proceso del SDK. La barra
  lateral las lista con un indicador de actividad.
- **Conversaciones anteriores** con búsqueda, debajo de las abiertas en la misma sección. Clic para
  continuar donde lo dejaste; clic derecho para bifurcar una copia sin tocar la original.
- **Renombrar** (doble clic en el título) y **fijar** (clic derecho o 📌) conversaciones. Nombre y
  fijado se guardan por sesión y se aplican en el historial y al reanudar.
- **Menú ⋯** de la conversación: **Compactar** (resume el contexto anterior con el comando `/compact`
  del SDK para ahorrar tokens) y **Descargar** en Markdown.
- La **carpeta de trabajo** es una píldora junto al título: muestra la ruta y permite cambiarla o abrirla.
- **Streaming** de texto y **resumen de progreso** mientras el agente trabaja.
- **Línea de actividad** plegable con cada herramienta usada, el archivo o comando afectado y su
  resultado. Los pasos que ejecuta un **subagente** aparecen sangrados con su nombre.
- **Barra de estado** con avisos legibles del SDK: límite de uso alcanzado o cercano, reintentos por
  errores de red o de la API, compactación en curso.
- **Sugerencias de siguiente mensaje** al final de cada respuesta.
- **Detener** la respuesta en curso.

### Compositor
- `+` adjunta archivos. También puedes **arrastrarlos** a la ventana.
- `/` abre las skills; escribir `/` al inicio filtra mientras tecleas.
- Píldora de **modelo y razonamiento** (bajo, medio, alto). Se cambia en caliente, incluso a mitad
  de una conversación.
- Píldora de **permisos** (ver abajo).
- **Dictado** por micrófono, con aviso para usar el dictado del sistema si el navegador embebido no
  lo soporta.

### Permisos
| Modo | Qué hace |
|---|---|
| **Planificar** | El agente solo lee y propone un plan. Lo apruebas o rechazas en una tarjeta antes de que ejecute nada. |
| **Preguntar** | Pide permiso por cada escritura de archivo o comando, con botones Permitir, Permitir siempre y Rechazar. |
| **Auto** | Edita archivos sin preguntar; pregunta en comandos delicados. |
| **Total** | Sin confirmaciones. |

Las preguntas del agente (`AskUserQuestion`) se muestran como formulario con opciones y campo
libre. Las solicitudes de conexiones MCP (elicitación) también.

### Archivos
- **Archivos producidos** por cada respuesta, como chips con Abrir, Carpeta y Vista previa.
- **Panel de vista previa** lateral para HTML, Markdown, imágenes, PDF, JSON, CSV y texto.
- **Ver cambios**: diferencias línea a línea de cada archivo que modificó la respuesta.
- **Revertir archivos de esta respuesta**: restaura los archivos al estado anterior a tu mensaje
  usando los checkpoints del SDK.
- **Imágenes adjuntas** (PNG, JPG, GIF, WebP de hasta 5 MB) se envían como imágenes reales al
  modelo, no como rutas.

### Sistema
- **Notificaciones** del sistema al terminar una respuesta si la app no está delante.
- **Costo por respuesta** (USD, tokens de entrada y salida, tiempo, turnos) y gasto acumulado.
- **Tope de gasto** y **máximo de turnos** por conversación.

## Skills

Una skill es un archivo Markdown con un frontmatter:

```
<carpeta>/.claude/skills/png-a-pdf/SKILL.md
```
```markdown
---
name: png-a-pdf
description: Convierte todos los PNG de la carpeta en un único PDF ordenado por nombre.
---
1. Busca los archivos *.png de la carpeta y ordénalos por nombre.
2. Genera salida.pdf con Python (pillow). Instala pillow si falta.
3. Informa cuántas páginas tiene el PDF.
```

- El agente las crea cuando se lo pides y las edita cuando las refinas ("modifica la skill para que
  también borre los PNG originales").
- Se invocan con `/nombre` o en lenguaje natural: el modelo elige por la `description`.
- Las de `~/.claude/skills/` son globales y valen para cualquier carpeta.
- Dos skills de ejemplo (`build/skills-ejemplo/`) se copian a la carpeta por defecto la primera vez que
  arranca la app; puedes editarlas o borrarlas, no se vuelven a copiar.
- Si la skill tiene bugs, el agente la corrige él mismo cuando le señalas el error.

## Memoria y perfil

El agente mantiene `<carpeta>/CLAUDE.md`, que el SDK carga automáticamente en cada conversación:

```markdown
## Perfil
- Prepara CVs y postulaciones a vacantes de ingeniería.

## Memoria
- Responder de forma breve y con tablas.
- No usar emojis.
```

- **Memoria**: correcciones y preferencias estables que le das al agente. Si la corrección es sobre
  una skill, edita la skill en vez de anotarla.
- **Perfil**: lo que descubre sobre tu tipo de trabajo. Máximo una anotación por respuesta.
- Además, la app registra sin gastar tokens qué extensiones de archivo se usan y cuántas tareas se
  han hecho (`.claude/perfil.json`) y se lo resume al agente.
- Puedes ver y editar todo en **Configuración › Memorias**.
- Cuando hay al menos cinco memorias, la pantalla de inicio ofrece **Obtener sugerencia**: uno o
  dos consejos concretos sobre nuevas skills o formas de ser más productivo, basados en lo que sabe
  de ti.

## Subagentes y hooks

Dos subagentes vienen definidos con la opción `agents` del SDK (`src/main/agents.js`) y se activan o
desactivan en **Configuración › Herramientas › Subagentes**:

| Subagente | Modelo | Herramientas | Para qué |
|---|---|---|---|
| `lector` | Haiku | Read, Glob, Grep | Explorar y resumir muchos archivos o documentos largos sin gastar el modelo principal. |
| `redactor` | El principal | Read, Glob, Grep, Write, Edit | Escribir documentos o archivos largos con instrucciones ya claras. |

El system prompt le dice al agente cuándo delegar (lecturas amplias, redacciones largas) y cuándo no
(tareas cortas). Sus pasos se ven en la línea de actividad marcados con `↳ lector` o `↳ redactor`.

Dos hooks del SDK (`src/main/hooks.js`, interruptor **Protección y registro de escrituras**):

- **PreToolUse** sobre Write, Edit, MultiEdit y NotebookEdit: si la ruta queda fuera de la carpeta de
  trabajo y de los directorios adicionales, deniega la escritura y deja un aviso en el hilo.
- **PostToolUse** sobre las mismas herramientas: añade una línea a `<carpeta>/.claude/cambios.log`
  con fecha ISO, herramienta y ruta relativa (y el subagente, si lo hubo).

El hook no cubre escrituras hechas con comandos de Bash; para eso están los modos de permisos.

## Artifacts

Pide una página, un dashboard, un informe visual o una presentación. El agente genera un HTML
autónomo en `<carpeta>/artifacts/` y la app lo abre en el panel de vista previa al terminar. Los
artifacts son archivos normales: puedes abrirlos en el navegador, compartirlos o versionarlos.

## Tareas programadas

En **Configuración › Tareas programadas** defines un mensaje o skill que se ejecuta cada hora,
cada día a una hora, o un día de la semana. Cada ejecución:

- corre como una consulta de un solo turno en la carpeta de trabajo, con el modelo y permisos
  configurados;
- añade el resultado a `<carpeta>/.claude/programadas/<id>.md`;
- si la tarea define un **esquema JSON**, el resultado se devuelve estructurado (salida con esquema
  del SDK) y se acumula además en `<id>.jsonl`, una línea por ejecución, listo para tablas;
- muestra una notificación del sistema. Una ejecución en curso se puede **cancelar**.

Las tareas solo se ejecutan mientras la app está abierta. Si estuvo cerrada, la tarea pendiente se
ejecuta una sola vez al volver y se recalcula la siguiente.

## Conexiones (MCP)

Servidores MCP listos para activar con un interruptor, sin claves ni configuración. Se descargan
con `npx` la primera vez:

| Conexión | Qué aporta | Credencial |
|---|---|---|
| Navegador web | Abrir páginas, leer contenido y hacer clics (Playwright). | No |
| Grafo de conocimiento | Memoria estructurada de entidades y relaciones. | No |
| Razonamiento paso a paso | Descomposición de problemas complejos. | No |
| GitHub | Repositorios, issues y pull requests (servidor remoto oficial). | Token personal |
| Notion | Páginas y bases de datos. | Token de integración |
| Slack | Canales y mensajes. | Bot token y Team ID |
| Búsqueda Brave | Búsqueda web alternativa con API. | API key |

Las credenciales se guardan cifradas con el almacén del sistema (`safeStorage` de Electron) y
nunca llegan a la interfaz. Cada conexión muestra su estado real: conectada, con error, requiere
autenticación o conectando. Para añadir otra, edita `CONNECTIONS` en `src/main/config.js`.

## Configuración

La ventana de Configuración tiene un menú lateral con una sección por pestaña:

| Sección | Opciones |
|---|---|
| General | Nombre, gasto de la sesión, clave de API (estado, cambiar, borrar), apariencia, fuente, notificaciones. |
| Memorias | Editor del `CLAUDE.md` de la carpeta, con resumen de entradas y archivos más usados. |
| Skills | Lista de skills de la carpeta y globales (clic: insertar `/nombre`; clic derecho: abrir el archivo), actualizar y crear. |
| Herramientas | Límites (tope de gasto y turnos), búsqueda web, sandbox, subagentes, protección y registro de escrituras, directorios adicionales, plugins. |
| Conexiones | Interruptores y credenciales de los servidores MCP. |
| Tareas programadas | Lista y formulario. |

La configuración se guarda en `config.json` dentro de la carpeta de datos del usuario
(`%APPDATA%\agente-escritorio` en Windows). La clave de API y las credenciales de conexiones van
cifradas con `safeStorage`; el nombre y fijado de conversaciones, en `convMeta` por sesión.

## Costos

Cada respuesta muestra su costo según lo reporta el SDK. Orientación con precios de septiembre
de 2026 por millón de tokens (entrada / salida):

| Modelo | Precio | Uso recomendado |
|---|---|---|
| Haiku 4.5 | $1 / $5 | Por defecto. Tareas cotidianas y skills sencillas. |
| Sonnet 5 | $2 / $10 | Skills complejas, análisis largos. |
| Opus 5 | $5 / $25 | Cuando la calidad importa más que el costo. |

El system prompt del SDK es grande, así que el primer mensaje de cada conversación cuesta más que
los siguientes, que aprovechan la caché de prompt. Una consulta trivial con Haiku ronda $0.01 a
$0.03.

## Estructura del código

```
main.js                  Ventana, atajos, notificaciones, registro de IPC (≈120 líneas)
preload.js               Expone window.agente al renderer
src/main/
  config.js              Configuración persistente, clave de API cifrada, carpeta, catálogos, convMeta
  memory.js              Skills (y las de ejemplo), CLAUDE.md, perfil sin tokens, system prompt adicional
  agent.js               Conversaciones (streaming-input), permisos, rewind, sesiones, compactar, runOnce
  agents.js              Subagentes lector y redactor e instrucciones de delegación
  hooks.js               Hooks: bloquear escrituras fuera de la carpeta y registrar cambios
  scheduler.js           Tareas programadas
renderer/
  index.html             Marcado base y orden de carga
  styles.css             Tokens, layout, chat, compositor, configuración
  app.js                 Estado global, utilidades, bus interno, tema
  welcome.js             Pantalla de bienvenida (clave de API)
  chat.js                Conversaciones en paralelo, mensajes, actividad, avisos, menú ⋯, conversaciones anteriores
  composer.js            Adjuntos, arrastrar y soltar, dictado, menú /, píldoras
  settings.js            Configuración: menú lateral con paneles (general, memorias, skills, herramientas, conexiones, tareas)
  dialogs.js             Tarjetas de permiso, preguntas, plan y elicitación
  files.js               Chips de archivos producidos y panel de vista previa
  schedules.js           Sección de tareas programadas
docs/ARQUITECTURA.md     Contratos IPC y eventos entre main y renderer
docs/EMPAQUETADO.md      Instalador, icono, actualizaciones
build/                   icon.png / icon.svg, skills-ejemplo/ (se empaquetan)
test/                    ui.js + ui/<área>.js (prueba real sobre Electron), scheduler, hooks y seed .test.js, demos
```

Cómo fluye un mensaje: el compositor llama a `convSend` → `agent.js` lo encola en la query del SDK
→ el SDK emite mensajes → `agent.js` los traduce a eventos `conv:*` con `convId` → `chat.js` pinta
en el hilo de esa conversación. Cuando el agente necesita al usuario, `agent.js` emite `conv:ask` y
espera `convReply`; `dialogs.js` pinta la tarjeta y responde.

## Extender el proyecto

Ideas que encajan en la arquitectura actual con poco código:

- **Nuevo modelo o precio**: una línea en `MODELS` (`src/main/config.js`).
- **Nueva conexión MCP**: una línea en `CONNECTIONS`. Para servidores con clave, añade un campo
  `env` al resultado de `mcpServerFor`.
- **Nuevo tipo de diálogo**: emite `conv:ask` con otro `kind` desde `agent.js` y añade su tarjeta
  en `dialogs.js`.
- **Otro subagente**: una entrada más en `AGENTS` (`src/main/agents.js`) y una línea en `AGENTS_APPEND`.
- **Otro hook** (por ejemplo, avisar antes de un `git push`): un matcher más en `buildHooks` (`src/main/hooks.js`).

Lo que no está y sería un cambio mayor: conexiones con OAuth interactivo (Google Drive), ejecución
remota, y sincronización de memoria entre equipos.

## Pruebas

```bash
npm test                        # abre el Electron real y pulsa cada control; ~46 comprobaciones; sin tokens
UI_TEST_LIVE=1 npm test         # además el área "live" con Haiku: permiso interactivo, archivo creado, ver
                                # cambios, revertir, hook de registro, sugerencia, compactar, historial con
                                # nombre persistido, hook de bloqueo y subagente (unos centavos)
npm test -- conversaciones live # solo esas áreas (arranque siempre corre)
node test/scheduler.test.js     # planificador
node test/hooks.test.js         # hooks de bloqueo y registro (sin SDK)
node test/seed.test.js          # copia de las skills de ejemplo
```

La prueba de UI (`test/ui.js`) se conecta al Electron real por el protocolo de depuración de Chromium
con `playwright-core`, usa una carpeta de trabajo y una carpeta de datos temporales, y cierra todos los
procesos al terminar. Está dividida por áreas (`test/ui/<área>.js`: arranque, compositor,
conversaciones, configuración, conexiones, live): una excepción en un área no impide las demás y al
final se imprime un resumen por área. No altera tu configuración.

## Limitaciones conocidas

- **Dictado**: Electron no incluye el servicio de reconocimiento de voz de Google, así que el
  micrófono puede no funcionar. La app lo detecta y sugiere el dictado del sistema (Win+H en
  Windows), que escribe directamente en el cuadro.
- **Sandbox** de comandos: depende del sistema. En Windows nativo requiere que el SDK tenga sus
  dependencias de aislamiento; si no, los comandos se ejecutan sin aislar y se avisa.
- **Tareas programadas** solo corren con la app abierta.
- **Compactar** requiere una conversación con varios turnos; con pocas, el SDK responde que aún es
  demasiado corta y la app lo indica.
- Los **hooks** de protección solo ven las herramientas de edición del SDK, no los comandos de Bash.
- Si lanzas la app **desde una terminal de Claude Code**, hereda variables `CLAUDE_CODE_*`; la app las
  limpia para que el CLI del SDK use tu clave y no la sesión del padre.
- Las conexiones MCP de tu instalación de Claude Code (`~/.claude`) también se cargan y aparecen
  como "needs-auth"; no afecta a la app, pero se ven en los registros.

## Licencia

MIT. Ver [LICENSE](LICENSE).
