# AgenOS UI

Shell canónica Wayland-first para la ISO live y el sistema instalado.

## Rutas internas

- `/` decide el arranque según `GET /api/bootstrap`
- `/installer` reutiliza el wrapper guiado actual sobre Calamares
- `/home` muestra la home mínima con launcher y acciones de sistema
- `/launching` cubre la transición al abrir apps o disparar acciones

## Build

La salida de producción se copia a `/usr/local/share/agenos-ui` dentro de la imagen.
