# Contrato UI <-> backend (broker Bun, `127.0.0.1:4173`)

Este documento describe el contrato **implementado** en `components/installer-ui/src/bun/server.ts`.
El transporte actual es HTTP REST + polling; no hay WebSocket. El diseño de eventos en streaming
se conserva al final como referencia futura.

Convenciones:

- Todo es local (`127.0.0.1:4173`); la UI llega por IPC de Electron con fallback HTTP.
- Los payloads del agente usan `schemaVersion: 1`, `correlationId` e ISO timestamps.
- Los endpoints worker-only exigen bearer token de `~/.agenos/broker/worker-token` (modo 0600).
- Errores: `400` validación, `403` denegado por política, `405` método, `409` pendiente de
  confirmación, `503` subsistema no disponible.

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
POST /api/agent/apps/open                            { app, workspace?, focus? }
POST /api/agent/browser/open-url                     { url }
POST /api/agent/shell/exec                           { command, cwd?, timeoutMs? }
GET  /api/agent/workspaces
POST /api/agent/workspaces/focus                     { workspace, source? }
POST /api/agent/worker/tool-call                     worker-only (bearer token)
GET  /api/agent/worker/health
```

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
