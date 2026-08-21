# STT local con whisper.cpp

AgenOS transcribe voz sin salir del equipo. Este documento describe cómo, por
qué está partido así y qué se puede mover sin recompilar.

## El problema que resuelve

La versión anterior grababa cuatro segundos fijos con `arecord`, arrancaba
`whisper-cli` para cada frase y no tenía detección de voz. Eso daba cuatro
síntomas concretos:

- una frase de seis segundos se cortaba por la mitad, y una de dos se pagaba
  como si durase cuatro;
- cada orden pagaba la carga del modelo desde cero;
- sobre silencio o ruido de sala, Whisper devolvía frases inventadas, que Pi
  ejecutaba como si fueran órdenes;
- cancelar desde la interfaz solo dejaba de escuchar la respuesta: `arecord`
  seguía con el micrófono abierto hasta agotar sus segundos;
- la ruta web y la de Electron le pedían cosas distintas al mismo Whisper.

## Piezas

```
   micrófono
      │  PCM S16LE 16 kHz mono
      ▼
  arecord ──pipe──► agenos-vad-capture ──► utterance.wav (recortado a la voz)
                     (Silero VAD, ggml)          │
                     eventos NDJSON              │ multipart
                     listening / speech / done   ▼
                                          whisper-server  ◄── ruta HTTP
                                          (modelo residente)    /api/speech/*
```

- **`tools/whisper-vad-capture/vad-capture.cpp`** → `agenos-vad-capture`.
  Binario propio, compilado dentro del árbol de whisper.cpp para enlazar contra
  la misma `libwhisper` y con el mismo perfil de instrucciones que el resto.
  Lee PCM crudo por stdin y decide en tiempo real cuándo ha terminado la frase.
  Existe porque la API de VAD de whisper.cpp trabaja sobre un buffer completo:
  no hay forma de alimentarla muestra a muestra desde TypeScript sin recargar el
  modelo en cada vuelta.

- **`components/stt/`**. Todo lo que antes vivía duplicado entre el proceso
  principal de Electron y el servidor HTTP: resolución de rutas, ajustes,
  cliente del motor y orquestación de la captura.

- **`whisper-server`** de whisper.cpp, arrancado por
  `scripts/agenos-whisper-server` bajo `agenos-whisper.service`. Carga el modelo
  una vez y escucha solo en `127.0.0.1`.

## Cómo termina una frase

`agenos-vad-capture` acumula el audio y cada 128 ms pasa Silero por la cola del
buffer (los últimos 4 s, alineados a ventanas de 512 muestras). De cada ventana
nueva se queda con la probabilidad de voz y actualiza tres cosas: primera
ventana con voz, última, y cuántas van. A partir de ahí:

| condición | resultado |
|---|---|
| voz acumulada ≥ 250 ms | emite `{"event":"speech"}` y la interfaz confirma que escucha |
| 650 ms sin voz después de haber habido voz | cierra con `reason: "silence"` |
| 15 s de audio | cierra con `reason: "max-duration"` |
| 8 s sin oír voz nunca | cierra con `reason: "no-speech"`, sin escribir WAV |

Una pausa por debajo de 650 ms no cierra nada: el contador de silencio se
reinicia con la primera ventana con voz que vuelve a pasar el umbral.

El WAV que sale va recortado a `[primera voz − 320 ms, última voz + 320 ms]`.
Si no hubo voz, el binario sale con código 4 y no escribe nada, así que no hay
audio que mandarle a Whisper y no puede inventarse una frase.

## Cancelar

`agenos-vad-capture` y `arecord` son hijos del proceso principal, encadenados
por una tubería. `SPEECH_IPC_CHANNELS.cancel` llega a
`LocalSpeechService.cancel()`, que manda `SIGKILL` a los dos y marca la captura
como cancelada. La promesa en curso resuelve con `{ ok: false, code:
"cancelled" }`, que el renderer trata como final normal: ni transcribe ni pinta
error. El micrófono queda libre y se puede empezar otra captura de inmediato.

## Un solo motor para las dos rutas

Electron y `/api/speech/transcribe` construyen su runtime con
`createSttRuntime()` y hablan con el mismo `whisper-server`, mandando los mismos
campos en cada `POST /inference`. La única diferencia es lo que hace falta antes:
el navegador graba webm/ogg, así que la ruta HTTP pasa por `ffmpeg` para dejarlo
en 16 kHz mono.

`whisper-server` corre con `--vad`, de modo que también la ruta HTTP filtra
silencio y ruido antes de la inferencia: sobre silencio devuelve texto vacío, y
el servicio lo traduce a `422 no-speech` en vez de a una frase inventada.

Los parámetros del VAD viajan en el multipart y no en la línea de comandos: en
whisper.cpp v1.7.6, `--vad-min-silence-duration-ms` escribe por error sobre
`vad_min_speech_duration_ms`. Por petición el mapeo sí es correcto.

### Lo que sigue siendo distinto

El corte por silencio de 650 ms lo hace el binario de captura, que solo existe
en la ruta de Electron. Un navegador no tiene forma de correr Silero sin
arrastrar onnxruntime-web, así que la ruta HTTP graba hasta que la persona pare
o hasta el tope de 15 s que publica `/api/speech/status`. El resto —motor,
modelo, flags, filtrado de silencio, semántica de cancelar— es idéntico.

## Configuración objetivo

| flag | valor | por qué |
|---|---|---|
| `-l` | `es` | AgenOS es un sistema en español y `auto` se equivoca en frases cortas |
| `-t` | 4 | los cuatro núcleos del equipo de referencia |
| `-bs` / `-bo` | 5 / 5 | calidad por delante de latencia |
| `-sns` | sí | suprime los tokens que Whisper reserva para lo que no es habla |
| `-ac` | no | ventana completa de 30 s |
| `-nt` | no | los segmentos llegan con marcas de tiempo y se normalizan en `normalizeWhisperTranscript` |

## Variables de entorno

Ninguna hace falta para que funcione; están para mover la configuración sin
recompilar.

| variable | por defecto | qué mueve |
|---|---|---|
| `AGENOS_WHISPER_DIR` | `/opt/agenos/system/whisper.cpp` | raíz de binarios y modelos |
| `AGENOS_WHISPER_MODEL` | el declarado en `stt.env` | modelo de Whisper |
| `AGENOS_STT_VAD_MODEL` | el declarado en `stt.env` | modelo de Silero |
| `AGENOS_STT_LANGUAGE` | `es` | idioma (`auto` cae en `es`) |
| `AGENOS_STT_THREADS` | `4` | hilos |
| `AGENOS_STT_BEAM_SIZE` | `5` | beam search |
| `AGENOS_STT_BEST_OF` | `5` | candidatos |
| `AGENOS_STT_ALSA_DEVICE` | `default` | dispositivo de captura |
| `AGENOS_STT_MAX_SECONDS` | `15` | tope duro de captura |
| `AGENOS_STT_SILENCE_MS` | `650` | silencio que cierra la frase |
| `AGENOS_STT_MIN_SPEECH_MS` | `250` | voz mínima para aceptar |
| `AGENOS_STT_SPEECH_PAD_MS` | `320` | margen al recortar |
| `AGENOS_STT_VAD_THRESHOLD` | `0.5` | umbral de Silero |
| `AGENOS_STT_START_TIMEOUT_MS` | `8000` | espera máxima sin oír voz |
| `AGENOS_STT_AUDIO_CTX` | `0` (completo) | contexto del encoder |
| `AGENOS_STT_SERVER_HOST` / `_PORT` | `127.0.0.1` / `8178` | dónde escucha el motor |
| `AGENOS_STT_SERVER_URL` | — | apuntar a otro motor ya levantado |
| `AGENOS_STT_SERVER_AUTOSTART` | `1` | dejar que el runtime levante el motor |
| `AGENOS_STT_FORCE_BASELINE` | `0` | forzar los binarios sin AVX2 |
| `AGENOS_STT_RECORDER_BIN` | `arecord` del sistema | grabador |
| `AGENOS_WHISPER_SERVER_BIN`, `AGENOS_STT_VAD_CAPTURE_BIN`, `AGENOS_FFMPEG_BIN` | autodetección | binarios sueltos |

## Build y caché

`scripts/build-ui.sh` compila whisper.cpp dos veces (SIMD y baseline) con los
targets `whisper-cli`, `whisper-server` y `agenos-vad-capture`, y descarga los
dos modelos verificando su SHA1. Los modelos viajan en la ISO: el STT funciona
sin Internet una vez instalado.

El manifiesto `stt.env` que queda junto a los binarios lleva el nombre exacto de
los modelos instalados, y **el runtime lo lee en vez de llevar su propia lista**.
Así no puede repetirse el fallo de que el build empaquete `ggml-base-q5_1.bin` y
el runtime siga buscando `ggml-small.bin`.

La caché se invalida por huella: `whisper_fingerprint()` mezcla la versión de
whisper.cpp, el perfil de compilación, los dos nombres de modelo con sus SHA1 y
el hash del fuente de `agenos-vad-capture`. Si cualquiera cambia, se reconstruye.

## Números medidos (Intel N100, 4 núcleos, `powersave`)

| medida | valor |
|---|---|
| frase de 3,2 s: fin de la voz → cierre de la captura | ~650 ms |
| inferencia con `base` Q5_1, beam 5, contexto completo | ~3,0 s |
| whisper-server residente en reposo tras transcribir | ~300 MB RSS |
| modelo en disco | 57 MiB (Whisper) + 0,85 MiB (Silero) |

Con `AGENOS_STT_AUDIO_CTX=512` la inferencia baja a ~1,0 s a costa de precisión.
Se deja fuera del valor por defecto a propósito: el objetivo es que entienda bien
el español, no que baje del segundo.
