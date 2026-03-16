# Migracion del instalador a Electrobun

## Objetivo

Reemplazar el runtime actual de tres piezas del instalador:

- UI React servida por `components/installer-ui`
- API HTTP local en `build/live-build/config/includes.chroot/usr/local/lib/agenos-installer/server.py`
- Chromium en modo kiosk apuntando a `http://127.0.0.1:4173`

por una sola app Electrobun que:

- conserva las mismas vistas React y el mismo flujo guiado
- elimina la dependencia de `fetch("/api/...")` y del servidor HTTP local
- sigue delegando el lanzamiento privilegiado de Calamares al helper actual en la primera iteracion

La meta de la v1 no es cambiar el flujo, sino reducir moving parts sin tocar el contrato funcional del instalador guiado.

## Estado actual del repo

### Flujo de UI

`components/installer-ui/src/App.tsx` hace hoy cinco cosas de integracion:

- `GET /api/preflight`
- `GET /api/disks`
- `POST /api/validate-profile`
- `POST /api/start-guided`
- `POST /api/start-classic`

El flujo visible es:

`welcome -> language -> disk -> identity -> confirm -> handoff`

### Backend actual

`server.py` mezcla tres responsabilidades:

- servir `index.html` y assets estaticos desde `/usr/local/share/agenos-installer-ui`
- exponer la API HTTP local
- inyectar el token de sesion en el HTML para proteger los `POST`

`common.py` contiene casi toda la logica no privilegiada:

- preflight
- descubrimiento de discos
- validacion y normalizacion del perfil

`agenos-installer-helper` ya encapsula lo delicado y privilegiado:

- `pkexec`
- preparacion del entorno GUI para X11/Wayland
- generacion de config temporal de Calamares
- lanzamiento de Calamares guiado o clasico

Ese helper es el mejor limite de compatibilidad para la primera migracion.

## Decision de arquitectura

La recomendacion para este repo es:

1. Convertir `components/installer-ui` en la app Electrobun, no crear un segundo arbol paralelo.
2. Portar `common.py` a Bun/TypeScript en la primera iteracion.
3. Mantener `agenos-installer-helper` en Python para `launchGuided()` y `launchClassic()`.
4. Eliminar `server.py`, `agenos-installer-server` y el transporte HTTP.
5. Sustituir Chromium por una ventana Electrobun fullscreen cargada con `views://mainview/index.html`.

### Por que portar `common.py` ya

Mantener Python solo para `preflight`, `disks` y `validate-profile` ahorra poco y deja una frontera innecesaria. `common.py` es pequeno, deterministico y mayormente hace:

- lectura de `/proc`
- llamada a `lsblk -J`
- validacion de strings
- normalizacion del JSON de perfil

Eso es una portacion directa y reduce el numero de procesos incluso en la v1.

### Por que mantener `agenos-installer-helper` en la v1

El helper actual ya resuelve quirks reales del entorno live:

- `pkexec`
- `XAUTHORITY`
- `WAYLAND_DISPLAY`
- `DBUS_SESSION_BUS_ADDRESS`
- `xhost` temporal para root en X11
- config temporal de Calamares y limpieza posterior

Mover eso a Bun el primer dia sube el riesgo y no mejora la UX. Ese es el trozo correcto para dejar estable y portar mas tarde, si compensa.

## Layout propuesto

La ruta mas simple es evolucionar `components/installer-ui` in place:

```text
components/installer-ui/
  package.json
  tsconfig.json
  electrobun.config.ts
  src/
    bun/
      index.ts
      window.ts
      rpc.ts
      installer/
        disks.ts
        preflight.ts
        validate-profile.ts
        launch.ts
        runtime.ts
    shared/
      installer-types.ts
      installer-rpc.ts
    views/
      mainview/
        index.html
        main.tsx
        App.tsx
        styles.css
        installer-client.ts
```

### Mapeo desde el estado actual

- `components/installer-ui/src/App.tsx` -> `components/installer-ui/src/views/mainview/App.tsx`
- `components/installer-ui/src/main.tsx` -> `components/installer-ui/src/views/mainview/main.tsx`
- `components/installer-ui/src/styles.css` -> `components/installer-ui/src/views/mainview/styles.css`
- `build/live-build/.../common.py` -> `components/installer-ui/src/bun/installer/*`
- `build/live-build/.../server.py` -> desaparece
- `build/live-build/.../agenos-installer-helper` -> se mantiene

## Boundary de responsabilidades

### `src/bun/index.ts`

Responsabilidades:

- crear una sola ventana fullscreen
- usar `renderer: "native"` en Linux
- cargar `views://mainview/index.html`
- registrar los handlers RPC
- bloquear navegacion remota no deseada
- centralizar logs y errores fatales

No debe contener logica de validacion ni parsing de `lsblk`.

### `src/bun/installer/*`

Responsabilidades:

- `preflight.ts`: firmware, live session, RAM y checks
- `disks.ts`: invocacion a `lsblk`, filtrado y normalizacion
- `validate-profile.ts`: validacion y normalizacion del payload
- `launch.ts`: escritura de `profile.json`, invocacion del helper y seguimiento del proceso
- `runtime.ts`: paths en `/run/user/<uid>/agenos-installer`, logs y utilidades comunes

### `src/views/mainview/*`

Responsabilidades:

- conservar la UI y el wizard actual
- cambiar `fetch()` por un cliente RPC tipado
- mantener el estado de formulario, errores y pasos

La UI no deberia conocer `pkexec`, rutas en `/run/user`, ni detalles de `lsblk`.

### `src/shared/*`

Responsabilidades:

- tipos compartidos del perfil
- tipos de respuesta de preflight y discos
- schema del RPC

Aqui debe vivir el contrato entre Bun y React.

## RPC propuesto

El shape exacto puede ajustarse al API tipado de Electrobun, pero el contrato funcional deberia quedar asi:

```ts
export type InstallerRpc = {
  bun: {
    requests: {
      getPreflight: {
        params: undefined;
        response: PreflightResponse;
      };
      getDisks: {
        params: undefined;
        response: DiskSummary[];
      };
      validateProfile: {
        params: InstallerProfilePayload;
        response: ValidationResponse;
      };
      launchGuided: {
        params: InstallerProfilePayload;
        response: LaunchResponse;
      };
      launchClassic: {
        params: undefined;
        response: LaunchResponse;
      };
      getRuntimeInfo: {
        params: undefined;
        response: {
          platform: "linux";
          renderer: "native" | "cef";
          version: string;
        };
      };
    };
    messages: {
      launchState: {
        phase: "starting" | "running" | "failed" | "exited";
        message: string;
      };
    };
  };
  webview: {
    requests: {};
    messages: {};
  };
};
```

### Traduccion directa de endpoints actuales

- `GET /api/preflight` -> `getPreflight()`
- `GET /api/disks` -> `getDisks()`
- `POST /api/validate-profile` -> `validateProfile(profile)`
- `POST /api/start-guided` -> `launchGuided(profile)`
- `POST /api/start-classic` -> `launchClassic()`

## Cambios concretos en React

La UI puede quedarse casi igual. Los cambios reales son pocos:

1. Mover los archivos actuales a `src/views/mainview/`.
2. Sustituir `apiGet()` y `apiPost()` por un cliente RPC.
3. Eliminar el bootstrap de `window.__AGENOS_INSTALLER__` y el `sessionToken`.
4. Mantener la validacion local previa al salto remoto.
5. Mantener intacto el shape del `InstallerProfilePayload`.

La refactorizacion minima en UI es introducir una sola capa:

`src/views/mainview/installer-client.ts`

con una interfaz como:

```ts
export const installerClient = {
  getPreflight(): Promise<PreflightResponse>,
  getDisks(): Promise<DiskSummary[]>,
  validateProfile(profile: InstallerProfilePayload): Promise<ValidationResponse>,
  launchGuided(profile: InstallerProfilePayload): Promise<LaunchResponse>,
  launchClassic(): Promise<LaunchResponse>,
};
```

Eso permite tocar muy poco `App.tsx`.

## Contrato de perfil que no debe romperse

Aunque Bun sustituya al servidor Python, el JSON entregado al helper y consumido por `agenosseed` debe seguir siendo compatible con el formato actual:

- `schemaVersion`
- `locale`
- `localeCode`
- `localeConf`
- `timezone`
- `keyboardLayout`
- `keyboardVariant`
- `targetDisk`
- `user.fullName`
- `user.username`
- `user.hostname`
- `user.password`
- `installMode`
- `rootMode`

Ese contrato ya lo consume el modulo Calamares `agenosseed`, asi que en la migracion no conviene redisenarlo.

## Ventana y renderer

Configuracion objetivo:

- una sola ventana
- fullscreen
- sin URL remota
- `views://mainview/index.html`
- `renderer: "native"` en Linux

### Riesgo principal

En Linux native mode el renderer depende del webview del sistema, no de Chromium. En la practica eso significa:

- posibles diferencias de CSS
- especial atencion a `backdrop-filter`, blur y composicion
- necesidad de probar en VM real con la ISO, no solo en host

### Mitigacion recomendada

Mantener una opcion de build para alternar:

- renderer nativo por defecto
- CEF como fallback empaquetable

No hace falta usar CEF en la primera entrega si la UI actual pasa las pruebas visuales, pero conviene no cerrar esa puerta en la arquitectura.

## Lanzamiento de Calamares

La logica de lanzamiento desde Bun deberia replicar la semantica actual de `server.py`:

### `launchGuided(profile)`

- validar y normalizar el perfil
- escribir `profile.json` en `/run/user/<uid>/agenos-installer/`
- invocar:
  `pkexec /usr/local/bin/agenos-installer-helper guided --profile <path>`
- si el helper falla de inmediato, devolver error al renderer
- si arranca, pasar a pantalla de handoff

### `launchClassic()`

- invocar:
  `pkexec /usr/local/bin/agenos-installer-helper classic`
- misma semantica de error/success que hoy

### Recomendacion

Preservar el log actual en runtime dir, por ejemplo:

`/run/user/<uid>/agenos-installer/helper.log`

para no perder trazabilidad cuando falle `pkexec` o Calamares.

## Packaging en la ISO

### Cambios de build

Sustituir el empaquetado de assets estaticos por el empaquetado de la app Electrobun:

- `scripts/build-installer-ui.sh` deja de copiar `dist/` a `/usr/local/share/agenos-installer-ui`
- en su lugar debe generar el bundle/binario Electrobun y copiarlo a algo como:
  `/opt/agenos/installer/`

Layout recomendado dentro del chroot:

```text
/opt/agenos/installer/
  agenos-installer
  resources/
    mainview/...
```

### Wrapper de lanzamiento

Crear un wrapper estable:

`/usr/local/bin/agenos-installer-app`

que haga solo:

```sh
exec /opt/agenos/installer/agenos-installer
```

Eso desacopla systemd del path exacto del bundle.

### Systemd / sesion live

Para la primera iteracion, la opcion mas segura es mantener el mismo modelo de sesion kiosk y cambiar solo el comando final:

antes:

```sh
cage -- chromium --kiosk --app=http://127.0.0.1:4173
```

despues:

```sh
cage -- /usr/local/bin/agenos-installer-app
```

Eso elimina Chromium y HTTP sin reabrir al mismo tiempo la discusion de si Cage debe seguir o no.

### Dependencias de paquetes

Secuencia recomendada:

1. Anadir primero las dependencias necesarias para Electrobun/native webview en Debian live.
2. Verificar arranque y render en VM.
3. Quitar `chromium`, `chromium-common` y `chromium-sandbox`.

No conviene quitar Chromium antes de validar que el renderer nativo arranca bien en la ISO real.

## Fases recomendadas

### Fase 1: quitar HTTP y Chromium

Entregable:

- app Electrobun funcional
- mismas pantallas React
- RPC tipado
- helper Python intacto

Cambios:

- mover UI a `src/views/mainview`
- portar `common.py` a TS
- introducir RPC
- empaquetar la app Electrobun en la ISO
- cambiar el comando de lanzamiento en la sesion live

### Fase 2: limpiar runtime legacy

Entregable:

- borrar `server.py`
- borrar `agenos-installer-server`
- borrar el bootstrap token y cualquier resto de `/api/*`
- borrar el asset root `/usr/local/share/agenos-installer-ui`

### Fase 3: evaluar portar el helper

Solo si la v1 ya es estable.

Motivos validos para hacerlo:

- reducir aun mas procesos
- unificar logs en TypeScript
- simplificar mantenimiento

Motivos para no hacerlo:

- el helper actual ya funciona
- el riesgo esta en GUI privilege handoff, no en la UI
- el beneficio de producto es pequeno frente al coste

## Orden de implementacion recomendado

1. Crear `src/shared/installer-types.ts` con los tipos que hoy estan duplicados dentro de `App.tsx`.
2. Mover `App.tsx`, `main.tsx` y `styles.css` a `src/views/mainview/`.
3. Crear `src/views/mainview/installer-client.ts` y cambiar `fetch()` por llamadas RPC.
4. Portar `common.py` a `src/bun/installer/`.
5. Implementar `src/bun/index.ts` con ventana y handlers RPC.
6. Añadir `launch.ts` que invoque al helper existente.
7. Crear el wrapper `/usr/local/bin/agenos-installer-app`.
8. Actualizar la build de live-build para copiar el bundle Electrobun.
9. Cambiar el servicio/launcher de la sesion live.
10. Borrar la ruta HTTP legacy cuando la smoke test pase.

## Checklist de aceptacion

- la app abre sin escuchar en `127.0.0.1:4173`
- no quedan llamadas `fetch("/api/...")` en `components/installer-ui`
- el flujo guiado completo sigue llegando a `handoff`
- `launchClassic()` abre Calamares clasico
- `launchGuided()` sigue escribiendo un perfil compatible con `agenosseed`
- el filtrado de discos excluye el live medium como hoy
- las validaciones de locale/timezone/username/hostname siguen dando los mismos errores funcionales
- la app funciona en VM con UEFI
- la app funciona en VM con BIOS
- el estilo sigue siendo aceptable bajo renderer nativo en Linux

## Riesgos abiertos

- diferencias visuales de WebKitGTK frente a Chromium
- dependencias exactas del renderer nativo dentro de Debian 12 live
- comportamiento de fullscreen/focus bajo Cage + native webview
- necesidad eventual de fallback a CEF si algun efecto visual importante no renderiza bien

## Resumen ejecutivo

Para este repo, la migracion correcta no es Bun por un lado y Python por otro en toda la API. La frontera buena es otra:

- React se mantiene
- HTTP desaparece
- `common.py` se porta a TypeScript
- `agenos-installer-helper` se conserva inicialmente
- la ISO lanza una app Electrobun en vez de Chromium

Eso da el mismo flujo con menos piezas, reduce memoria y elimina la red local artificial sin tocar el tramo mas delicado del handoff a Calamares.
