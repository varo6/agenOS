# Contrato inicial UI <-> agente

## WebSocket: agente a UI

```text
stt.partial        { "text": "abre fo..." }
stt.final          { "text": "abre fotos", "lang": "es" }
agent.intent       { "intent": "open_app", "slots": { "app": "Fotos" }, "confidence": 0.82, "risk_level": "low" }
action.proposed    { "action_id": "a_123", "tool": "apps.open", "args": { "app_id": "org.gnome.Photos" }, "summary": "Abrir Fotos", "requires_confirmation": false }
action.executing   { "action_id": "a_123", "progress": 0.3 }
action.done        { "action_id": "a_123", "result": { "ok": true } }
action.error       { "action_id": "a_123", "error": { "code": "APP_NOT_FOUND" } }
```

## HTTP: UI a agente

```http
POST /v1/ptt/start
POST /v1/ptt/stop
POST /v1/actions/confirm
POST /v1/actions/cancel
POST /v1/help
```

## Schema de tool calling

```json
{
  "tool": "apps.open",
  "args": {
    "app_id": "org.gnome.Photos"
  },
  "risk_level": "low",
  "requires_confirmation": false,
  "side_effects": "Abrira la aplicacion solicitada"
}
```
