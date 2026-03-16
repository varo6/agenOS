#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UI_DIR="${ROOT_DIR}/components/installer-ui"
OUTPUT_DIR="${ROOT_DIR}/build/live-build/config/includes.chroot/opt/agenos/installer"
API_BUILD_DIR="${UI_DIR}/build/api"
TAURI_BINARY="${UI_DIR}/src-tauri/target/release/agenos-installer-ui"
PACKAGED_BUN="$(command -v bun)"

cd "${UI_DIR}"

if [[ -f bun.lock || -f bun.lockb ]]; then
  bun install --frozen-lockfile
else
  bun install
fi

bun run build

if [[ ! -x "${TAURI_BINARY}" ]]; then
  echo "No se encontró el binario de Tauri en ${TAURI_BINARY}" >&2
  exit 1
fi

if [[ ! -x "${PACKAGED_BUN}" ]]; then
  echo "No se encontró el binario de Bun en PATH" >&2
  exit 1
fi

mkdir -p "${OUTPUT_DIR}" "${OUTPUT_DIR}/api" "${OUTPUT_DIR}/bin"
find "${OUTPUT_DIR}" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
mkdir -p "${OUTPUT_DIR}" "${OUTPUT_DIR}/api" "${OUTPUT_DIR}/bin"

install -m 0755 "${TAURI_BINARY}" "${OUTPUT_DIR}/agenos-installer-ui"
install -m 0755 "${PACKAGED_BUN}" "${OUTPUT_DIR}/bin/bun"
install -m 0755 "${API_BUILD_DIR}/server.js" "${OUTPUT_DIR}/api/server.js"
install -m 0755 "${API_BUILD_DIR}/cli.js" "${OUTPUT_DIR}/api/cli.js"
ldd "${TAURI_BINARY}" > "${OUTPUT_DIR}/tauri-ldd.txt"

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
