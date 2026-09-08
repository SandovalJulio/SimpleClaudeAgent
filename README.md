# Agente de escritorio (Electron + Claude Agent SDK)

App de escritorio tipo Cowork sobre el Claude Agent SDK. Sin frameworks ni bundler.
La arquitectura, los módulos y los contratos IPC están en `docs/ARQUITECTURA.md`.

## Requisitos
- Node 18+
- `.env` junto a `main.js` con `ANTHROPIC_API_KEY=sk-ant-...` (o la variable en el sistema).

## Uso
```bash
npm install
npm start
```
No hay compilación: para ver cambios cierra la app y vuelve a ejecutar `npm start`.
Con la app abierta, `Ctrl+R` recarga la interfaz y `Ctrl+Shift+I` abre DevTools.

## Qué hace
- **Carpeta de trabajo**: por defecto `Documentos\Agente`; se recuerda la última elegida.
- **Conversaciones en paralelo**: varias a la vez, cada una con su proceso del SDK. La barra
  lateral las lista con indicador de actividad. **Historial** de sesiones anteriores de la carpeta:
  clic para continuar, clic derecho para bifurcar en una copia.
- **Compositor**: `+` adjunta archivos (o arrástralos a la ventana), `/` abre las skills,
  píldora de modelo y razonamiento, píldora de permisos, micrófono (dictado del navegador; si no
  está disponible usa Win+H), enviar / detener.
- **Permisos**: Planificar (plan con aprobación antes de ejecutar), Preguntar (pide permiso por
  cada escritura o comando con tarjetas en el hilo), Auto, Total. Se cambian en caliente.
- **Preguntas del agente** como formulario con opciones y campo libre; elicitación MCP.
- **Deshacer archivos**: cada respuesta que modificó archivos tiene "Revertir archivos de esta
  respuesta" (checkpoints del SDK).
- **Archivos producidos** por turno como chips con abrir, carpeta y vista previa. **Artifacts**:
  el agente guarda páginas, dashboards o informes como HTML en `artifacts/` y la app los abre en el
  panel lateral automáticamente.
- **Skills** en `<carpeta>/.claude/skills/<nombre>/SKILL.md`; el agente las crea y edita.
- **Memoria y perfil** en `<carpeta>/CLAUDE.md` (secciones Memoria y Perfil), editable en
  Configuración. La app registra sin gastar tokens las extensiones de archivo usadas.
  "Obtener sugerencia" aparece con al menos cinco memorias.
- **Sugerencias de siguiente mensaje** y **resumen de progreso** mientras trabaja.
- **Costo por respuesta** (USD, tokens, tiempo) y gasto acumulado. **Tope de gasto** y de turnos.
- **Configuración**: nombre, memorias, apariencia y fuente, notificaciones del sistema,
  búsqueda web, sandbox para comandos, directorios adicionales, plugins locales, conexiones MCP
  sin claves (navegador, grafo de conocimiento, razonamiento) y **tareas programadas** (cada
  hora, diaria o semanal; resultado en `.claude/programadas/` y notificación).

## Pruebas
```bash
npm test                     # abre la app y pulsa cada control, sin gastar tokens
UI_TEST_LIVE=1 npm test      # además: permiso interactivo, archivo creado, revertir, sugerencia, historial (centavos)
node test/scheduler.test.js  # planificador
```

## Estructura
```
main.js              ventana, atajos, notificaciones, IPC
preload.js           window.agente
src/main/            config.js · memory.js · agent.js · scheduler.js
renderer/            index.html · styles.css · app.js · chat.js · composer.js · settings.js · dialogs.js · files.js · schedules.js
test/                ui.js · scheduler.test.js · demos
docs/ARQUITECTURA.md contratos IPC y eventos
```
