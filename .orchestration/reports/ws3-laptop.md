# WS3 — soporte de portátil bare-metal

Fecha de revisión: 2026-08-13

Rama: `ws3-laptop`

Base: Debian 12 bookworm, live-build, Sway y systemd

## Resultado

La imagen queda preparada para un portátil Intel o AMD común sin incorporar un
entorno de escritorio completo. La ruta voice-first recibe prioridad: además de
la cadena PipeWire existente, la ISO declara ahora el firmware de los DSP de
audio Intel y los perfiles ALSA necesarios para que el micrófono interno aparezca
y se enrute correctamente.

También se añadieron política de batería con avisos y apagado de emergencia,
perfiles de energía, control térmico, suspensión explícita por tapa, recuperación
selectiva del broker y de OpenClaw tras resume, brillo con ACL de udev, teclas
multimedia, firmware y aceleración gráfica, soporte de GPU híbrida y escalado
automático conservador del panel interno.

No se ejecutó ningún build de ISO, `quick-test` ni tarea `release*`, de acuerdo
con la restricción de esta misión. La última puerta sigue siendo una prueba en
hardware real siguiendo el plan al final de este informe.

## Auditoría inicial

### Package lists

`base.list.chroot` ya era mejor de lo que sugería la experiencia en VM:

- Red: `network-manager`, `wpasupplicant`, `iw`, `rfkill` y
  `wireless-regdb`.
- Firmware Wi-Fi: `firmware-iwlwifi`, `firmware-realtek`,
  `firmware-atheros`, `firmware-brcm80211`, `firmware-libertas`,
  `firmware-ti-connectivity` y `firmware-misc-nonfree`.
- `firmware-misc-nonfree` de bookworm incluye, entre otros, MediaTek
  MT7922/MT7961, firmware i915 y firmware Nouveau. No hace falta un paquete
  `firmware-mediatek` separado en esta versión de Debian.
- Audio: `pipewire`, `pipewire-alsa`, `pipewire-pulse`, `wireplumber`,
  `alsa-utils`, y `ffmpeg`.
- La configuración de live-build ya habilitaba las áreas `main contrib
  non-free non-free-firmware` y tanto `--firmware-binary` como
  `--firmware-chroot`.

Lo que no estaba declarado explícitamente:

- UPower, power-profiles-daemon, thermald o TLP.
- Firmware SOF/SST y perfiles ALSA UCM/topology para micros internos modernos.
- Brillo, ACL de backlight o control MPRIS de teclas multimedia.
- Firmware AMD, microcode Intel/AMD y drivers Mesa/VA/Vulkan explícitos.
- Servicio de notificaciones Wayland.

APT usa recomendaciones en esta imagen. Por ello Chromium podía arrastrar
`upower`, un proveedor genérico de notificaciones y `libgl1-mesa-dri` de forma
transitiva, pero no estaban fijados como requisitos del producto ni tenían
configuración AgenOS. Ahora sí lo están; el coste incremental real de esos tres
puede ser cero según la resolución concreta de APT.

`desktop-installer.list.chroot` ya incluía Sway, seatd, greetd, Xwayland,
`dbus-user-session`, Polkit, Chromium y las bibliotecas GTK que necesita el
instalador. No hacía falta añadir otro escritorio, daemon de entrada o servidor
de audio.

### Includes en `/etc`

Antes del cambio solo había configuración de AgenOS/Calamares/greetd, reglas
Polkit, teclado español y dos unidades propias. No existían:

- política de UPower;
- drop-in de `systemd-logind` para la tapa;
- configuración o servicio de reanudación;
- configuración de energía, backlight, audio o portátil.

El `config` de Sway tenía únicamente `input *` con `xkb_layout es` y
`xkb_model pc105`: sin touchpad, brillo, audio, mute de micrófono, controles
multimedia o salida HiDPI.

### systemd y hooks

Las unidades realmente incluidas en la ISO eran:

- `agenos-agent-api.service`: broker Bun en 4173, con
  `Restart=on-failure` y dependencia de NetworkManager.
- `agenos-openclaw.service`: worker/supervisor del gateway, también con
  `Restart=on-failure`.
- drop-in de greetd para seatd.

No había ninguna unidad ni hook de suspensión/reanudación. El único hook propio
de live-build era la instalación fijada de OpenClaw; los demás ficheros de
`hooks/normal` eran enlaces del propio live-build.

Los tres ficheros del directorio raíz `systemd/` (`agent.service`,
`kiosk.service`, `ui.service`) no se copian mediante `includes.chroot` ni los
habilita la configuración live. Además, `kiosk.service` referencia `cage`, que
no figura en package lists. Son artefactos genéricos/legados, no las unidades
activas de la ISO, y no los usé para esta implementación.

### Suspensión y procesos AgenOS

- Sway, Electron, Bun y el worker se congelan y continúan con los mismos PID
  durante un suspend normal; no hay motivo para reiniciarlos siempre.
- La shell nativa usa IPC local de Electron para Pi/STT/red. Las rutas HTTP del
  broker son petición/respuesta; no hay un WebSocket persistente implementado
  que haya que reconstruir.
- La UI sondea turnos en curso cada 1,2 s y, si el renderer se recarga, consulta
  los últimos turnos y retoma el que siga en `processing`.
- El supervisor de OpenClaw sondea el gateway, reintenta cada 30 s cuando otro
  proceso ya lo sirve y relanza su hijo con backoff si termina.

El riesgo residual era un proceso que siguiera `active` pero perdiera el socket
local tras un resume defectuoso. Se cubrió con una sonda post-resume; no con un
reinicio incondicional, que sí podría perder trabajo en curso.

### Red existente

`components/network/` ya implementa la integración con NetworkManager por
D-Bus: estado, escaneo, APs, conexión, desconexión y radio Wi-Fi. El firmware
para Intel, Realtek, Qualcomm/Atheros, Broadcom/Cypress, Marvell, TI y MediaTek
común ya estaba cubierto. No se cambió esa lógica.

Límite consciente: algunos Broadcom antiguos que solo funcionan con `b43` o
`broadcom-sta-dkms` pueden necesitar instalación posterior. Incluir DKMS,
headers y un módulo propietario para ese subconjunto aumentaría mucho el tamaño
y fragilidad de una live ISO; `brcmfmac`/`brcmsmac` sí quedan cubiertos.

## Implementación

### Energía, batería y térmica

- `UPower.conf` usa porcentaje (más predecible que las estimaciones ACPI de
  tiempo), marca bajo al 20 %, crítico al 7 % y ejecuta `PowerOff` al 3 %.
  No usa hibernación porque una live ISO no puede asumir swap persistente.
- `agenos-battery-monitor` consulta el `DisplayDevice` agregado de UPower cada
  30 s. Evita alertas de ratones/teclados, notifica una vez al cruzar cada umbral
  y se rearma al cargar.
- `agenos-power-status` muestra nivel y estado actual como texto, JSON o
  notificación bajo demanda, útil también desde las tools de shell del agente.
- Mako y el monitor arrancan dentro de la sesión D-Bus/Wayland existente desde
  `agenos-shell-runner`; no necesitan un escritorio ni una segunda sesión.
- `power-profiles-daemon` ofrece `balanced`, `power-saver` y, si el hardware lo
  soporta, `performance`. `agenos-power-profile-cycle` permite rotarlos desde
  Sway y notifica el resultado.
- `thermald` añade control preventivo en Intel compatible; en AMD se conserva
  la gestión térmica del kernel/firmware.
- No se añadió TLP: se solapa y entra en conflicto conceptual/paquetizado con
  power-profiles-daemon. Para AgenOS interesa una única API D-Bus sencilla.
- Tampoco se añadió `swayidle`: la misión exige tapa/suspend, no una política de
  bloqueo o suspensión por inactividad, y AgenOS aún no define una experiencia
  de desbloqueo.

### Tapa, suspensión y reanudación

El drop-in `60-agenos-laptop.conf` fija:

- tapa en batería: suspend;
- tapa con corriente: suspend;
- tapa en dock/múltiples monitores: ignorar;
- tecla de suspensión: suspend;
- respeto de inhibidores de alto nivel, importante mientras Calamares escribe
  el disco;
- holdoff de 30 s tras boot/resume para que logind redetecte docks y pantallas.

El hook `/usr/lib/systemd/system-sleep/agenos-resume` dispara sin bloquear una
unidad oneshot al volver. Esta comprueba 4173 y 18789 con tres intentos y solo
reinicia el servicio correspondiente si está inactivo o no escucha. NetworkManager
y PipeWire conservan su recuperación propia del hardware.

### Audio y micrófono voice-first

La cadena completa queda así:

1. driver ALSA del kernel;
2. firmware SOF/SST y perfiles UCM/topology;
3. PipeWire + WirePlumber + RTKit;
4. `pipewire-alsa`, por lo que `arecord -D default` entra al source por defecto;
5. Electron graba S16_LE mono/16 kHz y llama a whisper.cpp;
6. el fallback web usa MediaRecorder y el broker normaliza con ffmpeg.

WirePlumber descubre automáticamente dispositivos ALSA, elige el source/sink de
mayor prioridad y recuerda defaults, rutas, volumen y mute en el estado del
usuario. No se impuso un nombre de tarjeta: hacerlo rompería precisamente la
portabilidad entre barebones.

`pipewire-audio` garantiza el conjunto recomendado de Debian, incluido el plugin
Bluetooth; `bluez` hace utilizable ese plugin para auriculares y micros, y
`rtkit` permite scheduling de audio en tiempo real. Se evitó `pavucontrol`: GTK
ya está, pero AgenOS no tiene launcher clásico y `wpctl` cubre selección,
diagnóstico y teclas sin añadir otra UI.

### Brillo, touchpad y teclado

- `brightnessctl` más `brightness-udev` da acceso al usuario de asiento activo
  sin setuid. El usuario AgenOS ya pertenece a `video`.
- `systemd-backlight@.service`, parte de systemd, guarda/restaura el valor del
  backlight; no hace falta un daemon propio.
- `playerctl` cubre play/pause/prev/next/stop por MPRIS.
- El touchpad lo gestiona libinput a través de Sway, ya instalado. El bloque que
  debe integrarse en el config reservado está en la siguiente sección.

### Gráficos, híbrida y HiDPI

- `firmware-amd-graphics` completa AMDGPU; `firmware-misc-nonfree` ya cubría
  firmware i915 y Nouveau.
- `libgl1-mesa-dri` aporta OpenGL/DRI para Intel, AMD y Nouveau;
  `mesa-vulkan-drivers` añade ANV/RADV; VA-API queda cubierto para AMD, Intel
  moderno y generaciones Intel anteriores.
- microcode Intel y AMD corrige erratas de CPU/plataforma que afectan también a
  estabilidad, energía y suspend/resume.
- `switcheroo-control` mantiene la integrada como opción de bajo consumo y
  expone la dedicada; una aplicación concreta puede lanzarse con `DRI_PRIME=1`.
- No se incluyó `nvidia-driver`: es grande, acoplado al kernel y su ruta KMS en
  Debian 12 no es una apuesta segura para una ISO universal. Nouveau queda como
  camino de arranque; un equipo que necesite CUDA/proprietario requiere una
  imagen o instalación específica y prueba separada.
- Se eliminó el valor por defecto `WLR_NO_HARDWARE_CURSORS=1`, que forzaba una
  solución de VM también en portátiles sanos. Sigue disponible si se inyecta
  externamente y permanece el fallback explícito a Pixman si Sway no arranca.
- `agenos-output-autoscale` mide DPI del panel `eDP`/`LVDS`: usa 1× por debajo de
  135 dpi, 1,5× entre 135 y 190 y 2× desde 190. No toca monitores externos y
  preserva una escala Sway explícita distinta de 1×.
- Electron se ejecuta con Ozone/Wayland (`ozone-platform-hint=auto` y entorno
  Wayland), por lo que recibe el factor del compositor. Xwayland sigue disponible;
  sus clientes pueden verse borrosos con escala fraccional, una limitación de
  Xwayland/Sway, no de Electron nativo.

## Bloque de Sway listo para integrar

Añadir a `build/live-build/config/includes.chroot/etc/agenos/sway/config`. Este
fichero no fue modificado en esta rama porque pertenece a otro agente.

```sway
# Laptop touchpad: libinput settings (more specific than the existing input *).
input type:touchpad {
  tap enabled
  natural_scroll enabled
  dwt enabled
  scroll_method two_finger
}

# Screen and keyboard backlight. brightnessctl keeps delta changes above 0.
bindsym --locked XF86MonBrightnessDown exec brightnessctl --quiet set 5%-
bindsym --locked XF86MonBrightnessUp exec brightnessctl --quiet set +5%
bindsym --locked XF86KbdBrightnessDown exec brightnessctl --quiet --device='*::kbd_backlight' set 10%-
bindsym --locked XF86KbdBrightnessUp exec brightnessctl --quiet --device='*::kbd_backlight' set +10%

# PipeWire/WirePlumber default sink and source.
bindsym --locked XF86AudioLowerVolume exec wpctl set-volume @DEFAULT_AUDIO_SINK@ 5%-
bindsym --locked XF86AudioRaiseVolume exec wpctl set-volume -l 1.0 @DEFAULT_AUDIO_SINK@ 5%+
bindsym --locked XF86AudioMute exec wpctl set-mute @DEFAULT_AUDIO_SINK@ toggle
bindsym --locked XF86AudioMicMute exec wpctl set-mute @DEFAULT_AUDIO_SOURCE@ toggle

# MPRIS media controls.
bindsym --locked XF86AudioPlay exec playerctl play-pause
bindsym --locked XF86AudioPause exec playerctl play-pause
bindsym --locked XF86AudioPrev exec playerctl previous
bindsym --locked XF86AudioNext exec playerctl next
bindsym --locked XF86AudioStop exec playerctl stop

# AgenOS power profile cycle: balanced -> power-saver -> performance (if offered).
bindsym --locked $mod+p exec /usr/local/bin/agenos-power-profile-cycle
bindsym --locked $mod+b exec /usr/local/bin/agenos-power-status --notify

# Optional explicit HiDPI override; discover the real name with get_outputs.
# An explicit non-1 value is preserved by agenos-output-autoscale.
# output eDP-1 scale 2
# output eDP-1 scale_filter smart
```

`--locked` hace que brillo/audio sigan funcionando si más adelante se añade un
locker. No se enlaza `XF86Sleep`: logind ya consume esa tecla a nivel de sistema
y un segundo handler podría provocar dos solicitudes.

## Paquetes añadidos y coste

Los tamaños son el tamaño comprimido aproximado del `.deb` amd64/all publicado
para bookworm, no el incremento medido de la ISO. SquashFS vuelve a comprimir,
algunas dependencias ya estaban y algunos paquetes eran recomendaciones
transitivas. Sin construir, el rango honesto del crecimiento neto es **unos
40–50 MB**, dominado por firmware, microcode y Mesa/Vulkan.

| Paquete | Motivo | `.deb` aprox. |
|---|---|---:|
| `upower` | Estado agregado de batería y acción crítica | 0,08 MB |
| `power-profiles-daemon` | Perfiles por D-Bus/CLI sin TLP | 0,03 MB |
| `thermald` | Prevención térmica en Intel compatible | 0,24 MB |
| `mako-notifier` | Avisos Wayland ligeros | 0,05 MB |
| `libnotify-bin` | Cliente `notify-send` | 0,02 MB |
| `firmware-sof-signed` | DSP de audio Intel moderno | 0,60 MB |
| `firmware-intel-sound` | DSP Intel SST anterior | 0,80 MB |
| `alsa-ucm-conf` | Nombres/rutas de input y output por hardware | 0,05 MB |
| `alsa-topology-conf` | Topologías ALSA específicas | 0,02 MB |
| `pipewire-audio` | Metapaquete completo; añade plugin Bluetooth | 0,34 MB con plugin principal |
| `rtkit` | Prioridad de tiempo real para PipeWire | 0,03 MB |
| `bluez` | Daemon y CLI para headsets Bluetooth | 1,13 MB |
| `brightnessctl` | Control de backlight | 0,012 MB |
| `brightness-udev` | ACL no privilegiada de backlight | 0,004 MB |
| `playerctl` | Teclas MPRIS; con `libplayerctl2` | 0,09 MB |
| `firmware-amd-graphics` | Firmware AMDGPU/Radeon | 11,59 MB |
| `intel-microcode` | Correcciones de CPU/plataforma Intel | 12,55 MB |
| `amd64-microcode` | Correcciones de CPU/plataforma AMD | 0,27 MB |
| `libgl1-mesa-dri` | OpenGL/DRI Intel/AMD/Nouveau | 7,07 MB; probablemente ya transitivo |
| `mesa-vulkan-drivers` | Vulkan ANV/RADV | 7,81 MB |
| `mesa-va-drivers` | VA-API AMD/Mesa | 3,22 MB |
| `intel-media-va-driver` | VA-API Intel Gen8+ | 2,81 MB |
| `i965-va-driver` | VA-API Intel G45–Cannon Lake | 0,30 MB |
| `switcheroo-control` | Selección integrada/dedicada | 0,016 MB |

Costes indirectos pequeños no desglosados: codecs de `libspa-0.2-bluetooth`,
`libigdgmm12`, `libplayerctl2` y bibliotecas que no estuvieran ya por Sway,
Chromium o GTK.

## Plan de pruebas en hardware real

Usar al menos un portátil Intel con audio SOF y, si está disponible, uno AMD.
Para GPU híbrida, añadir un Intel+NVIDIA o AMD+NVIDIA. Probar primero desde USB
live y repetir lo esencial tras instalar para verificar persistencia.

### 1. Inventario y errores de firmware

```sh
lspci -nnk
lsusb
sudo dmesg -T | grep -Ei 'firmware|failed|iwlwifi|rtw|ath|brcm|mt79|amdgpu|i915|nouveau|sof|snd'
```

Pasa si cada controlador de red/gráficos/audio se enlaza a su driver esperado y
no hay `Direct firmware load ... failed` correspondiente al hardware presente.

### 2. Micrófono — puerta prioritaria

```sh
wpctl status
wpctl get-volume @DEFAULT_AUDIO_SOURCE@
arecord -D default -q -t wav -f S16_LE -r 16000 -c 1 -d 5 /tmp/agenos-mic.wav
aplay /tmp/agenos-mic.wav
```

Después pulsar el control de voz de AgenOS y decir una orden en español.

Pasa si `wpctl` muestra al menos un source físico que no sea solo un monitor, la
grabación reproduce voz inteligible, el medidor/source no está muteado y la UI
produce una transcripción correcta. Repetir con jack/USB/Bluetooth si existen;
WirePlumber debe cambiar al dispositivo disponible y recordar una selección
manual hecha con `wpctl set-default ID`.

### 3. Salida, volumen y teclas

```sh
wpctl status
wpctl get-volume @DEFAULT_AUDIO_SINK@
```

Reproducir audio, conectar y desconectar auriculares y pulsar subir, bajar, mute
y mute de micro. Pasa si cambia el sink/source correcto, los valores de `wpctl`
reflejan cada tecla, mute de micro no silencia el altavoz y el default reaparece
tras reiniciar la sesión.

### 4. Wi-Fi y firmware

```sh
rfkill list
nmcli device status
nmcli radio wifi
nmcli device wifi list --rescan yes
nmcli networking connectivity check
```

Conectar desde la UI a WPA2/WPA3, probar credencial errónea, red oculta y portal
cautivo si se puede. Suspender 60 s conectado y reanudar. Pasa si la interfaz no
está bloqueada, el escaneo devuelve APs, la UI conecta sin terminal, NetworkManager
recupera conectividad tras resume y no aparecen errores de firmware.

### 5. Batería, perfiles y térmica

```sh
upower -i /org/freedesktop/UPower/devices/DisplayDevice
powerprofilesctl list
powerprofilesctl get
powerprofilesctl set power-saver
powerprofilesctl set balanced
systemctl status upower.service power-profiles-daemon.service
systemctl status thermald.service
```

En Intel compatible, `thermald` debe estar activo y sin bucle de errores; en AMD
puede indicar plataforma no compatible sin afectar al kernel. `$mod+p` debe
cambiar perfil y notificar. Desenchufar y observar una descarga real: al cruzar
20 % debe aparecer un único aviso y al cruzar 7 % uno crítico. La comprobación
del 3 % debe hacerse solo en una sesión live sin trabajo valioso: pasa si UPower
ordena apagado limpio antes del corte eléctrico.

### 6. Tapa y resume de la sesión/agentes

Antes de cerrar:

```sh
systemd-analyze cat-config systemd/logind.conf
systemd-inhibit --list
systemctl is-active agenos-agent-api.service agenos-openclaw.service
curl -sS http://127.0.0.1:4173/api/speech/status
```

Iniciar una interacción que deje estado visible, anotar PID de Electron/broker,
cerrar tapa 60 s, abrir y repetir diez ciclos, cinco con cargador y cinco sin él.
Tras cada ciclo:

```sh
systemctl is-active agenos-agent-api.service agenos-openclaw.service
curl -sS http://127.0.0.1:4173/api/speech/status
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:18789/v1/models
journalctl -b -u systemd-suspend.service -u agenos-resume-health.service --no-pager
```

Pasa si el equipo entra realmente en suspend, abre en la misma sesión/workspace,
Electron vuelve a pintar y aceptar voz, la red retorna, el broker responde y el
gateway responde (401 también demuestra socket vivo si exige token). Los PID
deben conservarse en el caso sano; solo deben cambiar si la sonda documentó un
servicio no saludable. Un turno que terminó durante la transición debe mostrar
su estado final, no quedar eternamente obsoleto.

Durante una instalación, comprobar además que Calamares aparece en
`systemd-inhibit --list`; cerrar la tapa no debe interrumpir una sección crítica
si mantiene el inhibidor.

### 7. Brillo y persistencia

```sh
brightnessctl list
brightnessctl info
systemctl status 'systemd-backlight@*'
```

Pulsar brillo arriba/abajo hasta los extremos. Pasa si el panel cambia, nunca
queda accidentalmente en cero, no aparece petición de contraseña y el valor
vuelve aproximadamente igual tras reinicio. Repetir teclado iluminado si existe;
las teclas deben fallar de forma inocua si ese dispositivo no está presente.

### 8. Touchpad y teclado

```sh
swaymsg -t get_inputs
swaymsg -t get_seats
```

Tras integrar el bloque Sway: un toque hace click, dos dedos desplazan en sentido
natural y mover el touchpad mientras se teclea no mueve el cursor. Probar las
teclas Fn sin y con Fn-lock; cada presión debe generar una sola acción.

### 9. Gráficos, híbrida y HiDPI

```sh
swaymsg -t get_outputs
lspci -nnk | grep -A3 -Ei 'vga|3d|display'
switcherooctl list
ls /usr/share/vulkan/icd.d /usr/lib/x86_64-linux-gnu/dri
sudo dmesg -T | grep -Ei 'drm|amdgpu|i915|nouveau|gpu|hang|reset'
```

Pasa si Sway usa DRM/Mesa y no el fallback Pixman, el panel interno recibe 1,
1,5 o 2 según DPI, Electron se ve nítido y ocupa el output correctamente, y no
hay resets/hangs. En híbrida, la integrada debe ser la ruta de bajo consumo y
`DRI_PRIME=1 <aplicación>` debe activar la dedicada sin tumbar Sway. Con NVIDIA,
validar por separado el nivel funcional de Nouveau; no declarar soportado el
driver propietario hasta tener una imagen específica probada.

### 10. Persistencia y regresión final

Tras una instalación real, repetir micrófono, Wi-Fi, brillo, perfil, tapa y
HiDPI. Confirmar que `/etc/UPower/UPower.conf`, el drop-in de logind, las unidades
y los scripts AgenOS existen en el sistema instalado. Revisar:

```sh
journalctl -b -p warning..alert --no-pager
systemctl --failed
```

Pasa si no hay unidades AgenOS/NetworkManager/PipeWire críticas fallidas y no se
requiere ninguna corrección manual para arrancar, conectarse y emitir una orden
de voz.

## Validación realizada sin build

- Revisión completa de package lists, includes `/etc`, hooks y unidades.
- Confirmación en la documentación/índices oficiales de Debian bookworm de los
  nombres, disponibilidad y tamaños de los paquetes añadidos.
- `sh -n` sobre todos los scripts shell nuevos/modificados.
- compilación en memoria y pruebas de umbrales 1×/1,5×/2× de
  `agenos-output-autoscale`.
- `git diff --check` y smoke tests estáticos del repositorio.
- No se modificó el config Sway reservado ni ninguno de los cuatro ficheros
  TypeScript excluidos.

Fuentes de referencia: [paquetes Debian bookworm](https://packages.debian.org/bookworm/),
[UPower 0.99.20 de bookworm](https://sources.debian.org/src/upower/0.99.20-2/etc/UPower.conf),
[logind.conf de systemd 252](https://manpages.debian.org/bookworm/systemd/logind.conf.5.en.html),
[sway-input](https://manpages.debian.org/bookworm/sway/sway-input.5.en.html) y
[brightnessctl](https://manpages.debian.org/bookworm/brightnessctl/brightnessctl.1.en.html).
