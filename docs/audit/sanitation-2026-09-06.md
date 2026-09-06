# Saneamiento del 6 de septiembre de 2026

Base: `a8aa990`, rama `fix/memory-and-runtime-quality`,
[PR #13](https://github.com/varo6/agenOS/pull/13), abierta al revisar el repositorio.
El cambio funcional de esa revisión es `0778116`: persistencia de respuestas
guardadas, recuperación de capturas y actualización de dependencias y empaquetado.
La PR también incluye la voz remota de `feat/optional-remote-tools`.

La carpeta original estaba en `feat/optional-remote-tools`, con cambios locales
pendientes y el commit `7e0dc18`, que solo añade `.claude/` a `.gitignore`.
El saneamiento se preparó en otro worktree, rama `chore/sanitize-runtime`.

## Cambios

- El lanzador de Chromium devuelve directamente el resultado del arranque.
  Se elimina el transporte y la reasignación de argumentos que nadie consultaba.
  Conserva los reintentos mediante XWayland y sin scope de systemd.
- Se eliminan imports, una constante y parámetros sin uso en aplicaciones,
  NetworkManager, Calamares, trazas web y un doble de STT.
- Se elimina `REMOTE_SECRET_ENV_NAMES`, un alias exportado sin consumidores.
- Los comentarios de voz describen el comportamiento del código y omiten
  afirmaciones sobre precios y exclusividad de proveedores.

Los paquetes revisados tienen consumidores, incluidos Codex para autenticación,
Framer Motion para las animaciones y las fuentes de ambas interfaces.
No se han modificado manifiestos ni lockfiles.

## Comprobaciones

- `make test`: 1.154 pruebas superadas, más las comprobaciones de hashes de build.
  Incluye el arranque de Chromium y su respaldo XWayland.
- `bun run build` en UI e instalador: compilaciones de producción superadas.
- Los dos proyectos TypeScript de cada aplicación pasan también con
  `--noUnusedLocals --noUnusedParameters`.
- `git diff --check`: sin errores de espacios.

No hay una suite independiente en `components/network/node`; el cambio allí
solo elimina una constante y un argumento sin uso, y pasa los typechecks.
No se ha construido ni arrancado una ISO, probado audio real o hardware físico.
