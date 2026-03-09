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
- Para pruebas locales en Arch: `qemu-desktop` y opcionalmente `edk2-ovmf`

Comandos:

```bash
make build
```

La ISO resultante se copia a `dist/`.

## Probar la ISO en local

Si ya tienes una ISO en `dist/`, puedes arrancarla directamente en una VM local:

```bash
make vm-live
```

Eso reutiliza un disco persistente en `state/qemu/` para que el ciclo de instalacion y re-prueba sea rapido. Para arrancar el sistema ya instalado en ese disco:

```bash
make vm-disk
```

Si quieres reinstalar desde cero y limpiar el estado persistente de la VM:

```bash
make vm-reset
```

Tambien tienes el atajo:

```bash
make quick-test
```

Mas detalle en `docs/installer/quick-test.md`.

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
