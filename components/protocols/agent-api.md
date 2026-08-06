# Contrato UI <-> backend (broker Bun, `127.0.0.1:4173`)

Este documento describe el contrato **implementado** en `components/installer-ui/src/bun/server.ts`.
El transporte actual es HTTP REST + polling; no hay WebSocket. El diseño de eventos en streaming
se conserva al final como referencia futura.

Convenciones:

- Todo es local (`127.0.0.1:4173`); la UI llega por IPC de Electron con fallback HTTP.
- Los payloads del agente usan `schemaVersion: 1`, `correlationId` e ISO timestamps.
- Los endpoints worker-only exigen bearer token de `~/.agenos/broker/worker-token` (modo 0600).
- Errores: `400` validación, `403` denegado por política, `405` método, `409` pendiente de
  confirmación/estado incompatible, `500` efecto confirmado fallido, `501` tool sin ejecutor y
  `503` subsistema no disponible.
- Las señales de aprendizaje se pueden registrar sin confirmación, pero activar una memoria
  destilada usa `memory.write` con origen `system` y siempre crea una confirmación pendiente.

## Salud y diagnóstico

```http
GET  /health
GET  /api/diagnostics/support-bundle
```

## Pi (agente foreground)

```http
GET  /api/pi/status                              estado del harness y auth
POST /api/pi/auth/start                          inicia device login (Codex OAuth)
GET  /api/pi/auth/attempt/:attemptId             estado del intento
POST /api/pi/auth/attempt/:attemptId/manual-code entrega manual del código
POST /api/pi/auth/cancel
POST /api/pi/auth/logout
POST /api/pi/chat                                encola un turno de chat
GET  /api/pi/turns                               historial de turnos
GET  /api/pi/turns/latest                        turno activo (la UI hace polling)
GET  /api/pi/turns/:turnId
```

## Voz (STT local)

```http
GET  /api/speech/status      disponibilidad del motor local (binario + modelo)
POST /api/speech/transcribe  audio crudo en el body -> transcripción
```

`POST /api/speech/transcribe`:

- Body: bytes de audio; `Content-Type: audio/webm`, `audio/ogg` o `audio/wav`.
- Query opcional: `?lang=es` (por defecto `es`).
- Éxito: `200 { ok: true, text, durationMs, engine: "whisper.cpp", model }`
- Motor no disponible: `503 { ok: false, message }` — la UI degrada a Web Speech API o a la demo simulada.
- Audio vacío o formato no soportado: `400`.

## Agente (broker)

Tareas y confirmaciones:

```http
GET  /api/agent/tasks
POST /api/agent/tasks                               encola tarea en el worker
GET  /api/agent/tasks/:taskId
GET  /api/agent/tasks/:taskId/events
GET  /api/agent/confirmations
GET  /api/agent/confirmations/:confirmationId
POST /api/agent/confirmations/:confirmationId/confirm
POST /api/agent/confirmations/:confirmationId/deny
```

`POST /api/agent/tasks` solo devuelve `202` cuando un worker real ha aceptado la tarea. Si el
modo resuelto es `local-simulated`, devuelve `503 { ok:false, message }` y no crea una tarea
`queued`: el resto del broker sigue disponible, pero no se simula trabajo que nadie consumirá.

Confirmar es idempotente y ejecuta la acción persistida antes de responder. El `202` incluye
`{ ok:true, confirmation, execution, task? }`; si pertenecía a una tarea Bun en
`waiting_confirmation`, el broker reanuda su continuación persistida desde el paso siguiente.
Una segunda resolución devuelve `409` y no repite el efecto. Denegar finaliza una tarea en espera.
Las tools sin ejecutor no crean confirmaciones; si aparece un registro antiguo de una tool no
soportada, su confirmación devuelve `501` sin afirmar éxito.

Admin (solo UI local):

```http
GET  /api/agent/admin/status                        readiness, worker health, degraded reason
GET  /api/agent/admin/config
POST /api/agent/admin/config
GET  /api/agent/admin/policy                        reglas y defaults con IDs estables
POST /api/agent/admin/restart
POST /api/agent/admin/test-connection
POST /api/agent/admin/export-diagnostics
POST /api/agent/admin/tasks/:taskId/retry
POST /api/agent/admin/tasks/:taskId/clear
```

- `POST /admin/config`, `/admin/restart` y `/admin/tasks/:id/clear` devuelven primero `409` con
  `confirmationId`. Al confirmar, config escribe atómicamente el override de usuario con modo
  `0600` y recarga el adaptador del broker desde ese fichero, restart invoca la acción cerrada
  `agenos-shell-helper restart-agent`, y clear elimina realmente los registros de una tarea terminal.
- `retry` crea una tarea nueva con el mensaje/origen de la tarea terminal; si no puede hacerlo,
  responde `409 { ok:false }`.
- `test-connection` hace una completación mínima real contra el proveedor a través del gateway
  cuando el modo es `openclaw-process` (timeout de 15 s). En
  `agenos-bun-worker` o `local-simulated` devuelve `503` explicando que no existe una conexión
  remota comprobable.

Setup y canales (onboarding OpenClaw; los usa la tool `openclaw_setup` de Pi):

```http
GET  /api/agent/setup/status
POST /api/agent/setup/run
POST /api/agent/auth/codex/start
POST /api/agent/channels/telegram/configure
POST /api/agent/channels/telegram/test
POST /api/agent/channels/telegram/enable
```

Herramientas mediadas por política (`decidePolicy`):

```http
GET  /api/agent/memory/events
GET  /api/agent/memory/:namespace                    namespace: contacts | preferences | facts
POST /api/agent/memory/:namespace                    { content, source?, explicitUserIntent? }
GET  /api/agent/learning/signals                     señales redactadas y auditables
POST /api/agent/learning/signals/harness             ingesta local de una traza redactada de Pi
GET  /api/agent/learning/memories                    memorias confirmadas activas (`?includeDeleted=true` para historial)
POST /api/agent/learning/memories/:itemId             corrige una entrada por intención explícita del usuario
DELETE /api/agent/learning/memories/:itemId           olvida una entrada por intención explícita del usuario
GET  /api/agent/learning/context                      selección auditable (`query`, `tokenBudget`; máximo 512)
POST /api/agent/apps/open                            { app, workspace?, focus? }
POST /api/agent/browser/open-url                     { url }
POST /api/agent/shell/exec                           { command, cwd?, timeoutMs? }
GET  /api/agent/workspaces
POST /api/agent/workspaces/focus                     { workspace, source? }
POST /api/agent/worker/tool-call                     worker-only (bearer token)
GET  /api/agent/worker/health
```

Las memorias aprendidas son registros estructurados append-only con `kind` (`preference`,
`procedure`, `avoidance`), confianza, señales fuente, caducidad e ID visible. Corregir o borrar
no reescribe el historial. Las trazas del harness incluyen `harness.learningContext` con los IDs
y el presupuesto realmente inyectados; el texto de memoria no se copia a esa metadata.

## Sistema e instalador

```http
POST /api/system/maintenance          { "action": "terminal" } -> 202
GET  /api/network/status
POST /api/network/wifi/scan
GET  /api/network/wifi/access-points
POST /api/network/wifi/connect
POST /api/network/wifi/disconnect
POST /api/network/wifi/radio
GET  /api/installer/preflight
GET  /api/installer/disks
POST /api/installer/validate-profile
POST /api/installer/start-guided
POST /api/installer/start-classic
POST /api/installer/switch-mode
```

## Diseño futuro: eventos en streaming (no implementado)

El objetivo a medio plazo es sustituir el polling de `/api/pi/turns/latest` por SSE/WebSocket
con esta forma de eventos:

```text
stt.partial        { "text": "abre fo..." }
stt.final          { "text": "abre fotos", "lang": "es" }
agent.intent       { "intent": "open_app", "slots": { "app": "Fotos" }, "confidence": 0.82, "risk_level": "low" }
action.proposed    { "action_id": "a_123", "tool": "apps.open", "args": { "app_id": "org.gnome.Photos" }, "summary": "Abrir Fotos", "requires_confirmation": false }
action.executing   { "action_id": "a_123", "progress": 0.3 }
action.done        { "action_id": "a_123", "result": { "ok": true } }
action.error       { "action_id": "a_123", "error": { "code": "APP_NOT_FOUND" } }
```
