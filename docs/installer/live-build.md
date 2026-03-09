# Build de la ISO

La imagen se construye con `live-build` dentro de Docker para no depender de paquetes en el host.

## Flujo

1. `tools/live-build/Dockerfile` instala la toolchain de `live-build`.
2. `build/live-build/auto/config` define la ISO Debian 12 live.
3. `build/live-build/config/package-lists/` define el set de paquetes.
4. `build/live-build/config/includes.chroot/` inyecta branding, scripts y configuracion.
5. `scripts/build-iso.sh` ejecuta la build y copia la ISO a `dist/`.

## Personalizacion aplicada

- branding propio en Calamares
- autolanzado del instalador solo en la sesion live
- autologin del usuario live `agenos`
- base tecnica incluida para la siguiente fase: `chromium`, `cage`, `pipewire`, `wireplumber`

## Limitaciones actuales

- la sesion final instalada sigue siendo XFCE; la sesion kiosk aun no esta activada
- la UI React y el agente no se empaquetan todavia
- el branding del instalador es deliberadamente ligero para priorizar una ISO que compile
