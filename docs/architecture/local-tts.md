# TTS local con espeak-ng

AgenOS lee las respuestas de Pi sin levantar un servicio extra. El proceso
principal de Electron invoca `espeak-ng`, instalado por la imagen, y escribe el
texto por `stdin`.

## Piezas

- `components/tts/`: resolucion de binario, ajustes y ciclo de lectura.
- `agenosTts` en preload: puente IPC tipado para `speak`, `stop` y `status`.
- `useTtsReplies`: observa turnos completados y habla cada respuesta nueva una
  sola vez. El historial restaurado al arrancar se marca como visto para no leer
  conversaciones antiguas.

## Configuracion

| variable | por defecto | que mueve |
|---|---|---|
| `AGENOS_TTS_BIN` | autodeteccion de `espeak-ng` | binario a ejecutar |
| `AGENOS_TTS_VOICE` | `es` | voz/idioma de espeak-ng |
| `AGENOS_TTS_RATE` | `165` | palabras por minuto |
| `AGENOS_TTS_PITCH` | `45` | tono |
| `AGENOS_TTS_AMPLITUDE` | `140` | volumen de espeak-ng |
| `AGENOS_TTS_MAX_CHARS` | `4000` | recorte maximo de una respuesta |

## Por que asi

La ruta evita Python, servidores residentes y descargas de modelos. La calidad
no es neural, pero el fallo es facil de diagnosticar: si falta el binario,
`status()` devuelve `unavailable`; si una nueva respuesta llega, la lectura en
curso se cancela antes de empezar la siguiente.
