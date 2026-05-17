# Live System Slice
## Qué existe ahora

- La vertical slice activa vive en `components/installer-ui`; `components/ui` sigue siendo la UI futura.
- El modo `system` ya no es placeholder: renderiza una vista propia y ejecuta una acción real.
- Hay dos entradas para la misma slice: texto y micro demo.
- Solo existe una intención local real: `open_maintenance_terminal`.
- La acción real hace `POST /api/system/maintenance` contra el backend local Bun y termina en `pkexec + agenos-shell-helper terminal`.
- No hay agente, STT real ni WebSocket; la voz actual es una simulación local controlada.

## Flujo end-to-end

`usuario escribe o pulsa micro -> App interpreta comando local -> POST /api/system/maintenance -> backend Bun -> pkexec + agenos-shell-helper terminal -> UI muestra resultado`

Notas:
- El micro usa una transcripción fija demo: `abre terminal de mantenimiento`.
- Los estados visibles en UI son `idle`, `listening`, `processing` y `error`.

## Puntos de código

- UI y estado: `components/installer-ui/src/views/mainview/App.tsx`
- UI y estado: `components/installer-ui/src/views/mainview/components/LiveSystemView.tsx`
- Intérprete mínimo: `components/installer-ui/src/views/mainview/system-command.ts`
- Cliente HTTP: `components/installer-ui/src/views/mainview/installer-client.ts`
- Endpoint Bun: `components/installer-ui/src/bun/server.ts`
- Puente al helper del sistema: `components/installer-ui/src/bun/system/maintenance.ts`

Cobertura actual de tests: texto válido, micro demo válido, comando desconocido, error del backend, validación del endpoint Bun, cliente HTTP e intérprete local.

## Contrato mínimo

- Ruta HTTP real: `POST /api/system/maintenance`
- Body mínimo: `{ "action": "terminal" }`
- Éxito: `202 { ok: true, message: "Acción terminal lanzada." }`
- Error de validación: `400`
- Error del helper o ejecución: `500`
- Tipo público nuevo: `MaintenanceAction = "terminal"`
- Intención local actual: `open_maintenance_terminal`
- Transcripción demo pública: `abre terminal de mantenimiento`

## Qué es real y qué es demo

Real:
- Endpoint local Bun.
- Acción real de mantenimiento.
- Helper del sistema.
- Feedback visible en UI.

Demo/preparado:
- Micro simulado.
- Transcripción fija.
- Matching local determinista.
- Sin STT, sin agente, sin `stt.partial`, sin `stt.final`.

## Cómo extenderlo sin romperlo

- Sustituir la fuente demo por PTT/STT real manteniendo el mismo estado UI.
- Sustituir `interpretSystemCommand()` por un transporte al agente manteniendo el mismo contrato de resultado.
- Ampliar `MaintenanceAction` o añadir nuevas intenciones sin romper la slice actual.
- No mover esta slice a `components/ui` mientras la ISO siga arrancando por `components/installer-ui`.

## Agentic Backend MVP

The next slice keeps Pi as the foreground chat harness and adds an AgenOS-owned broker API under `/api/agent/*`.

Runtime behavior for the MVP:

- `agenos-agent-api.service` starts the real Bun broker API on `127.0.0.1:4173`
- local memory is stored for the `agenos` live user under `/home/agenos/.agenos/memory`
- policy decisions cover memory, apps, browser, tasks, and outbound sends
- the simulated worker follows `/home/agenos/.agenos/openclaw/outbox.ndjson`
- `agenos-openclaw.service` is a visible background worker boundary until the real worker package exists

This validates the always-on worker boundary before real WhatsApp, Telegram, or email credentials are required.
