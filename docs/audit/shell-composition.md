# ws9-shell — descomposición del shell de `components/ui`

Rama `ws9-shell`, base `a5833dd` (merge de ws4-ui). Cierra el frente que quedó a medias:
`App.tsx` pasa de **570 líneas de presentación** a **182 líneas de composición**, y toda la
pantalla vive en componentes con una responsabilidad cada uno.

## Estructura final de `components/ui/src`

```
App.tsx                       182 líneas: conecta hooks → acciones → dos vistas. No pinta nada.
main.tsx
styles.css                    tokens + capa de componentes (sin alias heredados)

components/
  shell/                      ← el shell propiamente dicho
    index.ts                  barrel
    TopBar.tsx                (memo) marca, navegación Inicio/Sistema, escritorios, estado de cuenta
    WorkspaceSwitcher.tsx     (memo) ya existía
    BootScreen.tsx            arranque: qué se está comprobando
    SystemAlertBanner.tsx     (memo) aviso + el botón que lo resuelve
    HomeView.tsx              vista voice-first: orbe → composer → bloqueos → historial
    SystemView.tsx            vista técnica: salud, cuenta, backend
    Composer.tsx              (memo) entrada de texto con motivo de bloqueo
    ConnectionPanel.tsx       (memo) cuenta: conectar, device-code en 2 pasos, fallback manual
    ConversationPanel.tsx     (memo) historial como `role="log"` + anuncio de la respuesta final
  voice/VoiceConsole.tsx      (memo) ya existía
  ui/                         primitivas compartidas (ya existían)
  Agent*.tsx                  paneles de agente, ahora vestidos con las primitivas

hooks/
  useShellActions.ts          ← nuevo: conectar, logout, refrescar, red, enviar, foco de escritorio
  useShellBoot.ts             ← nuevo: secuencia de arranque, un solo efecto
  useVoice / useWorkspaces / usePiSession / useConversation / useAgentHealth /
  useNetworkStatus / useSystemAlert / useLatest

lib/
  shell-state.ts              ← nuevo: reglas puras del shell (fase, bloqueo, readiness)
  clients.ts                  ← nuevo: los cuatro clientes, creados una vez por proceso
  voice-status / user-errors / agent-activity / workspace-source / cx / ...
```

Tests nuevos: `TopBar`, `SystemAlertBanner`, `ConnectionPanel`, `Composer`,
`ConversationPanel`, `HomeView` (vitest) y `shell-state` (bun).

## Decisiones de diseño

**Dos niveles de componente, con contratos distintos.** Las *vistas* (`HomeView`,
`SystemView`) reciben los controladores de los hooks: son las pantallas de este shell y no
tienen vocación de reutilizarse. Los *componentes* (`TopBar`, `Composer`, `ConnectionPanel`,
`ConversationPanel`, `SystemAlertBanner`) reciben valores primitivos y callbacks estables, y
por eso pueden memoizarse de verdad. Sin esa separación, `memo` habría sido decorativo: los
hooks devuelven un objeto nuevo en cada render y cualquier componente que reciba el objeto
entero se repinta con cada tecla.

**Voice-first de verdad en la pantalla principal.** Antes la portada era un `<h1>AgenOS</h1>`
de tamaño de landing con el orbe debajo y, pegados, la tarjeta de auth, un input suelto y el
historial. Ahora Inicio es el ciclo de uso: saludo (solo la primera vez) → orbe → campo de
texto → lo que impida usar a Pi → historial. Todo lo técnico que **no** bloquea (checklist de
salud, panel de backend, cuenta ya conectada) se fue a Sistema. La regla de qué bloquea está
en `resolveShellReadiness` y tiene un estado `checking` deliberado: mientras no hay lectura
del backend no se acusa a nadie de estar mal configurado, para no enseñar un aviso que
desaparece solo un segundo después.

**Lo que bloquea se resuelve donde aparece.** Si falta conectar la cuenta, el panel de
conexión sale en Inicio, no detrás de una pestaña: mandar a la persona a otra sección para
poder empezar es pedirle que adivine. Cuando todo funciona, ese panel desaparece de Inicio y
solo vive en Sistema.

**Los errores traen su salida.** `SystemAlertBanner` usa la clasificación que ya hacía
`lib/user-errors.ts` (que hasta ahora solo se leía) para poner junto al aviso el botón que lo
arregla: reintentar, conectar ChatGPT, comprobar la red o abrir Sistema. El mensaje técnico
original sigue estando, plegado, para soporte.

**Estado de voz sin ambigüedad.** No se ha tocado `lib/voice-status.ts` ni `useVoice`: el
ciclo escuchando → transcribiendo → pensando → ejecutando → hecho/error ya estaba resuelto
ahí y `VoiceConsole` lo pinta. Lo que se ha hecho es dejar de recalcularlo con ternarios
anidados dentro del JSX (`resolveAgentState`, `resolveBlockedReason` en `lib/shell-state.ts`,
con tests) y propagar el mismo `blockedReason` al campo de texto, que ahora dice por qué está
apagado en vez de quedarse gris sin explicación.

**Accesibilidad.** Landmarks (`<header>`, `<nav aria-label>`, `<main id="contenido">`) y enlace
"Saltar al contenido" como primer tabulador. `aria-current` en la sección y el escritorio
activos: el estado nunca se comunica solo por color. El anuncio de estado del agente sale de
la misma fuente que el texto visible (`status.announcement`), y el historial es `role="log"`
navegable con teclado que anuncia **solo la respuesta terminada** — hacer live region del
streaming lo volvería ilegible con lector de pantalla. El campo manual de login y el composer
tienen etiqueta asociada; el botón del micro nunca se deshabilita del todo, para que se pueda
llegar a él y oír por qué no se puede hablar.

**Rendimiento.** El arranque vive en `useShellBoot`, que lee sus pasos de una ref: corre una
vez y ninguna identidad de callback lo reinicia. `useShellActions` concentra los handlers y
depende siempre de funciones estables y valores sueltos, nunca del objeto del hook. Los
clientes se construyen a nivel de módulo (`lib/clients.ts`). Con eso, escribir en el composer
repinta el composer y el árbol de la vista, pero no la barra, ni el conmutador de escritorios,
ni el orbe, ni el historial. El test `escribir no vuelve a arrancar el shell` sigue vigilando
la regresión.

**Un solo sistema de estilos.** No se ha añadido ninguna dependencia. Al contrario: los
paneles de agente, backend y diagnóstico usaban su propia paleta (`text-white/35`,
`bg-black/20`, `rounded-lg`, `glass-panel`) y ahora usan los tokens y las primitivas. Como
consecuencia, los alias heredados `.glass-panel` / `.glass-input` de `styles.css` se quedaron
sin referencias y se han borrado, tal como anunciaba su propio comentario.

**Diagnóstico dentro de la barra.** El botón flotaba fijo sobre el contenido y se solapaba con
la zona de avisos; ahora es una acción más de la barra de sistema.

## Tests

Todo en verde, sin tests vaciados ni borrados:

```
bun run test  →  bun: 132 pass / 0 fail (13 ficheros)
                 vitest: 98 pass / 0 fail (16 ficheros)
```

Partida: 113 bun + 55 vitest. Añadidos **43 tests de renderer** y **19 de módulo puro**.

Tres tests de `App.test.tsx` se adaptaron al refactor conservando lo que verificaban:

| Antes | Ahora | Por qué |
|---|---|---|
| `name: "Conectar ChatGPT con codigo"` | `name: "Conectar ChatGPT"` | La etiqueta perdió el "con codigo" (el método por código es el único) y recuperó su acento. |
| `findByLabelText("Texto")` | `findByLabelText("Escribe a Pi")` | El input tiene ahora etiqueta real en vez de un "Texto" sin significado. |
| checklist de salud en Inicio | click en "Sistema" y luego la misma checklist | La checklist técnica se movió a Sistema; el test navega y comprueba exactamente los mismos ítems. |

Comprobaciones adicionales: `tsc --noEmit` limpio en ambos `tsconfig` (salvo el error
preexistente de `dbus-next` en `components/network/node`, fuera de este frente) y
`vite build` correcto.

## Commits

```
a1711fa refactor(ui): extract the shell chrome into a top bar and boot screen
335cf33 refactor(ui): give system errors a way out
8a8ea97 refactor(ui): extract the account connection panel
76a3280 refactor(ui): derive the shell state in a pure module
493a9d7 refactor(ui): extract the composer and the conversation history
8bf964a refactor(ui): compose the shell from a home and a system view
40fd102 test(ui): cover what the home screen decides to show
fe93ff7 style(ui): dress the agent panels with the shared design system
c094ad8 style(ui): retire the ad-hoc palette from the admin surfaces
```

## Pendiente

- **`App.tsx` son 182 líneas, no <150.** Lo que queda es cableado real: cinco hooks de estado,
  tres derivaciones y la composición. Bajar de ahí exigía o un `useShell()` que se tragara todo
  el cuerpo (mover el problema, no resolverlo) o agrupar props hasta volver opacos los
  contratos. Preferí parar con todas las líneas justificadas.
- **`AgentAdminPanel` y `AgentBackendSetupPanel`** ya usan los tokens, pero su maquetación
  sigue siendo propia (secciones y rejillas a mano en vez de `Panel`/`PanelInset`). Es el
  siguiente candidato natural y no lo toqué para no mezclarlo con este frente.
- **El modal de diagnóstico** no atrapa el foco ni se cierra con Escape.
- **`AgentOnboardingPanel` y `AgentHealthChecklist` siguen con textos sin tildes**
  ("Diagnostico", "configuracion", "Codex/Auth"): son cadenas que verifican sus tests y
  merecen una pasada de copy propia, no un `sed` de paso.
- **La respuesta de Pi no se lee en voz alta**: `lib/speech-bridge.ts` existe pero nadie lo
  usa. En una interfaz voice-first es el hueco más grande que queda.
