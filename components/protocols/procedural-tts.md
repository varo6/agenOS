# Narración procedural de Pi

Los endpoints de turnos de Pi y su puente IPC admiten el campo opcional
`progress.speechMessages`. No cambia la forma de solicitar ni cancelar turnos.

```ts
type PiSpeechMessage = {
  id: number;
  text: string;
  complete: boolean;
  afterTools: number;
};
```

- `id` crece dentro del turno y se mantiene durante los fragmentos de un mensaje.
- `text` contiene únicamente texto público del asistente. Los eventos de
  pensamiento y las llamadas, resultados y avisos de herramientas no lo alimentan.
- `complete` indica que el mensaje acabó. El estado de éxito del turno también
  permite vaciar el último fragmento pendiente.
- `afterTools` indica cuántas herramientas habían terminado al comenzar ese
  mensaje, comparable con `progress.completedTools.length`.

El harness conserva los últimos 32 mensajes, cada uno limitado a sus primeros
16.000 caracteres. Los snapshots copian los mensajes para que una actualización
posterior no modifique una respuesta ya entregada. El texto visual existente de
`streamedText` y `reply` mantiene su comportamiento; no se usa como fuente de la
narración cuando está presente el campo nuevo.

La UI narra solo el mensaje más reciente cuya cuenta de herramientas coincide
con la del turno actual. No reproduce retrospectivamente anuncios anteriores
si no pudo observarlos mientras eran actuales. Las frases ya en reproducción
pueden terminar; las pendientes se vuelven a comprobar antes de hablar.

La ausencia del campo permite compatibilidad con runtimes anteriores mediante
lectura final. Una lista vacía significa que no hay texto del asistente para
narrar, aunque `reply` contenga un resultado de herramienta. El historial
restaurado no se reproduce; en un turno todavía activo se omiten los mensajes
ya presentes y se pueden narrar los mensajes posteriores.

El transporte TTS conserva `speak(text)`, `stop()` y `status()`. El renderer
serializa fragmentos y no reintenta una síntesis fallida. No se envían objetos
de herramientas ni pensamiento al proveedor TTS remoto.
