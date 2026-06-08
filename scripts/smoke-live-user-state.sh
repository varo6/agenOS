#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LIVE_CONFIG="${ROOT_DIR}/build/live-build/config/includes.chroot/lib/live/config/9990-agenos-greetd"
BUILD_UI="${ROOT_DIR}/scripts/build-ui.sh"
BUILD_INSTALLER="${ROOT_DIR}/scripts/build-installer-ui.sh"
CALAMARES_DESKTOP="${ROOT_DIR}/build/live-build/config/includes.chroot/usr/lib/calamares/modules/agenosdesktop/main.py"
LIVE_BOOT_CONFIG="${ROOT_DIR}/build/live-build/auto/config"
SWAY_CONFIG="${ROOT_DIR}/build/live-build/config/includes.chroot/etc/agenos/sway/config"
KEYBOARD_DEFAULTS="${ROOT_DIR}/build/live-build/config/includes.chroot/etc/default/keyboard"
RUN_VM="${ROOT_DIR}/scripts/run-vm.sh"

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

require_literal "${LIVE_BOOT_CONFIG}" "persistence hostname=agenos"
require_literal "${SWAY_CONFIG}" "xkb_layout es"
require_literal "${SWAY_CONFIG}" "agenos-workspace-watch"
require_literal "${SWAY_CONFIG}" 'workspace 1:agent'
require_literal "${SWAY_CONFIG}" 'workspace 2:app'
require_literal "${SWAY_CONFIG}" 'workspace 3:web'
require_literal "${SWAY_CONFIG}" 'workspace 4:media'
require_literal "${SWAY_CONFIG}" 'workspace 5:work'
require_literal "${KEYBOARD_DEFAULTS}" 'XKBLAYOUT="es"'
require_literal "${RUN_VM}" "VM_LIVE_PERSISTENCE"
require_literal "${RUN_VM}" "VM_PERSIST_DISK"

echo "live user state smoke ok"
