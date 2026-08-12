# Informe de arranque y rendimiento percibido

## Resultado

La ruta al primer frame ya no espera al broker ni carga el runtime completo de Pi. El broker, Sway y el worker arrancan en paralelo; OpenClaw conserva su supervisión, pero con prioridad baja para no competir con Electron. El renderer inicia historial y red a la vez, y los sondeos activos usan una cadencia adaptativa sin peticiones solapadas.

No se construyó ninguna ISO, no se editaron las listas de paquetes ni la configuración de Sway, y no se tocaron `build/live-build/chroot/`, `cache/`, `binary/` o artefactos generados versionados.

## Cadena de arranque observada

La cadena real que se deduce de unidades, scripts y configuración es:

```text
graphical.target
├─ greetd ─(After/Wants seatd)─> agenos-session ─> Sway ─> agenos-shell-runner ─> Electron
├─ agenos-agent-api (broker Bun :4173)
└─ agenos-openclaw (setup + worker + gateway :18789)
```

Antes de este trabajo había tres dependencias artificiales:

1. `agenos-agent-api.service` esperaba a `NetworkManager.service`, aunque abrir el broker local en `127.0.0.1:4173` no necesita conectividad. El broker quedaba expuesto a esperas de DHCP/Wi-Fi.
2. `agenos-openclaw.service` tenía `After=agenos-agent-api.service`, aunque su arranque crea un adapter local y supervisa el gateway directamente. `Wants=` basta para activar ambos; el worker no consume el broker durante su bootstrap.
3. El wrapper generado de la UI ejecutaba un `curl --max-time 1` antes de `exec Electron` y podía levantar un broker duplicado. En la ISO systemd ya es el dueño de ese proceso.

`greetd` sí debe esperar a `seatd`: es una dependencia de dispositivo/sesión válida. `agenos-shell-runner` inicia `mako`, batería y autoscale en background; no bloquean Electron. El `sleep 1` del runner ocurre únicamente después de que la app termina, por lo que no pertenece al arranque normal; limita una tormenta de relanzamientos.

La ruta resultante conserva `greetd -> seatd -> Sway -> Electron`, pero broker y OpenClaw son ramas paralelas. El worker se ejecuta con `Nice=10`, `CPUWeight=20` e `IOWeight=20`, de modo que el primer frame y la interacción en foreground ganan la contención en un portátil modesto.

## Medidas locales

Host de medición: Linux x86_64, Intel Core i5-8500 (6 cores, 3 GHz), Bun 1.4.0. Son medidas de desarrollo en caliente; no representan un portátil objetivo ni incluyen kernel, live-boot, squashfs, Sway o page faults de una ISO fría.

### Broker Bun

Se compiló `components/installer-ui/src/bun/server.ts` y se midió desde `spawn` hasta el primer `GET /health` exitoso, con un HOME nuevo en cada ejecución:

```text
524 ms, 524 ms, 542 ms, 545 ms, 583 ms
mediana: 542 ms
```

El bundle medido ocupa 11.396.763 bytes. Este tiempo confirma que esperar al broker antes de lanzar Electron añadía del orden de medio segundo en este host, además de cualquier espera inicial del `curl`. Tras el cambio, ese coste se solapa con Sway/Electron.

### Renderer

Tres builds Vite aisladas antes de los cambios: 3.187 s, 2.895 s y 2.962 s. Bundle base:

- JavaScript: 287.633 bytes, 87.030 bytes gzip.
- CSS: 36.042 bytes, 7.290 bytes gzip.
- `back.mp4`: 190.486 bytes.
- `dist` completo: 763.694 bytes.

Build final completo: 10.484 ms incluyendo dos typechecks, Electron y Vite. Renderer final: 288.100 bytes JS (87.240 gzip) y 764.158 bytes en `dist`. No hay evidencia de que el renderer sea el problema de peso; el incremento de ~467 bytes procede de la función de cadencia adaptativa.

### Proceso principal de Electron

Antes, `main.ts` importaba `pi-harness` de forma estática. Bun empaquetaba 2.327 módulos en un único `main.mjs` de 11.672.894 bytes, que Electron debía leer y parsear antes de crear `BrowserWindow`.

Después:

- `main.mjs` inicial: 22.896 bytes (reducción de 99,80%).
- El harness se carga mediante `import()` en el primer IPC de Pi; permanece local y funcional.
- Runtime Electron completo: 6.608.467 bytes frente a 11.678.475 bytes antes (reducción de 43,41%).
- Chunk aplazado principal de Pi: 4.183.716 bytes; antes todo Pi estaba dentro del entrypoint.
- Build de Electron final medido: 235 ms. La build minificada equivalente aislada tardó 408 ms.

La mejora de tiempo hasta primer frame es una expectativa fuerte basada en bytes de código inicial, pero no se pudo cronometrar Electron/Sway real en este host. Debe verificarse desde la ISO.

## Tiempo hasta poder hablar

Electron no depende del broker para voz: el preload expone STT por IPC y el reconocimiento nativo usa `whisper.cpp` directamente. Tampoco espera a OpenClaw; la conversación foreground usa el harness Pi dentro de Electron. La UI sí bloquea enviar una orden si no hay red o la cuenta no está conectada, que es una condición funcional, no readiness del worker OpenClaw.

El bootstrap visual tenía una serialización evitable:

```text
antes: restoreConversation -> networkRefresh -> quitar overlay
ahora: Promise.allSettled(restoreConversation, networkRefresh)
```

Sesión Pi, salud del backend y workspaces ya se lanzaban en background. Se añadió una prueba que deja `listTurns()` pendiente y comprueba que `networkClient.getStatus()` empieza sin esperar. La pantalla sigue manteniendo el overlay hasta conocer red e historial, evitando mostrar erróneamente el panel offline durante el estado `null`.

El primer IPC de Pi ahora paga la carga aplazada del harness. En uso normal ocurre durante el bootstrap (`getStatus`) mientras red e historial ya están en paralelo, después de haber creado/mostrado la ventana. Es un intercambio deliberado: primer frame mucho más barato sin retrasar la primera orden más allá del readiness de sesión que ya se consultaba.

## Coste en reposo y sondeos

### UI

El supuesto “sondeo cada 1,2 s en reposo” no era exacto: el efecto solo existe mientras `activeTurnId` no es nulo. No hay polling de turnos con la conversación inactiva. El problema real era una cadencia fija durante respuestas largas y `setInterval`, que permite solapamiento si una consulta tarda más de 1,2 s.

Se sustituyó por un `setTimeout` programado después de terminar cada petición:

- 750 ms durante los primeros 15 s: más reactivo que antes para las respuestas cortas.
- 1,5 s entre 15 y 60 s.
- 3 s después de 60 s.
- 5 s con la ventana oculta; al volver a visible hace refresh inmediato.

Estimación determinista de peticiones, sin contar la consulta inmediata inicial:

- Turno visible de 2 min: ~100 antes, ~70 ahora (−30%).
- Turno visible de 5 min: ~250 antes, ~130 ahora (−48%).
- Ventana oculta: 50/min antes, 12/min ahora (−76%).

No se cambió a eventos porque el contrato de turnos por IPC/HTTP no expone suscripción; hacerlo correctamente requiere ampliar preload, main, cliente HTTP y protocolo. El watcher de workspaces ya usa eventos de Sway + SSE y no necesita cambios.

### Supervisor OpenClaw

El proceso hijo ya se reinicia por el evento `exit` con backoff 1–30 s. Sin embargo, el loop externo llamaba `adapter.health()` cada 30 s incluso sano; en modo OpenClaw eso hace fetch a `/v1/models`, lecturas de versión/estado y acceso al task store.

Ahora el health check es no solapable y adaptativo:

- Sano: cada 5 min, de 120 a 12 probes/hora (−90%).
- Fallando: 30 s, 60 s, 120 s, 240 s, 300 s máximo.
- Un `exit` del gateway sigue provocando el reinicio inmediato del supervisor; la cadencia de health no gobierna ese recovery.

## Cambios implementados

1. `1c97650 perf(boot): remove broker from shell critical path`
   - Quita NetworkManager de la ruta del broker.
   - Paraleliza broker y setup/worker OpenClaw.
   - Baja prioridad CPU/IO del worker.
   - Lanza el fallback de broker de desarrollo en background y lo omite cuando systemd gestiona la unidad.
   - Añade tests estructurales de la ruta crítica.
2. `5279d60 perf(ui): defer agent runtime until after first frame`
   - Divide el bundle Electron y carga Pi/browser launcher de forma dinámica.
   - Paraleliza historial y red.
   - Añade regresión React para el bootstrap concurrente.
3. `529f2eb perf(runtime): adapt background health polling`
   - Sondeo de turnos adaptativo, sensible a visibilidad y sin overlap.
   - Health de OpenClaw con backoff.
   - Tests puros de ambas cadencias.
4. `c8824ee perf(ui): minify Electron runtime chunks`
   - Minifica entrypoint, preload y chunks aplazados.

## Tamaño de ISO y squashfs

No se construyó la ISO, por tanto no hay una medida válida del `.iso` ni del squashfs final. Sí existe en el checkout principal un árbol generado previo al trabajo (`installer/build-info.json`: commit `14d96a7ec21c`, 2026-07-07). Se inspeccionó solo como evidencia orientativa, no se modificó:

- `/opt/agenos` generado: 1.112.155.288 bytes sin comprimir.
- Runtime system: 664.599.085 bytes.
- Runtime installer: 447.556.203 bytes.
- Codex: 203.288.904 bytes.
- modelo Whisper base: 147.951.465 bytes.
- Bun empaquetado: 92.752.752 bytes.
- Cada `electron-dist`: 296.296.826 bytes.

Los dos árboles `electron-dist` son idénticos (`diff -qr` sin diferencias; mismo SHA-256 para el binario y `default_app.asar`). Esa duplicación suma 296,3 MB sin comprimir. Squashfs probablemente deduplica/comprime bien bloques iguales, pero no debe asumirse: comprobar `unsquashfs -s` y el contenido real. El cambio de esta rama sí reduce el JS del runtime system en ~5,07 MB sin comprimir.

Cada Electron incluye 55 locales, 43.878.666 bytes. Con dos copias son 87,8 MB sin comprimir. AgenOS configura español, pero podar idiomas es una decisión de producto/accesibilidad y por eso no se aplicó. Tampoco se cambiaron Chromium, firmware, ffmpeg, Calamares, Node/OpenClaw o las listas de paquetes: todos tienen justificación funcional y requieren medir el squashfs antes de retirar nada.

## Bloques opcionales para integrar manualmente

No hay ningún bloque obligatorio en rutas prohibidas: todos los cambios necesarios quedaron en fuente permitida.

Si se decide que la ISO será exclusivamente española/inglesa, este bloque puede añadirse después de copiar ambos runtimes Electron en los scripts de build. Debe acompañarse de una prueba de arranque y de la decisión explícita de idiomas:

```bash
for electron_dir in \
  "${PACKAGE_OUTPUT_DIR}/electron-dist" \
  "${OUTPUT_DIR}/electron-dist"; do
  find "${electron_dir}/locales" -maxdepth 1 -type f \
    ! -name 'es.pak' \
    ! -name 'es-419.pak' \
    ! -name 'en-US.pak' \
    ! -name 'en-GB.pak' \
    -delete
done
```

No copiar literalmente en ambos scripts con variables que no existan allí; es la política lista para adaptar en cada contexto. Ahorro superior teórico en el árbol previo: hasta ~84 MB sin comprimir entre las dos distribuciones, menos el coste de los cuatro locales conservados. El ahorro real del squashfs debe medirse.

## Validación realizada

- `make test`: verde.
  - UI Bun: 115.
  - UI Vitest: 56.
  - installer/backend Bun: 215.
  - installer Vitest: 20.
  - agent Bun: 11.
  - Python: 9.
  - Total: 417 pruebas Bun/Vitest + 9 Python = 426.
- Build completo de `components/ui`: verde, 10.484 ms.
- Typechecks del renderer y Electron: verdes dentro del build.
- `bash -n scripts/build-ui.sh`: verde.
- `systemd-analyze verify`: parseó las unidades; solo avisó que los ejecutables absolutos de la ISO no existen en el host, esperado fuera del chroot.
- React Doctor después del cambio: 77/100, 9 avisos preexistentes (componente `App` grande, barrel import, iteraciones y clientes fetch). No señaló el nuevo efecto de polling. No se instaló en el repo.

Para medir en el worktree fue necesario enlazar temporalmente los `node_modules` ya instalados del checkout principal. El enlace de `components/network/node_modules` se retiró; `components/ui/node_modules` ya existía al comenzar y se dejó intacto y sin versionar.

## Verificación necesaria con una ISO real

1. Arrancar tres veces en frío en el portátil objetivo y guardar:

   ```bash
   systemd-analyze time
   systemd-analyze critical-chain graphical.target
   systemd-analyze blame
   journalctl -b -o short-monotonic \
     -u greetd -u agenos-agent-api -u agenos-openclaw
   ```

2. Añadir marcas monotónicas temporales en `agenos-session`, runner y Electron (`app.whenReady`, `did-finish-load`, primer frame/overlay retirado, controlador de voz listo) para obtener:
   - encendido -> greetd;
   - greetd -> Sway;
   - Sway -> primer frame;
   - primer frame -> botón de voz activable;
   - primera pulsación -> fase `listening`.
3. Confirmar que la UI aparece y permite capturar voz aunque :4173 y :18789 aún estén arrancando; probar también broker fallido y OpenClaw degradado.
4. Confirmar que OpenClaw llega a sano después de arrancar en paralelo y que `Nice/CPUWeight/IOWeight` no alargan de forma problemática su readiness.
5. Ejecutar un turno corto, uno de más de 2 min y ocultar/mostrar la ventana; contar peticiones `getTurn` y confirmar actualización inmediata al volver.
6. Verificar suspend/resume: `agenos-resume-health` mantiene su lógica separada y debe recuperar broker/gateway si alguno no responde.
7. Medir tamaño real:

   ```bash
   stat -c '%s %n' *.iso
   unsquashfs -s live/filesystem.squashfs
   unsquashfs -ll live/filesystem.squashfs | sort -k3 -n | tail
   ```

   Comparar además una build de control y otra con poda de locales antes de decidir cambios de idiomas o paquetes.

## Riesgos conocidos

- La primera consulta Pi carga el chunk aplazado. Los tests y build validan resolución/typing, pero solo Electron empaquetado confirma el coste y que todos los chunks estén junto a `main.mjs` en la ISO.
- `Wants=` sin `After=` permite que OpenClaw llegue al broker antes de que esté escuchando. Hoy no hay llamada al broker en el bootstrap del worker; si se añade una en el futuro habrá que ordenar únicamente esa operación o hacerla tolerante a retry.
- `CPUWeight`/`IOWeight` dependen del accounting/cgroup efectivo del sistema. `Nice=10` sí da una preferencia clara incluso si esos weights no se aplican.
- No se midió boot frío ni squashfs; cualquier cifra de impacto temporal fuera de broker/build/bundle está identificada como estimación.
