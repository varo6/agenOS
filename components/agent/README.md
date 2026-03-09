# Agent skeleton

Estado: estructura solo documental.

## Responsabilidad prevista

- capturar audio o recibir control PTT desde la UI
- STT local-first
- resolver intenciones
- aplicar politicas de riesgo/confirmacion
- ejecutar tools auditables
- emitir eventos WebSocket y respuestas HTTP a la UI

## Siguiente estructura recomendada

```text
components/agent/
├── cmd/
├── internal/
│   ├── audio/
│   ├── intent/
│   ├── memory/
│   ├── policy/
│   ├── tools/
│   └── transport/
└── README.md
```

## Dependencias objetivo

- `whisper.cpp` o backend STT equivalente
- TTS local tipo Piper
- almacenamiento local para memoria/perfiles
- servidor HTTP/WebSocket local
