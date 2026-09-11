# TTS local con espeak-ng

AgenOS lee las respuestas de Pi sin levantar un servicio extra. El proceso
principal de Electron invoca `espeak-ng`, instalado por la imagen, y escribe el
texto por `stdin`.

## Piezas

- `components/tts/`: resolucion de binario, ajustes y ciclo de lectura.
- `agenosTts` en preload: puente IPC tipado para `speak`, `stop` y `status`.
- `useTtsReplies` y `tts-narrator`: leen las frases nuevas del asistente durante
  la ejecución. El historial restaurado no se reproduce.
- `speech-text`: separa frases completas, limpia Markdown y omite bloques de
  código, tablas y direcciones web. Conserva el texto de los enlaces y los
  nombres de archivos escritos como código en línea.

## Narración durante la ejecución

El harness publica mensajes de voz separados en `progress.speechMessages`.
Cada uno tiene un ID, texto acumulado, indicador de cierre y el número de
herramientas terminadas al comenzar. Solo admite texto del asistente: ni el
pensamiento, ni argumentos, ni resultados o avisos de las herramientas.
El [contrato de narración](../../components/protocols/procedural-tts.md)
describe los campos y su compatibilidad.

La UI espera a una frase completa para sintetizarla. Al cerrar el mensaje lee
también el fragmento final sin puntuación. Una cola serializa las llamadas a
`speak`, tanto con espeak-ng como con Azure, para que una frase no cancele a la
anterior. La lectura en marcha puede terminar; de la cola se eliminan los
mensajes superados por nuevas herramientas terminadas o por otro mensaje del
asistente. Así, si el archivo ya está abierto al recibir la actualización, no
se empieza a leer el anuncio pendiente de que se iba a buscar.

Los offsets se guardan por turno y mensaje: el cierre del turno no vuelve a leer
lo que ya se narró. Si falta el campo nuevo, se mantiene la lectura de la
respuesta final de los runtimes anteriores. Si el campo existe pero está vacío,
no se utiliza como sustituto el resultado técnico de una herramienta.

«Parar voz» silencia el resto de ese turno, incluida su cola. Una nueva petición
puede volver a hablar. Cancelar el turno, vaciar la conversación o desmontar la
UI detiene la lectura. Inicio también para la narración al abrir el micrófono
o enviar otra petición. Un fallo del motor silencia ese turno sin reintentar
automáticamente. El texto permanece disponible en pantalla.

Con puente TTS disponible, el seguimiento del turno consulta cada 400 ms con
la ventana visible y cada 750 ms oculta, después de terminar la consulta anterior.
Sin puente conserva la cadencia anterior. Son intervalos de consulta, no una
garantía de latencia de audio: la síntesis, especialmente remota, añade espera.
El agente no espera a que termine la voz para ejecutar herramientas.

## Configuracion

| variable | por defecto | que mueve |
|---|---|---|
| `AGENOS_TTS_BIN` | autodeteccion de `espeak-ng` | binario a ejecutar |
| `AGENOS_TTS_VOICE` | `es` | voz/idioma de espeak-ng |
| `AGENOS_TTS_RATE` | `165` | palabras por minuto |
| `AGENOS_TTS_PITCH` | `45` | tono |
| `AGENOS_TTS_AMPLITUDE` | `140` | volumen de espeak-ng |
| `AGENOS_TTS_MAX_CHARS` | `4000` | recorte máximo por llamada de síntesis |

## Por que asi

La ruta evita Python, servidores residentes y descargas de modelos. La calidad
no es neural, pero el fallo es facil de diagnosticar: si falta el binario,
`status()` devuelve `unavailable`; si una nueva respuesta llega, la lectura en
curso se cancela antes de empezar la siguiente.
