# Auditorías e informes de ingeniería

Cada fichero documenta un frente de trabajo: qué estaba mal, qué se decidió,
por qué, y qué queda pendiente o requiere validación en hardware real.

- [tfg-implementation-gaps.md](tfg-implementation-gaps.md) — contraste entre lo
  que afirma la memoria del TFG y lo que el código implementa, con veredicto y
  evidencia fichero:línea por promesa. **Empieza por aquí.**
- [workspaces-reliability.md](workspaces-reliability.md) — por qué cambiar de
  workspace fallaba y dejaba pantallas negras.
- [graphical-launching.md](graphical-launching.md) — lanzamiento supervisado de
  Chromium y del resto de aplicaciones.
- [laptop-hardware.md](laptop-hardware.md) — soporte de portátil: energía,
  suspensión por tapa, micrófono, brillo, gráficos y firmware.
- [boot-performance.md](boot-performance.md) — arranque y coste en reposo.
- [honest-operations.md](honest-operations.md) — rutas que respondían éxito sin
  efecto, y qué se hizo con cada una.
- [broker-boundary.md](broker-boundary.md) — cierre de los caminos por los que
  el agente actuaba sin pasar por la política del broker.
- [broker-boundary-merge.md](broker-boundary-merge.md) — cómo se reconciliaron
  los dos frentes anteriores, que se solapaban.
- [pi-learning-loop.md](pi-learning-loop.md) — bucle de aprendizaje de Pi, con
  lo que se midió y lo que **no** se puede afirmar todavía.
- [dependency-audit.md](dependency-audit.md) — dependencias JS y paquetes
  Debian, incluido el cruce entre binarios invocados y paquetes instalados.
- [shell-composition.md](shell-composition.md) — descomposición de `App.tsx`.
- [simplified-interface.md](simplified-interface.md) — simplificación de la
- [desktop-applications.md](desktop-applications.md) — conjunto base de aplicaciones
  instaladas y asociaciones MIME por defecto.
  interfaz para usuarios mayores y no técnicos.
