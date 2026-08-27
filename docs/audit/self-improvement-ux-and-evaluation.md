# Self-improvement visible y evaluable

Fecha: 2026-08-25

## Diagnóstico

agenOS tiene dos ciclos distintos que la memoria debe separar con cuidado.

El Self-Harness de desarrollo modifica el harness de Pi. Parte de escenarios, agrupa fallos,
propone ediciones y solo conserva una edición si no introduce regresiones en `held-in` ni en
`held-out`. La persona que desarrolla aplica el cambio. Este ciclo actúa sobre `h_t`.

La memoria aprendida funciona durante el uso. Captura señales, destila una frase estructurada,
pide permiso, activa una entrada y la recupera dentro de un presupuesto. El usuario puede
corregirla u olvidarla. Este ciclo modifica `Q(M, u_t)`, no el harness ni la política.

Llamar self-improvement a ambos sin distinguir el objeto que cambia hace que el argumento técnico
parezca más autónomo de lo que es. La distinción mejora también la seguridad: ni una preferencia
confirmada ni una métrica de éxito pueden reescribir reglas de política.

Antes de este cambio, el segundo ciclo existía en el broker pero casi no existía para el usuario.
Las propuestas aparecían mezcladas con confirmaciones administrativas, las memorias activas solo se
podían consultar por API o por conversación y no había una medida persistente de uso. El sistema
podía demostrar selección de contexto, pero no ofrecer control directo ni construir un embudo de
evaluación.

## Cambio implementado

La pantalla `Sistema` incluye ahora `Lo que Pi aprende`, fuera del desplegable técnico. Muestra:

- propuestas pendientes con frase exacta, tipo y número de señales fuente;
- botones explícitos `Recordar` y `Descartar`;
- memorias activas, fecha de caducidad y número de usos;
- corrección inline y borrado por ID;
- totales de memorias activas, turnos con memoria y propuestas pendientes.

El broker registra `learning_context_used` al cerrar un turno cuyo contexto contiene IDs de memoria.
`GET /api/agent/learning/overview` agrega señales, decisiones de confirmación y uso por entrada. El
registro conserva IDs y marcas de tiempo, no duplica el texto de la memoria en la traza.

La semántica sigue siendo conservadora. Capturar y contar no cambia conducta. Una propuesta solo se
activa mediante la confirmación existente de `memory.write`; corregir y olvidar exigen intención
explícita de la UI y pasan por política.

## Qué se puede afirmar

Con estos datos sí se puede medir:

- tasa de aceptación: aceptadas entre propuestas decididas;
- tasa de corrección y olvido sobre memorias activadas;
- cobertura de recuperación: turnos con memoria entre turnos observados;
- frecuencia y recencia de uso por `itemId`;
- precisión de infraestructura: el ID esperado fue seleccionado dentro del presupuesto;
- seguridad: una propuesta pendiente o denegada nunca aparece en el contexto.

`learning_context_used` significa que el broker inyectó una entrada en el turno. No demuestra que el
modelo la obedeciera ni que la respuesta fuera mejor. Esa diferencia debe aparecer de forma literal
en la evaluación.

## Experimento que falta

La prueba técnica más limpia es pareada. Cada tarea se ejecuta con el mismo modelo, temperatura,
prompt y estado inicial en dos condiciones: memoria desactivada y memoria confirmada. El verificador
debe observar el resultado, no la explicación del modelo.

Un conjunto pequeño pero defendible tendría al menos cuatro familias:

1. Preferencia relevante. Por ejemplo, producir exactamente tres viñetas.
2. Procedimiento relevante. Elegir una herramienta de contrato o comprobar un resultado antes de
   repetir.
3. Memoria irrelevante. No debe inyectarse ni alterar la respuesta.
4. Conflicto. La petición actual debe ganar a una preferencia antigua y la política debe ganar a
   ambas.

Por condición conviene guardar `itemIds`, tokens de contexto, latencia, éxito del verificador,
repeticiones de herramienta y necesidad de aclaración. Con pocas tareas no procede vender
significancia estadística. Es mejor publicar todos los resultados pareados y un intervalo de
confianza bootstrap, además de señalar el tamaño de muestra.

Las métricas primarias deberían ser éxito de tarea y ausencia de regresión de seguridad. La tasa de
aceptación es una métrica de producto, no de calidad del modelo. La cobertura de recuperación es una
métrica del selector, no de eficacia. Separarlas evita transformar actividad del sistema en una
afirmación de mejora.

## Cambios recomendados dentro de `tfg/`

No se han aplicado, por petición del autor.

- Capítulo 3. Añadir una subsección que formalice los dos ciclos. El de desarrollo produce
  `h_{t+1}`; el de uso produce `M_{t+1}` tras confirmación. Incluir sus distintas reglas de
  aceptación y amenazas.
- Capítulo 6. Añadir el panel visible de aprendizaje al recorrido de experiencia. La aportación de UX
  no es que el agente recuerde, sino que el usuario puede anticipar, inspeccionar y revertir ese
  recuerdo.
- Capítulo 7. Sustituir la descripción única de Markdown por la arquitectura real: memoria histórica
  legible y almacén aprendido estructurado append-only, con caducidad, revisiones e IDs. Explicar
  `learning_context_used` y el endpoint agregado.
- Capítulo 8. Conservar el resultado negativo del ensayo real. La selección correcta de un ID prueba
  infraestructura, no mejora conductual. Añadir el experimento pareado anterior cuando el adaptador
  vuelva a extraer la respuesta final.
- Capítulo 10. Rebajar cualquier frase que diga que el Self-Harness está "completo" mientras
  `proposals.ts` solo genere notas por código de fallo y no implemente la búsqueda de `K` candidatas,
  aplicación, reevaluación y promoción narradas en el algoritmo.

Antes de cerrar la memoria también hay que reconciliar los números y capacidades ya anotados en
`tfg/analisis-contenido-pendiente.md`: la suite versionada no tiene la división 9/5 descrita, el
resultado de memoria no mostró mejora de conducta, y las afirmaciones sobre TTS, broker y ejecución
en imagen real deben corresponder a artefactos reproducibles.
