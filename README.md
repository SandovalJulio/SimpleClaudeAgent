# Agente

Un agente de escritorio para Windows, macOS y Linux construido sobre el **Claude Agent SDK**, con
una interfaz al estilo de Claude Cowork. Elige una carpeta, describe la tarea y el agente lee,
escribe, ejecuta comandos, crea **skills** reutilizables y **recuerda tus correcciones**.

El proyecto es deliberadamente pequeño: **~3 600 líneas en total, sin frameworks, sin bundler,
sin TypeScript, sin base de datos**. Todo lo difícil (el bucle del agente, las herramientas, los
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

Dependencias de ejecución: `@anthropic-ai/claude-agent-sdk` y `marked`. Nada más.

## Instalación

Requisitos: Node 18 o superior y una clave de API de Anthropic.

```bash
git clone https://github.com/<tu-usuario>/agente.git
cd agente
npm install
```

Crea un archivo `.env` junto a `main.js`:

```
ANTHROPIC_API_KEY=sk-ant-...
```

Arranca:

```bash
npm start
```

No hay paso de compilación. Para ver cambios en el proceso principal, cierra la app y vuelve a
ejecutar `npm start`. Con la app abierta, `Ctrl+R` recarga la interfaz y `Ctrl+Shift+I` abre las
herramientas de desarrollo.

## Primer uso

1. La app arranca con la carpeta `Documentos\Agente` como espacio de trabajo. Cámbiala desde la
   barra lateral si quieres trabajar sobre otra.
2. Escribe una tarea o pulsa una tarjeta de inicio.
3. Para crear tu primera skill, pulsa **Crear una skill**, pon un nombre y describe los pasos.
   Aparecerá en la barra lateral y podrás invocarla con `/nombre`.
4. Corrige al agente cuando haga algo que no te guste. Lo guardará en la memoria de la carpeta y lo
   aplicará en las siguientes conversaciones.

## Funciones

### Conversación
- **Conversaciones en paralelo.** Varias a la vez, cada una con su propio proceso del SDK. La barra
  lateral las lista con un indicador de actividad.
- **Historial.** Sesiones anteriores de la carpeta. Clic para continuar donde lo dejaste; clic
  derecho para bifurcar una copia sin tocar la original.
- **Streaming** de texto y **resumen de progreso** mientras el agente trabaja.
- **Línea de actividad** plegable con cada herramienta usada, el archivo o comando afectado y su
  resultado.
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
- **Revertir archivos de esta respuesta**: restaura los archivos al estado anterior a tu mensaje
  usando los checkpoints del SDK.

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
- muestra una notificación del sistema.

Las tareas solo se ejecutan mientras la app está abierta. Si estuvo cerrada, la tarea pendiente se
ejecuta una sola vez al volver y se recalcula la siguiente.

## Conexiones (MCP)

Servidores MCP listos para activar con un interruptor, sin claves ni configuración. Se descargan
con `npx` la primera vez:

| Conexión | Qué aporta |
|---|---|
| Navegador web | Abrir páginas, leer contenido y hacer clics (Playwright). |
| Grafo de conocimiento | Memoria estructurada de entidades y relaciones. |
| Razonamiento paso a paso | Descomposición de problemas complejos. |

Para añadir otra, edita `CONNECTIONS` en `src/main/config.js` con el paquete npm del servidor.

## Configuración

| Sección | Opciones |
|---|---|
| General | Cómo quieres que el agente te llame. |
| Memorias | Editor del `CLAUDE.md` de la carpeta, con resumen de entradas y archivos más usados. |
| Preferencias | Apariencia (sistema, claro, oscuro), fuente del chat, notificaciones. |
| Límites | Tope de gasto en USD y máximo de turnos por conversación. |
| Herramientas | Búsqueda web (WebSearch y WebFetch), sandbox para comandos, directorios adicionales, plugins locales de Claude Code. |
| Conexiones | Interruptores de los servidores MCP. |
| Tareas programadas | Lista y formulario. |

La configuración se guarda en `config.json` dentro de la carpeta de datos del usuario
(`%APPDATA%\agente-escritorio` en Windows).

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
main.js                  Ventana, atajos, notificaciones, registro de IPC (≈100 líneas)
preload.js               Expone window.agente al renderer
src/main/
  config.js              Configuración persistente, carpeta, catálogos (modelos, permisos, conexiones)
  memory.js              Skills, CLAUDE.md, perfil sin tokens, system prompt adicional
  agent.js               Conversaciones (streaming-input), permisos, rewind, sesiones, runOnce
  scheduler.js           Tareas programadas
renderer/
  index.html             Marcado base y orden de carga
  styles.css             Tokens, layout, chat, compositor, configuración
  app.js                 Estado global, utilidades, bus interno, tema
  chat.js                Conversaciones en paralelo, mensajes, actividad, costo, historial
  composer.js            Adjuntos, arrastrar y soltar, dictado, menú /, píldoras
  settings.js            Modal de configuración
  dialogs.js             Tarjetas de permiso, preguntas, plan y elicitación
  files.js               Chips de archivos producidos y panel de vista previa
  schedules.js           Sección de tareas programadas
docs/ARQUITECTURA.md     Contratos IPC y eventos entre main y renderer
test/                    ui.js (prueba real sobre Electron), scheduler.test.js, demos
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
- **Subagentes especializados**: opción `agents` del SDK en `buildOptions`.
- **Hooks** (registro, bloqueo de rutas): opción `hooks` del SDK en `buildOptions`.
- **Salida estructurada** (JSON con esquema): opción `outputFormat` en `runOnce` para tareas
  programadas.
- **Instalador**: `electron-builder` sobre `package.json`; no hay nada que compilar antes.

Lo que no está y sería un cambio mayor: conexiones con OAuth (GitHub, Google Drive), ejecución
remota, y sincronización de memoria entre equipos.

## Pruebas

```bash
npm test                     # abre el Electron real y pulsa cada control; ~30 comprobaciones; sin tokens
UI_TEST_LIVE=1 npm test      # además, con Haiku: permiso interactivo, archivo creado, revertir,
                             # sugerencia, historial y reanudar sesión (unos centavos)
node test/scheduler.test.js  # planificador
```

La prueba de UI se conecta al Electron real por el protocolo de depuración de Chromium con
`playwright-core`, usa una carpeta de trabajo y una carpeta de datos temporales, y cierra todos los
procesos al terminar. No altera tu configuración.

## Limitaciones conocidas

- **Dictado**: Electron no incluye el servicio de reconocimiento de voz de Google, así que el
  micrófono puede no funcionar. La app lo detecta y sugiere el dictado del sistema (Win+H en
  Windows), que escribe directamente en el cuadro.
- **Sandbox** de comandos: depende del sistema. En Windows nativo requiere que el SDK tenga sus
  dependencias de aislamiento; si no, los comandos se ejecutan sin aislar y se avisa.
- **Tareas programadas** solo corren con la app abierta.
- Las conexiones MCP de tu instalación de Claude Code (`~/.claude`) también se cargan y aparecen
  como "needs-auth"; no afecta a la app, pero se ven en los registros.

## Licencia

MIT. Ver [LICENSE](LICENSE).
