# Mejoras del usuario

Bajo cada respuesta terminada de Pi hay un boton **Guardar en memoria**. El
usuario lo pulsa cuando le ha gustado como Pi ha resuelto algo. A partir de ahi
todo pasa por debajo: en conversaciones futuras, cuando pida algo parecido, Pi
recupera esa nota y repite lo que funciono.

El usuario nunca ve el mecanismo. No hay pantalla de edicion, ni confirmacion,
ni espera: el boton responde al instante y el trabajo ocurre despues.

## Por que no es la memoria aprendida que ya existe

`learned-memory.ts` destila senales automaticas (fallos de tool, denegaciones,
correcciones detectadas por regex) en frases sueltas que se inyectan en cada
turno. Es involuntaria, granular y de una linea.

Esto es lo contrario: lo dispara el usuario a proposito, guarda un
procedimiento de varias lineas y se lee una vez por conversacion. Comparten la
idea de "acordarse de algo" y nada mas, asi que viven en almacenes distintos.

## Almacen

```
~/.agenos/memory/improvements/     # AGENOS_IMPROVEMENTS_DIR lo cambia
  index.json                       # catalogo derivado, reconstruible
  jobs.ndjson                      # trabajos de destilado, para auditoria
  correo/responder-pedidos.md
  web/reservar-restaurante.md
  ...
```

Una mejora es un Markdown con frontmatter YAML:

```markdown
---
name: reservar-restaurante
category: web
title: Como reservar mesa en un restaurante
triggers: [reservar, mesa, restaurante, cena, thefork]
createdAt: 2026-08-28T09:12:04.000Z
updatedAt: 2026-08-28T09:12:04.000Z
sourceTurnIds: [turn_k3m1, turn_k3m0]
version: 1
---

Cuando pida reservar mesa:
- Busca en TheFork, no llames por telefono.
- Ensenale las opciones con hora y precio antes de confirmar.
```

El cuerpo esta limitado a 900 caracteres. La nota es contexto, no un manual.

### Por que carpetas por categoria y no un cajon unico

Un cajon unico obliga a leer el directorio entero para cualquier decision, y a
los seis meses son cien ficheros. Categorias libres son peor: el destilador
inventaria "correo", "email" y "gmail" como tres cajones para lo mismo.

Por eso la taxonomia es **cerrada y de ocho entradas**
(`improvements-types.ts`): `correo`, `calendario`, `web`, `escritorio`,
`archivos`, `sistema`, `estilo`, `general`. Cubren la superficie real de tools
de Pi, el destilador solo puede elegir una de ellas, y la fusion de duplicados
solo busca candidatos dentro de la categoria elegida, que es lo que mantiene el
almacen pequeno a largo plazo.

`index.json` es cache: se reconstruye leyendo los frontmatter si falta o esta
corrupto. La verdad esta siempre en los `.md`.

## Como llega a Pi sin saturar el contexto

Dos niveles, y la separacion entre ellos es lo que hace que la funcionalidad
aguante a largo plazo.

**Nivel 1, el catalogo, una vez por conversacion.** Al crear la sesion se
anade al prompt de sistema un bloque con una linea por mejora: nombre,
categoria y titulo. Unos 15 tokens cada una, con techo de 1.200 tokens (~80
mejoras). No lleva cuerpos.

**Nivel 2, el cuerpo, bajo demanda.** Pi tiene la tool `improvements`. Cuando
lo que pide el usuario se parece a una linea del catalogo, Pi llama a
`read` con ese nombre **antes de actuar** y recibe el cuerpo completo. Si el
catalogo venia truncado, `search` le da los nombres que faltaban.

### Por que no se inyecta en cada mensaje

Ademas de que repetirlo en cada turno no aporta nada, hay una razon tecnica:
`ensureSession` en `pi-harness.ts` compara el hash del contexto inyectado y
**tira la sesion del modelo cuando cambia**. Un bloque que cambiase con cada
mensaje reiniciaria el hilo a mitad de conversacion. El catalogo se calcula al
abrir la conversacion y se queda fijo mientras dura; el cuerpo entra por la
tool, que no toca el prompt de sistema.

### Desalojo

Con mas de 120 mejoras se borra la que lleve mas tiempo sin que Pi la lea
(`lastUsedAt`, y `createdAt` si nunca se leyo). El techo protege al catalogo,
que es lo unico que se paga en cada conversacion.

## Captura

1. La UI llama a `POST /api/agent/improvements/capture` con `{ turnId }`. No
   manda texto: el broker lee el turno del harness, y asi el contenido de la
   mejora no depende de lo que diga el cliente.
2. El broker toma ese turno y el anterior, para que el destilador vea que
   pregunto el usuario antes y no solo la respuesta final.
3. Responde `202` con el `jobId`. La UI ya puede decir "Lo tendre en cuenta".
4. El destilado corre en segundo plano, con como mucho dos trabajos a la vez.

### El destilador

`codex exec` no interactivo, con `--output-schema` para que la respuesta sea
JSON validado, `--sandbox read-only` porque solo tiene que escribir texto, y
`--ephemeral` para no dejar sesiones. El broker valida ademas el JSON contra el
contrato: categoria de la lista cerrada, `name` en kebab-case, cuerpo por
debajo del limite.

Se le pasan las mejoras existentes que mas se parecen, y puede devolver
`replaces` para fusionar con una en vez de crear otra. Sin eso, marcar cinco
veces la misma preferencia dejaria cinco notas casi identicas en el catalogo.

Si Codex no esta disponible o no ha iniciado sesion, entra el destilador de
respaldo, que escribe una nota minima a partir del texto del turno sin llamar a
ningun modelo. Perder la senal del usuario es peor que guardar una nota tosca.

## Endpoints

| Metodo | Ruta | Que hace |
| --- | --- | --- |
| `POST` | `/api/agent/improvements/capture` | Encola el destilado de un turno. `202`. |
| `GET` | `/api/agent/improvements/catalog` | Bloque de catalogo para el prompt. |
| `GET` | `/api/agent/improvements` | Lista las entradas del catalogo. |
| `GET` | `/api/agent/improvements/search?query=` | Nombres que casan con una peticion. |
| `GET` | `/api/agent/improvements/:name` | Mejora completa; marca `lastUsedAt`. |
| `DELETE` | `/api/agent/improvements/:name` | La olvida. |

## Seguridad

El cuerpo de una mejora es **dato, no instruccion**, igual que la memoria
aprendida: no puede saltarse el contexto de sistema, ni la politica de tools,
ni la peticion actual. El almacen redacta el texto con
`redactHarnessTraceText` antes de escribirlo, y descarta borradores que
intenten hablarle al sistema ("ignora tus instrucciones", "system prompt").
