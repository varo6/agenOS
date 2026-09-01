#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UI_DIR="${ROOT_DIR}/components/installer-ui"
SYSTEM_UI_DIR="${ROOT_DIR}/components/ui"
AGENT_DIR="${ROOT_DIR}/components/agent"
NETWORK_DIR="${ROOT_DIR}/components/network"
OUTPUT_DIR="${ROOT_DIR}/build/live-build/config/includes.chroot/opt/agenos/installer"
API_BUILD_DIR="${UI_DIR}/build/api"
VIEW_DIST_DIR="${UI_DIR}/dist"
SYSTEM_DIST_DIR="${SYSTEM_UI_DIR}/dist"
ELECTRON_APP_DIR="${UI_DIR}/build/electron"
ELECTRON_DIST_DIR="${UI_DIR}/node_modules/electron/dist"
PI_AGENT_PACKAGE_DIR="${UI_DIR}/node_modules/@mariozechner/pi-coding-agent"
PLAYWRIGHT_PACKAGE_DIR="${UI_DIR}/node_modules/playwright-core"
PACKAGED_BUN="$(command -v bun)"
STAMP_FILE="${OUTPUT_DIR}/.build-stamp"

# Los tests quedan fuera del hash a proposito: no se empaquetan ni se importan
# desde el codigo que se compila, asi que editarlos solo disparaba un rebuild
# completo cuyo resultado era byte a byte identico.
source_hash() {
  local target_dir="$1"
  shift
  (
    cd "${target_dir}"
    local inputs=()

    for path in "$@"; do
      [[ -e "${path}" ]] && inputs+=("${path}")
    done

    find "${inputs[@]}" -type f -not -path "*/node_modules/*" -not -name '*.test.ts' -not -name '*.test.tsx' -print 2>/dev/null \
      | LC_ALL=C sort \
      | xargs sha256sum
  )
}

cd "${UI_DIR}"

CURRENT_HASH="$(
  {
    source_hash "${UI_DIR}" src public package.json bun.lock bun.lockb index.html vite.config.ts vitest.config.ts tsconfig.json tsconfig.node.json
    source_hash "${SYSTEM_UI_DIR}" src dev public package.json bun.lock bun.lockb index.html vite.config.ts tsconfig.json tsconfig.node.json
    source_hash "${AGENT_DIR}" .
    source_hash "${NETWORK_DIR}" package.json bun.lock bun.lockb types.ts client.ts node react
    sha256sum "${ROOT_DIR}/scripts/build-installer-ui.sh"
  } | sha256sum | awk '{print $1}'
)"
CURRENT_STAMP=""

if [[ -f "${STAMP_FILE}" ]]; then
  CURRENT_STAMP="$(cat "${STAMP_FILE}")"
fi

if [[ "${CURRENT_STAMP}" == "${CURRENT_HASH}" && -x "${OUTPUT_DIR}/agenos-installer-ui" && -x "${OUTPUT_DIR}/agenos-system-ui" && -f "${OUTPUT_DIR}/dist/index.html" && -f "${OUTPUT_DIR}/system-dist/index.html" && -x "${OUTPUT_DIR}/electron-dist/electron" && -f "${OUTPUT_DIR}/pi-coding-agent/package.json" && -f "${OUTPUT_DIR}/node_modules/playwright-core/package.json" && -f "${OUTPUT_DIR}/api/pi-system-context.md" ]]; then
  echo "components/installer-ui sin cambios; se reutiliza el paquete empaquetado."
  exit 0
fi

if [[ -f bun.lock || -f bun.lockb ]]; then
  bun install --frozen-lockfile
else
  bun install
fi

if [[ -f "${NETWORK_DIR}/node/package.json" ]]; then
  (
    cd "${NETWORK_DIR}/node"
    if [[ -f bun.lock || -f bun.lockb ]]; then
      bun install --frozen-lockfile
    else
      bun install
    fi
  )
fi

bash "${ROOT_DIR}/scripts/build-ui.sh"
bun run build

if [[ ! -f "${VIEW_DIST_DIR}/index.html" ]]; then
  echo "No se encontró la vista compilada en ${VIEW_DIST_DIR}/index.html" >&2
  exit 1
fi

if [[ ! -f "${SYSTEM_DIST_DIR}/index.html" ]]; then
  echo "No se encontró la vista compilada en ${SYSTEM_DIST_DIR}/index.html" >&2
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

if [[ ! -f "${PI_AGENT_PACKAGE_DIR}/package.json" ]]; then
  echo "No se encontró el runtime de pi-coding-agent en ${PI_AGENT_PACKAGE_DIR}" >&2
  exit 1
fi

if [[ ! -f "${PLAYWRIGHT_PACKAGE_DIR}/package.json" ]]; then
  echo "No se encontró playwright-core en ${PLAYWRIGHT_PACKAGE_DIR}" >&2
  exit 1
fi

mkdir -p "${OUTPUT_DIR}" "${OUTPUT_DIR}/api" "${OUTPUT_DIR}/bin" "${OUTPUT_DIR}/dist" "${OUTPUT_DIR}/system-dist" "${OUTPUT_DIR}/electron-app" "${OUTPUT_DIR}/electron-dist" "${OUTPUT_DIR}/pi-coding-agent" "${OUTPUT_DIR}/node_modules/playwright-core"

install -m 0755 "${PACKAGED_BUN}" "${OUTPUT_DIR}/bin/bun"
install -m 0755 "${API_BUILD_DIR}/server.js" "${OUTPUT_DIR}/api/server.js"
install -m 0755 "${API_BUILD_DIR}/cli.js" "${OUTPUT_DIR}/api/cli.js"
install -m 0644 "${AGENT_DIR}/pi-system-context.md" "${OUTPUT_DIR}/api/pi-system-context.md"
rsync -a --delete "${VIEW_DIST_DIR}/" "${OUTPUT_DIR}/dist/"
rsync -a --delete "${SYSTEM_DIST_DIR}/" "${OUTPUT_DIR}/system-dist/"
rsync -a --delete "${ELECTRON_APP_DIR}/" "${OUTPUT_DIR}/electron-app/"
rsync -a --delete "${ELECTRON_DIST_DIR}/" "${OUTPUT_DIR}/electron-dist/"
rsync -a --delete "${PI_AGENT_PACKAGE_DIR}/" "${OUTPUT_DIR}/pi-coding-agent/"
rsync -a --delete "${PLAYWRIGHT_PACKAGE_DIR}/" "${OUTPUT_DIR}/node_modules/playwright-core/"

BUILD_GENERATED_AT="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
BUILD_GIT_COMMIT="$(git -C "${ROOT_DIR}" rev-parse --short=12 HEAD 2>/dev/null || printf 'unknown')"
printf '{\n  "schemaVersion": 1,\n  "generatedAt": "%s",\n  "sourceHash": "%s",\n  "gitCommit": "%s"\n}\n' \
  "${BUILD_GENERATED_AT}" \
  "${CURRENT_HASH}" \
  "${BUILD_GIT_COMMIT}" \
  > "${OUTPUT_DIR}/build-info.json"

if [[ -f "${OUTPUT_DIR}/electron-dist/chrome-sandbox" ]]; then
  chmod 0755 "${OUTPUT_DIR}/electron-dist/chrome-sandbox"
fi

printf '%s\n' \
  '#!/bin/sh' \
  'set -eu' \
  'SCRIPT_DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"' \
  'APP_KIND="${AGENOS_APP_KIND:-installer}"' \
  'APP_PATH="${AGENOS_APP_PATH:-/installer/}"' \
  'RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/agenos-installer"' \
  'PROFILE_DIR="${RUNTIME_DIR}/electron-profile"' \
  'LOCK_FILE="${RUNTIME_DIR}/electron.lock"' \
  'SYSTEM_DIST_DIR="${SCRIPT_DIR}/system-dist"' \
  'APP_URL="http://127.0.0.1:4173${APP_PATH}"' \
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
  'export AGENOS_APP_KIND="${APP_KIND}"' \
  'export AGENOS_SYSTEM_DIST_DIR="${SYSTEM_DIST_DIR}"' \
  'export AGENOS_SYSTEM_BRIDGE_MODE="${AGENOS_SYSTEM_BRIDGE_MODE:-ipc}"' \
  'export AGENOS_ELECTRON_GPU_MODE="${AGENOS_ELECTRON_GPU_MODE:-auto}"' \
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
  'export AGENOS_APP_KIND="system"' \
  'export AGENOS_APP_PATH="/"' \
  'exec "$(CDPATH= cd -- "$(dirname "$0")" && pwd)/agenos-installer-ui" "$@"' \
  > "${OUTPUT_DIR}/agenos-system-ui"

chmod +x "${OUTPUT_DIR}/agenos-system-ui"

printf '%s\n' \
  '#!/bin/sh' \
  'set -eu' \
  'SCRIPT_DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"' \
  'BUN="${SCRIPT_DIR}/bin/bun"' \
  'CLI_ENTRY="${SCRIPT_DIR}/api/cli.js"' \
  'SERVER_ENTRY="${SCRIPT_DIR}/api/server.js"' \
  'UI_BINARY="${SCRIPT_DIR}/agenos-installer-ui"' \
  'API_URL="http://127.0.0.1:4173/health"' \
  '' \
  'if [ -n "${XDG_RUNTIME_DIR:-}" ]; then' \
  '  RUNTIME_DIR="${XDG_RUNTIME_DIR}/agenos-installer"' \
  'else' \
  '  RUNTIME_DIR="${HOME:-/tmp}/.cache/agenos-installer/runtime"' \
  'fi' \
  'API_PID_FILE="${RUNTIME_DIR}/api.pid"' \
  'API_LOG="${RUNTIME_DIR}/api.log"' \
  'LOCK_FILE="${RUNTIME_DIR}/gui.lock"' \
  '' \
  'mkdir -p "${RUNTIME_DIR}"' \
  'export PI_PACKAGE_DIR="${PI_PACKAGE_DIR:-${SCRIPT_DIR}/pi-coding-agent}"' \
  'export AGENOS_PI_AGENT_DIR="${AGENOS_PI_AGENT_DIR:-${HOME:-/tmp}/.agenos/ui-dev/pi}"' \
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
