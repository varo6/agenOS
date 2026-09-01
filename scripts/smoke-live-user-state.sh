#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LIVE_CONFIG="${ROOT_DIR}/build/live-build/config/includes.chroot/lib/live/config/9990-agenos-greetd"
BUILD_UI="${ROOT_DIR}/scripts/build-ui.sh"
BUILD_INSTALLER="${ROOT_DIR}/scripts/build-installer-ui.sh"
CALAMARES_DESKTOP="${ROOT_DIR}/build/live-build/config/includes.chroot/usr/lib/calamares/modules/agenosdesktop/main.py"
LIVE_BOOT_CONFIG="${ROOT_DIR}/build/live-build/auto/config"
SWAY_CONFIG="${ROOT_DIR}/build/live-build/config/includes.chroot/etc/agenos/sway/config"
WAYBAR_CONFIG="${ROOT_DIR}/build/live-build/config/includes.chroot/etc/agenos/waybar/config.json"
DESKTOP_PACKAGES="${ROOT_DIR}/build/live-build/config/package-lists/desktop-installer.list.chroot"
BAR_LAUNCHER="${ROOT_DIR}/build/live-build/config/includes.chroot/usr/local/bin/agenos-bar"
KEYBOARD_DEFAULTS="${ROOT_DIR}/build/live-build/config/includes.chroot/etc/default/keyboard"
RUN_VM="${ROOT_DIR}/scripts/run-vm.sh"
AGENT_API_UNIT="${ROOT_DIR}/build/live-build/config/includes.chroot/etc/systemd/system/agenos-agent-api.service"
BROWSER_LAUNCHER="${ROOT_DIR}/build/live-build/config/includes.chroot/usr/local/bin/agenos-browser"
BROWSER_DESKTOP="${ROOT_DIR}/build/live-build/config/includes.chroot/usr/share/applications/agenos-browser.desktop"
MIMEAPPS="${ROOT_DIR}/build/live-build/config/includes.chroot/etc/xdg/mimeapps.list"
SHELL_RUNNER="${ROOT_DIR}/build/live-build/config/includes.chroot/usr/local/bin/agenos-shell-runner"
PERSISTENCE_NOTICE="${ROOT_DIR}/build/live-build/config/includes.chroot/usr/local/bin/agenos-persistence-notice"
BASE_PACKAGES="${ROOT_DIR}/build/live-build/config/package-lists/base.list.chroot"

require_literal() {
  local file="$1"
  local text="$2"
  if ! grep --fixed-strings --quiet -- "${text}" "${file}"; then
    echo "Falta en ${file}: ${text}" >&2
    exit 1
  fi
}

require_literal "${LIVE_CONFIG}" "install -d -o agenos -g agenos -m 0700 /home/agenos/.agenos"
require_literal "${LIVE_CONFIG}" "agenos ALL=(ALL) NOPASSWD:ALL"
require_literal "${LIVE_CONFIG}" "install -d -o agenos -g agenos -m 0755 /home/agenos/Documentos"
require_literal "${LIVE_CONFIG}" "install -d -o agenos -g agenos -m 0755 /home/agenos/Fotos"
require_literal "${LIVE_CONFIG}" "install -d -o agenos -g agenos -m 0755 /home/agenos/Musica"
require_literal "${LIVE_CONFIG}" "install -d -o agenos -g agenos -m 0755 /home/agenos/Trabajo"
require_literal "${LIVE_CONFIG}" 'XDG_DOCUMENTS_DIR="$HOME/Documentos"'
require_literal "${LIVE_CONFIG}" 'XDG_PICTURES_DIR="$HOME/Fotos"'
require_literal "${LIVE_CONFIG}" "install -d -o agenos -g agenos -m 0700 /home/agenos/.agenos/ui-dev"
require_literal "${LIVE_CONFIG}" "install -d -o agenos -g agenos -m 0700 /home/agenos/.agenos/ui-dev/pi"
require_literal "${LIVE_CONFIG}" "install -d -o agenos -g agenos -m 0700 /home/agenos/.agenos/openclaw"
require_literal "${LIVE_CONFIG}" "install -d -o agenos -g agenos -m 0700 /home/agenos/.agenos/memory"
require_literal "${LIVE_CONFIG}" "install -d -o agenos -g agenos -m 0700 /home/agenos/.agenos/broker"
require_literal "${LIVE_CONFIG}" "chown -R agenos:agenos /home/agenos/.agenos"
require_literal "${LIVE_CONFIG}" "chmod 0700 /home/agenos/.agenos"

require_literal "${BUILD_UI}" '.cache/agenos-system/runtime'
require_literal "${BUILD_UI}" 'export AGENOS_PI_AGENT_DIR="${AGENOS_PI_AGENT_DIR:-${HOME:-/tmp}/.agenos/ui-dev/pi}"'
require_literal "${BUILD_INSTALLER}" 'export AGENOS_PI_AGENT_DIR="${AGENOS_PI_AGENT_DIR:-${HOME:-/tmp}/.agenos/ui-dev/pi}"'

require_literal "${CALAMARES_DESKTOP}" "agenos-agent-api.service"
require_literal "${CALAMARES_DESKTOP}" "agenos-openclaw.service"
require_literal "${CALAMARES_DESKTOP}" 'state_root / "ui-dev" / "pi"'
require_literal "${CALAMARES_DESKTOP}" 'USER_HOME_DIRS = ["Documentos", "Fotos", "Musica", "Trabajo"]'
require_literal "${CALAMARES_DESKTOP}" 'XDG_DOCUMENTS_DIR="$HOME/Documentos"'

require_literal "${LIVE_BOOT_CONFIG}" "persistence persistence-label=agenos-persist hostname=agenos"
require_literal "${RUN_VM}" "-L agenos-persist"
require_literal "${RUN_VM}" "/home union"
require_literal "${ROOT_DIR}/scripts/create-persistent-usb.sh" 'PERSISTENCE_LABEL="agenos-persist"'
require_literal "${SWAY_CONFIG}" "xkb_layout es"
require_literal "${SWAY_CONFIG}" "seat * xcursor_theme Adwaita 24"
require_literal "${SWAY_CONFIG}" "swaybar_command /usr/local/bin/agenos-bar"
require_literal "${BAR_LAUNCHER}" "exec waybar"
require_literal "${WAYBAR_CONFIG}" '"modules-center": ["clock"]'
require_literal "${WAYBAR_CONFIG}" '"format": "{:%H:%M}"'
require_literal "${WAYBAR_CONFIG}" '"exec": "/usr/local/bin/agenos-workspace-watch --status"'
require_literal "${DESKTOP_PACKAGES}" "waybar"
require_literal "${ROOT_DIR}/build/live-build/config/includes.chroot/usr/local/bin/agenos-session" 'WLR_NO_HARDWARE_CURSORS="${WLR_NO_HARDWARE_CURSORS:-1}"'
require_literal "${SWAY_CONFIG}" 'workspace 1:home'
require_literal "${SWAY_CONFIG}" 'workspace 2:app'
require_literal "${SWAY_CONFIG}" 'workspace 3:web'
require_literal "${SWAY_CONFIG}" 'workspace 4:media'
require_literal "${SWAY_CONFIG}" 'workspace 5:work'
require_literal "${KEYBOARD_DEFAULTS}" 'XKBLAYOUT="es"'
require_literal "${RUN_VM}" "VM_LIVE_PERSISTENCE"
require_literal "${RUN_VM}" "VM_PERSIST_DISK"

# La sesion iniciada en el navegador tiene que sobrevivir a un reinicio del
# broker y a cualquier via de apertura de URLs; si no, el usuario aparece
# desconectado de sus cuentas sin haber cerrado nada.
require_literal "${AGENT_API_UNIT}" "KillMode=process"
require_literal "${BROWSER_LAUNCHER}" '.agenos/browser-profile'
require_literal "${BROWSER_LAUNCHER}" "--password-store=basic"
require_literal "${BROWSER_LAUNCHER}" "18800"
require_literal "${BROWSER_DESKTOP}" "Exec=/usr/local/bin/agenos-browser %U"
require_literal "${MIMEAPPS}" "x-scheme-handler/https=agenos-browser.desktop;"
require_literal "${MIMEAPPS}" "text/html=agenos-browser.desktop;"
require_literal "${BUILD_UI}" '${HOME:-/tmp}/.agenos/system-ui-profile'
require_literal "${SHELL_RUNNER}" "agenos-persistence-notice"
require_literal "${PERSISTENCE_NOTICE}" "/run/live/persistence"
require_literal "${BASE_PACKAGES}" "systemd-timesyncd"

if grep --quiet --fixed-strings -- "=chromium.desktop;" "${MIMEAPPS}"; then
  echo "mimeapps.list vuelve a abrir URLs con el perfil por defecto de Chromium: ${MIMEAPPS}" >&2
  exit 1
fi

for script in "${BROWSER_LAUNCHER}" "${PERSISTENCE_NOTICE}"; do
  if [[ ! -x "${script}" ]]; then
    echo "Falta el bit de ejecucion en ${script}" >&2
    exit 1
  fi
  sh -n "${script}"
done

echo "live user state smoke ok"
