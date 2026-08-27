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

La ISO resultante se copia a `dist/`. El build normal reutiliza la cache de `live-build` (los `.deb` ya descargados y el chroot de bootstrap) y las caches de descarga de cargo, Bun y Electron bajo `.cache/`, todas verificadas por checksum.

Si necesitas forzar un build completamente en frio:

```bash
LB_PURGE=1 make build
```

`LB_PURGE=1` y `make clean` borran `build/live-build/cache/`: ~1,3 GB de paquetes y el chroot de bootstrap. El siguiente build vuelve a hacer debootstrap y a descargar todos los paquetes, lo que anade del orden de 5 a 15 minutos. Uselo solo cuando sospeche que el estado del archivo de paquetes esta corrupto, no como limpieza rutinaria.

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

## Probar desde un USB sin perder los datos

La imagen admite persistencia para conservar archivos, sesiones y redes Wi-Fi entre arranques. El USB necesita una partición adicional, que puede crearse desde Linux con una simulación previa:

```bash
./scripts/create-persistent-usb.sh --device /dev/disk/by-id/usb-FABRICANTE_MODELO
```

La guía completa y las advertencias sobre borrado y datos sin cifrar están en `docs/installer/persistent-usb.md`.

## Publicar una release

Si ya tienes una ISO en `dist/`, puedes empaquetar la release y subirla a Google Drive:

```bash
make release VERSION=v0.1.0
```

Si quieres compilar y publicar en un solo paso:

```bash
make release-build VERSION=v0.1.0
```

Por defecto se crea una carpeta gitignored en `releases/` dentro del repo y se sube esa misma release a `gdrive:/agenOS/` usando `rclone`. El identificador de release sigue el formato `<version>_<fecha>`, por ejemplo `v0.1.0_2026-04-05`, y la ISO publicada se llama `agenos-bookworm-amd64-v0.1.0.iso`. Mas detalle en `docs/installer/releases.md`.

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
