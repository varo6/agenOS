# WS5 — Bucle de auto-mejora de Pi

Fecha: 2026-08-13

Rama: `ws5-selfimprove`

## Resultado

Se ha implementado un bucle real y conservador de señal → propuesta → confirmación → memoria
activa → recuperación. Pi ya puede reutilizar preferencias y lecciones entre sesiones, pero nunca
activa conocimiento destilado automáticamente sin pasar por la política del broker.

No se ha demostrado todavía una mejora conductual end-to-end con el modelo real. El eval comparativo
quedó en `0/1` tanto sin memoria como con memoria porque el harness recibió la llamada del modelo pero
no extrajo un mensaje final (`No se recibio respuesta del agente`). Sí quedó demostrada la parte de
infraestructura: la variante learned seleccionó el ID correcto y registró `82/256` tokens, mientras
que baseline registró cero IDs y cero tokens. Este resultado no se presenta como mejora del agente.

## Arquitectura elegida

El broker sigue siendo la única autoridad. La implementación se divide así:

- `learned-memory.ts`: almacén estructurado append-only de señales y memoria confirmada.
- `self-improvement.ts`: captura y destilación determinista; genera propuestas, no escrituras activas.
- `tool-runner.ts` + política: toda propuesta automática usa `memory.write` con origen `system`.
- `pi-harness.ts`: pide al broker contexto relevante antes de cada turno, lo añade al system prompt y
  registra IDs/presupuesto realmente usados en la traza.
- adaptadores worker: OpenClaw recibe el mismo contexto seleccionado por el broker como mensaje
  `system`; el worker Bun lo recibe como contexto marcado como datos no ejecutables.
- `learning_memory`: herramienta de Pi para listar, corregir y olvidar memorias mediante IDs visibles.

La memoria canónica vive en `~/.agenos/memory/learned/`:

- `signals.ndjson`: señales redactadas y deduplicadas.
- `items.ndjson`: historial de altas, correcciones y borrados. Nunca se reescribe una entrada previa.

Cada memoria incluye `schemaVersion`, `itemId`, namespace (`preferences` o `facts`), tipo
(`preference`, `procedure` o `avoidance`), confianza, IDs de señales fuente, timestamps, caducidad,
origen, confirmación y marca de edición del usuario.

Se eligió un registro estructurado separado de los Markdown históricos porque corregir o borrar una
línea añadida a un Markdown no es trazable ni fiable. Sigue siendo memoria del broker y comparte la
misma frontera y política, pero conserva revisiones auditables.

## Señales capturadas

- Turnos foreground correctos y fallidos.
- Herramientas foreground correctas y con error.
- Correcciones o preferencias explícitas en el texto del usuario.
- Tareas de background fallidas cuando su estado es observado.
- Solicitudes de reintento.
- Confirmaciones denegadas.

Los éxitos se guardan sin copiar el prompt. Solo una corrección durable conserva una vista previa del
input, ya redactada. Tokens, claves y secretos siguen el redactor del harness. Los IDs estables evitan
duplicar señales cuando se consulta varias veces el mismo estado.

Limitación conocida: no existe todavía una suscripción continua a eventos del worker. Una tarea
asíncrona fallida se captura cuando Pi o la API consultan su estado, no necesariamente en el instante
exacto del fallo.

## Destilación

La destilación es determinista; no se entrega el almacén a un LLM para que invente reglas:

- Una corrección solo propone preferencia si contiene una señal durable como `prefiero`, `siempre`,
  `nunca`, `recuerda que` o `a partir de ahora`.
- `no, así no` se registra como señal, pero no produce conocimiento si no aporta una regla reusable.
- Dos o más fallos de la misma herramienta proponen una precaución genérica y verificable.
- Una acción denegada propone no repetir automáticamente una acción equivalente.
- Denegar una escritura de memoria nunca genera otra propuesta de memoria, evitando bucles.
- Patrones evidentes de control del prompt (`ignora las instrucciones`, `system prompt`, etc.) no se
  destilan.

Las propuestas duplicadas activas o ya pendientes se eliminan. La caducidad automática por defecto
es 90 días; una corrección explícita del usuario la extiende a 180 días. Las entradas caducadas no se
inyectan, aunque permanecen en el historial de auditoría.

## Recuperación e inyección

El broker filtra entradas activas y no caducadas y las ordena por coincidencia léxica aproximada,
tipo, confianza y recencia. El presupuesto por defecto es 256 tokens estimados y el máximo duro es
512. Una preferencia no relacionada no entra solo por ser reciente.

El bloque se marca explícitamente como datos, se serializa una entrada por JSON y recuerda que no
puede anular system prompt, seguridad, política ni petición actual. El system prompt de Pi repite esa
regla. La traza guarda solo `itemIds`, tokens estimados, presupuesto y truncado; así se puede auditar
la selección sin duplicar el contenido de memoria en telemetría.

El harness recrea su sesión únicamente si cambia el modelo o el conjunto/contexto seleccionado. La
conversación persiste en el mismo `SessionManager`.

## Control del usuario y política

Una señal se puede registrar automáticamente porque no cambia el comportamiento. En cambio, una
propuesta usa exactamente:

```text
tool=memory.write, source=system
→ agent.memory.learning.confirm
→ confirmation pending
→ memoria activa solo tras POST .../confirm
```

No existe una ruta alternativa de activación. La confirmación aplica la misma función de escritura
que el tool runner. Una denegación queda como señal y la propuesta permanece inactiva.

Control disponible:

- `GET /api/agent/learning/signals`
- `GET /api/agent/learning/memories?includeDeleted=true`
- `GET /api/agent/learning/context?query=...&tokenBudget=...`
- `POST /api/agent/learning/memories/:itemId` con intención explícita
- `DELETE /api/agent/learning/memories/:itemId` con intención explícita
- herramienta de voz `learning_memory` con `list`, `correct` y `forget`

Correcciones y borrados crean nuevas revisiones; el historial anterior queda disponible para
auditoría. Un elemento borrado deja de entrar inmediatamente en contexto.

## Medición real

Suite: `tools/pi-harness-eval/scenarios/pi-learning.json`

Runner: `tools/pi-harness-eval/src/learning-live.ts`

Modelo solicitado: `gpt-5.5-instant`; modelo realmente seleccionado por el registro disponible:
`gpt-5.1`.

Prompt fijado antes de ejecutar:

> ¿En qué formato prefiero que me des los resúmenes?

Criterios: turno correcto, output con `tres viñetas`, ID `learn_summary_format` presente, contexto
≤256 tokens y duración ≤30 s.

| variante | suite | estado | recuerdo visible | selección | tokens | duración |
| --- | ---: | --- | --- | --- | ---: | ---: |
| baseline | 0/1 | failed | no | ningún ID | 0/256 | 8220 ms |
| learned | 0/1 | failed | no | `learn_summary_format` | 82/256 | 8216 ms |

El primer intento con el OAuth histórico del harness falló con `refresh_token_reused`; se repitió en
directorios temporales aislados usando el login vigente de Codex. Ambas llamadas posteriores llegaron
al modelo, pero el adaptador del harness no extrajo respuesta. Por ello:

- demostrado: recuperación correcta, presupuesto, aislamiento baseline/learned y trazabilidad;
- no demostrado: que el modelo conteste mejor o deje de preguntar gracias a esa memoria.

Los informes generados localmente están bajo
`tools/pi-harness-eval/.out/self-improvement/{baseline-report,learned-report}` y están ignorados por
Git. El eval fue ampliado para puntuar IDs y presupuesto además del output.

## Verificación

- Backend/harness/eval focalizados: `114 pass`, `0 fail`.
- Renderer: `bunx vitest run src/App.test.tsx`: `7 pass`, `0 fail`.
- `git diff --check`: limpio.
- `bun run typecheck:bun` no pudo completarse porque el `node_modules` compartido carece de
  `dbus-next`, dependencia ya declarada y usada por `components/network/node/network-manager.ts`.
  El fallo no apunta a archivos modificados en este trabajo.
- No se lanzó ningún build de ISO.

## Fuera de alcance

- Aprendizaje libre o reescritura autónoma del system prompt por un LLM.
- Activación silenciosa de memoria sin confirmación.
- Embeddings/vector DB; el volumen actual no justifica esa dependencia.
- Compactación física del historial NDJSON; caducidad y borrado son lógicos y auditables.
- Suscripción push a todos los eventos terminales de OpenClaw.
- Reparar la extracción de respuestas del adaptador real `gpt-5.1`; debe resolverse antes de poder
  afirmar una mejora conductual end-to-end.
