# WS11 — cierre de bypasses de política

- Fecha: 2026-08-13
- Rama: `ws11-security`
- Alcance: autoridad del broker, política fail-closed, Pi empaquetado, autenticación local,
  CORS y elevación de `apps_install`.
- Restricciones respetadas: no se construyó ninguna ISO, no se editó `build/live-build/**` y en
  `components/ui/src/**` solo se modificó `components/ui/src/electron/**`.

## Resultado arquitectónico

Hay una sola sesión Pi de producción y vive en el broker Bun. Electron ya no instancia
`createPiHarness`: carga la shell desde `127.0.0.1:4173` y convierte sus canales `agenosPi` en un
cliente autenticado de `/api/pi/*`. El broker crea el harness e inyecta exclusivamente custom
tools respaldadas por handlers del propio broker.

El flujo efectivo queda así:

```text
renderer -> IPC Electron -> HTTP loopback autenticado -> Pi del broker
                                                    -> decidePolicy
                                                    -> handler tipado
                                                    -> efecto
```

La llamada HTTP loopback adicional es el coste de latencia. Es local y normalmente marginal
frente al tiempo del modelo y al mapeo de una ventana. A cambio se eliminan la segunda sesión Pi,
la divergencia de estado y la ejecución directa de adaptadores.

## Hallazgos cerrados

### 1. Default-allow de la política

**Qué se hizo.** Se eliminó `agent.ui.superuser.allow`, la regla comodín que aceptaba cualquier
tool de origen `ui`. Solo hay allows nominativos. Las mutaciones admin vuelven a `confirm`, una
tool desconocida de UI cae en `agent.default.deny`, y la memoria explícita usa su regla específica.
Además, `shell.exec` se niega por completo a identidades `openclaw`/`system`; la shell queda como
superficie administrativa de UI explícita, no como capacidad del agente.

**Qué demuestra el test.** `policy.test.ts` prueba que configuración/reinicio/limpieza devuelven
`confirm`, que una shell destructiva de UI devuelve `confirm`, que una tool UI desconocida
devuelve `deny`, y que toda shell de worker —también la aparentemente inocua— se deniega.
`tool-runner.test.ts` prueba además que el ejecutor no recibe la llamada denegada.

**Por qué cambió la expectativa anterior.** Ser el frontend oficial no convierte una petición en
segura ni en superusuario. La identidad determina quién solicita; la regla de la tool determina
si se permite. La expectativa anterior mezclaba ambas cosas y hacía inalcanzables todas las
reglas sensibles posteriores.

### 2. Pi de Electron fuera del broker

**Qué se hizo.** Electron usa `broker-pi-client.ts`, preserva los códigos HTTP de política a través
de IPC y ya no importa ni crea el harness. Incluso las URLs externas y de OAuth se abren mediante
`/api/agent/browser/open-url`; no queda fallback directo a `shell.openExternal`.

El harness del broker solo anuncia `browser_open`, `apps_open`, `files_open`, `openclaw_setup`,
`agent_task` y `learning_memory`. Se retiraron `bash`, `read`, `edit`, `write`, `grep`, `find`, `ls`
y `apps_install`. Cada custom tool entra en `toolRunner.run`, que vuelve a ejecutar `decidePolicy`
inmediatamente antes del handler. Un allow sin handler ya no responde el éxito sintético
`Tool call accepted`: falla cerrado.

**Qué demuestra el test.** `electron-broker-client.test.ts` verifica URL, payload y bearer del
salto Electron→broker, la propagación de un `409` y que la apertura de enlaces también usa el
broker. `broker-pi-tools.test.ts` verifica la lista exacta de capacidades, la ausencia de
shell/edición/instalación, el origen UI fijo y que una denegación impide el efecto.
`pi-harness.test.ts` verifica la lista limitada registrada y las trazas de esas tools. Los tests de
servidor verifican efectos reales de app, navegador, fichero, workspace, setup y tareas detrás del
runner.

### 3. `/api/agent/shell/exec` sin autenticación

**Qué se hizo.** Se creó una identidad UI separada de la del worker. El token aleatorio se guarda
en `~/.agenos/broker/ui-token` con modo `0600`; Electron usa bearer y la shell web recibe una cookie
`HttpOnly; SameSite=Strict`. Todas las rutas `/api/*` salvo la frontera worker exigen esta sesión.
La ruta worker sigue exigiendo su token distinto.

La shell HTTP pasa ahora por `toolRunner`, incluida la detección de destrucción. El body ya no
puede elegir su identidad. Tampoco se acepta `source: openclaw/system` en las rutas UI de memoria,
tareas o workspace.

**Qué demuestra el test.** `ui-auth.test.ts` comprueba modo `0600`, rechazo sin credencial,
aceptación por bearer/cookie y atributos de cookie. `server.test.ts` prueba que una shell sin sesión
devuelve `401` sin ejecutar, una autenticada ejecuta una sola vez y una destructiva devuelve `409`,
crea la confirmación y no llega al adaptador.

### 4. CORS abierto

**Qué se hizo.** Se eliminaron todas las cabeceras `Access-Control-Allow-Origin: *`, incluido SSE.
Una petición API con origen distinto de `127.0.0.1:4173`/`localhost:4173` o con
`Sec-Fetch-Site: cross-site` recibe `403` antes de autenticación y antes de cualquier efecto. Los
preflight ajenos también se rechazan.

**Qué demuestra el test.** `server.test.ts` envía una petición con bearer válido pero
`Origin: https://attacker.example`: recibe `403`, no obtiene ACAO y el comando no se ejecuta. Esto
demuestra que conocer/inyectar un header de contenido no reabre la superficie desde una página.

### 5. Elevación genérica de `apps_install`

**Qué se hizo.** Se borraron `installApp`, `commandsWithPrivileges` y todo uso de
`sudo -n`/`pkexec apt-get` de `components/agent/apps.ts`. `apps_install` desapareció del harness,
del prompt y del contrato. No se añadió un endpoint de instalación que trasladase el mismo agujero
al broker.

**Qué demuestra el test.** `apps.test.ts` exige que `createAppTool()` no exponga `installApp`;
`broker-pi-tools.test.ts` y `pi-harness.test.ts` exigen que `apps_install` no figure entre las
capacidades del modelo. Una búsqueda del árbol relevante ya no encuentra `sudo/pkexec apt-get`.

**Impacto UX.** Pi explica que instalar paquetes no está disponible. Es una degradación visible y
honesta, preferible a prometer una frontera privilegiada cerrada mientras se eleva un gestor de
paquetes genérico. La funcionalidad debe volver mediante un helper tipado y allowlisted.

## Verificación

- `make test`: verde.
  - UI Bun: 115 tests.
  - UI Vitest: 55 tests.
  - Installer/backend Bun: 224 tests.
  - Installer Vitest: 20 tests.
  - Agent compartido: 11 tests.
  - Python: 6 tests.
- Typecheck backend: `bun run typecheck:bun`, verde.
- Typecheck Electron: `bunx tsc --noEmit -p tsconfig.node.json`, verde.
- Bundle Electron de UI y del backend compartido: verde.
- No se ejecutaron `make build`, `quick-test`, `release*` ni ningún build de ISO.

## Lo que sigue sin cumplir lo que afirma el TFG

1. **Las confirmaciones no son todavía una máquina reanudable general.** El broker crea y persiste
   confirmaciones para shell/admin, pero la ruta de confirmación existente solo materializa
   `memory.write`. Aprobar shell, config, restart o queue clear todavía no ejecuta/reanuda el efecto.
   No se modificó esa zona porque otro agente trabaja simultáneamente en las rutas de confirmación.
   Hasta que se integre su trabajo, P7.4 sigue siendo parcial; esta rama al menos no ejecuta antes de
   confirmar ni informa un allow falso.

2. **La instalación conversacional está ausente.** Ya no es insegura, pero P7.8 no puede afirmar
   instalación mediada. Hace falta un helper privilegiado Rust/polkit con operaciones cerradas,
   validación de paquete contra catálogo y reanudación idempotente tras confirmación. No debe
   reintroducirse `apt-get` con argumentos libres.

3. **El endpoint shell administrativo no es un sandbox.** Solo la UI autenticada puede usarlo y
   el agente no lo posee, pero la clasificación destructiva es heurística. Un proceso que ya corre
   como el mismo usuario y puede leer el token `0600` tiene la autoridad de ese usuario; el token
   protege frente a webs y otros usuarios, no frente a compromiso completo del UID. Esto coincide
   con una frontera local de sesión, no con aislamiento hostil multiusuario.

4. **Los fallbacks de worker y la reanudación de tareas siguen fuera de este cierre.** Los gaps
   P7.11/P9.5 del informe (worker simulado/Bun utilizable y continuación tras confirmación) no se
   resuelven aquí. Al negar shell genérica, una tarea que dependía de ella falla de forma explícita
   hasta tener una tool tipada; ya no puede aparentar éxito mediante el fallback genérico.

5. **No hay validación en imagen/VM en esta rama.** Las suites y bundles TypeScript pasan, pero no
   se construyó ni arrancó la ISO por prohibición expresa. La entrega necesita posteriormente el
   smoke de imagen autorizado para verificar permisos efectivos, cookie/token y servicios systemd
   dentro de Debian 12.
