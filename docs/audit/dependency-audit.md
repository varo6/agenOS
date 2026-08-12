# Auditoría de dependencias y supply chain — ws6-deps

Fecha: 2026-08-13

Rama/worktree: `ws6-deps` / `/home/varo/code/agenOS/.worktrees/ws6-deps`

Base objetivo: Debian 12 Bookworm, Bun, Electron y React

## Resumen ejecutivo

- No hay un binario **obligatorio** invocado por TypeScript/Python/Rust que quede ausente al resolver la selección actual de Debian 12 con `LB_APT_RECOMMENDS="true"`.
- Hay tres dependencias de ejecución demasiado implícitas: `xdg-open`, `xhost` y `pkill`. Hoy llegan, respectivamente, por dependencias/Recommends de Chromium y por el sistema base de prioridad `important`; deben declararse explícitamente como `xdg-utils`, `x11-xserver-utils` y `procps` para que no desaparezcan si cambia Chromium o la política de Recommends.
- No hay invocaciones de `brightnessctl`, `wl-copy`, `wl-paste`, `pactl` ni `wpctl` en el árbol auditado.
- No hay invocaciones de procesos externos desde Python. Sí hay invocaciones adicionales desde Rust, incluidas en la tabla para que el inventario sea completo.
- Se eliminaron `debug` y `x11` del paquete de red porque no existe ningún import; se declararon sus imports React como peers.
- Se eliminaron copias directas redundantes de `dbus-next` en UI e installer. La dependencia canónica queda en `components/network` y `components/network/node`, que son los paquetes que realmente la importan y que los scripts de build instalan antes de compilar.
- `@openai/codex` pasó a `devDependencies`: el código JS no lo importa; `scripts/build-ui.sh` extrae su binario durante el empaquetado y lo copia a `/opt/agenos/system/codex-bin/codex`.
- Se aplicaron actualizaciones compatibles y acotadas: Pi `0.68.1`, React `19.2.8`, Vite `7.3.6`, Vitest `3.2.7` y plugin React de Vite `5.2.0`.
- `bun audit` bajó de 115 hallazgos por cada app a 94 (UI) y 93 (installer). Esto elimina duplicación en sus locks, pero el riesgo de `dbus-next` sigue existiendo en los paquetes de red que realmente usa la ISO.
- No se editó ninguna lista de paquetes Debian ni ningún fichero excluido por la misión. No se ejecutó ningún build de ISO.

## Método y límites

Se buscaron, fuera de `node_modules`, chroot, caches, binarios y generados:

```text
spawn(, spawnSync(, execFile, execFileSync, exec(, execSync(
Bun.spawn, subprocess.*, os.system, Command::new
```

También se inspeccionaron comandos construidos dinámicamente, candidatos/fallbacks y `.desktop` `Exec=`. Se contrastó cada binario contra las tres listas `*.list.chroot`, el cierre conocido de dependencias Bookworm y los hooks de chroot. La columna “lista” significa presencia literal en `package-lists`; “efectivo” refleja cómo llega realmente a la imagen.

## Inventario completo de binarios invocados

| Binario | Dónde se invoca | Paquete/proveedor | ¿En la lista? | Disponibilidad efectiva y acción |
|---|---|---|---|---|
| `/bin/bash` o `$SHELL` | `components/agent/shell.ts:59,71` | `bash` | Sí: `base` | Garantizado. El comando interior es entrada controlada por la herramienta y, por definición, no admite un inventario estático cerrado. |
| `swaymsg` | `components/agent/workspaces.ts:143,174`; `components/agent/apps.ts:542,557`; `tools/agenos-shell-rust/src/bin/server.rs:295,512,532` | `sway` | Sí: `desktop-installer` | Garantizado. |
| `chromium`, `/usr/bin/chromium` | `components/agent/browser-launcher.ts:29-36,150` | `chromium` | Sí: `desktop-installer` | Garantizado; es el candidato preferente disponible en Debian. |
| `google-chrome`, `google-chrome-stable` | `components/agent/browser-launcher.ts:30-31` | Repositorio externo de Google | No | Fallback opcional con `commandExists`; no añadir para AgenOS. |
| `chromium-browser`, `/usr/bin/chromium-browser`, `/snap/bin/chromium` | `components/agent/browser-launcher.ts:33-36` | Alias Ubuntu/Snap | No | Fallbacks opcionales; no son rutas Bookworm y no se invocan si no existen. |
| `foot` y `/usr/bin/foot` | `components/agent/apps.ts:109`; `tools/agenos-shell-rust/src/bin/helper.rs:110` | `foot` | Sí: `desktop-installer` | Garantizado. |
| `x-terminal-emulator` | `components/agent/apps.ts:110` | virtual `x-terminal-emulator`, provisto por `foot` | Indirecto | Garantizado por el paquete explícito `foot`. |
| `gnome-terminal`, `konsole`, `xfce4-terminal` | `components/agent/apps.ts:111-113` | paquetes homónimos | No | Fallbacks opcionales y comprobados antes de spawn. |
| `xdg-open` | `components/agent/files.ts:53`; `components/agent/apps.ts:121` | `xdg-utils` | No | Instalado por dependencia dura `chromium -> chromium-common -> xdg-utils`. Añadir explícitamente. |
| `nautilus`, `dolphin`, `thunar` | `components/agent/apps.ts:122-124` | paquetes homónimos | No | Fallbacks opcionales; la ISO no promete un file manager dedicado. |
| `gtk-launch` | `components/agent/apps.ts:278,698-700` | `libgtk-3-bin` | No | Opcional y comprobado. Llega hoy por `Recommends` de `libgtk-3-0` porque `LB_APT_RECOMMENDS=true`; no es requisito para el fallback directo por `Exec=`. |
| `gio` | `components/agent/apps.ts:278,704-706` | `libglib2.0-bin` | No | Opcional y comprobado; si falta se usa el `Exec=` directo. |
| comando de `Exec=` de una app | `components/agent/apps.ts:173-205,721`; `tools/agenos-shell-rust/src/bin/server.rs:660-672` | paquete propietario del `.desktop` | Dinámico | Solo se descubren entradas instaladas y ejecutables. No hay paquete único que añadir. |
| `apt-get` | `components/agent/apps.ts:736,752,778` | `apt` | No | Garantizado por la base Debian (`Priority: required`). |
| `sudo` | `components/agent/apps.ts:452-470` | `sudo` | Sí: `base` | Garantizado. |
| `pkexec` | `components/agent/apps.ts:458`; `components/installer-ui/src/shared/system-services/switch-mode.ts:25`; `maintenance.ts:34`; `installer/launch.ts:39`; Rust `server.rs:303` | `pkexec`, dependencia de `policykit-1` | Sí: `desktop-installer` (`policykit-1`) | Garantizado. |
| `/usr/local/bin/agenos-shell-helper`, `agenos-installer-helper` | servicios compartidos TS y Rust `server.rs:330,336`; `emergency.rs:204` | artefactos propios de `scripts/build-agenos-shell.sh` | N/A | No son Debian; el empaquetado propio debe seguir verificándolos. |
| `codex` | `components/ui/dev/pi-harness.ts:563`; `tools/pi-harness-eval/src/codex-direct.ts:59`; setup fallback `components/installer-ui/src/bun/agent/setup.ts:210-214,281` | `@openai/codex` / binario empaquetado | No | ISO: garantizado por `scripts/build-ui.sh:186-204,238`. El harness de `tools/pi-harness-eval` no lo declara y depende del PATH: documentar prerrequisito o añadir manifest+lock propios. |
| `arecord` | `components/ui/src/electron/main.ts:368-408` | `alsa-utils` | Sí: `base` | Garantizado. |
| `whisper-cli`, `whisper-cli-baseline` | `components/ui/src/electron/main.ts:314-408`; `components/installer-ui/src/bun/speech/stt.ts:54-61,211-321` | build propio de whisper.cpp | No | Garantizado por `scripts/build-ui.sh`, que compila ambos binarios y empaqueta el modelo en `/opt/agenos/system/whisper.cpp`. |
| `ffmpeg` | `components/installer-ui/src/bun/speech/stt.ts:68-70,232-239,282-317` | `ffmpeg` | Sí: `base` | Garantizado. |
| `systemctl` | `components/installer-ui/src/bun/diagnostics/support-bundle.ts:66-67`; Rust `helper.rs:136` | `systemd` | Indirecto | Garantizado por `systemd-sysv`, presente en `live` y con `Pre-Depends: systemd`. |
| `journalctl` | `components/installer-ui/src/bun/diagnostics/support-bundle.ts:68-69` | `systemd` | Indirecto | Igual que `systemctl`. |
| `openclaw` | `components/installer-ui/src/bun/agent/worker/openclaw-runtime.ts:11,64,79,238`; setup `setup.ts:196-214,281` | instalación npm fijada por hook | No | Garantizado por `0900-install-openclaw.hook.chroot`, que fija `2026.6.11` y valida `/usr/bin/openclaw`. |
| `npm` | `components/installer-ui/src/bun/agent/worker/openclaw-runtime.ts:94-99` | NodeSource `nodejs` instalado por hook | No | Fallback de auto-instalación, no package manager del proyecto. El hook instala Node 22/npm si hace falta. |
| `bun` | `components/installer-ui/src/bun/dev.ts:18-19` | Bun | No | Solo desarrollo. En la ISO, `scripts/build-installer-ui.sh` copia el Bun del builder a `/opt/agenos/installer/bin/bun`. |
| `xhost` | `components/installer-ui/src/bun/installer/calamares.ts:138,146` | `x11-xserver-utils` | No | Llega hoy por `xdg-utils Recommends x11-xserver-utils` con Recommends habilitados. Añadir explícitamente: es requisito de la ruta Calamares sobre X11. |
| `getent` | `components/installer-ui/src/bun/installer/gui-env.ts:36` | `libc-bin` | No | Garantizado: `libc-bin` es `Essential: yes`. |
| `lsblk` | `components/installer-ui/src/bun/installer/disks.ts:118` | `util-linux` | No | Garantizado: `util-linux` es `Essential: yes`. |
| `/usr/bin/calamares` | `components/installer-ui/src/bun/installer/calamares.ts:195,211` | `calamares` | Sí: `desktop-installer` | Garantizado. |
| `pkill` | `tools/agenos-shell-rust/src/bin/helper.rs:115` | `procps` | No | Presente en el sistema base porque `procps` tiene `Priority: important`. Añadir explícitamente para hacer visible el contrato de reload. |
| binarios internos de emergencia | `tools/agenos-shell-rust/src/bin/emergency.rs:119-124` | `/opt/agenos/...` / `/usr/local/bin/...` | N/A | Constantes de artefactos producidos por el repo, no paquetes Debian. |

Notas de resolución Debian:

- `chromium-common` depende de `xdg-utils`; `xdg-utils` recomienda `x11-xserver-utils`.
- `build/live-build/config/common:16` conserva Recommends con `LB_APT_RECOMMENDS="true"`.
- `libgtk-3-0` recomienda `libgtk-3-bin`.
- `procps` es prioridad `important`; `apt` prioridad `required`; `libc-bin` y `util-linux` son Essential.

Fuentes Debian consultadas: [x11-xserver-utils](https://packages.debian.org/bookworm/x11-xserver-utils), [procps](https://packages.debian.org/bookworm/procps), [xdg-utils](https://packages.debian.org/bookworm/xdg-utils), [chromium-common](https://packages.debian.org/bookworm/amd64/chromium-common), [libgtk-3-bin](https://packages.debian.org/bookworm/libgtk-3-bin), [libc-bin](https://packages.debian.org/bookworm/amd64/libc-bin/filelist) y [util-linux](https://packages.debian.org/bookworm/amd64/util-linux/filelist).

## Dependencias JS/TS

### Aplicado

| Paquete/manifest | Hallazgo | Cambio |
|---|---|---|
| `components/network` | `debug` y `x11` estaban declarados pero no existe ningún import en el código fuente. | Eliminados y retirados del lock. |
| `components/network` | `react` y `lucide-react` se importan desde `react/NetworkConnectionPanel.tsx` pero no estaban declarados. | Añadidos como `peerDependencies`, evitando una segunda copia de React. |
| UI e installer | `dbus-next` estaba duplicado aunque el único import vive en `components/network/node/network-manager.ts`. | Eliminado de ambos consumidores; se conserva en los dos contextos aislados de red que los scripts instalan. |
| UI | `@openai/codex` no se importa en JS/TS y solo abastece el paso que extrae/copía el binario. | Movido de `dependencies` a `devDependencies`. |
| UI e installer | Pi, React y toolchain web tenían parches compatibles pendientes y locks divergentes. | Alineados a Pi `0.68.1`, React/DOM `19.2.8`, plugin React `5.2.0`, Vite `7.3.6`, Vitest `3.2.7`. |

### Correctas o justificadas

- `@mariozechner/pi-ai` y `@mariozechner/pi-coding-agent` sí se importan directamente en `components/ui/dev/pi-harness.ts`; no se pueden eliminar.
- `@anthropic-ai/sdk`, `openai`, `@mistralai/mistralai`, `@google/genai` y Bedrock **no** se importan desde AgenOS. Son dependencias duras transitivas de `@mariozechner/pi-ai`. Eliminarlas a mano rompería la integridad del paquete; para reducirlas hace falta que Pi separe proveedores en opcionales o reemplazar la capa unificada.
- Electron está correctamente en `devDependencies`: se usa para compilar/empaquetar y el runtime se copia a `/opt`, no se resuelve desde `node_modules` en producción.
- Fonts, React, ReactDOM, Lucide y Framer Motion son dependencias de renderer y están bien en `dependencies`.
- `dbus-next` aparece tanto en `components/network` como en `components/network/node` porque los dos scripts de build los instalan como contextos aislados. Sus versiones están alineadas. Consolidarlos en un workspace raíz sería mejor, pero borrar uno ahora rompería uno de los flujos de instalación.

### Falta o requiere decisión del dueño

- `tools/pi-harness-eval` invoca `codex` pero su `package.json` no declara `@openai/codex` y no tiene lock. No se añadió otra copia del binario (~multiplataforma y pesada) sin decidir si el CLI global es un prerrequisito deliberado.
- No existe manifest raíz/workspace. Los imports relativos cruzan límites de paquete (`ui -> agent/network/installer-ui`), por lo que la corrección depende de que los scripts instalen varios directorios en el orden adecuado. Recomendación: workspace Bun raíz con paquetes `@agenos/agent`, `@agenos/network` y `@agenos/network-node`, o bundles con límites explícitos.

## Versiones y seguridad

### Resultado reproducible de `bun audit`

| Paquete | Antes | Después | Lectura |
|---|---:|---:|---|
| UI | 115 (3 critical, 49 high, 51 moderate, 12 low) | 94 (38 high, 44 moderate, 12 low) | Se eliminaron el duplicado `dbus-next` y vulnerabilidades corregibles de Vitest/Vite directo. |
| installer-ui | 115 (3 critical, 49 high, 51 moderate, 12 low) | 93 (38 high, 43 moderate, 12 low) | Mismo saneamiento; una diferencia transitiva respecto a UI. |
| network | 22 (2 critical, 11 high, 9 moderate) | 22 | El riesgo real de `dbus-next` permanece aquí. |
| network/node | 22 (2 critical, 11 high, 9 moderate) | 22 | Igual que network. |

Los contadores no equivalen a explotabilidad en la ISO: mezclan herramientas de desarrollo, dependencias opcionales y runtime. Prioridad técnica:

1. **`dbus-next@0.10.2`**: no tiene actualización publicada y arrastra `xml2js@0.4`, `event-stream` y el opcional `usocket -> node-gyp -> request`, con `form-data`/`tar` críticos. El bundle ya externaliza `usocket`; evaluar `bun install --omit optional` para los paquetes de red y migrar a un binding D-Bus mantenido. No se forzaron overrides profundos sin pruebas de integración con NetworkManager.
2. **Electron 37**: `bun audit` exige al menos `38.8.6`; la última observada es `43.4.0`. Es un salto de major del runtime de la shell y requiere prueba gráfica/Wayland, no solo unit tests. No aplicado.
3. **Pi Agent**: el advisory de escalada local por rutas temporales afecta todas las versiones publicadas hasta `0.73.1`; también hay advisories menores de credenciales/export HTML. Subir de `0.68` a `0.73` no elimina el hallazgo y puede romper APIs. Se aplicó solo `0.68.1`.
4. **Proveedores transitivos de Pi**: Anthropic necesita `>=0.91.1`, fuera del rango `^0.90.0` fijado por Pi. `undici`, protobuf, AWS XML y `ws` también tienen advisories. Resolverlos requiere release de Pi o overrides con una matriz de pruebas de proveedores.
5. **Toolchain dev**: Vite directo está en `7.3.6` y Vitest en `3.2.7`, pero Vitest 3 todavía trae `vite-node@3.2.4` con un Vite `7.3.1` anidado; Bun sigue reportándolo. No se sobreescribió una dependencia interna fijada por upstream.

Advisories principales: [Pi temporary path LPE](https://github.com/advisories/GHSA-jfgx-wxx8-mp94), [Anthropic file permissions](https://github.com/advisories/GHSA-p7fg-763f-g4gf), [Electron context isolation bypass](https://github.com/advisories/GHSA-h7rp-cf8h-j98x), [form-data boundary randomness](https://github.com/advisories/GHSA-fjxv-7rqg-78g4) y [xml2js prototype pollution](https://github.com/advisories/GHSA-776f-qx25-q3cc).

### Desactualizados relevantes no aplicados

- `@openai/codex`: `0.124.0 -> 0.147.0`; binario central de autenticación/ejecución, validar CLI y device auth antes.
- Pi: `0.68.1 -> 0.73.1`; serie `0.x`, potencialmente breaking y sin resolver sus advisories directos.
- Electron: `37.10.3 -> 43.4.0`; prioridad alta por seguridad, pero requiere migración y smoke test gráfico.
- Vite `7 -> 8`, Vitest `3 -> 4`, TypeScript `5 -> 7`, plugin React `5 -> 6`, jsdom `26 -> 30`, Lucide `0 -> 1`, Framer Motion `12 -> 13`: majors deliberadamente no tocados.
- Fonts `5.2 -> 5.3`, Tailwind `4.2 -> 4.3` y testing libraries tienen actualizaciones menores; sin urgencia de seguridad frente a los riesgos anteriores.

## Coherencia de toolchain

- Solo existen locks Bun versionados: `components/ui/bun.lock`, `components/installer-ui/bun.lock`, `components/network/bun.lock` y `components/network/node/bun.lock`.
- No hay `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `npm-shrinkwrap.json` ni `bun.lockb` duplicados.
- Los scripts de aplicación usan `bun install`, `bun run`, `bun test` y `bun build`. No hay scripts de proyecto que usen npm/yarn/pnpm para instalar estas dependencias.
- Las únicas llamadas npm son intencionales y externas al toolchain de AgenOS: instalar OpenClaw desde su distribución npm, tanto en el hook chroot como en el fallback de runtime.
- No hay `engines.bun` ni `packageManager` en los manifests.
- Hay una divergencia real: `tools/openclaw-backend/Dockerfile` fija `oven/bun:1.3.14-debian`, el builder live usa `curl https://bun.sh/install | bash` sin versión, y esta auditoría se ejecutó con `bun 1.4.0-canary.1` (el comando corto informa `1.4.0`). `@types/bun` parte de `^1.3.10`.
- Recomendación: escoger una versión estable única, fijarla por digest/versión en ambos builders, añadir `packageManager`/`engines.bun` coherentes y regenerar/validar los cuatro locks con esa versión. No se fijó unilateralmente porque habría requerido editar builders fuera de la propiedad de este workstream.

## Paquetes Debian que hay que añadir/quitar

Lista preparada para el agente propietario de `package-lists`:

### Añadir explícitamente

```text
xdg-utils
x11-xserver-utils
procps
```

Motivo:

- `xdg-utils`: `xdg-open` es una función explícita de apertura de archivos; hoy solo llega por Chromium.
- `x11-xserver-utils`: `xhost` es requisito del camino Calamares bajo X11; hoy depende de Recommends.
- `procps`: el helper Rust usa `pkill` para recargar la shell; hoy depende de que la base incluya paquetes `important`.

### No añadir (fallbacks opcionales)

```text
libgtk-3-bin      # gtk-launch; opcional y hoy recomendado por libgtk-3-0
libglib2.0-bin    # gio; opcional, con fallback a Exec= directo
gnome-terminal konsole xfce4-terminal nautilus dolphin thunar
```

### Quitar

```text
# Ninguno con evidencia suficiente.
```

`wget` y `bash-completion` no tienen llamadas directas desde el runtime auditado, pero son utilidades de rescate/terminal y su retirada es una decisión de producto. Firmware, `iw`, `rfkill`, PipeWire/WirePlumber, bootloader, XWayland, Calamares y librerías GTK/NSS/NSPR no deben clasificarse como “sin uso” solo por no aparecer como subprocess: habilitan hardware, servicios o runtimes nativos.

## Cambios aplicados y verificación

Commit de dependencias: `c836079 chore(deps): remove duplicates and apply safe updates`

Verificaciones ejecutadas después de los cambios:

```text
components/ui:           bun run test  -> 81 Bun + 20 Vitest, 0 fallos
components/installer-ui: bun run test  -> 190 Bun + 20 Vitest, 0 fallos
components/ui:           bun run build -> OK (typecheck, Electron bundle, Vite)
components/installer-ui: bun run build -> OK (typecheck, API, Electron, Vite)
los cuatro paquetes:     bun install --frozen-lockfile -> OK
git diff --check -> OK
```

No se ejecutó `make build`, `quick-test`, ningún objetivo `release*` ni ningún build de ISO.
