# AgenOS

AgenOS es una base de distribucion Debian pensada para evolucionar hacia un sistema "voice-first" orientado a accesibilidad y uso agéntico del ordenador.

En esta primera iteracion el repositorio deja preparada la estructura general del TFG y prioriza lo que ahora mismo si es viable:

- construir una imagen live/installable basada en Debian 12 con `live-build`
- personalizar de forma ligera la experiencia visual del instalador con Calamares
- dejar definidos los huecos de `ui`, `agent`, protocolos y servicios `systemd` para las siguientes fases

## Estructura

- `build/live-build/`: configuracion de la ISO live e instalable.
- `scripts/`: automatizacion de build y limpieza.
- `tools/live-build/`: contenedor Docker reproducible para compilar sin tocar el host.
- `components/ui/`: esqueleto de la UI kiosk/voice-first futura.
- `components/agent/`: esqueleto del daemon del agente.
- `components/protocols/`: contratos iniciales HTTP/WebSocket.
- `systemd/`: unidades previstas para `agent`, `ui` y `kiosk`.
- `docs/`: notas de arquitectura e instalacion.

## Build rapido

Requisitos del host:

- Docker disponible para el usuario actual

Comandos:

```bash
make build
```

La ISO resultante se copia a `dist/`.

## Estado actual

Implementado ahora:

- ISO Debian live con XFCE para sesion de instalacion
- Calamares con branding AgenOS y autolanzado en modo live
- PipeWire, Chromium y Cage incluidos como base para la siguiente fase

Dejado como estructura, sin implementar aun:

- UI React kiosk
- daemon del agente
- memoria, tools y policy engine
- sesion kiosk Wayland-first para uso diario
