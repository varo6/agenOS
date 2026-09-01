# Informe de workspaces fiables

## Resultado

El cambio de workspace deja de depender de respuestas optimistas y de un watcher que inspeccionaba cualquier evento. La navegación deliberada a un workspace vacío permanece allí, el cierre de la última ventana puede devolver a Home, y el workspace real de Sway se publica al renderer en tiempo real.

Los workspaces vacíos muestran la única barra superior del sistema con el nombre y una explicación contextual. No se usan ventanas Electron auxiliares ni placeholders que puedan confundirse con ventanas de aplicación o fallar junto con el renderer.

## Causas raíz confirmadas

1. **Expulsión de workspaces vacíos:** confirmada. `agenos-workspace-watch` ejecutaba la misma inspección al arrancar y después de todos los eventos `window` y `workspace`. Un `workspace/focus` hacia `2:app` vacío iniciaba directamente el retorno a `1:home`.
2. **Bloqueo y acumulación de eventos:** confirmada. Cada inspección podía dormir 150 ms y luego 2 s dentro del mismo bucle que consumía stdout de `swaymsg -t subscribe`. Los eventos acumulados repetían el mismo coste y podían producir latencia y flapping.
3. **Pantalla negra ambigua:** confirmada. El fondo era un color sólido, no había barra nativa y los workspaces de app usan ventanas fullscreen sin bordes. Un workspace vacío no ofrecía ninguna señal de que Sway seguía respondiendo.
4. **Respuesta optimista del agente:** confirmada. `focusWorkspaceSync()` lanzaba `swaymsg` detached, no leía su resultado ni comprobaba `get_workspaces`, y devolvía el número pedido como si ya fuera real.
5. **Ausencia de push hacia la UI:** confirmada. El renderer solo obtenía el workspace durante cargas/refrescos HTTP y después de acciones propias; no existía ninguna suscripción a `workspace/focus` de Sway.
6. **Watchers duplicados al recargar Sway:** causa adicional. La configuración usaba `exec_always`, por lo que cada reload podía añadir otra suscripción independiente con la misma política de retorno.

## Arquitectura implementada

### Watcher de cierre

`agenos-workspace-watch` conserva un snapshot con el workspace enfocado, los workspaces con vistas y un mapa de IDs de ventanas a workspace. La función pura `decide_actions(event, snapshot)` decide sin ejecutar IPC:

- `workspace/change=focus`: registra el foco y cancela cualquier retorno pendiente.
- `window/change=new|move`: solicita refrescar el mapa de ventanas.
- `window/change=close`: solo programa una comprobación si la ventana cerrada pertenecía al workspace de app actualmente enfocado.
- `empty-check`: vuelve a Home únicamente si el mismo workspace sigue enfocado y continúa vacío.

El lector de eventos vive en un hilo dedicado que solo parsea JSON y lo introduce en una cola; no duerme ni consulta el árbol. El coordinador usa deadlines de 25/75 ms para agrupar actualizaciones e inspeccionar el árbol cuando Sway ya terminó el lote. Un evento de foco posterior cancela el retorno, por lo que una navegación deliberada siempre gana.

El watcher ya no inspecciona ni cambia el foco al arrancar. Sway lo inicia con `exec`, no con `exec_always`.

### Superficie para workspaces vacíos

El único bloque `bar` de Sway usa Waybar como renderizador. Sus botones muestran el workspace real a la izquierda, el reloj `HH:MM` queda centrado respecto a la pantalla y `agenos-workspace-watch --status` publica a la derecha una indicación como `Web · vacio hasta que abras el navegador · Ctrl+Alt+1: Home`.

Esta solución no crea una segunda barra ni falsas ventanas para la política de vacío. Waybar se ejecuta desde `swaybar_command`, conserva una sola superficie superior y desaparece naturalmente detrás de una aplicación fullscreen.

`swaybar_command` apunta a `/usr/local/bin/agenos-bar`, no a `waybar` con argumentos. Sway 1.7 lanza esa orden con `execvp()` usando la cadena entera como `argv[0]` y añadiendo `-b <bar_id>` (`sway/config/bar.c`, `invoke_swaybar`); no hay ningún shell de por medio. Con `swaybar_command waybar -c ... -s ...`, Sway buscaba un binario cuyo nombre era la línea completa, el `execvp` fallaba y el hijo terminaba en `_exit(EXIT_FAILURE)` **sin emitir ningún error**: el escritorio arrancaba sin barra y sin ninguna traza que lo explicara. El lanzador es un único ejecutable sin argumentos, guarda dentro las rutas de configuración y estilo, propaga `"$@"` para conservar el `-b <bar_id>` y cae a `swaybar` si Waybar no estuviera disponible.

Los botones usan `{value}` y no `{name}`: `{name}` recorta el prefijo `N:` y dejaba `home` donde la barra nativa mostraba `1:home`, que es justo lo que conecta con `Ctrl+Alt+1..5`.

### Foco confirmado en el broker

El servicio de workspaces ejecuta `swaymsg workspace <nombre>` de forma síncrona, valida la respuesta JSON de Sway y consulta `get_workspaces`. Solo devuelve `ok: true` si el workspace enfocado real coincide con el solicitado.

Los launchers existentes de Pi inyectan un spawner detached. Para conservar su interfaz sin tocar esos ficheros, el servicio hace hasta ocho comprobaciones separadas 20 ms (140 ms máximos de espera) antes de dejar que el launcher continúe. Después, la lógica existente de apps confirma y mueve la ventana recién creada.

### Push Sway → broker → renderer

El servicio mantiene una única suscripción compartida a `swaymsg -t subscribe '["workspace"]'`, filtra exclusivamente `change=focus` y reconecta si el proceso termina. El broker la expone en `GET /api/agent/workspaces/events` como Server-Sent Events.

El cliente del renderer abre un `EventSource`, aplica cada estado real y cierra la conexión al desmontar `App`. Los clicks ya no modifican `activeWorkspace` antes de tiempo; mantienen el estado anterior hasta recibir una respuesta verificada o el evento de Sway. Los cambios por teclado y por agente llegan por el mismo canal.

## Ficheros modificados

- `build/live-build/config/includes.chroot/usr/local/bin/agenos-workspace-watch`
- `build/live-build/config/includes.chroot/etc/agenos/sway/config`
- `components/agent/workspaces.ts`
- `components/installer-ui/src/bun/agent/workspaces.test.ts`
- `components/installer-ui/src/bun/server.ts`
- `components/installer-ui/src/bun/server.test.ts`
- `components/ui/src/lib/agent-client.ts`
- `components/ui/src/lib/agent-client.test.js`
- `components/ui/src/App.tsx`
- `components/ui/src/App.test.tsx`
- `tests/test_agenos_workspace_watch.py` (nuevo)
- `.orchestration/reports/ws1-workspaces.md` (nuevo)

## Tests añadidos y ejecutados

- Seis tests Python para navegación deliberada, cierre local, cierre en background, comprobación final, ventanas tiled/floating y texto del workspace vacío.
- Tests Bun para validación del comando, rechazo si el foco real no coincide, espera de launchers detached, parsing estricto de eventos y publicación/cierre de la suscripción.
- Test del endpoint SSE y su cleanup.
- Test del cliente `EventSource` y su cleanup.
- Tests React que demuestran que el click no es optimista y que un evento externo actualiza la barra.
- Regresiones de `apps` y `browser`, porque ambos reutilizan el servicio de workspaces.

Comandos de validación usados:

```text
python3 -m unittest tests/test_agenos_workspace_watch.py
bun test components/installer-ui/src/bun
(cd components/ui && bun test src/lib dev)
(cd components/ui && bunx vitest run src/App.test.tsx)
(cd components/installer-ui && bun run typecheck:bun)
(cd components/ui && bunx tsc --noEmit -p tsconfig.json)
npx -y react-doctor@latest . --verbose --scope changed
```

Resultado final: 6 tests Python, 189 tests Bun del backend, 82 tests Bun de UI/dev y 8 tests Vitest del renderer, todos en verde. Ambos typechecks terminaron sin errores. React Doctor no señaló ningún problema específico de la nueva suscripción; mantuvo avisos preexistentes sobre el tamaño de `App`, efectos anteriores y otros clientes HTTP.

No se ejecutó ningún build de ISO ni se tocó ningún artefacto generado prohibido.

## Validación de la barra

Ejecutada en un contenedor Debian bookworm con las versiones exactas de la imagen (sway 1.7, Waybar 0.9.17), con Sway sobre el backend `headless` y capturas con `grim`, usando los ficheros reales de `includes.chroot`:

- Con `swaybar_command waybar -c ...` no existe ningún proceso de barra y Sway no registra ningún error. Ésta era la causa de la pantalla sin barra.
- Con `swaybar_command /usr/local/bin/agenos-bar`, Waybar arranca (`Bar configured (width: 1280, height: 46)`), pinta los botones de workspace a la izquierda con el nombre completo, el reloj centrado y el texto de `agenos-workspace-watch --status` a la derecha, y reserva su zona exclusiva (las ventanas empiezan por debajo).
- `swaymsg reload` deja exactamente un proceso de Waybar: Sway destruye el cliente anterior antes de relanzarlo, así que no se duplica la superficie.

## Pendiente de validación en VM/hardware

- Confirmar en hardware real colores, altura y legibilidad a distancia sobre una pantalla física.
- Probar Ctrl+Alt+1..5 con workspaces vacíos y ocupados, incluidos cambios rápidos repetidos.
- Cerrar la última ventana tiled y floating; comprobar que vuelve a Home, y cerrar una ventana en background mientras se permanece deliberadamente en otro workspace vacío.
- Probar el ciclo completo de Pi abriendo browser, terminal y una aplicación genérica en workspaces explícitos.
- Verificar varios monitores y la reconexión SSE después de reiniciar el broker o recargar la UI.
