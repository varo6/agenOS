#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LIVE_CONFIG="${ROOT_DIR}/build/live-build/config/includes.chroot/lib/live/config/9990-agenos-greetd"
BUILD_UI="${ROOT_DIR}/scripts/build-ui.sh"
BUILD_INSTALLER="${ROOT_DIR}/scripts/build-installer-ui.sh"
CALAMARES_DESKTOP="${ROOT_DIR}/build/live-build/config/includes.chroot/usr/lib/calamares/modules/agenosdesktop/main.py"

require_literal() {
  local file="$1"
  local text="$2"
  if ! grep --fixed-strings --quiet -- "${text}" "${file}"; then
    echo "Falta en ${file}: ${text}" >&2
    exit 1
  fi
}

require_literal "${LIVE_CONFIG}" "install -d -o agenos -g agenos -m 0700 /home/agenos/.agenos"
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

echo "live user state smoke ok"
