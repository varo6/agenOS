# Voz en la nube (opcional)

Por defecto AgenOS dicta y habla sin salir del equipo: Voxtype para el dictado y
espeak-ng para la voz. Nada de esto cambia. Lo que se añade es un interruptor
por servicio para delegarlos en internet y recuperar la CPU del portátil, que en
un N100 es justo lo que se lleva la inferencia de Whisper.

Los dos interruptores son independientes y están en Ajustes → Más ajustes → Voz
en la nube. El idioma sigue siendo castellano fijo en las dos direcciones.

## Qué proveedor y por qué

| | Proveedor | Modelo / voz | Coste |
|---|---|---|---|
| Dictado | Groq | `whisper-large-v3-turbo` | 0,04 $/hora de audio. Gratis hasta 8 h de audio al día |
| Voz | Azure AI Speech | `es-ES-ElviraNeural` y otras | 0,5 M caracteres al mes gratis, recurrente |

Groq es el mismo Whisper large v3 que corre en local, a 216x tiempo real y con
un tramo gratuito recurrente de verdad. Se puede cambiar a `whisper-large-v3`
desde el panel si alguien nota errores: acierta algo más y cuesta 2,8 veces más.

**Groq no sirve para la voz.** Sus modelos de TTS (`playai-tts`, retirado en
diciembre de 2025, y los Orpheus que lo sustituyen) solo hablan inglés y árabe.
Por eso el TTS remoto va a Azure, que es el único proveedor grande con voces
castellanas nativas, medio millón de caracteres gratis al mes de forma
recurrente y salida WAV directa. Esa salida WAV importa: se reproduce con
`aplay`, que ya está en la imagen por el micrófono, y evita arrastrar un
descodificador de mp3.

## Cómo encaja

El interruptor vive en `components/remote`. Guarda dos ficheros con permisos
0600 dentro de `~/.agenos/remote/`:

- `services.json`: qué está encendido, el modelo de Groq, la voz y la región.
- `secrets.env`: las claves de API. Nunca salen del proceso principal; la
  interfaz solo llega a saber si están puestas.

`createSttRuntime` y `createTtsService` reciben ese almacén y devuelven un objeto
cuya identidad no cambia nunca, así que Electron se lo guarda al arrancar y sigue
llamándolo igual. En cada petición miran el interruptor y despachan al motor que
toque. Al encender la nube se cierra el motor local en ese mismo momento, no en
la siguiente transcripción: si alguien lo enciende para aligerar el equipo,
Voxtype tiene que morir ya.

Un interruptor encendido sin su clave **no** activa el servicio. Se sigue usando
el motor local y el panel lo dice, porque lo contrario sería quedarse sin voz.

La ruta HTTP (`/api/speech/transcribe`) lee el mismo almacén, así que encender el
dictado en la nube cambia las dos rutas y no solo la de Electron.

## Variables de entorno

Solo son la válvula de escape para fijar el modo desde la imagen o un
despliegue. Ganan al fichero, pero no lo reescriben: al quitarlas vuelve la
elección del usuario tal y como estaba.

| Variable | Efecto |
|---|---|
| `AGENOS_STT_REMOTE` | Enciende el dictado en la nube |
| `AGENOS_STT_REMOTE_MODEL` | `whisper-large-v3-turbo` o `whisper-large-v3` |
| `AGENOS_STT_REMOTE_BASE_URL` | Endpoint de Groq |
| `AGENOS_STT_REMOTE_TIMEOUT_MS` | Espera máxima, 1.000–120.000 |
| `AGENOS_TTS_REMOTE` | Enciende la voz en la nube |
| `AGENOS_TTS_REMOTE_REGION` | Región del recurso de Azure |
| `AGENOS_TTS_REMOTE_VOICE` | Voz `es-ES-*` |
| `AGENOS_TTS_REMOTE_FORMAT` | Formato de salida, WAV por defecto |
| `AGENOS_TTS_REMOTE_TIMEOUT_MS` | Espera máxima, 1.000–120.000 |
| `AGENOS_GROQ_API_KEY` | Clave de Groq, gana a `secrets.env` |
| `AGENOS_AZURE_SPEECH_KEY` | Clave de Azure, gana a `secrets.env` |
| `AGENOS_REMOTE_STATE_DIR` | Dónde viven los dos ficheros |
| `AGENOS_TTS_PLAYER_BIN` | Reproductor del WAV, `aplay` por defecto |

## Límites conocidos

- Groq no tiene STT por streaming, solo por fichero. Vale para pulsar y hablar,
  que es como funciona AgenOS, pero no serviría para micrófono siempre abierto.
- Groq factura un mínimo de 10 s por petición. Una orden de dos segundos cuenta
  como diez; a 0,04 $/hora sigue siendo ruido, pero conviene saberlo.
- El tramo gratuito de Azure son 0,5 M caracteres al mes. Un uso intenso lo pasa;
  Google Cloud TTS da 4 M gratis y sería el siguiente sitio donde mirar, a costa
  de OAuth con service-account y audio en base64 dentro de un JSON.
