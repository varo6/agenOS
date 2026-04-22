# AgenOS Installer UI

Proyecto React del instalador guiado. El micro y la shell principal viven en `components/ui`.

## Desarrollo

```bash
cd components/installer-ui
bun install
bun dev
```

`bun dev` fuerza una sesión live local para poder programar el flujo del instalador sin depender de una VM.

## Separación con `components/ui`

- `components/ui`: shell principal del sistema, con el micro y el comando.
- `components/installer-ui`: instalador guiado y su backend Bun compartido.

## Comportamiento empaquetado

La VM sigue usando un único runtime empaquetado para no romper el arranque, pero monta dos frontends distintos:

- `/` sirve `components/ui`
- `/installer/` sirve `components/installer-ui`

## Estado actual del runtime

- `system` ya carga `components/ui` desde `system-dist/index.html` con `loadFile(...)`.
- `installer` sigue cargando por HTTP local.
- Bun permanece arrancado para compatibilidad, fallback del renderer y soporte del instalador.
- La lógica de `preflight`, `maintenance` y `switchMode` vive en `src/shared/system-services` y se reutiliza desde Bun y Electron main.

Detalle de arranque, bridge IPC y flags de rollout: [docs/installer/electron-system-shell.md](/home/varose/code/agenOS/docs/installer/electron-system-shell.md).
