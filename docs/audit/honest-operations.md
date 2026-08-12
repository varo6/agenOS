# WS10 — eliminación de éxitos sin efecto

- Fecha: 2026-08-13
- Rama: `ws10-honesty`
- Commits funcionales: `7ee82b9`, `38eefda`, `2bdf3b0`, `48f8fae`
- Criterio: ninguna ruta auditada puede devolver éxito si no ha ejecutado o iniciado un efecto verificable. Cuando no existe un ejecutor real, la ruta falla en español y propone la alternativa disponible.

## Decisiones y evidencia

| Ruta que mentía | Decisión | Resultado y motivo | Demostración |
| --- | --- | --- | --- |
| `POST /api/agent/admin/config` | **Implementar** | La petición crea una confirmación (`409`). Al aprobarla valida el patch, escribe atómicamente el config de usuario con modo `0600`, actualiza la vista admin y recarga inmediatamente el adaptador del broker desde disco. No se persiste `explicitUserIntent` ni campos desconocidos. | `worker/config.test.ts`: escritura, permisos y rechazo de modo inválido. `admin.test.ts`: confirmación, fichero y config leída. `tasks.test.ts`: `reload()` cambia al modo persistido. |
| `POST /api/agent/admin/restart` | **Implementar** | Tras confirmar, ejecuta únicamente `pkexec /usr/local/bin/agenos-shell-helper restart-agent`. El helper Rust tiene una rama cerrada que hace `systemctl restart agenos-openclaw.service`. Un fallo de helper/polkit devuelve `ok:false`; nunca se traduce en éxito. | `admin-effects.test.ts`: comando/argumentos exactos y error no autorizado. `admin.test.ts`: la confirmación invoca el efecto una sola vez. `cargo test` compila el helper. |
| `POST /api/agent/admin/test-connection` | **Implementar** | En `openclaw-process` exige primero gateway saludable y luego realiza una completación mínima real contra el proveedor mediante OpenClaw, con timeout de 15 s. Bun y simulado devuelven `503` porque no tienen una conexión remota comprobable. | `admin.test.ts`: round trip inyectado y error honesto fuera de OpenClaw. `openclaw-process.test.ts`: verifica llamada real a `runtime.chat` y timeout. |
| `POST /api/agent/admin/tasks/:id/retry` | **Implementar** | Solo reintenta tareas terminales; crea una ejecución nueva con el mensaje y origen originales y devuelve su nuevo `taskId`. Tarea inexistente/activa devuelve error. | `agenos-worker-daemon.test.ts`: `task_1` terminal se reintenta como `task_2`, que termina en `succeeded`. `admin.test.ts`: delegación real al ciclo de cola. |
| `POST /api/agent/admin/tasks/:id/clear` | **Implementar** | Requiere confirmación. Solo limpia tareas terminales y elimina del NDJSON tanto estados como eventos; una tarea activa/inexistente produce `ok:false`. | `agenos-worker-daemon.test.ts`: tras clear, `status` es `null` y `events` es `[]`. `admin.test.ts`: la acción confirmada llama a clear. |
| `POST /api/agent/confirmations/:id/confirm` para `memory.write` | **Implementar** | Usa el mismo ejecutor tipado que una tool permitida, conserva `confirmationId` en memoria aprendida y responde éxito solo si se escribió. | `server.test.ts` (“learning proposals…”): la memoria no existe antes y aparece activa después de confirmar. |
| La misma ruta para `shell.exec` | **Implementar** | Ejecuta exactamente el comando persistido, saltándose únicamente la segunda evaluación de política porque ya existe autorización explícita. Devuelve el resultado real del shell. | `server.test.ts` (“confirmed shell…”): cero comandos antes de confirmar; después aparecen exactamente el sensible y el paso posterior. |
| La misma ruta para `admin.*` | **Implementar** | Despacha a los tres efectos admin anteriores (`config.write`, `service.restart`, `queue.clear`) y propaga cualquier fallo. | `admin.test.ts` y `admin-effects.test.ts`. |
| La misma ruta para outbound o tool sin ejecutor | **Fallar honestamente** | `outbound.send`, mail, WhatsApp y cualquier tool desconocida no tienen backend real en este alcance. El runner devuelve `deny/ok:false` antes de crear una confirmación inútil. Si se confirma un registro histórico no soportado, HTTP devuelve `501`. | `tool-runner.test.ts`: outbound devuelve error y el store de confirmaciones queda vacío. |
| Confirmación de una tarea `waiting_confirmation` | **Implementar** | El worker Bun persiste plan, pasos y `nextStepIndex`. Confirmar ejecuta la tool pendiente y reanuda desde el paso siguiente; denegar finaliza la tarea como fallida. La continuación sobrevive a recrear el adaptador. | `agenos-worker-daemon.test.ts`: se recrea el adapter entre espera y confirmación y solo se ejecuta el paso restante. `server.test.ts`: E2E HTTP termina la tarea en `succeeded`. |
| Confirmar/denegar dos veces | **Fallar honestamente e idempotente** | La segunda resolución devuelve `409` y no vuelve a ejecutar el efecto. | `confirmations.test.ts`: solo dos líneas (create + confirm) pese a confirmar dos veces. `server.test.ts`: segundo POST da `409` y la lista de comandos no cambia. |
| Fallback genérico del tool runner (`"Tool call accepted"`) | **Fallar honestamente** | Se eliminó el éxito genérico. Solo `memory.write` y `shell.exec` tienen ejecutor en esta frontera; cualquier otra tool devuelve error con correlación y sin efecto. | `tool-runner.test.ts`, además de búsqueda de regresión sin el mensaje antiguo en código productivo. |
| `local-simulated.health()` | **Fallar honestamente** | El broker sigue arrancando y el modo se considera degradado, pero health devuelve `ok:false`, `serviceActive:false` y una causa accionable. Degradado no es fatal; tampoco significa que haya un worker. | `local-simulated.test.ts`: health degradado con mensaje de configurar OpenClaw. |
| `local-simulated.enqueue()` / `POST /api/agent/tasks` | **Fallar honestamente** | Rechaza la delegación y no crea `outbox.ndjson` ni una tarea eterna. HTTP devuelve `503` y recomienda configurar OpenClaw o ejecutar localmente en foreground. | `local-simulated.test.ts`, `tasks.test.ts` y `server.test.ts`: no existe ningún registro `queued`. |
| Worker Bun sin `planWithModel` | **Fallar honestamente** | Sin planner inyectado, health es `ok:false` y enqueue falla antes de persistir una tarea. Con planner real, ejecuta pasos, confirmaciones, retry y clear normalmente. | `agenos-worker-daemon.test.ts`: ausencia de provider/planner no crea tarea; planner inyectado completa y reanuda tareas reales. |
| IPC `getPreflight` de `components/ui` | **Implementar** | Delega en `createPreflightService({ getDisks: discoverDisks })`: lee `/proc/meminfo`, cmdline/live/EFI y `lsblk`, igual que el camino compartido. Ya no devuelve ceros/checks vacíos. | `system-ipc-services.test.ts`: RAM, disco y checks proceden del servicio. Los tests compartidos de preflight cubren la detección. |
| IPC `runMaintenance` | **Implementar** | Valida la acción y delega en `createMaintenanceService`, que lanza el helper privilegiado. Payload inválido o fallo se devuelve con `ok:false`. | `system-ipc-services.test.ts`: efecto delegado e inválidos sin llamada. `shared/system-services/maintenance` permanece cubierto por la suite completa. |
| IPC `switchMode` | **Implementar** | Delega en `createSwitchModeService`: persiste el override, lanza reload de shell y revierte el fichero si el helper falla. | `system-ipc-services.test.ts`: llamada real al servicio e inválidos sin efecto. `switch-mode.test.ts`: persistencia/rollback compartidos. |

## Verificación final

`make test` desde la raíz, verde:

| Suite | Resultado |
| --- | ---: |
| UI Bun (incluye Electron puro) | 116 pass |
| UI Vitest | 55 pass |
| Installer/backend Bun | 227 pass |
| Installer Vitest | 20 pass |
| `components/agent` Bun | 11 pass |
| Python | 6 pass |

Comprobaciones adicionales:

- `bun run typecheck:bun`: verde.
- `bunx tsc --noEmit -p components/ui/tsconfig.node.json`: verde.
- `bun run build:electron` en `components/ui`: bundle generado correctamente.
- `cargo test --manifest-path tools/agenos-shell-rust/Cargo.toml`: verde.
- `git diff --check`: verde.
- No se ejecutó ningún build de ISO, `quick-test` ni target `release*`.

## Pendiente, de forma explícita

- No hay envío outbound real genérico para email/WhatsApp (ni un dispatcher outbound común). Esas tools quedan deshabilitadas con error; no se simula aceptación.
- `local-simulated` no ejecuta tareas por decisión consciente: sin modelo/worker no existe una forma honesta de producir el trabajo solicitado. El foreground, memoria, herramientas locales, admin y diagnósticos siguen disponibles.
- El daemon Bun necesita que producción le inyecte un planner real. Mientras no exista, se anuncia no disponible; OpenClaw sigue siendo el backend seleccionado y funcional del producto.
- El reinicio se ha validado a nivel de comando, error y compilación Rust, pero no contra systemd/polkit dentro de una ISO/VM porque las reglas prohíben construir o arrancar una imagen en esta tarea. En una instalación sin helper o autorización devuelve error accionable.
- La prueba de conexión consume una petición mínima real del proveedor. Esto es deliberado: un simple readiness local no demuestra conectividad/auth upstream.
