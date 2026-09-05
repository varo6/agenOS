# Respuestas guardadas y preferencias

Al pulsar "Guardar en memoria", el broker conserva la respuesta completa en
este ordenador antes de confirmar el guardado. No necesita conexión al modelo.
Se puede buscar, releer y borrar desde Sistema, Respuestas guardadas.

Después, un trabajo de Pi intenta extraer una preferencia reutilizable. Si no
encuentra ninguna o el modelo falla, la respuesta original sigue guardada.
Las preferencias se consultan con la herramienta `improvements` y se incorporan
al catálogo de conversaciones futuras. Las respuestas originales no se inyectan
automáticamente en el contexto del modelo.

## Archivos

La raíz es `~/.agenos/memory/improvements`, configurable con
`AGENOS_IMPROVEMENTS_DIR`.

- `saved-replies/<sha256 del turnId>.json` conserva la pregunta, la respuesta y
  la fecha de guardado. No caduca ni se desaloja automáticamente. Se aplica la
  redacción de secretos del proyecto.
- `<categoría>/<nombre>.md` contiene una preferencia, con metadatos y un cuerpo
  de hasta 900 caracteres. El almacén admite 120 preferencias y desaloja la
  menos usada cuando se llena.
- `index.json` es el catálogo derivado de las preferencias. Puede reconstruirse.
- `jobs.ndjson` registra el destilado. Los trabajos pendientes incluyen hasta
  cuatro turnos, con un máximo total de 12.000 caracteres, para poder continuar
  después de reiniciar o cambiar de conversación. Al superar 1 MiB se compacta
  conservando los trabajos activos y los 50 trabajos más recientes.
- `events.ndjson` registra cambios de preferencias.

Las respuestas, las preferencias y el índice se escriben primero en un archivo
temporal y se sustituyen mediante rename. Una fusión escribe la nueva nota
antes de borrar la anterior. Esto evita archivos parciales si el proceso se
interrumpe durante la escritura; no garantiza persistencia ante un corte eléctrico.

Borrar una respuesta guardada no borra una preferencia que ya se haya extraído.
Las preferencias se pueden olvidar mediante la herramienta `improvements`.

## Guardado y recuperación

El cliente manda solo el `turnId`. El contenido procede del historial del broker,
que conserva hasta 40 turnos, igual que la conversación visible. La captura toma
una copia del contexto al pulsar el botón, antes de encolarse.

Las peticiones repetidas reutilizan el trabajo activo o terminado. El guardado
del original también es idempotente. El destilado ejecuta como máximo dos
trabajos a la vez y tiene un plazo de 30 segundos, incluida la creación de la
sesión. Al agotarlo, se cancela y se intenta el respaldo local para preferencias
explícitas. Un fallo de extracción no elimina el original.

En Electron, estas operaciones usan un puente IPC con autenticación en el
proceso principal. Esto permite guardar cuando el shell ha arrancado desde sus
archivos locales por un retraso del broker. El renderer no recibe el token.
Las peticiones de memoria tienen un plazo de ocho segundos.

Un cliente conectado a un broker anterior conserva el seguimiento del trabajo,
pero deja de esperar a los dos minutos y permite reintentar. Los resultados de
una conversación anterior no modifican las marcas de una conversación nueva.

## API

| Método y ruta | Resultado |
| --- | --- |
| `POST /api/agent/improvements/capture` | Recibe `turnId`; `saved: true` confirma el original en disco. Devuelve también el identificador del destilado. |
| `GET /api/agent/improvements/capture/:jobId` | Estado de extracción de la preferencia. |
| `GET /api/agent/saved-replies?query=texto&offset=0` | Busca en preguntas y respuestas; devuelve páginas de 50, empezando por las más recientes. |
| `DELETE /api/agent/saved-replies/:turnId` | Borra el original; requiere `explicitUserIntent: true`. |
| `GET /api/agent/improvements` | Lista de preferencias por nombre, categoría y título. |
| `GET /api/agent/improvements/catalog` | Catálogo limitado a 1.200 tokens por defecto. |
| `GET /api/agent/improvements/search?query=texto` | Busca preferencias por palabras clave. |
| `GET /api/agent/improvements/:name` | Lee una preferencia y actualiza su fecha de uso. |
| `DELETE /api/agent/improvements/:name` | Olvida una preferencia; requiere intención explícita. |

Las notas anteriores siguen siendo compatibles. Las respuestas de capturas
antiguas que nunca se escribieron no pueden reconstruirse desde este almacén.
