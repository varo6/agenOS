#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UI_DIR="${ROOT_DIR}/components/installer-ui"
OUTPUT_DIR="${ROOT_DIR}/build/live-build/config/includes.chroot/opt/agenos/installer"
API_BUILD_DIR="${UI_DIR}/build/api"
VIEW_DIST_DIR="${UI_DIR}/dist"
ELECTRON_APP_DIR="${UI_DIR}/src/electron"
ELECTRON_DIST_DIR="${UI_DIR}/node_modules/electron/dist"
PACKAGED_BUN="$(command -v bun)"
STAMP_FILE="${OUTPUT_DIR}/.build-stamp"

source_hash() {
  (
    cd "${UI_DIR}"
    find src public package.json bun.lock index.html vite.config.ts vitest.config.ts tsconfig*.json -type f -print 2>/dev/null \
      | LC_ALL=C sort \
      | xargs sha256sum
  )
}

cd "${UI_DIR}"

CURRENT_HASH="$(
  {
    source_hash
    sha256sum "${ROOT_DIR}/scripts/build-installer-ui.sh"
  } | sha256sum | awk '{print $1}'
)"

if [[ -f "${STAMP_FILE}" && "$(cat "${STAMP_FILE}")" == "${CURRENT_HASH}" && -x "${OUTPUT_DIR}/agenos-installer-ui" && -f "${OUTPUT_DIR}/dist/index.html" && -x "${OUTPUT_DIR}/electron-dist/electron" ]]; then
  echo "components/installer-ui sin cambios; se reutiliza el paquete empaquetado."
  exit 0
fi

if [[ -f bun.lock || -f bun.lockb ]]; then
  bun install --frozen-lockfile
else
  bun install
fi

bun run build

if [[ ! -f "${VIEW_DIST_DIR}/index.html" ]]; then
  echo "No se encontró la vista compilada en ${VIEW_DIST_DIR}/index.html" >&2
  exit 1
fi

if [[ ! -x "${ELECTRON_DIST_DIR}/electron" ]]; then
  echo "No se encontró el runtime de Electron en ${ELECTRON_DIST_DIR}/electron" >&2
  exit 1
fi

if [[ ! -x "${PACKAGED_BUN}" ]]; then
  echo "No se encontró el binario de Bun en PATH" >&2
  exit 1
fi

mkdir -p "${OUTPUT_DIR}" "${OUTPUT_DIR}/api" "${OUTPUT_DIR}/bin" "${OUTPUT_DIR}/dist" "${OUTPUT_DIR}/electron-app" "${OUTPUT_DIR}/electron-dist"

install -m 0755 "${PACKAGED_BUN}" "${OUTPUT_DIR}/bin/bun"
install -m 0755 "${API_BUILD_DIR}/server.js" "${OUTPUT_DIR}/api/server.js"
install -m 0755 "${API_BUILD_DIR}/cli.js" "${OUTPUT_DIR}/api/cli.js"
rsync -a --delete "${VIEW_DIST_DIR}/" "${OUTPUT_DIR}/dist/"
rsync -a --delete "${ELECTRON_APP_DIR}/" "${OUTPUT_DIR}/electron-app/"
rsync -a --delete "${ELECTRON_DIST_DIR}/" "${OUTPUT_DIR}/electron-dist/"

if [[ -f "${OUTPUT_DIR}/electron-dist/chrome-sandbox" ]]; then
  chmod 0755 "${OUTPUT_DIR}/electron-dist/chrome-sandbox"
fi

printf '%s\n' \
  '#!/bin/sh' \
  'set -eu' \
  'SCRIPT_DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"' \
  'RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/agenos-installer"' \
  'PROFILE_DIR="${RUNTIME_DIR}/electron-profile"' \
  'LOCK_FILE="${RUNTIME_DIR}/electron.lock"' \
  'APP_URL="http://127.0.0.1:4173/"' \
  'ELECTRON_BIN="${SCRIPT_DIR}/electron-dist/electron"' \
  'ELECTRON_APP="${SCRIPT_DIR}/electron-app"' \
  '' \
  'mkdir -p "${RUNTIME_DIR}" "${PROFILE_DIR}"' \
  'if [ ! -x "${ELECTRON_BIN}" ]; then' \
  '  echo "No se encontró el binario empaquetado de Electron." >&2' \
  '  exit 1' \
  'fi' \
  '' \
  'export AGENOS_INSTALLER_URL="${APP_URL}"' \
  'export ELECTRON_IS_DEV=0' \
  'export ELECTRON_OZONE_PLATFORM_HINT=auto' \
  'export TMPDIR="${RUNTIME_DIR}"' \
  'exec flock -n "${LOCK_FILE}" "${ELECTRON_BIN}" "${ELECTRON_APP}" \' \
  '  --no-sandbox \' \
  '  --disable-dev-shm-usage \' \
  '  "--user-data-dir=${PROFILE_DIR}"' \
  > "${OUTPUT_DIR}/agenos-installer-ui"

chmod +x "${OUTPUT_DIR}/agenos-installer-ui"

printf '%s\n' \
  '#!/bin/sh' \
  'set -eu' \
  'SCRIPT_DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"' \
  'BUN="${SCRIPT_DIR}/bin/bun"' \
  'CLI_ENTRY="${SCRIPT_DIR}/api/cli.js"' \
  'SERVER_ENTRY="${SCRIPT_DIR}/api/server.js"' \
  'UI_BINARY="${SCRIPT_DIR}/agenos-installer-ui"' \
  'RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/agenos-installer"' \
  'API_PID_FILE="${RUNTIME_DIR}/api.pid"' \
  'API_LOG="${RUNTIME_DIR}/api.log"' \
  'LOCK_FILE="${RUNTIME_DIR}/gui.lock"' \
  'API_URL="http://127.0.0.1:4173/health"' \
  '' \
  'mkdir -p "${RUNTIME_DIR}"' \
  '' \
  'ensure_api() {' \
  '  if curl --silent --fail --max-time 1 "${API_URL}" >/dev/null 2>&1; then' \
  '    return 0' \
  '  fi' \
  '' \
  '  if [ -f "${API_PID_FILE}" ]; then' \
  '    pid="$(cat "${API_PID_FILE}" 2>/dev/null || true)"' \
  '    if [ -n "${pid}" ] && kill -0 "${pid}" 2>/dev/null; then' \
  '      :' \
  '    else' \
  '      rm -f "${API_PID_FILE}"' \
  '    fi' \
  '  fi' \
  '' \
  '  if [ ! -f "${API_PID_FILE}" ]; then' \
  '    "${BUN}" "${SERVER_ENTRY}" >>"${API_LOG}" 2>&1 &' \
  '    echo "$!" > "${API_PID_FILE}"' \
  '  fi' \
  '' \
  '  attempts=0' \
  '  while [ "${attempts}" -lt 40 ]; do' \
  '    if curl --silent --fail --max-time 1 "${API_URL}" >/dev/null 2>&1; then' \
  '      return 0' \
  '    fi' \
  '    attempts=$((attempts + 1))' \
  '    sleep 0.25' \
  '  done' \
  '' \
  '  echo "El API local no respondió en ${API_URL}." >&2' \
  '  return 1' \
  '}' \
  '' \
  'if [ "$#" -gt 0 ]; then' \
  '  exec "${BUN}" "${CLI_ENTRY}" "$@"' \
  'fi' \
  '' \
  'ensure_api' \
  'exec flock -n "${LOCK_FILE}" "${UI_BINARY}"' \
  > "${OUTPUT_DIR}/agenos-installer"

chmod +x "${OUTPUT_DIR}/agenos-installer"
printf '%s\n' "${CURRENT_HASH}" > "${STAMP_FILE}"
