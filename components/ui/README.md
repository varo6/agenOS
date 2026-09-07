# AgenOS UI

Proyecto React de la shell principal del sistema. Aquí vive el micro, el comando local y la entrada mínima al mantenimiento.

## Desarrollo local

```bash
cd components/ui
bun install --frozen-lockfile
bun run install:electron
bun dev
```

Eso levanta Vite en `http://127.0.0.1:4174` con un backend mock solo para desarrollo. Por defecto simula una sesión instalada para que la shell quede aislada del instalador.

Si quieres forzar también el acceso discreto al instalador, usa:

```bash
cd components/ui
bun run dev:live
```

## Separación con `components/installer-ui`

- `components/ui`: shell del sistema.
- `components/installer-ui`: instalador guiado.

En la VM se empaquetan ambos en el mismo runtime compartido, pero cada uno mantiene su propio build y su propia carpeta.

## Runtime empaquetado

En modo `system`, esta UI tiene su propio runtime Electron compilado desde `components/ui/src/electron`. La imagen live lo empaqueta en `/opt/agenos/system` y `/usr/local/bin/agenos-system-app` arranca ese paquete directamente.

Electron monta `dist/index.html` con `loadFile(...)` y el renderer consume capacidades nativas mediante clientes con dos caminos:

- IPC por `window.agenosSystem` y `window.agenosPi` cuando el preload está disponible.
- Fallback HTTP al API Bun para desarrollo web, rollback y compatibilidad.

El flujo detallado está documentado en [docs/installer/electron-system-shell.md](../../docs/installer/electron-system-shell.md).
