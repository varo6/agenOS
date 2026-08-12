# Informe ws2-browser: lanzamiento fiable de aplicaciones

## Resultado

Se sustituyeron los lanzamientos gráficos *fire-and-forget* por una política común y verificable. Chromium, aplicaciones `.desktop` y apertura de ficheros ahora:

1. resuelven el entorno gráfico y el ejecutable con el mismo `PATH` que recibirá el proceso;
2. capturan `stderr`, errores de `spawn` y salidas tempranas no exitosas;
3. toman una instantánea del árbol de Sway antes de lanzar;
4. esperan a que aparezca una ventana nueva o activada;
5. solo entonces la mueven, ponen en fullscreen y enfocan en el workspace solicitado;
6. devuelven un timeout o diagnóstico accionable en español si no se puede confirmar el resultado.

Pi dispone además de `browser_open`, por lo que una petición como «abre YouTube» ya no se interpreta como una aplicación local llamada YouTube: el modelo recibe instrucciones explícitas para abrir `https://www.youtube.com/` en Chromium.

No se ejecutó ningún build de ISO.

## Causas raíz confirmadas

### 1. Éxito falso y fallos mudos

`browser-launcher.ts`, `apps.ts` y `files.ts` tenían implementaciones separadas de `spawn`, normalmente con `detached: true` y `stdio: "ignore"`. El llamador recibía éxito inmediatamente aunque el binario no existiera en el entorno final, fallara el loader, Chromium rechazara la sandbox o el proceso terminara con código distinto de cero.

En aplicaciones genéricas existía una comprobación posterior de Sway, pero solo esperaba aproximadamente 1,8 s y, aunque no encontrara ventana, devolvía `ok: true`. Chromium y ficheros no verificaban que apareciera ninguna ventana.

### 2. Carrera de foco reproducible por diseño

Los tres flujos enfocaban el workspace antes de lanzar. La configuración actual de Sway también contiene reglas `for_window` que mueven y enfocan Chromium y Foot. Además, `agenos-workspace-watch` espera dos segundos porque conoce explícitamente el hueco entre «workspace enfocado» y «ventana mapeada».

Había por tanto dos autoridades de routing y una ventana temporal visible en la que el usuario podía acabar en un workspace vacío o ser devuelto a Home. El nuevo lanzador no enfoca a ciegas: el único cambio de workspace ocurre sobre un `con_id` ya observado en el árbol.

### 3. Resolución de binario con el `PATH` equivocado

El navegador y las apps calculaban el entorno gráfico resuelto, pero `defaultCommandExists` seguía consultando `process.env.PATH`. Después se lanzaba con otro `env`. Esto podía declarar ausente un binario disponible para la sesión o declarar disponible uno que el hijo no podía resolver.

`resolveExecutable` y `executableExists` usan ahora el `PATH` del entorno que se pasa al hijo. Para Chromium se prioriza `/usr/bin/chromium`, que es la ruta del paquete Debian, y después se prueban nombres/rutas alternativos.

### 4. Pi no tenía una herramienta web

La API HTTP tenía `/api/agent/browser/open-url`, pero el modelo foreground solo recibía `apps_open`. Por ello «abre YouTube» podía acabar en la búsqueda de una aplicación local inexistente. `browser_open` está ahora registrado en el harness, en el prompt del sistema y en la lista visible de actividad.

### 5. Dependencias implícitas ausentes de la lista de la ISO

Chromium estaba en `desktop-installer.list.chroot`, no en `base.list.chroot`. Ese es el package list correcto para el escritorio. `files.ts` asumía que existía `xdg-open`, y `apps.ts` prefería `gtk-launch`/`gio`, pero ninguno de sus paquetes proveedores estaba declarado explícitamente.

Se añadieron `chromium-sandbox`, `xdg-utils`, `libglib2.0-bin`, `libgtk-3-bin`, `desktop-file-utils` y `shared-mime-info`. Aunque `chromium-sandbox` es una recomendación del paquete Chromium y live-build tiene recomendaciones activadas, declararlo directamente evita que un futuro cambio de política elimine silenciosamente la sandbox. Debian documenta que `chromium-sandbox` contiene la sandbox setuid y que `xdg-utils` proporciona `xdg-open`.

### 6. Ozone era ambiguo, no necesariamente inválido

`--ozone-platform-hint=auto` existe en Chromium y puede caer a X11, así que no se puede afirmar que ese flag por sí solo fuera siempre la causa. Sí era una selección menos determinista para un sistema que conoce su sesión.

La política implementada es:

- si existe `WAYLAND_DISPLAY`, usar `--ozone-platform=wayland`;
- si solo existe `DISPLAY`, usar `--ozone-platform=x11`;
- si el intento Wayland termina temprano y también hay `DISPLAY`, reintentar una vez mediante XWayland;
- permitir override operativo con `AGENOS_BROWSER_OZONE_PLATFORM=auto|wayland|x11`;
- si Sway está usando `WLR_RENDERER=pixman`, o `AGENOS_BROWSER_DISABLE_GPU=1`, añadir `--disable-gpu` y comunicarlo en el resultado.

No se añadió `--enable-features=UseOzonePlatform`: Chromium eliminó esa necesidad en 2021 al convertir Ozone en el camino por defecto de Linux. Tampoco se añadió `WaylandWindowDecorations`; no aparece como requisito de arranque vigente en la documentación/código actual consultado. La documentación upstream sí prescribe `--ozone-platform=wayland` para seleccionar el backend.

### 7. Root y sandbox

La unidad `agenos-agent-api.service` ya declara `User=agenos`, que sigue siendo la política preferida. Si el proceso que lanza Chromium tiene UID 0, Chromium recibe `--no-sandbox` solo en ese caso. La degradación se registra con `console.warn`, se emite como progreso y se incluye en el mensaje final; nunca ocurre en silencio. Para UID no cero no se añade el flag.

### 8. Primer perfil sin feedback

Ya existía un `--user-data-dir` persistente, pero se creaba justo antes del `spawn` sin señal al usuario. Ahora se detecta el primer arranque, se comunica «Preparando el perfil…», se crea con modo `0700`, y a partir de 1,5 s se emite progreso de arranque lento.

No se generó ni precalentó un perfil Chromium durante el build: un perfil de navegador contiene estado sensible y artefactos dependientes de versión/máquina. Con `--no-first-run`, perfil persistente y progreso visible se obtiene el beneficio seguro sin introducir estado de build en `/etc/skel`.

## Arquitectura elegida

`components/agent/graphical-launcher.ts` es el núcleo común. Expone:

- resolución de ejecutables contra un `env` concreto;
- ejecución de comandos con timeout y salida limitada;
- `spawn` gráfico supervisado con `stderr` limitado;
- snapshot/poll de `swaymsg -t get_tree`;
- matching por PID, `app_id`, clase, instancia, título y ventana nueva;
- routing atómico por `con_id` después del mapeo;
- estados `mapped`, `unverified`, `failed`, `timed-out` y `aborted`;
- callbacks de progreso y `AbortSignal` inyectables.

La espera por defecto es de 12 s, suficiente para un primer arranque frío y menor que el timeout HTTP gráfico de 20 s. Si no hay Sway pero sí una sesión X11/Wayland, se captura todavía la ventana de fallo temprano y se devuelve `unverified`: fuera de Sway no existe una API común fiable para comprobar o ubicar la ventana.

Se mantuvieron `apps.ts`, `browser-launcher.ts` y `files.ts` como adaptadores de dominio. Unificarlos en un único API público habría mezclado descubrimiento `.desktop`, normalización segura de URL y MIME/rutas; compartir el mecanismo y conservar adaptadores pequeños reduce el acoplamiento.

Los updates de Pi (`onUpdate`) se propagan hasta `PiTurnProgress.currentToolMessage`, por lo que la UI muestra mensajes como preparación de perfil, espera de ventana, fallback XWayland o degradación de sandbox/GPU mientras la herramienta sigue activa.

## Ficheros tocados

### Núcleo y adaptadores

- `components/agent/graphical-launcher.ts` — política común nueva.
- `components/agent/browser-launcher.ts` — Ozone explícito, fallback XWayland, sandbox root, perfil y supervisión.
- `components/agent/apps.ts` — descubrimiento conservado; lanzamiento delegado al núcleo común.
- `components/agent/files.ts` — `xdg-open` con fallback `gio`, supervisión y verificación.
- `components/agent/browser-open-tool.ts` — herramienta Pi nueva.
- `components/agent/file-open-tool.ts` — propagación de progreso/cancelación.
- `components/agent/pi-system-context.md` — routing web frente a app local.

### API/UI

- `components/installer-ui/src/bun/agent/browser.ts` — espera el resultado real y devuelve errores en vez de éxito prematuro.
- `components/ui/dev/pi-harness.ts` — registra `browser_open` y conserva updates de herramienta.
- `components/ui/src/lib/pi-types.ts` y `components/ui/src/App.tsx` — muestran progreso específico.
- `components/ui/src/lib/agent-client.ts` — timeout de 20 s para lanzamientos gráficos.
- `components/ui/src/electron/main.ts` — integra el launcher asíncrono en URLs externas.

### Runtime de la ISO

- `build/live-build/config/package-lists/desktop-installer.list.chroot` — sandbox y utilidades desktop explícitas.

### Tests

- `components/agent/graphical-launcher.test.ts`
- `components/agent/browser-open-tool.test.ts`
- `components/agent/files.test.ts`
- `components/agent/file-open-tool.test.ts`
- `components/installer-ui/src/bun/agent/browser.test.ts`
- `components/installer-ui/src/bun/agent/apps.test.ts`
- `components/ui/dev/pi-harness.test.ts`

## Cambios requeridos en la configuración de Sway

No se editó `build/live-build/config/includes.chroot/etc/agenos/sway/config`.

Para que exista una sola autoridad de routing, eliminar estas tres reglas:

```text
for_window [app_id="^(chromium|chromium-browser|google-chrome|google-chrome-stable)$"] move to workspace "3:web", focus
for_window [class="^(Chromium|Google-chrome|Google-chrome-stable)$"] move to workspace "3:web", focus
for_window [app_id="^foot$"] move to workspace "5:work", focus
```

El launcher ya mueve, activa fullscreen y enfoca por `con_id` después de observar la ventana. Las reglas de Home para AgenOS/installer deben permanecer: protegen ventanas de sistema que no nacen de este launcher.

Las reglas `for_window [workspace="2:app"|...] fullscreen enable` pueden permanecer como defensa para lanzamientos manuales; no deciden routing ni foco. El launcher aplica también fullscreen después del movimiento porque una regla `for_window` evaluada al crear la ventana no siempre se vuelve a evaluar cuando esta se mueve.

La regla de Foot debe retirarse junto con una migración del atajo `Ctrl+Alt+Return` al launcher/API si se quiere conservar su routing a `5:work`. Mantener la regla de Foot preservaría el atajo actual, pero reintroduciría dos autoridades para los terminales abiertos por Pi.

`agenos-workspace-watch` no se modificó. Su gracia de dos segundos deja de ser necesaria para estos lanzamientos, pero es inocua y puede seguir protegiendo otros flujos que enfoquen workspaces vacíos.

## Tests ejecutados

Todos finalizaron en verde:

- `bun test components/agent/graphical-launcher.test.ts components/agent/browser-open-tool.test.ts components/agent/files.test.ts components/agent/file-open-tool.test.ts components/installer-ui/src/bun/agent/browser.test.ts components/installer-ui/src/bun/agent/apps.test.ts` — 32 tests.
- `bun test components/ui/dev/pi-harness.test.ts` — 25 tests.
- `bun test components/ui/src/lib/agent-client.test.js components/ui/dev/pi-harness.test.ts` — 32 tests.
- `bun test components/installer-ui/src/bun/server.test.ts` — 41 tests.
- `bunx vitest run src/App.test.tsx` desde `components/ui` — 7 tests.
- `bun run typecheck:bun` desde `components/installer-ui`.
- `bunx tsc --noEmit -p tsconfig.node.json` y `bunx tsc --noEmit -p tsconfig.json` desde `components/ui`.
- React Doctor sobre el diff: sin hallazgos nuevos ligados al cambio; sus avisos corresponden a deuda preexistente de `App.tsx` y clientes fetch.

## Validación pendiente en VM/hardware real

1. Arranque frío de Chromium en la ISO con un usuario `agenos` limpio: medir tiempo hasta map y confirmar progreso audible/visible.
2. Verificar app IDs/clases reales del Chromium Debian actual en Ozone Wayland y XWayland con `swaymsg -t get_tree`.
3. Forzar fallo Wayland manteniendo XWayland disponible y confirmar que el segundo intento abre y no deja locks de perfil.
4. Arrancar Sway con renderer hardware y con fallback `pixman`; comprobar vídeo/WebGL y ausencia de ventana negra con la política de GPU.
5. Probar una sesión live lanzada accidentalmente como root y confirmar el aviso `--no-sandbox`; la corrección preferida sigue siendo ejecutar toda la sesión como `agenos`.
6. Abrir por Pi: YouTube/Netflix/Gmail, Chrome, Terminal, una app `.desktop`, imagen, vídeo, PDF y carpeta. Los últimos tipos dependen de que exista un handler MIME instalado; este cambio garantiza la infraestructura `xdg-open`/GIO, no instala viewers pesados adicionales.
7. Cerrar una app y confirmar interacción con `agenos-workspace-watch`, especialmente tras retirar las reglas `for_window` de routing.
8. Multi-monitor y workspaces ya existentes: confirmar fullscreen/foco y que un Chromium ya abierto crea/activa la ventana nueva esperada.

## Fuentes técnicas consultadas

- [Chromium Ozone overview](https://chromium.googlesource.com/chromium/src/+/main/docs/ozone_overview.md): selección explícita con `--ozone-platform=wayland` y backends Linux.
- [Chromium change: Ozone is default on Linux](https://chromium.googlesource.com/chromium/src/+/1660bb4b8e2119e3ad32d8370601becf4621200b): ya no es necesario `--enable-features=UseOzonePlatform`.
- [Chromium Ozone switch definitions](https://chromium.googlesource.com/chromium/src/+/refs/tags/126.0.6465.0/ui/ozone/public/ozone_switches.cc): diferencia entre `ozone-platform` y `ozone-platform-hint`.
- [Debian 12 chromium package](https://packages.debian.org/bookworm/chromium): recomienda `chromium-sandbox`.
- [Debian 12 chromium-sandbox](https://packages.debian.org/bookworm/chromium-sandbox): sandbox setuid del navegador.
- [Debian 12 xdg-utils](https://packages.debian.org/bookworm/xdg-utils): proveedor de `xdg-open`.
- [Debian 12 libgtk-3-bin file list](https://packages.debian.org/bookworm/i386/libgtk-3-bin/filelist): proveedor de `gtk-launch`.
