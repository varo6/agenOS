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
| `web_control` | `web-control.ts` | Operar cualquier web por Chrome DevTools Protocol: abrir, leer la página, pulsar, escribir, esperar, extraer. Usa el perfil y las sesiones ya iniciadas del usuario. |
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
