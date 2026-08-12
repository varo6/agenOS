# Análisis de gap entre la memoria del TFG y la implementación de agenOS

- Fecha del análisis: 2026-08-13
- Rama: `ws8-gap`
- Commit analizado: `a5833dd`

## Alcance, método y criterio

Se han leído únicamente los capítulos `tfg/capitulos/5-plano-sistema.tex`, `6-plano-experiencia.tex`, `7-plano-orquestacion.tex`, `8-evaluacion.tex` y `9-casos-de-uso.tex`. En este worktree no existe el directorio `tfg/`; los cinco originales se consultaron en el árbol principal del mismo repositorio (`/home/varo/code/agenOS/tfg/capitulos/`). El contraste se ha limitado a `components/agent/`, `components/ui/src/`, `components/installer-ui/src/bun/`, `components/protocols/agent-api.md`, `build/live-build/config/includes.chroot/` y, para la reproducibilidad del capítulo 8, `tools/pi-harness-eval/` y su target de Make.

No se han reanalizado los workspaces de Sway, el lanzamiento de Chromium/aplicaciones, el soporte de portátil, las dependencias ni el bucle de auto-mejora de Pi, por exclusión expresa de la tarea. Sí se señalan cruces con esas áreas cuando rompen otra promesa auditada, por ejemplo que una herramienta de Pi evite el broker o que la sesión live seleccione el frontal equivocado.

Los veredictos significan:

- **IMPLEMENTADO**: existe un camino real, no solo el contrato o la UI, y la evidencia inspeccionada ejecuta la acción prometida.
- **PARCIAL**: existe una parte real, pero falta una propiedad material de la promesa o hay un camino principal que la evita.
- **AUSENTE**: no existe el camino prometido o el código actual lo contradice directamente.
- **SIMULADO**: existe la superficie, pero devuelve estado fijo, valida solo formato, encola sin consumir o responde éxito sin realizar el efecto.

Que una ruta HTTP exista no se ha considerado prueba suficiente. Se ha seguido la llamada hasta el efecto o hasta el stub. Las referencias `fichero:línea` apuntan al estado del commit indicado.

## A. Promesas concretas y verificables de la memoria

### Capítulo 5 — plano de sistema

- **P5.1.** La ISO es una Debian 12 híbrida BIOS/UEFI generada declarativamente con live-build y reproducible mediante Docker (`tfg/capitulos/5-plano-sistema.tex:12-15`, `:35-40`, `:59-63`).
- **P5.2.** El broker y el worker arrancan como servicios systemd supervisados y sin privilegios (`tfg/capitulos/5-plano-sistema.tex:163-173`).
- **P5.3.** Las pocas operaciones privilegiadas pasan por un helper Rust estático, tipado y con una lista cerrada, invocado mediante polkit; no se admiten argumentos libres (`tfg/capitulos/5-plano-sistema.tex:175-193`).
- **P5.4.** Hay instalación guiada que entrega un perfil a Calamares y modo clásico de respaldo (`tfg/capitulos/5-plano-sistema.tex:195-208`).
- **P5.5.** Los hitos de empaquetado se validan arrancando ISO y disco en QEMU; los humos comprueban systemd, broker, GUI y resolución del modo de worker (`tfg/capitulos/5-plano-sistema.tex:210-221`).

### Capítulo 6 — plano de experiencia

- **P6.1.** Electron expone dos bridges mínimos (`agenosSystem` y `agenosPi`) y el renderer degrada transparentemente a HTTP si IPC no está disponible (`tfg/capitulos/6-plano-experiencia.tex:12-26`).
- **P6.2.** IPC y HTTP son envoltorios finos de la misma lógica real en `src/shared/system-services`, sin comportamientos divergentes (`tfg/capitulos/6-plano-experiencia.tex:28-32`).
- **P6.3.** La GPU admite `auto/on/off`; `auto` detecta un crash temprano, persiste `off` y evita un bucle de arranque (`tfg/capitulos/6-plano-experiencia.tex:34-44`).
- **P6.4.** Un único backend Bun sirve la shell en `/` y el instalador en `/installer/`, compartiendo servicios (`tfg/capitulos/6-plano-experiencia.tex:46-63`).
- **P6.5.** La shell muestra workspaces, conversación, actividad de herramientas, entrada de texto/voz y un panel admin con modo, cola y último error correlacionado (`tfg/capitulos/6-plano-experiencia.tex:65-122`).
- **P6.6.** El instalador ofrece seis pasos, preflight real de arranque/RAM/disco/alimentación, validación backend y entrega a Calamares (`tfg/capitulos/6-plano-experiencia.tex:124-137`).
- **P6.7.** La transcripción local usa whisper.cpp y el broker expone estado y transcripción (`tfg/capitulos/6-plano-experiencia.tex:156-177`).
- **P6.8.** Si falla STT local, se pasa al reconocimiento del navegador y después a demo; los tres modos comparten cuatro estados (`tfg/capitulos/6-plano-experiencia.tex:179-205`).
- **P6.9.** La captura es push-to-talk: se graba mientras se mantiene pulsado, se procesa al soltar y el audio nunca toca disco (`tfg/capitulos/6-plano-experiencia.tex:196-212`).

### Capítulo 7 — plano de orquestación

- **P7.1.** Pi mantiene la conversación interactiva y el worker ejecuta tareas largas persistentes sin bloquearla (`tfg/capitulos/7-plano-orquestacion.tex:10-25`).
- **P7.2.** El broker es la única autoridad de política, memoria y confirmaciones; toda acción con efecto pasa por `allow/deny/confirm`, con 403/409 explícitos y reglas fail-closed (`tfg/capitulos/7-plano-orquestacion.tex:4-8`, `:30-50`, `:70-76`).
- **P7.3.** La memoria local se guarda por namespaces en Markdown y sus eventos en NDJSON append-only (`tfg/capitulos/7-plano-orquestacion.tex:78-95`).
- **P7.4.** Las confirmaciones pendientes se pueden aprobar o denegar y, al aprobar, la acción queda ejecutable; las tareas tienen estado, eventos, reintento y limpieza (`tfg/capitulos/7-plano-orquestacion.tex:97-107`).
- **P7.5.** El panel admin realiza prueba real de conectividad, configuración/reinicio y exporta diagnósticos redactados (`tfg/capitulos/7-plano-orquestacion.tex:103-107`).
- **P7.6.** Todos los registros llevan versión, correlación y timestamp; una versión desconocida degrada el backend sin impedir el arranque (`tfg/capitulos/7-plano-orquestacion.tex:119-132`).
- **P7.7.** La frontera worker-broker exige un bearer token local con permisos 0600 (`tfg/capitulos/7-plano-orquestacion.tex:134-141`).
- **P7.8.** Las tools de sistema de Pi terminan en endpoints del broker y pasan por política, incluidas apertura, instalación, ficheros, setup y delegación (`tfg/capitulos/7-plano-orquestacion.tex:164-177`).
- **P7.9.** Pi usa OAuth de dispositivo, modelo objetivo `gpt-5.5-instant` y polling de turnos; streaming queda expresamente pendiente (`tfg/capitulos/7-plano-orquestacion.tex:187-219`).
- **P7.10.** Pi enruta lo inmediato al foreground y delega trabajo autónomo; si el worker falta, lo explica y ofrece aprovisionamiento o ejecución local (`tfg/capitulos/7-plano-orquestacion.tex:221-242`).
- **P7.11.** La cascada OpenClaw → worker Bun → worker simulado es utilizable y conserva cola, progreso y API; también degrada en caliente (`tfg/capitulos/7-plano-orquestacion.tex:244-306`).
- **P7.12.** El contrato HTTP aplica validación y códigos uniformes; todo efecto de agentes entra por tools mediadas (`tfg/capitulos/7-plano-orquestacion.tex:308-361`).

### Capítulo 8 — evaluación

- **P8.1.** Existen cuatro niveles de verificación: pruebas runtime/contrato, dobles, evaluación de harness y humos de imagen (`tfg/capitulos/8-evaluacion.tex:11-36`).
- **P8.2.** El objeto evaluado es exactamente contexto + tools + política del Pi real (`tfg/capitulos/8-evaluacion.tex:38-55`).
- **P8.3.** Cada turno produce NDJSON con prompt, tool calls, argumentos/resultados, duración y estado; tokens, rutas absolutas y memoria se redactan en origen (`tfg/capitulos/8-evaluacion.tex:57-87`).
- **P8.4.** `make pi-harness-eval` reproduce 14 escenarios deterministas con estado, tools requeridas/prohibidas, texto y duración; se dividen en 9 held-in y 5 held-out (`tfg/capitulos/8-evaluacion.tex:89-134`).
- **P8.5.** Los fallos se agrupan por una firma de tres componentes y generan propuestas auditables (`tfg/capitulos/8-evaluacion.tex:136-189`).
- **P8.6.** Se ejecutaron tres rondas con `K=3`, con resultados `h0=6/9+3/5`, `h1=8/9+4/5`, `h2=9/9+4/5`, incluida una rama rechazada por regresión (`tfg/capitulos/8-evaluacion.tex:219-268`).
- **P8.7.** El repositorio mantiene 48 ficheros y aproximadamente 277 casos de prueba (`tfg/capitulos/8-evaluacion.tex:270-278`).
- **P8.8.** Se midieron sobre artefacto/hardware real: ISO 1,7 GB, builds 40/11 min, boot 24/18 s, STT 780 ms, primera respuesta 1,1 s, shell 210 MB y setup 3 min 40 s (`tfg/capitulos/8-evaluacion.tex:280-308`).

### Capítulo 9 — casos de uso

- **P9.1.** Los cuatro casos se ejecutaron E2E sobre la imagen real en VM y están respaldados por pruebas (`tfg/capitulos/9-casos-de-uso.tex:4-9`).
- **P9.2.** Caso 1: push-to-talk abre el reproductor en el workspace 4 en poco más de dos segundos y el 503 de STT degrada sin cortar el flujo (`tfg/capitulos/9-casos-de-uso.tex:11-37`).
- **P9.3.** Caso 2: la conversación aprovisiona OpenClaw/OAuth y opcionalmente configura Telegram con envío de prueba real y activación (`tfg/capitulos/9-casos-de-uso.tex:75-115`).
- **P9.4.** Caso 3: la sesión live entra directamente al instalador fullscreen, completa el perfil y reinicia al sistema instalado (`tfg/capitulos/9-casos-de-uso.tex:117-147`).
- **P9.5.** Caso 4: Pi delega, libera la conversación, persiste progreso y el mismo worker se consulta desde Telegram; las tools de fondo esperan confirmación (`tfg/capitulos/9-casos-de-uso.tex:149-178`).
- **P9.6.** Las cascadas de voz y worker se ejercitan de verdad, no solo en tests (`tfg/capitulos/9-casos-de-uso.tex:180-199`).

## B. Veredicto por promesa y evidencia

### Capítulo 5

| ID | Veredicto | Evidencia y razonamiento |
| --- | --- | --- |
| P5.1 | **PARCIAL** | El árbol inyectado contiene configuración y unidades reales, pero la reproducibilidad completa de live-build/Docker no puede probarse desde los directorios de código autorizados. No hay en `tools/pi-harness-eval/` evidencia de builds 40/11 min. La parte de dependencias se excluyó expresamente de este análisis. |
| P5.2 | **IMPLEMENTADO** | El broker y el worker tienen unidades reales y corren como `User=agenos`, `Group=agenos`: `build/live-build/config/includes.chroot/etc/systemd/system/agenos-agent-api.service:6-18` y `build/live-build/config/includes.chroot/etc/systemd/system/agenos-openclaw.service:6-23`. |
| P5.3 | **PARCIAL** | La política polkit/helper no basta para sostener una frontera diminuta: la sesión live instala `agenos ALL=(ALL) NOPASSWD:ALL` (`build/live-build/config/includes.chroot/lib/live/config/9990-agenos-greetd:29-33`) y `apps_install` eleva `apt-get` genérico mediante `sudo -n` o `pkexec` (`components/agent/apps.ts:347-364`, `:606-639`). Además, `agenos-shell-helper` no es un artefacto versionado bajo `includes.chroot`, por lo que el binario Rust y su whitelist no son auditables en el alcance dado. |
| P5.4 | **IMPLEMENTADO** | El backend valida el perfil, lo escribe 0600, lanza el helper en modo `guided` y limpia el fichero (`components/installer-ui/src/bun/installer/launch.ts:95-146`); también existe `classic` (`:149-160`). El descubrimiento de discos usa `lsblk` y excluye el medio live (`components/installer-ui/src/bun/installer/disks.ts:24-31`, `:67-69`). Esto no implica que la sesión live entre automáticamente al frontal correcto; ese fallo se trata en P9.4. |
| P5.5 | **PARCIAL** | Las unidades y endpoints que un humo podría comprobar existen, pero no hay, en el material evaluador versionado, resultados, logs o imágenes que reproduzcan los humos declarados. La afirmación histórica puede ser cierta, pero no queda demostrable hoy con el alcance solicitado. |

### Capítulo 6

| ID | Veredicto | Evidencia y razonamiento |
| --- | --- | --- |
| P6.1 | **PARCIAL** | Los bridges existen (`components/ui/src/electron/preload.ts:91-109`, `:111-146`), y los clientes eligen IPC o HTTP al crearse. Sin embargo, si IPC está disponible y falla una llamada, no hay fallback por operación: `createPiClient` fija el bridge (`components/ui/src/lib/pi-client.ts:106-156`) y `createSystemClient` hace lo mismo (`components/ui/src/lib/system-client.ts:154-160`). |
| P6.2 | **SIMULADO** | El camino Electron no es un wrapper fino del backend real. Devuelve RAM/disco a cero y checks vacíos (`components/ui/src/electron/main.ts:467-474`), “Mantenimiento no implementado” con `ok:true` y acepta cambio de modo sin escribirlo ni recargar nada (`:488-503`). Por tanto IPC y HTTP sí divergen materialmente. |
| P6.3 | **AUSENTE** | Electron solo interpreta `off`; todo lo demás se convierte en `on` (`components/ui/src/electron/main.ts:22-24`). No hay estado `auto`, detección de crash ni persistencia de fallback en el entrypoint usado por la shell. |
| P6.4 | **IMPLEMENTADO** | El servidor redirige `/installer`, sirve ese prefijo desde un dist separado y usa el frontal del sistema para el resto (`components/installer-ui/src/bun/server.ts:227-253`), dentro del mismo proceso/API (`:416-445`). |
| P6.5 | **PARCIAL** | La UI monta conversación, selector de workspaces, voz y admin (`components/ui/src/App.tsx:232-244`, `:306`, `:334`). La observabilidad de lectura existe, pero varias acciones del panel son no-op y el panel expone un textbox de shell arbitrario (`components/ui/src/components/AgentAdminPanel.tsx:226-262`). |
| P6.6 | **PARCIAL** | El camino HTTP del instalador tiene descubrimiento, validación y launch reales (`components/installer-ui/src/bun/installer/launch.ts:95-146`), pero el bridge Electron que consume la shell da un preflight fijo con RAM/disco cero (`components/ui/src/electron/main.ts:467-474`). La entrada automática live también está rota, véase P9.4. |
| P6.7 | **IMPLEMENTADO** | El servicio resuelve binario/modelo, normaliza audio, ejecuta whisper.cpp y devuelve duración/modelo (`components/installer-ui/src/bun/speech/stt.ts:262-346`). Usa ficheros temporales y los borra al terminar (`:294-300`, `:354-355`). |
| P6.8 | **AUSENTE** | La selección inicial sí intenta nativo → HTTP → navegador (`components/ui/src/lib/speech-recognition.ts:232-245`), pero el preload declara disponible el bridge por estar en modo IPC, no por tener Whisper (`components/ui/src/electron/preload.ts:41-47`, `:148-163`). Si falta STT nativo, la voz se deshabilita (`components/ui/src/lib/speech-recognition.ts:130-140`); si HTTP responde 503, solo se emite error (`components/ui/src/lib/local-stt.ts:175-185`). No existe modo demo en esta cascada. |
| P6.9 | **AUSENTE** | El control es click para iniciar y segundo click para cancelar, no mantener/soltar (`components/ui/src/components/voice/VoiceConsole.tsx:66-88`). En Electron se graban cuatro segundos fijos a un WAV temporal (`components/ui/src/electron/main.ts:404-427`), contradiciendo tanto el gesto como “el audio no toca disco”; se borra después (`:462-464`), pero sí fue persistido. |

### Capítulo 7

| ID | Veredicto | Evidencia y razonamiento |
| --- | --- | --- |
| P7.1 | **PARCIAL** | Pi y worker tienen superficies separadas y la cola persiste, pero solo OpenClaw puede hacer trabajo real. Los fallbacks Bun/simulado no satisfacen la promesa de tarea larga; véase P7.11. |
| P7.2 | **PARCIAL** | `decidePolicy` es real y default-deny (`components/installer-ui/src/bun/agent/policy.ts:20-34`), pero la primera regla permite cualquier tool con `source:"ui"` (`components/installer-ui/src/bun/agent/policy-rules.ts:24-32`), por delante de shell destructiva y admin-confirm (`:33-48`, `:79-100`). La propia suite codifica que admin y shell UI deben saltarse confirmación (`components/installer-ui/src/bun/agent/policy.test.ts:44-64`). Más grave: el Pi de Electron se instancia y ejecuta directamente (`components/ui/src/electron/main.ts:206-217`, `:505-554`), fuera del broker. |
| P7.3 | **IMPLEMENTADO** | Crea `contacts.md`, `preferences.md` y `facts.md` con modo 0600 (`components/installer-ui/src/bun/agent/memory.ts:35-54`) y añade eventos con correlación a `events.ndjson` (`:78-104`). |
| P7.4 | **PARCIAL** | La cola y endpoints existen, pero confirmar solo aplica `memory.write`; no continúa shell, admin, outbound ni una tarea en espera (`components/installer-ui/src/bun/server.ts:1118-1145`). Reintentar solo devuelve texto fijo y limpiar delega a una confirmación que, por el orden de política, se transforma en éxito sin borrar (`components/installer-ui/src/bun/agent/admin.ts:132-141`, `:156-160`). |
| P7.5 | **SIMULADO** | `writeConfig` y `restart` no escriben ni reinician: solo llaman a `confirmationRequired` (`components/installer-ui/src/bun/agent/admin.ts:106-121`), que actualmente responde `ok:true` sin efecto (`:156-160`). `testConnection` no contacta al proveedor, solo traduce readiness local (`:122-130`). |
| P7.6 | **PARCIAL** | Los registros normales sí llevan campos de protocolo, pero las migraciones de tarea/evento/confirmación/memoria lanzan excepción ante versión futura (`components/installer-ui/src/bun/agent/worker/migrations.ts:24-47`, `:68-86`), lo contrario de degradar sin impedir arranque. Solo config devuelve formalmente `degradedReason` (`:50-65`). |
| P7.7 | **IMPLEMENTADO** | El token se crea y corrige a 0600 y la autorización compara `Bearer` exacto (`components/installer-ui/src/bun/agent/worker/local-auth.ts:19-31`, `:42-45`). El servidor lo instala para rutas worker (`components/installer-ui/src/bun/server.ts:442-444`). |
| P7.8 | **AUSENTE** | Las custom tools inspeccionadas ejecutan adaptadores locales directamente: `files_open` llama a `fileTool.openPath` (`components/agent/file-open-tool.ts:51-79`), `browser_open` al launcher (`components/agent/browser-open-tool.ts:61-115`) y `apps_install` a `apt-get` elevado (`components/agent/apps.ts:581-670`). El broker solo expone `/api/agent/apps/open`, no install (`components/installer-ui/src/bun/server.ts:1328-1344`; contrato en `components/protocols/agent-api.md:94-113`). |
| P7.9 | **PARCIAL** | Hay endpoints/IPC de login y polling; la decisión consciente de no usar streaming coincide con el contrato (`components/protocols/agent-api.md:24-37`, `:138-145`). No obstante, la shell empaquetada usa un harness Pi residente en Electron, mientras el servidor mantiene otro camino; no hay una única sesión broker. El modelo/latencia de 1,1 s no se puede verificar con los artefactos de evaluación actuales. |
| P7.10 | **PARCIAL** | Existe `agent_task` y la cola, pero la alternativa “lo hace Pi cuando sea viable” depende del modelo, no de un fallback orquestado. Con worker simulado la petición queda eternamente `queued` (`components/installer-ui/src/bun/agent/worker/local-simulated.ts:37-80`). |
| P7.11 | **SIMULADO** | `auto` selecciona OpenClaw, Bun o simulado (`components/installer-ui/src/bun/agent/worker/index.ts:47-63`), pero el simulado solo escribe `queued` y nunca consume (`components/installer-ui/src/bun/agent/worker/local-simulated.ts:37-80`). El daemon Bun crea un planner sin `planWithModel` (`components/installer-ui/src/bun/agent/worker/agenos-worker-daemon.ts:38-40`), por lo que el planner model-backed devuelve “Provider/auth is not configured” (`components/installer-ui/src/bun/agent/worker/planner.ts:41-47`) y la tarea falla (`components/installer-ui/src/bun/agent/worker/agenos-worker-daemon.ts:95-138`). No hay degradación en caliente implementada en esa selección. |
| P7.12 | **PARCIAL** | Hay rutas y validaciones reales, pero el contrato no contiene `apps_install`, las tools de Pi pueden evitarlas y los efectos locales carecen de autenticación de sesión. CORS permite cualquier origen (`components/installer-ui/src/bun/http.ts:10-15`) y `/api/agent/shell/exec` ejecuta como UI sin autenticar (`components/installer-ui/src/bun/server.ts:1248-1265`). Los códigos tampoco son uniformes: setup devuelve 202 incluso cuando el objeto interno puede indicar fallo (`:952-988`). |

### Capítulo 8

| ID | Veredicto | Evidencia y razonamiento |
| --- | --- | --- |
| P8.1 | **PARCIAL** | Hay tests de Bun/Vitest y un replay evaluator real. Los humos y medidas de imagen no dejan resultados reproducibles dentro de los artefactos auditados. |
| P8.2 | **PARCIAL** | El evaluador consume trazas de Pi, pero no evalúa de forma integrada la política efectiva del broker: valida nombres de tools en una traza. Además, el Pi de Electron ejecuta custom tools directas, por lo que “contexto + tools + política” no es una única unidad ejecutable (`components/ui/src/electron/main.ts:505-554`; `components/agent/file-open-tool.ts:63-78`). |
| P8.3 | **PARCIAL** | La captura y el saneado existen, pero la redacción solo cubre bearer, claves `sk-` y pares con nombres token/secret (`components/agent/harness-trace.ts:77-109`). No redacta rutas absolutas ni contenido de memoria y no genera el array `redactions` mostrado en la memoria. |
| P8.4 | **PARCIAL** | La suite actual tiene 14 escenarios y el replay es determinista, pero la distribución real es 8 held-in, 4 held-out y 2 safety (`tools/pi-harness-eval/scenarios/pi-smoke.json:7-162`), no 9+5. El ejemplo publicado tampoco coincide con el JSON actual: el escenario real de VLC exige `apps_open`, prohíbe `apps_install`, busca “VLC” y no fija duración (`:19-28`), mientras la memoria dice prohibir `bash`, buscar “espacio” y máximo 15 s. |
| P8.5 | **SIMULADO** | El código agrupa únicamente por `failureCode` (`tools/pi-harness-eval/src/proposals.ts:33-40`), no por la firma causa/comportamiento/mecanismo. Las propuestas son plantillas fijas para unos pocos códigos (`:65-129`), no tres ramas `K=3` con evaluación de regresión. |
| P8.6 | **AUSENTE** | No hay trazas, `summary.json`, propuestas, diffs o manifiesto versionado de `h0/h1/h2`. El fixture contiene solo tres turnos sintéticos (`tools/pi-harness-eval/fixtures/pi-chat.ndjson:1-3`). Al ejecutarlo hoy en estricto produce 3/14, no ninguna fila de la tabla. |
| P8.7 | **AUSENTE** como reproducción histórica | Un recuento actual en los tres árboles auditados da 61 ficheros `*.test/spec.{js,jsx,ts,tsx}` y 349 declaraciones `test(`/`it(`, no 48/~277. Esto puede ser evolución posterior, pero no hay snapshot o manifiesto que permita recuperar y verificar el recuento publicado. |
| P8.8 | **AUSENTE** como reproducción | `tools/pi-harness-eval/` solo reproduce aserciones sobre trazas y `durationMs`; no mide tamaño de ISO, tiempo de build/boot, RSS, STT real, primera respuesta ni setup. No hay muestras crudas, identificación completa del portátil, protocolo, número de repeticiones, dispersión ni scripts de benchmark versionados junto a los resultados. |

### Capítulo 9

| ID | Veredicto | Evidencia y razonamiento |
| --- | --- | --- |
| P9.1 | **AUSENTE** como evidencia reproducible | No hay un artefacto E2E versionado que demuestre la ejecución de los cuatro recorridos sobre una misma imagen. Hay tests unitarios/contrato, pero varios aprueban explícitamente comportamientos divergentes, por ejemplo el superusuario UI que evita confirmaciones (`components/installer-ui/src/bun/agent/policy.test.ts:44-64`). |
| P9.2 | **PARCIAL** | STT y apertura existen, pero el gesto no es mantener/soltar, el audio toca disco, el 503 no degrada y la custom tool no termina en el broker. La latencia de dos segundos carece de muestra reproducible. |
| P9.3 | **SIMULADO** | OAuth arranca un proceso real, pero Telegram solo valida la forma del token (`components/installer-ui/src/bun/agent/setup.ts:696-700`) y “enable” cambia estado local (`:446-461`); no llama a Telegram, no envía prueba y no configura un canal operativo en OpenClaw. |
| P9.4 | **AUSENTE** en el arranque actual | Aunque `/etc/agenos/shell.json` declara `bootMode: installer` (`build/live-build/config/includes.chroot/etc/agenos/shell.json:1-6`), `agenos-shell-runner` ignora ese fichero y devuelve `system` tanto en live como instalado (`build/live-build/config/includes.chroot/usr/local/bin/agenos-shell-runner:36-49`). Por tanto la USB no muestra el instalador guiado automáticamente. |
| P9.5 | **PARCIAL** solo con OpenClaw real; **SIMULADO** en fallbacks | La cola/progreso de OpenClaw puede funcionar, pero Bun falla planificación y simulado no consume. El worker tool runner solo ejecuta realmente `memory.write` y `shell.exec`; cualquier otra tool permitida responde “Tool call accepted” sin efecto (`components/installer-ui/src/bun/agent/tool-runner.ts:87-124`). Confirmar no reanuda la tarea (`components/installer-ui/src/bun/server.ts:1118-1145`) y Telegram no es real. |
| P9.6 | **AUSENTE** | La cascada de voz se detiene al fallar nativo/HTTP y la cascada de worker termina en modos no utilizables. La frase “se ejercita de verdad” contradice los caminos ejecutables actuales. |

## C. Los 12 gaps más graves por impacto en el usuario final

Los esfuerzos son estimaciones de ingeniería para corregir, añadir tests y validar el flujo, no solo cambiar una línea. `d` significa días-persona; `sem` semanas-persona.

| Prioridad | Gap y síntoma observable | Causa raíz y evidencia | Esfuerzo estimado |
| ---: | --- | --- | --- |
| 1 | **Ejecución de shell desde cualquier origen local/web permitido por el navegador.** Una página maliciosa o proceso local puede intentar ejecutar comandos con los permisos del usuario agenOS; no aparece confirmación aunque el comando sea destructivo. | CORS `*` y `content-type` habilitado (`components/installer-ui/src/bun/http.ts:10-15`), endpoint sin autenticación (`components/installer-ui/src/bun/server.ts:1248-1265`) y regla UI global antes de la destructiva (`components/installer-ui/src/bun/agent/policy-rules.ts:24-39`). | **2–4 d**: token/origin binding, PNA/CORS restrictivo, mover regla destructiva, CSRF/contract tests. |
| 2 | **La arquitectura “broker como única autoridad” no se cumple.** En la shell empaquetada Pi puede abrir, instalar o tocar ficheros sin pasar por la política/auditoría central; UI y servidor pueden mantener sesiones Pi distintas. | Electron instancia `createPiHarness` directamente (`components/ui/src/electron/main.ts:206-217`, `:505-554`) y las custom tools llaman adaptadores locales (`components/agent/file-open-tool.ts:63-78`, `components/agent/browser-open-tool.ts:77-104`, `components/agent/apps.ts:581-670`). | **1–2 sem**: unificar Pi en broker o convertir todas las custom tools a clientes broker, con identidad/correlación end-to-end. |
| 3 | **Confirmaciones y controles admin engañosos.** “Reiniciar”, “guardar config”, “limpiar” y “reintentar” pueden mostrar éxito sin hacer nada; los comandos sensibles de UI no piden confirmación. | Regla `agent.ui.superuser.allow` eclipsa reglas posteriores (`components/installer-ui/src/bun/agent/policy-rules.ts:24-32`, `:79-100`); admin solo devuelve resultado de política (`components/installer-ui/src/bun/agent/admin.ts:106-141`, `:156-160`); confirmación solo materializa memoria (`components/installer-ui/src/bun/server.ts:1133-1145`). | **4–7 d**: ordenar política, modelar acción pendiente tipada, ejecutar/reanudar idempotentemente, tests de efectos. |
| 4 | **La USB live abre la shell de sistema en lugar del instalador.** El tribunal arranca la ISO y no ve el caso de uso 3 prometido. | El JSON dice `installer`, pero el runner devuelve `system` en ambos lados (`build/live-build/config/includes.chroot/etc/agenos/shell.json:1-6`; `build/live-build/config/includes.chroot/usr/local/bin/agenos-shell-runner:36-49`). | **0,5–1 d** más un ciclo de build/boot live y disco. |
| 5 | **El modo degradado del worker no trabaja.** Una tarea puede quedarse `queued` para siempre o fallar inmediatamente con “Provider/auth is not configured”; el health del simulado dice `ok:true`. | Simulado solo persiste cola/evento (`components/installer-ui/src/bun/agent/worker/local-simulated.ts:24-80`); Bun crea planner sin implementación (`components/installer-ui/src/bun/agent/worker/agenos-worker-daemon.ts:38-40`) y falla el plan (`:95-138`). | **2–3 sem** para un worker mínimo real; **1–2 d** si se decide declarar ambos modos no disponibles en vez de simular utilidad. |
| 6 | **Tools del worker pueden responder éxito sin efecto y una confirmación no reanuda la tarea.** El usuario ve “aceptado” pero la app/web/acción no ocurre, o la tarea queda esperando después de confirmar. | Fallback genérico `ok:true, "Tool call accepted"` (`components/installer-ui/src/bun/agent/tool-runner.ts:119-124`); confirmación solo ejecuta memoria y no cambia/continúa la tarea (`components/installer-ui/src/bun/server.ts:1118-1145`). | **1–2 sem**: dispatch exhaustivo, errores para tools no implementadas, estado suspendido/reanudable y pruebas E2E. |
| 7 | **Telegram aparenta estar validado y activado sin existir comunicación.** Un token con formato correcto pasa el “test”; no hay mensaje real y el móvil no puede consultar la tarea. | `defaultTelegramProbe` solo aplica regex (`components/installer-ui/src/bun/agent/setup.ts:696-700`); `enableTelegram` persiste un booleano (`:446-461`); el secreto se guarda pero no se propaga a una configuración de canal (`:552-557`). | **4–8 d**: `getMe`/envío real, chat destino, configuración OpenClaw, rollback y pruebas con API doble/integración. |
| 8 | **La degradación de voz prometida falla y el gesto no es push-to-talk.** Sin Whisper la voz queda deshabilitada; con 503 no salta al navegador; el click graba una duración fija y otro click cancela. | Selección única inicial (`components/ui/src/lib/speech-recognition.ts:232-245`), errores nativo/503 terminales (`:130-140`; `components/ui/src/lib/local-stt.ts:182-185`), click-toggle (`components/ui/src/components/voice/VoiceConsole.tsx:79-88`) y grabación fija a WAV (`components/ui/src/electron/main.ts:404-427`). | **4–7 d**: máquina de estados con fallback runtime, press/release real, cancelación de recorder y tests de integración. |
| 9 | **Un fallo de GPU puede dejar la shell en bucle.** La configuración documentada `auto` no existe en el proceso Electron que arranca la UI. | Cualquier valor distinto de `off` se reduce a `on` (`components/ui/src/electron/main.ts:22-24`); no hay marca de arranque estable ni fallback persistido. | **2–4 d** más pruebas en VM/hardware con crash inducido. |
| 10 | **Pi recibe un system prompt con marcadores de conflicto Git.** Puede interpretar instrucciones duplicadas/contradictorias y la versión evaluada del harness no es identificable. | Marcadores `<<<<<<<`, `=======`, `>>>>>>>` versionados (`components/agent/pi-system-context.md:12-17`), cargados literalmente (`components/agent/pi-system-context.ts:4-22`). | **0,5 d** para resolver y añadir lint; repetir la evaluación válida requiere esfuerzo adicional. |
| 11 | **Las trazas pueden filtrar rutas y memoria pese a prometer redacción en origen.** Un paquete diagnóstico/evaluación puede contener `/home/agenos/...` o texto personal. | Redactor limitado a bearer, `sk-` y nombres token/secret (`components/agent/harness-trace.ts:77-109`); no hay reglas de home paths ni memoria. | **2–4 d**: redacción estructurada por campos, marcadores, casos adversariales y revisión de paquetes existentes. |
| 12 | **Un registro con versión futura puede romper lecturas/arranque en vez de degradar.** Tras una actualización/downgrade, cola, memoria o confirmaciones pueden fallar con excepción. | `assertSupportedSchemaVersion` lanza para task/event/confirmation/memory (`components/installer-ui/src/bun/agent/worker/migrations.ts:24-47`, `:68-86`). | **3–5 d**: resultado tipado de migración, cuarentena de registros, estado degraded y fixtures forward-version. |

Dos gaps adicionales relevantes, aunque quedan fuera del top 12, son la instalación de paquetes por `sudo/pkexec apt-get` fuera del helper privilegiado acotado (`components/agent/apps.ts:347-364`, `:606-639`) y el preflight Electron fijo en cero (`components/ui/src/electron/main.ts:467-474`).

## D. Evaluación: qué se afirma que se midió y qué puede reproducirse hoy

### D.1 Afirmaciones de medida del capítulo 8

El capítulo no se limita a describir una metodología. Afirma resultados concretos ya obtenidos:

1. Se producen trazas reales de uso normal y redactadas en origen, con un esquema concreto (`tfg/capitulos/8-evaluacion.tex:57-87`).
2. Existe una suite de 14 escenarios, 9 held-in y 5 held-out, con constraints de tools, texto, estado y latencia (`:89-134`).
3. El agrupamiento usa la firma de tres componentes y genera propuestas sobre esa evidencia (`:136-189`).
4. Se ejecutaron tres rondas con `K=3` y se obtuvieron las puntuaciones 9/14 → 12/14 → 13/14, preservando 4/5 held-out en el estado final (`:219-268`).
5. Había 48 ficheros y aproximadamente 277 tests (`:270-278`).
6. Sobre la imagen y un portátil se midieron ISO 1,7 GB, builds 40/11 min, boot 24/18 s, STT 780 ms, primera respuesta 1,1 s, RSS 210 MB y onboarding 3 min 40 s (`:280-308`).

### D.2 Reproducción efectuada hoy

Se ejecutó el CLI actual contra la única traza fixture versionada, escribiendo el informe fuera del repo:

```text
bun run tools/pi-harness-eval/src/cli.ts \
  --suite tools/pi-harness-eval/scenarios/pi-smoke.json \
  --trace tools/pi-harness-eval/fixtures/pi-chat.ndjson \
  --out /tmp/agenos-pi-eval-report.json \
  --strict

AgenOS Pi harness eval: 3/14 passed (21.4%).
Trace records evaluated: 3/3
exit status: 1
```

El reparto producido por el propio evaluador fue:

| Split actual | Aprobados | Total |
| --- | ---: | ---: |
| held-in | 2 | 8 |
| held-out | 0 | 4 |
| safety | 1 | 2 |
| **total** | **3** | **14** |

Este resultado solo prueba que el replay funciona y que tres fixtures fueron escritos para pasar tres escenarios. No reproduce `h0`, `h1` ni `h2`.

### D.3 Matriz de reproducibilidad

| Afirmación publicada | ¿Reproducible hoy? | Diagnóstico |
| --- | --- | --- |
| El evaluador ejecuta 14 escenarios deterministas | **Sí, parcialmente** | El CLI carga suite y trazas y evalúa aserciones. Un fichero de traza inexistente se transforma silenciosamente en lista vacía (`tools/pi-harness-eval/src/trace.ts:4-14`). Además, el modo por defecto no es estricto: solo falla el proceso con `--strict` (`tools/pi-harness-eval/src/cli.ts:43-58`, `:67-72`); `make pi-harness-eval` no añade `--strict` (`Makefile:17-18`). Por tanto CI/manual puede mostrar 0/14 y aun terminar con código 0. |
| Split 9 held-in + 5 held-out | **No** | El JSON actual contiene 8 held-in, 4 held-out y 2 safety (`tools/pi-harness-eval/scenarios/pi-smoke.json:7-162`). Los 2 safety no pertenecen formalmente a ninguno de los dos splits de aceptación publicados. |
| Escenario de ejemplo de VLC | **No** | La memoria publica `forbiddenTools:[bash]`, `outputIncludes:[espacio]`, `maxDurationMs:15000`; el repo actual pide `apps_open`, prohíbe `apps_install`, busca `VLC` y no tiene máximo (`tools/pi-harness-eval/scenarios/pi-smoke.json:19-28`). |
| Seguridad validada por rechazo real | **No de forma fuerte** | Los escenarios safety solo prohíben tres nombres de tool y buscan substrings débiles como “no” o “disco” (`tools/pi-harness-eval/scenarios/pi-smoke.json:143-162`). No consultan la decisión del broker ni impiden otras tools destructivas; una respuesta del tipo “no hay problema, disco formateado” podría satisfacer un substring si la traza no registra la tool real. |
| Trazas redactadas de prompt/tools/resultado | **Parcial** | Existe trace/sanitize, pero no el esquema mostrado (`correlationId`, `toolCalls`, `finalStatus`, `redactions`) y la redacción no cubre home paths ni memoria (`components/agent/harness-trace.ts:77-109`). |
| Clustering por firma de 3 componentes | **No** | Se agrupa solo por código de fallo (`tools/pi-harness-eval/src/proposals.ts:33-40`). No se calcula `verifierCause + agentBehavior + mechanism`. |
| Anchura de propuesta `K=3` y aceptación por regresión | **No** | El generador emite como máximo una plantilla fija por clase de error (`tools/pi-harness-eval/src/proposals.ts:65-129`). No crea tres ramas, no ejecuta candidatos y no compara held-in/held-out. |
| Tres rondas y puntuaciones h0/h1/h2 | **No** | `git ls-files tools/pi-harness-eval` no contiene trazas completas, summaries, proposals aceptadas/rechazadas, hashes de commits/modelo, semillas ni manifiesto de rondas. El único fixture tiene tres líneas (`tools/pi-harness-eval/fixtures/pi-chat.ndjson:1-3`) y da 3/14. |
| Reejecutar el modelo Pi para capturar la suite | **No automáticamente** | El README indica que primero hay que conducir manualmente Pi y después hacer replay (`tools/pi-harness-eval/README.md:52-61`). El target de Make no genera 14 trazas ni autentica/invoca el harness real. |
| 48 ficheros / ~277 tests | **No como cifra histórica** | Hoy el recuento del alcance es 61 ficheros y 349 declaraciones. No hay snapshot etiquetado o manifiesto de la medición publicada. La suite actual puede haber crecido; el problema es de trazabilidad, no necesariamente de falsedad histórica. |
| ISO/build/boot/RSS/STT/primera respuesta/setup | **No con `tools/pi-harness-eval/`** | El evaluador solo lee trazas y aserciones; no construye ISO, no arranca QEMU, no muestrea RSS y no cronometra Whisper/onboarding. Tampoco hay CSV/JSON/logs crudos o protocolo de benchmark versionado que permita recalcular media, dispersión o condición de parada. |

### D.4 Riesgo explícito para la defensa

**El repositorio actual no permite reproducir las principales cifras y resultados que el capítulo 8 presenta como medidos.** Esto es un riesgo alto para la defensa del TFG, por cuatro motivos concretos:

1. Una demostración de `make pi-harness-eval` sin trazas locales puede terminar con éxito de proceso aunque fallen los 14 escenarios. Con el fixture versionado muestra 3/14, visualmente incompatible con la tabla de la memoria.
2. La suite que el tribunal puede abrir no tiene el reparto ni el escenario de ejemplo descritos. No es solo drift de puntuación: cambió el objeto experimental.
3. No existe cadena de custodia para `h0/h1/h2`: faltan entradas, outputs, versión exacta del modelo/harness/política, candidatos `K=3`, rama rechazada y resultados de cada ronda. No se puede auditar que los números 6/9+3/5, 8/9+4/5 y 9/9+4/5 procedan del código disponible.
4. Las métricas del sistema son números sin artefacto bruto ni procedimiento ejecutable. Un evaluador externo no puede distinguir una medición única, una media, una estimación o una cifra histórica tomada en otro estado del repositorio.

Hay además un problema de identidad del harness: el documento que supuestamente representa `h2` contiene marcadores de conflicto Git (`components/agent/pi-system-context.md:12-17`). Mientras no se resuelva y no se asocie cada ronda a un commit/traza, no puede afirmarse qué instrucciones exactas produjeron los resultados publicados.

La formulación defendible hoy sería: “existe un evaluador determinista de replay y una suite actual de 14 escenarios, pero los artefactos de las tres rondas y de los benchmarks publicados no están versionados y no son reproducibles desde este checkout”. Defender que las tablas son reproducibles con el repositorio actual sería incorrecto.

## E. Casos de uso del capítulo 9 que fallarían en una prueba en vivo

### Caso 1 — operar el sistema hablando: **fallo parcial y fallo seguro bajo degradación**

El camino nominal puede transcribir con Whisper y la tool local puede abrir la aplicación; no se reevalúa aquí el lanzamiento/workspace recién reparado. Sin embargo, un tribunal que siga literalmente el guion observaría diferencias:

- No se mantiene pulsado y se suelta para enviar. Un click inicia y otro cancela (`components/ui/src/components/voice/VoiceConsole.tsx:79-88`); Electron graba cuatro segundos fijos (`components/ui/src/electron/main.ts:404-427`).
- El audio sí se escribe temporalmente a disco (`components/ui/src/electron/main.ts:406-427`; en HTTP, `components/installer-ui/src/bun/speech/stt.ts:294-300`). Se borra, pero contradice la afirmación literal.
- Si se quita Whisper/modelo o se fuerza un 503, no aparece navegador/demo: se deshabilita o muestra error (`components/ui/src/lib/speech-recognition.ts:130-140`; `components/ui/src/lib/local-stt.ts:182-185`).
- `apps_open` en Pi no sigue la secuencia del diagrama Pi → broker → política; el harness Electron ejecuta tools locales (`components/ui/src/electron/main.ts:505-554`).
- “Poco más de dos segundos” no es reproducible con el fixture/benchmark actual.

**Resultado probable en vivo:** funciona solo en la configuración nominal y con un gesto distinto; falla en cuanto el tribunal prueba la degradación que el propio caso afirma.

### Caso 2 — configurar el backend conversando: **falla en Telegram y puede declarar listo un backend no operativo**

El flujo OAuth tiene implementación real, pero la parte demostrable de Telegram es un mock semántico:

- “Test” solo comprueba regex del token y devuelve “format looks valid” (`components/installer-ui/src/bun/agent/setup.ts:696-700`).
- “Enable” solo persiste `telegramEnabled` según el test local (`components/installer-ui/src/bun/agent/setup.ts:446-461`).
- No existe envío a Telegram, `getMe`, chat destino ni configuración del canal en OpenClaw.
- `buildState` considera saludable OpenClaw por estar instalado si no recibió health explícito (`components/installer-ui/src/bun/agent/setup.ts:479-497`). El worker Bun alternativo tampoco puede planificar (`components/installer-ui/src/bun/agent/worker/agenos-worker-daemon.ts:38-40`, `:95-138`).

**Resultado probable en vivo:** puede completarse la UI de setup y almacenar secretos, pero el mensaje de prueba real y la consulta desde móvil no ocurren. Si el tribunal exige ver el bot respondiendo, el caso falla.

### Caso 3 — instalar el sistema: **falla en el primer paso del guion**

La sesión live no selecciona el instalador. Aunque `/etc/agenos/shell.json` dice `installer`, el runner devuelve `system` en live e instalado (`build/live-build/config/includes.chroot/usr/local/bin/agenos-shell-runner:36-49`). El switch de modo IPC, además, responde éxito sin escribir/cambiar nada (`components/ui/src/electron/main.ts:494-497`).

El backend guiado y Calamares tienen caminos reales si se invocan manualmente (`components/installer-ui/src/bun/installer/launch.ts:95-160`), pero eso no salva la promesa “arranca directamente al instalador fullscreen”.

**Resultado probable en vivo:** aparece la shell normal, no las seis pantallas. El caso completo no puede iniciarse según el procedimiento descrito.

### Caso 4 — delegar trabajo al segundo plano: **falla salvo en una configuración OpenClaw real muy concreta, y aun así no cumple todo el contrato**

- En `local-simulated`, la tarea queda `queued` indefinidamente (`components/installer-ui/src/bun/agent/worker/local-simulated.ts:37-80`).
- En `agenos-bun-worker`, falla al planificar porque no se inyecta modelo (`components/installer-ui/src/bun/agent/worker/agenos-worker-daemon.ts:38-40`, `:95-138`).
- Muchas tool calls de worker responden éxito sin efecto (`components/installer-ui/src/bun/agent/tool-runner.ts:119-124`).
- Una confirmación de tool distinta de memoria no ejecuta la acción ni reanuda la tarea (`components/installer-ui/src/bun/server.ts:1118-1145`).
- La consulta desde Telegram no existe realmente (`components/installer-ui/src/bun/agent/setup.ts:696-700`).
- Reintento y limpieza admin son respuestas sin ciclo de vida real (`components/installer-ui/src/bun/agent/admin.ts:132-141`).

**Resultado probable en vivo:** con OpenClaw correctamente autenticado puede existir una respuesta de fondo básica, pero el recorrido prometido —progreso durable, tools mediadas efectivas, pausa/confirmación/reanudación y consulta desde Telegram— falla. En los modos degradados que la memoria llama utilizables, falla de forma determinista.

### Conclusión sobre la demo ante tribunal

De los cuatro casos, ninguno reproduce hoy de extremo a extremo todo lo narrado:

- caso 1: **parcial**, nominal posible pero gesto, broker y degradación no coinciden;
- caso 2: **simulado** en la parte diferencial de Telegram;
- caso 3: **ausente en el arranque live**;
- caso 4: **simulado/ausente** en los fallbacks y parcial con OpenClaw.

Los fallos más fáciles de descubrir por un tribunal son, en este orden: arrancar la ISO y no ver el instalador; probar un token Telegram y no recibir mensaje; retirar Whisper y no obtener fallback; ejecutar el fixture del evaluador y ver 3/14; delegar con modo simulado y observar que la tarea nunca avanza; pulsar los botones admin y comprobar que el servicio/config/cola no cambian.
