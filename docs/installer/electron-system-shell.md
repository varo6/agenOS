# Electron system shell

Estado actual del runtime empaquetado para `components/ui` y `components/installer-ui`.

## Modos de arranque

- `APP_KIND=system`
  - Electron carga `system-dist/index.html` con `BrowserWindow.loadFile(...)`.
  - El renderer de `components/ui` intenta usar `window.agenosSystem` primero.
  - Si el bridge IPC no está disponible o se fuerza `AGENOS_SYSTEM_BRIDGE_MODE=http`, el renderer cae al API Bun en `http://127.0.0.1:4173`.

- `APP_KIND=installer`
  - Electron mantiene `BrowserWindow.loadURL(AGENOS_INSTALLER_URL)`.
  - El instalador guiado sigue funcionando sobre HTTP local sin cambios de flujo.

## Bridge IPC del sistema

El preload expone una superficie mínima en `window.agenosSystem`:

- `getPreflight()`
- `runMaintenance(action)`
- `switchMode(mode)`
- `getRuntimeInfo()`
- `isAvailable()`

Todos los canales usan `ipcMain.handle` y `ipcRenderer.invoke` con estos ids:

- `agenos-system:get-preflight`
- `agenos-system:run-maintenance`
- `agenos-system:switch-mode`
- `agenos-system:get-runtime-info`

La lógica real vive en `components/installer-ui/src/shared/system-services`, y Bun reutiliza esa misma capa mediante wrappers finos.

## Flujo de arranque empaquetado

1. `agenos-installer` sigue levantando Bun para compatibilidad, fallback HTTP y modo installer.
2. `agenos-installer-ui` arranca Electron y exporta:
   - `AGENOS_SYSTEM_DIST_DIR`
   - `AGENOS_SYSTEM_BRIDGE_MODE`
   - `AGENOS_ELECTRON_GPU_MODE`
3. En modo `system`, Electron monta `electron-app/main.cjs`, carga `system-dist/index.html` y activa `preload.cjs` cuando existe.
4. En modo `installer`, Electron mantiene la carga por `APP_URL`.

## Rollout y GPU

- `AGENOS_SYSTEM_BRIDGE_MODE=ipc|http`
  - `ipc` por defecto.
  - `http` desactiva el bridge para el renderer sin cambiar el binario.

- `AGENOS_ELECTRON_GPU_MODE=auto|on|off`
  - `installer` sigue forzado a `off`.
  - `system` usa:
    - `on` si se pide explícitamente.
    - `off` si se pide explícitamente.
    - `auto` por defecto, arrancando con GPU activa y persistiendo fallback a `off` en `/run/user/<uid>/agenos-installer/electron-gpu-mode` si hay crash antes de carga estable.
