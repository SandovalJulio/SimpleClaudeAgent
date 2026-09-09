---
name: ordenar-carpeta
description: Propone y aplica una organización de los archivos sueltos de la carpeta de trabajo en subcarpetas por tipo o tema (documentos, imágenes, hojas de cálculo, instaladores…). Úsala cuando el usuario pida "ordena", "organiza" o "limpia" la carpeta.
---
1. Lista los archivos de la raíz de la carpeta de trabajo (no entres en `.claude/`, `artifacts/` ni en
   subcarpetas ya existentes). Si hay más de 60 archivos, delega el inventario en el subagente "lector".
2. Agrupa por tipo o tema y propone una tabla: archivo → carpeta destino. Carpetas sugeridas:
   `Documentos`, `Imágenes`, `Hojas de cálculo`, `Presentaciones`, `Instaladores`, `Comprimidos`, `Otros`.
   Si detectas un tema claro (por ejemplo, facturas o un proyecto), propón una carpeta con ese nombre.
3. **No muevas nada todavía.** Muestra la propuesta y pide confirmación con AskUserQuestion
   (opciones: aplicar todo, aplicar solo algunas carpetas, cancelar).
4. Con la confirmación, crea las carpetas y mueve los archivos con comandos del sistema, uno por uno,
   sin sobrescribir: si el destino existe, añade un sufijo numérico.
5. Informa cuántos archivos se movieron a cada carpeta y guarda el detalle en `.claude/ordenar-carpeta.log`.
