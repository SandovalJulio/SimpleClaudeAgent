---
name: resumir-documento
description: Resume uno o varios documentos adjuntos o de la carpeta (PDF, Word exportado a texto, Markdown, TXT) en viñetas claras con las ideas clave, decisiones y pendientes. Úsala cuando el usuario pida "resume", "de qué trata" o "puntos clave" de un archivo.
---
1. Identifica los archivos a resumir: los adjuntos del mensaje o los que el usuario nombre. Si no hay
   ninguno, pregunta cuál (herramienta AskUserQuestion) antes de seguir.
2. Lee cada archivo completo. Si es muy largo (más de ~200 líneas), delega la lectura en el subagente
   "lector" y trabaja con su resumen.
3. Escribe el resumen con esta estructura, en español y sin adornos:
   - **De qué trata** (dos frases).
   - **Ideas clave** (3 a 7 viñetas).
   - **Decisiones o cifras importantes** (si las hay).
   - **Pendientes o siguientes pasos** (si los hay).
4. Si el usuario lo pide, guarda el resumen en `resumenes/<nombre-del-archivo>.md` dentro de la carpeta.
5. Termina preguntando si quiere el resumen más corto, más largo o en otro formato (tabla, correo).
