# STT local con Voxtype y Whisper

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
                                          Voxtype worker  ◄── ruta HTTP
                                          (proceso aislado)     /api/speech/*
                                                │
                                                ▼
                                      small Q5_1 multilingüe
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

- **Voxtype**. AgenOS compila la versión fijada en `scripts/build-ui.sh` y usa
  su comando interno `transcribe-worker`. El proceso carga el modelo durante la
  grabación, recibe PCM por stdin, devuelve JSON y termina. No se usa el daemon
  de hotkeys ni la inyección de texto de Voxtype. Electron conserva el control
  del micrófono y recibe la transcripción por IPC.

- **`whisper-server`** de whisper.cpp queda empaquetado como fallback. Ya no
  arranca con el sistema. `AGENOS_STT_ENGINE=whisper.cpp` lo activa y el runtime
  lo levanta cuando hace falta.

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
error. También termina el worker precargado de Voxtype. El micrófono y la RAM
del modelo quedan libres de inmediato.

## Un solo motor para las dos rutas

Electron y `/api/speech/transcribe` construyen su runtime con
`createSttRuntime()` y usan el mismo adaptador de Voxtype. La única diferencia
es lo que hace falta antes:
el navegador graba webm/ogg, así que la ruta HTTP pasa por `ffmpeg` para dejarlo
en 16 kHz mono.

El fallback `whisper.cpp` conserva su VAD por petición. Sus parámetros no van en
la línea de comandos porque en v1.7.6 el flag de silencio escribe por error
sobre la duración mínima de voz.

### Lo que sigue siendo distinto

El corte por silencio de 650 ms lo hace el binario de captura, que solo existe
en la ruta de Electron. Un navegador no tiene forma de correr Silero sin
arrastrar onnxruntime-web, así que la ruta HTTP graba hasta que la persona pare
o hasta el tope de 15 s que publica `/api/speech/status`. El motor, el modelo y
la normalización del resultado sí son los mismos.

## Configuración objetivo de Voxtype

| ajuste | valor | por qué |
|---|---|---|
| motor | `voxtype` | usa Whisper mediante `whisper-rs` y libera el proceso tras cada frase |
| modelo | `small` Q5_1 multilingüe | mejora el español frente a `base` sin llegar al tamaño de `medium` |
| idioma | `es` | evita que una orden corta se detecte como inglés |
| prompt | vocabulario de AgenOS | ayuda con Pi, ChatGPT, Chromium y controles del portátil |
| hilos | 4 | coincide con los cuatro núcleos del Intel N100 de referencia |
| transporte | worker por stdin/stdout | no simula teclado y devuelve JSON a Electron |

## Variables de entorno

Ninguna hace falta para que funcione; están para mover la configuración sin
recompilar.

| variable | por defecto | qué mueve |
|---|---|---|
| `AGENOS_STT_ENGINE` | `voxtype` | `voxtype` o fallback `whisper.cpp` |
| `AGENOS_WHISPER_DIR` | `/opt/agenos/system/whisper.cpp` | raíz de binarios y modelos |
| `AGENOS_VOXTYPE_BIN` | el declarado en el paquete | binario de Voxtype |
| `AGENOS_WHISPER_MODEL` | el declarado en `stt.env` | modelo de Whisper |
| `AGENOS_STT_VAD_MODEL` | el declarado en `stt.env` | modelo de Silero |
| `AGENOS_STT_LANGUAGE` | `es` | idioma (`auto` cae en `es`) |
| `AGENOS_STT_INITIAL_PROMPT` | vocabulario de AgenOS | nombres propios que Whisper debe reconocer |
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

`scripts/build-ui.sh` compila Voxtype desde su tag fijado dentro del contenedor
Debian Bookworm. También compila whisper.cpp dos veces con los targets de
diagnóstico, fallback y captura VAD. Descarga `small-q5_1` y Silero verificando
su SHA1. Los modelos viajan en la ISO, así que el STT funciona sin Internet.

El build instala `LICENSE.voxtype` junto al binario. Voxtype se distribuye bajo
[licencia MIT](https://github.com/peteonrails/voxtype/blob/dev/LICENSE).

El manifiesto `stt.env` que queda junto a los binarios lleva el nombre exacto de
los modelos instalados, y **el runtime lo lee en vez de llevar su propia lista**.
Así no puede repetirse el fallo de que el build empaquete un modelo y el runtime
siga buscando otro.

La caché se invalida por huella. Mezcla las versiones de whisper.cpp y Voxtype,
el perfil de compilación, los modelos con sus SHA1 y el fuente del capturador.

## Números medidos (Intel N100, 4 núcleos, `powersave`)

| medida | valor |
|---|---|
| frase de 3,2 s: fin de la voz → cierre de la captura | ~650 ms |
| inferencia anterior con `base` Q5_1, beam 5, contexto completo | ~3,0 s |
| servidor anterior residente después de transcribir | ~300 MB RSS |
| modelo anterior en disco | 57 MiB (Whisper) + 0,85 MiB (Silero) |
| modelo nuevo `small` Q5_1 en disco | 181 MiB |

Falta medir en el N100 la latencia y el pico RSS del worker nuevo. En reposo no
queda cargado. Esa medición debe formar parte de la prueba de la próxima ISO.
