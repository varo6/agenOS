#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UI_DIR="${ROOT_DIR}/components/ui"
STATIC_OUTPUT_DIR="${ROOT_DIR}/build/live-build/config/includes.chroot/usr/local/share/agenos-ui"
PACKAGE_OUTPUT_DIR="${ROOT_DIR}/build/live-build/config/includes.chroot/opt/agenos/system"
ELECTRON_APP_DIR="${UI_DIR}/build/electron"
ELECTRON_DIST_DIR="${UI_DIR}/node_modules/electron/dist"
STAMP_FILE="${PACKAGE_OUTPUT_DIR}/.build-stamp"

source_hash() {
  (
    cd "${UI_DIR}"
    local inputs=()

    for path in src public package.json bun.lock bun.lockb index.html vite.config.ts tsconfig.json tsconfig.node.json; do
      [[ -e "${path}" ]] && inputs+=("${path}")
    done

    find "${inputs[@]}" -type f -print 2>/dev/null \
      | LC_ALL=C sort \
      | xargs sha256sum
  )
}

cd "${UI_DIR}"

CURRENT_HASH="$(
  {
    source_hash
    sha256sum "${ROOT_DIR}/scripts/build-ui.sh"
  } | sha256sum | awk '{print $1}'
)"
CURRENT_STAMP=""

if [[ -f "${STAMP_FILE}" ]]; then
  CURRENT_STAMP="$(cat "${STAMP_FILE}")"
fi

if [[ "${CURRENT_STAMP}" == "${CURRENT_HASH}" && -f "${STATIC_OUTPUT_DIR}/index.html" && -x "${PACKAGE_OUTPUT_DIR}/agenos-system-ui" && -x "${PACKAGE_OUTPUT_DIR}/electron-dist/electron" ]]; then
  echo "components/ui sin cambios; se reutiliza el build empaquetado."
  exit 0
fi

if [[ -f bun.lock || -f bun.lockb ]]; then
  bun install --frozen-lockfile
else
  bun install
fi

bun run build

if [[ ! -f "${UI_DIR}/dist/index.html" ]]; then
  echo "No se encontró la vista compilada en ${UI_DIR}/dist/index.html" >&2
  exit 1
fi

if [[ ! -x "${ELECTRON_DIST_DIR}/electron" ]]; then
  echo "No se encontró el runtime de Electron en ${ELECTRON_DIST_DIR}/electron" >&2
  exit 1
fi

mkdir -p \
  "${STATIC_OUTPUT_DIR}" \
  "${PACKAGE_OUTPUT_DIR}/dist" \
  "${PACKAGE_OUTPUT_DIR}/electron-app" \
  "${PACKAGE_OUTPUT_DIR}/electron-dist"

rsync -a --delete "${UI_DIR}/dist/" "${STATIC_OUTPUT_DIR}/"
rsync -a --delete "${UI_DIR}/dist/" "${PACKAGE_OUTPUT_DIR}/dist/"
rsync -a --delete "${ELECTRON_APP_DIR}/" "${PACKAGE_OUTPUT_DIR}/electron-app/"
rsync -a --delete "${ELECTRON_DIST_DIR}/" "${PACKAGE_OUTPUT_DIR}/electron-dist/"

if [[ -f "${PACKAGE_OUTPUT_DIR}/electron-dist/chrome-sandbox" ]]; then
  chmod 0755 "${PACKAGE_OUTPUT_DIR}/electron-dist/chrome-sandbox"
fi

printf '%s\n' \
  '#!/bin/sh' \
  'set -eu' \
  'SCRIPT_DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"' \
  'RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/agenos-system"' \
  'PROFILE_DIR="${RUNTIME_DIR}/electron-profile"' \
  'LOCK_FILE="${RUNTIME_DIR}/electron.lock"' \
  'ELECTRON_BIN="${SCRIPT_DIR}/electron-dist/electron"' \
  'ELECTRON_APP="${SCRIPT_DIR}/electron-app"' \
  '' \
  'mkdir -p "${RUNTIME_DIR}" "${PROFILE_DIR}"' \
  'if [ ! -x "${ELECTRON_BIN}" ]; then' \
  '  echo "No se encontró el binario empaquetado de Electron." >&2' \
  '  exit 1' \
  'fi' \
  '' \
  'export AGENOS_UI_DIST_DIR="${SCRIPT_DIR}/dist"' \
  'export AGENOS_SYSTEM_BRIDGE_MODE="${AGENOS_SYSTEM_BRIDGE_MODE:-ipc}"' \
  'export AGENOS_ELECTRON_GPU_MODE="${AGENOS_ELECTRON_GPU_MODE:-auto}"' \
  'export ELECTRON_IS_DEV=0' \
  'export ELECTRON_OZONE_PLATFORM_HINT=auto' \
  'export TMPDIR="${RUNTIME_DIR}"' \
  'exec flock -n "${LOCK_FILE}" "${ELECTRON_BIN}" "${ELECTRON_APP}" \' \
  '  --no-sandbox \' \
  '  --disable-dev-shm-usage \' \
  '  "--user-data-dir=${PROFILE_DIR}"' \
  > "${PACKAGE_OUTPUT_DIR}/agenos-system-ui"

chmod +x "${PACKAGE_OUTPUT_DIR}/agenos-system-ui"
printf '%s\n' "${CURRENT_HASH}" > "${STAMP_FILE}"
