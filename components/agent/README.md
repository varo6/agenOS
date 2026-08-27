# Tools del agente

Módulos que dan a Pi, el agente de primer plano, la capacidad de operar el
ordenador. Cada uno se parte en dos: un módulo de capacidad (lógica pura, con
dependencias inyectables para poder testear sin sistema real) y un *model tool*
que expone esa capacidad al modelo.

Nada de esto ejecuta efectos por su cuenta. El broker
(`components/installer-ui/src/bun/agent/`) decide con `policy-rules.ts` si cada
llamada se permite, se deniega o necesita confirmación del usuario, y es quien
instancia los servicios reales.

## Capacidades

| Tool | Módulo | Qué permite |
| --- | --- | --- |
| `computer_run` | `shell.ts` + `computer-run-tool.ts` | Shell real: ficheros, procesos, servicios, hardware, red. Los comandos destructivos vuelven como confirmación pendiente. |
| `files_manage` | `files-content.ts` | Leer, escribir, añadir, listar y buscar ficheros del usuario. |
| `web_control` | `web-control.ts` | Operar cualquier web: abrir, leer la página, pulsar, escribir, esperar, extraer. Usa el perfil y las sesiones ya iniciadas del usuario. El broker lo sirve con Playwright y cae al CDP directo de este módulo si Playwright falta o falla. |
| `desktop_control` | `desktop-control.ts` | Operar aplicaciones nativas: ver ventanas (`swaymsg`), escribir (`wtype`), ratón (`ydotool`), capturas (`grim`). |
| `google_workspace` | `google-auth.ts` + `google-api.ts` | Gmail y Google Calendar de verdad: leer, enviar, responder, listar y crear citas. |
| `browser_open`, `apps_open`, `apps_install`, `files_open` | varios | Abrir cosas para que las vea el usuario, e instalar paquetes Debian. |
| `agent_task`, `openclaw_setup`, `learning_memory` | varios | Trabajo en segundo plano, configuración del backend y memoria aprendida. |

El comportamiento que se espera del modelo (qué tool elegir, cuándo pedir
confirmación y la obligación de no afirmar acciones no realizadas) vive en
`pi-system-context.md`, que se inyecta como prompt de sistema.

## Requisitos del sistema

`web_control` necesita que Chromium escuche en el puerto de depuración; de eso se
encarga `browser-launcher.ts`, que añade siempre `--remote-debugging-port`
(constante `CHROMIUM_DEBUG_PORT`) para que el navegador sea manejable durante
toda la sesión.

### Playwright y el respaldo CDP

`web-control.ts` sigue siendo la API pública: el tipo `WebController` y la tool
`web_control` no cambian. Lo que cambia es quién las implementa. El broker
instancia `createPlaywrightWebController`
(`components/installer-ui/src/bun/agent/web-control-playwright.ts`), que usa
`playwright-core` para conectarse **por CDP al Chromium que ya tiene el usuario**
en `127.0.0.1:18800` (`chromium.connectOverCDP`). No lanza un navegador propio ni
descarga ninguno: por eso la dependencia es `playwright-core` y no `playwright`.

Lo que aporta Playwright es la espera de accionabilidad de `Locator`, el manejo
de `iframe` (los refs de marcos secundarios viajan como `f1:e7`) y una
navegación más fiable. La lectura de la página sigue siendo el mismo script de
`buildSnapshotScript`, que se le pasa a Playwright como expresión: el snapshot
y los refs son idénticos vayan por Playwright o por el respaldo CDP.

Si `playwright-core` no está instalado, el controlador se marca como no
disponible y todas las acciones pasan al `createWebController` de este módulo,
que habla CDP a mano. Si el módulo está pero la conexión falla, cae igualmente al
respaldo y deja de reintentar la conexión durante 30 s para que ninguna acción
pague el timeout completo. El empaquetado de la ISO copia `playwright-core` a
`/opt/agenos/installer/node_modules/`, junto al `api/server.js` que lo importa;
`scripts/smoke-agent-runtime.sh` comprueba que esté.

### Capturas y visión

`web_control screenshot` y `desktop_control screenshot` devuelven el mensaje de
texto **y** el PNG como `ImageContent`, para que el modelo lo vea sin leer el
disco. `screenshot-tool-content.ts` verifica la firma PNG y descarta archivos de
más de 5 MiB, y el base64 nunca entra en `details`: ahí solo va la ruta.

El texto es siempre la vía principal: `web_control` devuelve el snapshot
textual tras cada acción y con eso basta para decidir el paso siguiente. La
captura queda para lo que el texto no cuenta (mapas, gráficos, páginas sin
texto). Además la visión es condicionada: si el modelo activo no declara
entrada de imagen, o si se arranca con `AGENOS_TOOL_VISION=off`, el tool
devuelve solo el texto con la ruta del archivo.

### Trazas visuales de `web_control`

El broker guarda un registro NDJSON por cada paso en
`~/.agenos/broker/traces/web-control/steps.ndjson`. El registro incluye acción,
duración, `correlationId`, resultado y estado de la captura. No guarda el texto
escrito en formularios. Las URL pierden query y fragmento antes de escribirse en
disco, y los archivos usan permisos `0600`. Antes de marcar un PNG como guardado,
el broker comprueba su firma y registra tamaño y dimensiones.

El modo predeterminado, `failures`, solo pide una captura cuando falla una
acción. La captura corre en segundo plano, así que no retrasa la respuesta del
tool. Los últimos 20 PNG quedan en el subdirectorio `screenshots/`; al añadir
otro se elimina el más antiguo.

Para una sesión de depuración visual completa, arranca el broker con:

```bash
AGENOS_WEB_CONTROL_TRACE=visual bun run src/bun/server.ts
```

Ese modo también captura después de `open`, `click`, `type`, `pressKey`,
`waitFor`, `back` y `reload`. `snapshot`, `extract` y `status` solo generan
metadatos. Usa `AGENOS_WEB_CONTROL_TRACE=off` para desactivar la traza,
`AGENOS_WEB_CONTROL_TRACE_DIR` para cambiar el directorio,
`AGENOS_WEB_CONTROL_TRACE_MAX_SCREENSHOTS` para ajustar el límite de PNG entre
1 y 200 y `AGENOS_WEB_CONTROL_TRACE_MAX_BYTES` para el tamaño del NDJSON.

La retención está acotada por los dos lados: el NDJSON rota a `steps.ndjson.1`
al pasar de 2 MiB, así que la traza nunca ocupa más de dos ficheros más los 20
PNG. Las trazas guardan rutas de captura, nunca base64.

`desktop_control` necesita los paquetes `wtype`, `ydotool`, `grim` y `slurp`, que
la ISO instala, más el demonio `ydotoold` y el módulo `uinput`. Si algo falta, el
módulo lo dice nombrando el paquete concreto en vez de fallar en silencio.

`google_workspace` necesita un ID de cliente OAuth de tipo «Aplicación de
escritorio» creado por el usuario en Google Cloud Console, en
`~/.agenos/google/client.json` o en `AGENOS_GOOGLE_CLIENT_ID` /
`AGENOS_GOOGLE_CLIENT_SECRET`. Sin él, el tool explica los pasos en vez de
fingir que puede.

## Tests

```bash
cd components/installer-ui && bun test ../agent
```
