# Arquitectura objetivo

El repositorio ya separa tres planos, aunque solo el de instalacion/build este activo:

## Experiencia

- `components/ui/`: futura UI React servida en local y mostrada en modo kiosk.
- objetivo: pantalla unica, input por voz o texto y delegacion de tareas al agente.

## Orquestacion

- `components/agent/`: daemon local que recibira audio, ejecutara STT, resolvera intenciones y llamara tools.
- se deja preparado para poder probarse por CLI sin depender de la UI.

## Sistema

- `build/live-build/`: empaquetado y generacion de imagen.
- `systemd/`: unidades previstas para `agent`, `ui` y `kiosk`.

## Decision de esta iteracion

Para no bloquear el TFG en una UI o agente aun no implementados, la ISO actual usa un entorno grafico minimo con Calamares. Eso permite:

- compilar una imagen instalable desde ya
- modificar branding y parte de la experiencia visual de instalacion
- dejar el salto a sesion kiosk como siguiente hito, no como prerequisito
