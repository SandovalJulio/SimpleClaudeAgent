# Agente de escritorio (Electron + Claude Agent SDK)

App de escritorio con interfaz tipo Cowork. Todo lo "inteligente" (herramientas, skills,
memoria en CLAUDE.md, sesiones, permisos, MCP) lo aporta el Claude Agent SDK. Aquí hay una
ventana, un puente IPC y una UI sin frameworks.

## Requisitos
- Node 18+
- Archivo `.env` junto a `main.js` con `ANTHROPIC_API_KEY=sk-ant-...`
  (o la variable ya definida en el sistema).

## Uso
```bash
npm install
npm start
```
1. **Elegir carpeta** en la barra lateral. El agente trabaja con `cwd` en esa carpeta
   y se recuerda entre arranques.
2. Escribe en el compositor o usa las tarjetas de inicio:
   - **Explorar la carpeta**: resumen de su contenido.
   - **Crear una skill**: rellena una plantilla con nombre y pasos.
   - **Trabajar con archivos**: adjunta archivos y pregunta sobre ellos.
   - **Mejorar una skill**: elige una existente y describe el cambio.
   - **Obtener sugerencia**: sustituye a "Explorar" cuando el agente ya sabe lo suficiente
     de ti. Analiza memoria, perfil y skills y propone una o dos mejoras concretas.

## Compositor
- `+` adjunta archivos (se pasan como rutas; el agente los lee con Read).
- `/` abre la lista de skills. También puedes escribir `/` al inicio para filtrar.
- Píldora de **modelo** y **razonamiento** (bajo, medio, alto).
- Píldora de **permisos**: Solo lectura, Auto (edita archivos) o Total (sin confirmaciones).
- Botón de enviar, que pasa a detener mientras el agente trabaja.

## Skills
Una skill es `<carpeta>/.claude/skills/<nombre>/SKILL.md`. El agente la crea con Write
cuando se lo pides, y la edita cuando la refinas. Aparece en la barra lateral: clic para
insertar `/nombre`, clic derecho para abrir el archivo. Las skills en `~/.claude/skills`
son globales.

## Memoria y perfil
- El agente guarda correcciones y preferencias en `<carpeta>/CLAUDE.md` bajo `## Memoria`,
  y lo que aprende de tu tipo de trabajo bajo `## Perfil`. Ese archivo lo carga el SDK
  automáticamente en cada sesión.
- Si la corrección es sobre una skill, edita su SKILL.md en vez de anotarla.
- La app registra sin gastar tokens las extensiones de archivo que se usan y el número de
  tareas en `<carpeta>/.claude/perfil.json`, y lo inyecta resumido en el system prompt.
- En **Configuración › Memorias** puedes ver y editar el CLAUDE.md completo.

## Configuración
- Tu nombre (el agente lo usa al dirigirse a ti).
- Memorias editables.
- Apariencia (sistema, claro, oscuro) y fuente del chat.
- **Conexiones**: servidores MCP sencillos sin claves, activables con un interruptor:
  navegador web (Playwright), grafo de conocimiento y razonamiento paso a paso. Se
  descargan con `npx` la primera vez. La lista está en `CONNECTIONS` en `main.js`.

## Costo
Cada respuesta muestra costo en USD, modelo, tokens y tiempo. El pie de la barra lateral
acumula el gasto de la sesión. La lista de modelos y precios está en `MODELS` en `main.js`.

## Pruebas
```bash
npm test                 # abre la app, pulsa cada botón y comprueba el resultado (sin gastar tokens)
UI_TEST_LIVE=1 npm test  # además lanza una consulta real con Haiku (unos centavos)
```
Usa una carpeta temporal con una skill y tres memorias de ejemplo. Requiere `playwright-core`
(ya en devDependencies); no descarga navegadores porque se conecta al propio Electron.

## Archivos
- `main.js`: ventana, carpeta, skills, memoria, perfil, configuración y `query()` del SDK.
- `preload.js`: expone `window.agente` al HTML de forma segura.
- `index.html`: interfaz completa (`marked` para Markdown).
