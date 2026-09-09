# Empaquetado y actualizaciones

Instalador con `electron-builder` y actualizaciones automáticas con `electron-updater`.
Toda la configuración vive en la sección `build` de `package.json`; no hay archivos extra.

## Construir

```bash
npm install
npm run dist          # Windows: instalador NSIS
npm run dist:mac      # macOS: .dmg (solo desde macOS)
npm run dist:linux    # Linux: .AppImage (solo desde Linux)
```

Resultado en `dist/` (ignorada por git):

| Archivo | Qué es |
|---|---|
| `Agente Setup <versión>.exe` | Instalador. Pide carpeta de instalación, se instala por usuario (sin admin). |
| `Agente Setup <versión>.exe.blockmap` | Mapa de bloques: permite descargas diferenciales al actualizar. |
| `latest.yml` | Manifiesto que consulta `electron-updater` para saber si hay versión nueva. |
| `win-unpacked/` | La app sin empaquetar, útil para depurar. |

El instalador pesa ~186 MB porque incluye Electron y el CLI nativo del SDK
(`node_modules/@anthropic-ai/claude-agent-sdk-win32-x64/claude.exe`, ~219 MB sin comprimir).
Ese binario **no puede ejecutarse desde dentro del asar**, por eso `build.asarUnpack` incluye
`node_modules/@anthropic-ai/**` y queda en `resources/app.asar.unpacked/`.

### Icono

`build/icon.png` (512×512, PNG con transparencia). electron-builder genera el `.ico` de Windows y
los tamaños de macOS/Linux a partir de él. `build/icon.svg` es el mismo diseño en vectorial.
Para cambiarlo, sustituye el PNG por otro de al menos 512×512 y reconstruye.

### Firma de código

No hay certificado, así que `build.win.signExecutable` está en `false`: se aplican icono y
metadatos al `.exe` pero no se firma. Windows SmartScreen avisará al instalar
("Editor desconocido"). Si en algún momento hay certificado, quita esa línea y define
`CSC_LINK` / `CSC_KEY_PASSWORD`.

Si la construcción falla intentando firmar, ejecuta:

```bash
CSC_IDENTITY_AUTO_DISCOVERY=false npm run dist
```

## La clave de API en la app instalada

En desarrollo, `main.js` lee `.env` **junto a `main.js`** con `process.loadEnvFile`. Empaquetada,
`__dirname` apunta dentro del `app.asar`, así que ese `.env` no existe. Hay dos opciones:

1. **Variable de entorno del sistema** (recomendado): define `ANTHROPIC_API_KEY` en las variables
   de entorno del usuario de Windows y reinicia la app.
2. **Archivo `.env` junto al ejecutable instalado**: crea
   `%LOCALAPPDATA%\Programs\Agente\.env` (o la carpeta que hayas elegido al instalar) con:

   ```
   ANTHROPIC_API_KEY=sk-ant-...
   ```

   El bloque final de `main.js` carga ese archivo cuando `app.isPackaged`.

El `.env` del repositorio nunca se empaqueta (está excluido en `build.files`).

## Publicar una release para las actualizaciones

`electron-updater` consulta las *releases* de GitHub definidas en `build.publish`:

```json
"publish": { "provider": "github", "owner": "tu-usuario", "repo": "agente" }
```

**Cambia `owner` por tu usuario u organización de GitHub** (y `repo` si el repositorio se llama
distinto). Es un placeholder; mientras no sea real, la app no encontrará actualizaciones — no pasa
nada más: el error se ignora en silencio.

Pasos para publicar una versión nueva:

1. Sube la versión en `package.json` (`0.1.0` → `0.1.1`). Debe ser mayor que la instalada.
2. `npm run dist`.
3. Crea una release en GitHub con la etiqueta `v0.1.1` y sube **los tres artefactos** de `dist/`:
   - `Agente Setup 0.1.1.exe`
   - `Agente Setup 0.1.1.exe.blockmap`
   - `latest.yml`

   Sin `latest.yml` el actualizador no ve nada; sin el `.blockmap` funciona, pero descarga el
   instalador completo en vez de solo las diferencias.
4. Publica la release (no la dejes en borrador: las releases en borrador no son visibles para el
   actualizador).

Alternativa automática: `GH_TOKEN=<token> npx electron-builder --win --publish always` sube los
artefactos y crea la release en un paso.

## Cómo se comporta la actualización

Al arrancar la app instalada (`app.isPackaged`), `main.js` llama a
`autoUpdater.checkForUpdatesAndNotify()`:

- si hay versión nueva, se descarga en segundo plano y el sistema muestra una notificación;
- la actualización se aplica al cerrar y volver a abrir la app;
- cualquier error (sin red, `publish` sin configurar, release inexistente) se ignora y la app sigue
  funcionando con normalidad.

En desarrollo (`npm start`) el actualizador no se activa nunca.
