# WS13 — integración semántica de honestidad y seguridad

- Fecha: 2026-08-13
- Rama: `ws13-merge`
- Ramas combinadas: base integrada con `ws10-honesty` + `ws11-security`
- Restricciones respetadas: no se ejecutaron `make build`, `quick-test`, `release*` ni builds de ISO.

## Resultado

El broker Bun es la única autoridad de política y la única sede de la sesión Pi de producción,
pero conserva los efectos reales introducidos por `ws10-honesty`. Una aprobación válida ya no es
solo un cambio de estado: ejecuta una vez el efecto de memoria, shell administrativa o admin y,
si pertenece a una tarea Bun, reanuda su continuación persistida. Las identidades worker/system no
pueden usar shell, ni siquiera mediante una confirmación antigua; deben usar tools tipadas.

El flujo de Pi empaquetado queda así:

```text
renderer -> IPC Electron -> HTTP loopback autenticado -> broker/Pi
                                                    -> decidePolicy
                                                    -> handler registrado
                                                    -> efecto real o error explícito
```

El IPC de sistema no forma parte de Pi y mantiene su flujo propio:

```text
renderer -> IPC Electron -> system-ipc-services.ts -> servicios compartidos reales
```

## Resolución de conflictos

### `components/installer-ui/src/bun/agent/policy-rules.ts`

El lado de honestidad permitía shell de worker y conservaba un allow comodín para cualquier tool
con `source: "ui"`; el lado de seguridad hacía la política nominativa y negaba shell a
`openclaw/system`. Se mantuvo el deny de agente antes de cualquier clasificación destructiva, se
limitó el allow de shell a UI con intención explícita y se conservó la confirmación de shell
destructiva y de mutaciones admin. Se eliminó `agent.ui.superuser.allow` y se incorporaron solo los
allows concretos que tienen handler en el broker.

### `components/installer-ui/src/bun/agent/policy.test.ts`

Las expectativas chocaban sobre shell ordinaria/destructiva de worker y sobre el supuesto
superusuario UI. La expectativa combinada niega ambas shells del worker, permite shell ordinaria
solo desde UI explícita, confirma la destructiva de UI, mantiene las confirmaciones admin/memoria y
demuestra que una tool UI desconocida cae en `agent.default.deny`.

### `components/installer-ui/src/bun/agent/tool-runner.ts`

`ws10` aportaba `executeConfirmed`, metadatos de confirmación y rechazo temprano de tools sin
efecto; `ws11` aportaba `explicitUserIntent`, handlers tipados, salida real y fail-closed cuando un
allow carece de handler. Se combinaron ambos modelos: el runner solo acepta built-ins ejecutables o
handlers registrados, crea confirmación únicamente si existe ejecutor, ejecuta confirmaciones con
su `confirmationId`, y permite que `memory.write` use el handler de corrección cuando no es una
escritura append/learned. Antes de materializar una confirmación se vuelve a aplicar cualquier deny
vigente; esto bloquea confirmaciones históricas de shell de worker sin impedir memoria confirmada o
shell destructiva de UI.

### `components/installer-ui/src/bun/agent/tool-runner.test.ts`

Un lado probaba ejecución/rechazo honesto y el otro mediación por handlers. Se conservaron ambos:
shell de worker nunca llega al ejecutor ni crea confirmación, memoria de fondo sí la crea, shell UI
explícita ejecuta, outbound sin handler falla antes de confirmar, los handlers devuelven su efecto
real y un allow sin ejecutor falla cerrado. También se prueba que una shell UI confirmada se
materializa y que una confirmación legacy de shell worker se rechaza.

### `components/installer-ui/src/bun/agent/admin.test.ts`

El test entrante solo comprobaba que config y restart pedían confirmación; el test de honestidad
comprobaba además el efecto posterior. Se mantuvo la versión más fuerte: la config confirmada se
escribe y se recarga, restart invoca el efecto inyectado, `testConnection` hace una sonda real en
OpenClaw y falla explícitamente fuera de ese modo, y retry/clear delegan en la cola real.

### `components/installer-ui/src/bun/server.ts`

El conflicto reunía el runner reanudable de `ws10` con auth UI, CORS cerrado, Pi brokerizado y
handlers de `ws11`. Se conservaron token/cookie, validación de origen, handlers tipados y origen UI
no falsificable. La ruta de tareas pasa por el runner, pero conserva el `503` honesto cuando el
worker simulado no puede aceptar trabajo. La ruta de confirmación mantiene el control idempotente,
ejecuta memoria/shell mediante `toolRunner.executeConfirmed`, admin mediante
`agentAdmin.executeConfirmed`, y reanuda tareas Bun mediante `resolveConfirmation`.

### `components/installer-ui/src/bun/server.test.ts`

Se unieron los imports y las pruebas de auth/CORS/handlers con las de efectos reales e
idempotencia. La antigua continuación usaba dos pasos shell de worker, comportamiento incompatible
con la nueva frontera. Se sustituyó por una escritura de memoria confirmada seguida de
`apps.open`, una tool tipada: la memoria se escribe una vez, el segundo paso se ejecuta y la tarea
termina; un segundo confirm devuelve `409` sin repetir nada. En paralelo, la prueba de shell
destructiva UI ahora aprueba la confirmación, comprueba el efecto exacto y comprueba que no se
repite.

### `components/ui/src/electron/main.ts`

La dirección de `ws11` prevalece para Pi: Electron usa `broker-pi-client.ts`, carga la UI desde el
origen del broker y también media URLs externas por el broker; no instancia ni importa el harness
Pi. Se conservó de `ws10` `createSystemIpcServices()` para preflight, mantenimiento y cambio de
modo, por ser IPC de sistema ajeno a Pi. Los errores HTTP de política mantienen su status al cruzar
IPC.

## Comportamiento combinado de seguridad

- Política default-deny sin regla comodín para UI.
- Token UI separado, persistido con modo `0600`; cookie `HttpOnly; SameSite=Strict` para la shell y
  bearer para Electron.
- Orígenes cross-site rechazados y sin `Access-Control-Allow-Origin: *`.
- Token worker independiente para `/api/agent/worker/tool-call`.
- Shell solo como endpoint administrativo de UI autenticada; worker/system reciben deny.
- Pi no expone shell, edición, escritura de ficheros ni instalación de paquetes.
- `apps_install`, `installApp` y la elevación genérica `sudo/pkexec apt-get` quedan retirados.
- Una tool permitida sin ejecutor falla antes de crear una confirmación inútil.

## Comportamiento combinado de honestidad

- Config confirmada: escritura atómica modo `0600` y recarga inmediata del adapter.
- Restart confirmado: helper privilegiado cerrado `restart-agent` y error visible si falla.
- Queue clear confirmada y retry: efectos reales sobre la cola.
- Shell destructiva UI confirmada: efecto una vez; duplicados devuelven conflicto.
- Memoria confirmada: efecto una vez con trazabilidad del `confirmationId`.
- Tareas Bun: plan/índice persistidos y continuación tras confirmar o denegar.
- `testConnection`: petición mínima al gateway/proveedor real; otros modos devuelven `503`.
- `local-simulated` y tools sin ejecutor rechazan el trabajo en vez de dejar éxito o cola eterna.

## Bundle Electron medido

Comando: `cd components/ui && bun run build`.

- `build/electron/main.mjs`: **31.308 bytes** (Bun: **31,31 KB**).
- Chunk estático de arranque: **155 bytes**.
- Grafo JS inicial del proceso principal: **31.463 bytes** (30,73 KiB).
- `preload.cjs`, separado: **3.265 bytes**.
- Chunk DBus dinámico: **194.802 bytes**, cargado bajo demanda por red y no parte del arranque.

No queda `createPiHarness`, `piHarnessPromise` ni import de `dev/pi-harness` en Electron. Por tanto,
se conserva el objetivo del bundle pequeño sin necesitar ya el import dinámico del harness: el
harness completo vive en el proceso broker.

## Verificación

- Tests focales de conflictos (`policy`, `tool-runner`, `admin`, `server`): **69 pass**.
- Tests focales Electron/broker/IPC sistema: **31 pass**.
- Tests adicionales de seguridad (`apps`, `broker-pi-tools`, `ui-auth`): **17 pass**.
- Typecheck backend: `bun run typecheck:bun`, verde.
- `cd components/ui && bun run build`: verde (typecheck renderer + Electron, bundle Electron y
  Vite).
- `make test`: verde, **516 tests** en total:
  - UI Bun: 139.
  - UI Vitest: 99.
  - Installer/backend Bun: 238.
  - Installer Vitest: 20.
  - Agente compartido: 11.
  - Python: 9.

La base indicada tenía 504 tests; el merge termina con 516. `ws11` retiró pruebas de la antigua
instalación privilegiada junto con esa API, pero las sustituyó por aserciones de ausencia de
`installApp`/`apps_install` y el recuento global no disminuye. Vitest emitió avisos no fatales ya
existentes sobre `act(...)` y `--localstorage-file`; no hubo fallos.

## Riesgos residuales reales

1. La instalación conversacional no existe. Recuperarla exige helper privilegiado tipado, catálogo
   cerrado y confirmación reanudable; no debe volver `apt-get` con argumentos libres.
2. La shell administrativa sigue siendo una capacidad amplia del mismo UID y su clasificación
   destructiva es heurística, no un sandbox. Token/cookie protegen frente a web cross-site y otros
   usuarios, no frente a un proceso ya comprometido bajo el mismo UID.
3. Pi depende ahora de que el broker loopback esté disponible. El fallo es explícito y conserva el
   status, pero añade un salto HTTP local y un único punto de disponibilidad.
4. Las confirmaciones antiguas de shell creadas por worker antes de esta política ya no son
   ejecutables; se rechazan al aprobarlas y la intención debe reformularse con una tool tipada.
5. No se validaron permisos, cookies ni unidades systemd dentro de una imagen/VM porque el build de
   ISO estaba expresamente prohibido. Esa comprobación queda para un smoke de imagen autorizado.
