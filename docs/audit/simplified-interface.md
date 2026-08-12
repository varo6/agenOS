# ws12-simple — Menos interfaz, más Pi

Rama `ws12-simple`. Trabajo de superficie y contenido sobre `components/ui/src/**`
(sin tocar `src/electron/**`). La arquitectura del refactor previo se mantiene:
`App.tsx` sigue siendo composición, las reglas puras siguen en `lib/`, la
presentación en `components/shell/` y los tokens en `styles.css`.

---

## 1. Qué había de más y por qué sobraba

### La barra fija llevaba cinco cosas y ninguna era para el usuario

Era la única franja permanente de la pantalla y contenía: el logotipo "AgenOS",
la navegación, **cinco escritorios numerados**, el **identificador del modelo**
(`gpt-5.4-mini`, en monoespaciada) y una **pastilla de estado de cuenta**, más un
botón "Diagnostico". Cuatro de esos cinco elementos son información *sobre la
máquina*, permanentemente encima de la pantalla que sirve para *hablar*.

- **Escritorios numerados** → un "3" suelto es un concepto del gestor de ventanas,
  no una tarea. Además Pi cambia de escritorio hablando. Se van a Sistema, ahora
  con el nombre escrito al lado del número y 56 px de alto.
- **Identificador de modelo** → ficha técnica pura. A Sistema, junto a la cuenta.
- **Pastilla de estado** → cuando todo va bien dice "Conectado", que es ruido; y
  cuando algo va mal, Inicio ya enseña un bloque grande con la solución, así que
  duplicaba el mensaje. Sustituida por un aviso en la pestaña Sistema, que además
  **se dice con palabras** (`aria-label="Sistema, necesita atención"`) y no solo
  con un punto de color.
- **Botón "Diagnostico"** → herramienta de soporte, no de uso diario. A Sistema.
- **Logotipo** → no ayuda a nadie a hacer nada. Fuera.

La barra queda en **dos botones**. Nada más.

### Inicio pedía cinco caminos cuando solo uno era posible

Con la cuenta sin conectar, la pantalla mostraba a la vez: saludo + párrafo,
orbe de micrófono (apagado), campo de texto (apagado), tarjeta de "siguiente
paso" con dos botones, panel de cuenta completo con **cuatro botones más**
(Conectar / Cancelar login / Refrescar estado / Cerrar sesión) y un panel de
conversación vacío. **Ocho botones mientras la persona no podía hacer nada.**

Ahora Inicio tiene dos caras y nunca las dos a la vez:

- **Falta algo** → la pantalla *es* ese algo: un titular, una frase y un botón
  grande. El panel de cuenta solo baja cuando hay un **código que copiar**, y en
  versión reducida (sin "Actualizar" ni "Cerrar sesión": caminos que no llevan a
  ninguna parte en ese momento).
- **No falta nada** → micrófono, campo de texto y, solo si ya hay historial, la
  conversación.

### El panel de conversación vacío

Cuatro líneas de decoración (eyebrow "Conversación" + título "Lo que has hablado
con Pi" + descripción "Se guarda en este equipo y sobrevive a los reinicios." +
estado vacío) para envolver cero contenido, en la primera pantalla que ve la
persona. Ahora **no se pinta hasta que hay algo que recordar**. El estado vacío
del componente se conserva (lo usan otras rutas y su test).

### El párrafo de bienvenida

"Dime qué necesitas y lo hago en este equipo: abrir aplicaciones, buscar archivos
o cambiar de escritorio." Enseñaba algo útil (qué se puede pedir) pero competía
con el texto del propio orbe, que dice lo mismo con menos. La enseñanza se mudó
al **placeholder del campo**: `Por ejemplo: abre el navegador`. Un elemento que
ya existía haciendo dos trabajos, y una línea menos en pantalla.

### El modo degradado se comía la pantalla entera

`resolveShellReadiness` trataba `degraded` igual que `needs_setup` y bloqueaba
Inicio. Pero según el propio contrato del proyecto, *degradado ≠ fatal*: el
servicio sigue atendiendo turnos. Quitarle la pantalla a la persona por un
problema que no le impide hablar es castigarla por algo que no es suyo. Ahora
**degradado no bloquea**; se señala en la pestaña Sistema (`needsSystemAttention`,
regla pura y probada) y se detalla dentro.

### Errores crudos del servicio en la pantalla principal

`AgentOnboardingPanel` volcaba `backendError` ("Failed to fetch"),
`degradedReason` y `setupItems[0].label` — este último **en inglés y de
ingeniería** ("Connect backend Codex auth for OpenClaw."). Nada de eso llega ya a
Inicio. Sigue disponible en Sistema, que es donde alguien puede usarlo. Hay tests
que lo verifican explícitamente (`queryByText("Failed to fetch")` ausente).

---

## 2. Textos: antes → después

### Jerga eliminada de la superficie principal

| Dónde | Antes | Después |
|---|---|---|
| Salud → servicio | **Backend** / "Broker local disponible" / "La UI puede hablar con el servicio local." | **Servicio de Pi** / "Funcionando" / "El broker local responde en 127.0.0.1:4173." |
| Salud → motor | **Worker** / "Worker listo" / "agenos-bun-worker / cola 0" | **Motor de tareas** / "Listo" / "Modo agenos-bun-worker, 0 en cola." |
| Salud → motor | "Setup requerido" / "Servicio inactivo" / "Modo degradado" | "Falta configurarlo" / "Parado" / "Funciona a medias" |
| Salud → cuenta | **Codex/Auth** / "Login en curso" / "Requiere atencion" | **Tu cuenta** / "Conectando" / "Necesita atención" |
| Salud → soporte | "Diagnostico listo" / "El bundle de soporte se puede copiar desde la esquina superior." | "Informe disponible" / "Puedes copiar el informe técnico para pedir ayuda." |
| Paso pendiente | "Backend no disponible" + volcado de `backendError` | "Pi no está disponible" / "Espera unos segundos y vuelve a intentarlo." |
| Paso pendiente | "Leyendo backend" / "Estoy cargando el estado del broker y del worker." | "Un momento" / "Estoy comprobando que todo esté listo." |
| Paso pendiente | "Setup del backend" / `setupItems[0].label` (inglés) | "Falta terminar la configuración" / "Ábrela en Sistema y lo dejamos listo." |
| Paso pendiente | "Backend en modo degradado" / `degradedReason` (inglés) | "Pi funciona a medias" / "Puedes usarlo, pero conviene revisarlo." |
| Paso pendiente | "Completa el login de Codex" / "Termina el flujo de navegador o pega el codigo manual si el callback no vuelve solo." | "Termina de conectar tu cuenta" / "Abre el enlace y escribe el código." |
| Paso pendiente | "Conecta ChatGPT/Codex" / "El backend esta listo. Solo falta iniciar sesion para activar el chat y el micro." | "Conecta tu cuenta" / "Es el último paso para poder hablar con Pi." |
| Paso pendiente | "Agente listo" / "Backend, worker y login local estan disponibles. Ya puedes escribir o usar el micro." | "Todo listo" / "Ya puedes hablar con Pi." |
| Soporte | "Diagnostico" / "Diagnostico de AgenOS" / "Produccion" / "Comandos utiles" | "Ver informe técnico" / "Informe técnico" / "Cópialo y envíaselo a quien te dé soporte." / "Comandos útiles" |
| Campo apagado | "AgenOS no responde ahora mismo. Abre Sistema para revisarlo." | "Pi no responde ahora mismo." |

De paso se arreglaron las tildes que faltaban en toda la superficie
(`configuracion`, `esta`, `codigo`, `Diagnostico`, `Produccion`, `atencion`…).

### Botones: verbo y lenguaje llano

| Antes | Después |
|---|---|
| "Refrescar salud" | "Reintentar" |
| "Refrescar estado" | "Actualizar" |
| "Cancelar login" | "Cancelar" |
| "Conectar ahora" | "Conectar" |
| "Diagnostico" (icono + palabra técnica) | "Ver informe técnico" |
| "Refrescar" / "Copiar" (modal de soporte) | "Actualizar" / "Copiar", ambos como botones del sistema de diseño |

### Menos verbosidad (misma información)

| Dónde | Antes | Después |
|---|---|---|
| Arranque | "Un momento: estoy comprobando el micrófono, la red y tu cuenta." | "Un momento." |
| Voz · escuchando | "Habla con normalidad; pararé cuando termines." | "Habla con calma." |
| Voz · transcribiendo | "Entendiendo lo que has dicho" / "Un momento, estoy pasando tu voz a texto." | "Estoy entendiéndote" / "Un momento." |
| Voz · trabajando | "Puede tardar unos segundos." | "Un momento." |
| Voz · pensando | "Preparando la respuesta." | "Un momento." |
| Voz · hecho | "Ya puedes volver a hablarle." | "Pulsa para hablar otra vez." |
| Voz · sin red | "Sin conexión a internet" / "Conecta AgenOS a una red wifi y podrás hablar con Pi." | "Sin internet" / "Conéctate a una red wifi." |
| Voz · sin cuenta | "Conecta ChatGPT para activar el micrófono." | "Conecta ChatGPT para hablar." |
| Voz · sin micro | "Micrófono no disponible" / "Puedes escribirle a Pi mientras tanto." | "El micrófono no funciona" / "Escríbele a Pi aquí abajo." |
| Error · servicio caído | "El servicio interno se está reiniciando o se ha caído. Espera unos segundos y vuelve a intentarlo." | "Espera unos segundos y vuelve a intentarlo." |
| Error · sesión caducada | "Tu cuenta ha dejado de estar conectada" / "Vuelve a conectar ChatGPT para seguir hablando con Pi." | "Tu cuenta se ha desconectado" / "Vuelve a conectar ChatGPT." |
| Error · login | "Inténtalo otra vez. Si el navegador no vuelve solo, pega el código a mano." | "Inténtalo otra vez." |
| Error · desconocido | "Vuelve a intentarlo. Si se repite, abre Sistema y copia el diagnóstico." | "Vuelve a intentarlo." |
| Cuenta · conectada | "Tu cuenta está lista: ya puedes hablar con Pi." | "Ya puedes hablar con Pi." |
| Cuenta · autorizando | "Termina el inicio de sesión en el navegador o pega aquí el código." | "Termina de conectarla en el navegador." |
| Cuenta · manual | "Si el navegador no vuelve solo, copia aquí la dirección a la que te ha llevado." | "Copia aquí la dirección que te muestre el navegador." |
| Composer | "O escríbeselo aquí…" | "Por ejemplo: abre el navegador" |
| Conversación | eyebrow + "Lo que has hablado con Pi" + "Se guarda en este equipo y sobrevive a los reinicios." | "Conversación" |

El botón que arregla cada fallo está siempre al lado, así que la ayuda ya no
tiene que explicar además cómo llegar hasta él.

---

## 3. Tipografía, contraste y objetivos táctiles

Todo con valores concretos, en `styles.css` y en los primitivos.

### Escala tipográfica

Se redefinió la **escala completa de Tailwind** en `@theme` en vez de retocar
clase por clase: así ningún componente se puede quedar atrás, ni los que no toqué.

| Token | Antes | Ahora | Interlineado |
|---|---|---|---|
| `text-xs` | 12 px | **15 px** | 1.55 |
| `text-sm` (cuerpo) | 14 px | **17 px** | 1.60 |
| `text-base` | 16 px | **19 px** | 1.65 |
| `text-lg` | 18 px | 22 px | 1.5 |
| `text-xl` | 20 px | 26 px | 1.4 |
| `text-2xl` | 24 px | 30 px | 1.3 |
| `text-3xl` | 30 px | 36 px | 1.25 |
| `text-4xl` | 36 px | 44 px | 1.15 |
| `text-5xl` | 48 px | 56 px | 1.1 |

- `body` pasa a `17 px / 1.6` explícito.
- `.eyebrow`: de **10 px** con `letter-spacing: 0.24em` a **13 px** con `0.12em`
  (a 10 px en versalitas no se leía; el tracking exagerado lo empeoraba).
- **Suelo real: 15 px.** Ya no queda ningún `text-[10px]` ni `text-[11px]` en el
  shell; los paneles de administración usan ahora el token `.eyebrow` compartido.

### Contraste (WCAG AAA)

| Token | Antes | Ahora | Ratio sobre lienzo `#06080d` |
|---|---|---|---|
| `--color-ink` | `rgba(255,255,255,.96)` | `.98` | **20.6:1** |
| `--color-ink-muted` | `.74` (≈10.8:1) | `.84` | **13.8:1** |
| `--color-ink-faint` | `.58` (≈7.0:1) | `.70` | **10.3:1** |

Los tres superan AAA (7:1) con margen deliberado. El margen hacía falta porque el
ratio calculado **no era el ratio real**:

- Los paneles eran translúcidos (`rgba(255,255,255,.038)`) sobre un **vídeo de
  fondo**, así que el contraste del texto dependía del fotograma. Ahora `.panel`
  pinta una base opaca (`rgba(6,8,13,.86)` + película clara) y `--color-sunken`
  sube de `.5` a `.78` de opacidad.
- El vídeo baja de `opacity-75` a **`opacity-40`** y el velo oscuro sube a
  `0.72 / 0.55 / 0.82`. Es ambiente, no contenido.
- `::placeholder` sube de `.38` a `.55` de blanco.
- `button:disabled` sube de `opacity: .45` a `.6`: un botón apagado tiene que
  poder leerse.
- Foco visible: contorno de **2 px → 3 px**, `outline-offset` 2 → 3 px.

### Objetivos táctiles

| Elemento | Antes | Ahora |
|---|---|---|
| `.btn` (todas las variantes) | sin mínimo (~34 px) | **`min-height: 44px`**, peso 500 → 600 |
| `Button size="sm"` | `py-1.5` + 13 px | **44 px** + 17 px |
| `Button size="md"` | `py-2.5` + 14 px | **48 px** + 17 px |
| `Button size="lg"` | `py-3` + 16 px | **56 px** + 19 px |
| Pestañas de la barra | `py-1.5` (~30 px) | **48 px**, 19 px |
| Botones de escritorio | 32 × 32, solo número | **56 px de alto**, número **+ nombre** |
| Cerrar aviso (Alert) | `p-1.5` (~28 px) | **44 × 44** |
| Cerrar informe técnico | `p-2` (~36 px) | **44 × 44** |
| `.field-input` | `padding .7rem` | **`min-height: 48px`**, 17 px |
| Desplegable de detalles | — | **~63 px** de alto |
| Enlace "Saltar al contenido" | `py-2` + 14 px | **48 px** + 19 px |
| Código de dispositivo | 18 px | **30 px** monoespaciada |
| **Orbe de micrófono** | 128 / 160 px, icono 36/44 px | **160 / 208 px**, icono **48/64 px**, título **30/36 px** |

`sm` deja de significar "pequeño" y pasa a significar "secundario": sigue siendo
pulsable, solo pesa menos en la jerarquía. Hay un test que lo fija.

---

## 4. Jerarquía: Inicio vs Sistema

```
BARRA FIJA          [ Inicio ] [ Sistema ● ]        ← dos destinos, nada más
                                        └ el punto solo aparece si algo necesita
                                          atención, y se anuncia con palabras

INICIO — cara A (falta algo)        INICIO — cara B (todo listo)
  ┌───────────────────────┐          Hola, soy Pi          (solo la 1ª vez)
  │ ⚙ Conecta tu cuenta   │
  │ Es el último paso...  │                 ◯               orbe 160/208 px
  │ [ Conectar ]          │           Pulsa para hablar
  └───────────────────────┘           O escríbele aquí abajo
  (+ el código, solo si lo hay)
                                     [ Por ejemplo: abre el navegador ] [Enviar]

                                     Conversación          (solo si hay turnos)

SISTEMA
  Sistema
  ├─ Tu cuenta          ← conectar / actualizar / cerrar sesión + proveedor y modelo
  ├─ Escritorios        ← botones grandes con número y nombre
  └─ ▸ Detalles técnicos   (plegado; se abre con teclado y se queda abierto)
       ├─ Estado del sistema   (checklist: servicio, motor, cuenta, soporte)
       ├─ Soporte              (informe técnico)
       └─ Panel de administración
```

**Regla que ordena el reparto:** en Inicio solo vive lo que sirve para hablar con
Pi *ahora*. En Sistema, lo que sirve para entender o arreglar la máquina. Y dentro
de Sistema, dos niveles: arriba lo que una persona puede necesitar tocar (su
cuenta, su escritorio); plegado, lo que solo toca quien depura.

### Lo que no se ha roto

- **Panel de administración, diagnóstico y checklist de salud**: intactos en
  funcionalidad, agrupados bajo "Detalles técnicos" en Sistema. Se usa un
  `<details>` nativo: se abre con teclado, se anuncia como botón, y una vez
  abierto se queda abierto. Nada depende de un tooltip ni desaparece solo.
- **Estado de voz**: la máquina de estados (escuchando → transcribiendo →
  pensando → ejecutando → hecho/error) no se ha tocado; solo se han acortado los
  textos. Sigue habiendo icono distinto por fase, texto visible y anuncio
  `aria-live` desde la **misma fuente**, así que nunca se contradicen.
- **Accesibilidad**: se conservan `main#contenido`, el enlace de salto (ahora más
  grande), `aria-live`/`role="status"`, `role="log"` del historial, `aria-current`
  en secciones y escritorios, y el orbe que sigue siendo alcanzable con
  `aria-disabled` en vez de `disabled` para que un lector de pantalla pueda leer
  el motivo. **Añadido**: la cara de "falta un paso" tiene su propio `h1`
  (`Falta un paso para hablar con Pi`) para no dejar un `main` sin encabezado, y
  el aviso de la pestaña Sistema se dice con palabras además de con color.
- **Nada castiga la lentitud**: no hay temporizadores nuevos, ni confirmaciones
  que se cierren solas, ni información accesible únicamente por tooltip. El
  `title` de los botones de escritorio se sustituyó por texto visible.

---

## 5. Commits

| Hash | Commit |
|---|---|
| `fa8308b` | `style(ui): raise the type scale, contrast and touch targets` |
| `315b330` | `copy(ui): say what happened instead of naming the machinery` |
| `54a767b` | `refactor(ui): move the machine surfaces into Sistema` |
| `d7be787` | `feat(ui): give Inicio one purpose and one path` |
| `a990cbe` | `style(ui): size the microphone like the main gesture it is` |
| `4305241` | `test(ui): cover the Sistema layout and its folded technical group` |

36 ficheros, +964 / −562.

---

## 6. Tests

```
bun run test   →  17 files, 109 tests  ✅   (renderer, vitest)
bun test src/lib dev →  15 files, 134 tests  ✅   (backend, bun)
tsc --noEmit   →  limpio*
```

*Los tres únicos errores de `tsc` son `Cannot find module 'dbus-next'` en
`components/network/node/network-manager.ts`, preexistentes y fuera de este
worktree.

Se partió de **99 tests de renderer**; ahora hay **109**. Ninguno se vació ni se
borró: los que comprobaban un texto que cambié se adaptaron conservando lo que
verificaban, y varios se reforzaron.

**Tests adaptados** (mismo propósito, copia o ubicación nueva):

- `AgentOnboardingPanel.test` — las tres pruebas mantienen la prioridad que
  verificaban (servicio caído > configuración > login) y ahora **además**
  comprueban que el texto crudo en inglés no se filtra a la pantalla.
- `AgentHealthChecklist.test` — mismas cuatro comprobaciones, nombradas en
  castellano; **añadido** un test de que el dato técnico sigue presente como
  tercera línea (es lo que hace falta para la defensa).
- `TopBar.test` — se conservan navegación y `aria-current`; las pruebas de
  pastilla de cuenta y modelo se **movieron** a `SystemView.test` y
  `ConnectionPanel.test`, que es donde vive ahora esa información.
- `App.test` — los dos tests de escritorios pasan por Sistema; el de refresco de
  estado usa la ruta nueva (Inicio para conectar, Sistema para actualizar).
- `HomeView.test` — el test del campo apagado usa `busy` en vez de `offline`
  (con la cuenta sin conectar ya no hay campo: esa es justamente la mejora).
- `shell-state.test` — `degraded` pasa de esperar `blocked` a esperar `ready`,
  con el porqué escrito al lado.

**Tests nuevos** (10):

- Ningún tamaño de botón baja de 44 px.
- La barra no carga estado del equipo; avisa con palabras cuando hace falta.
- `needsSystemAttention`: 4 casos (todo bien / sin lectura / degradado / caído).
- Inicio sin cuenta es *solo* el paso que falta (sin micro ni campo al lado).
- El panel de cuenta solo baja cuando hay código, y sin acciones de mantenimiento.
- Con el servicio a medias se puede seguir hablando.
- Sin conversación no se pinta el historial.
- La cara de "falta un paso" tiene título y landmark.
- `SystemView.test` completo (4): orden, cuenta en palabras, escritorios con
  nombre, y lo técnico plegado pero montado y alcanzable.

---

## 7. Qué queda pendiente

1. **`AgentAdminPanel` y `AgentBackendSetupPanel` siguen en inglés técnico**
   ("Setup requerido", "Conectar Codex backend", "Telegram bot token", "Policy
   rules"). Es deliberado: son la consola de administración, están doblemente
   anidados (Sistema → Detalles técnicos) y su público es quien defiende el
   proyecto, no quien usa el portátil. Solo se les ha normalizado la tipografía.
   Si se quisiera, merecerían su propia pasada de copia.
2. **La pantalla de red** (`components/network/react/NetworkConnectionPanel`)
   queda fuera de mi territorio y no se ha revisado. Es la primera pantalla que
   ve alguien sin wifi, así que debería recibir el mismo tratamiento de tamaño y
   contraste.
3. **Verificación visual real**: todo está validado por tests y por cálculo de
   ratios, pero no se ha arrancado la UI (no se lanzan builds de ISO). Convendría
   una pasada en la VM, sobre todo para el orbe a 208 px en pantallas pequeñas y
   para el vídeo de fondo al 40 %.
4. **Sin ajuste de tamaño de letra por el usuario.** La escala está subida para
   todos, pero un control de "letra más grande" en Sistema sería el siguiente
   paso natural para este público.
5. **El historial se limita a `max-h-[28rem]` con scroll interno.** Con el cuerpo
   a 17 px caben menos turnos; habría que revisar si conviene paginar o dejar que
   crezca con la página.
