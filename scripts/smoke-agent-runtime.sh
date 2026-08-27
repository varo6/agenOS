#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PACKAGE_DIR="${ROOT_DIR}/build/live-build/config/includes.chroot/opt/agenos/installer"
BUN="${PACKAGE_DIR}/bin/bun"
SERVER_ENTRY="${PACKAGE_DIR}/api/server.js"
PI_PACKAGE_DIR="${PACKAGE_DIR}/pi-coding-agent"
PLAYWRIGHT_PACKAGE_DIR="${PACKAGE_DIR}/node_modules/playwright-core"
INSTALLER_WRAPPER="${PACKAGE_DIR}/agenos-installer"
RUNTIME_ROOT="$(mktemp -d)"
SERVER_LOG="${RUNTIME_ROOT}/agent-api.log"
DOCTOR_JSON="${RUNTIME_ROOT}/doctor.json"
PID=""

cleanup() {
  if [[ -n "${PID}" ]] && kill -0 "${PID}" 2>/dev/null; then
    kill "${PID}" 2>/dev/null || true
    wait "${PID}" 2>/dev/null || true
  fi
  chmod -R u+w "${RUNTIME_ROOT}" 2>/dev/null || true
  rm -rf "${RUNTIME_ROOT}"
}
trap cleanup EXIT

if [[ ! -x "${BUN}" ]]; then
  echo "No se encontró Bun empaquetado en ${BUN}" >&2
  exit 1
fi

if [[ ! -f "${SERVER_ENTRY}" ]]; then
  echo "No se encontró el broker empaquetado en ${SERVER_ENTRY}" >&2
  exit 1
fi

if [[ ! -x "${INSTALLER_WRAPPER}" ]]; then
  echo "No se encontró el wrapper empaquetado en ${INSTALLER_WRAPPER}" >&2
  exit 1
fi

if [[ ! -f "${PI_PACKAGE_DIR}/package.json" ]]; then
  echo "No se encontró pi-coding-agent empaquetado en ${PI_PACKAGE_DIR}" >&2
  exit 1
fi

# web_control prefiere Playwright y cae al CDP directo si falta; el paquete se
# resuelve desde api/server.js, así que tiene que estar en el node_modules
# hermano y no basta con que exista en el árbol de desarrollo.
if [[ ! -f "${PLAYWRIGHT_PACKAGE_DIR}/package.json" ]]; then
  echo "No se encontró playwright-core empaquetado en ${PLAYWRIGHT_PACKAGE_DIR}" >&2
  exit 1
fi

if curl --silent --fail --max-time 1 http://127.0.0.1:4173/health >/dev/null 2>&1; then
  echo "El puerto 4173 ya está ocupado por un broker local; deténlo antes del smoke empaquetado." >&2
  exit 1
fi

HOME="${RUNTIME_ROOT}/home" \
AGENOS_OPENCLAW_SYSTEM_CONFIG="${ROOT_DIR}/build/live-build/config/includes.chroot/etc/agenos/openclaw.json" \
AGENOS_OPENCLAW_USER_CONFIG="${RUNTIME_ROOT}/worker.json" \
AGENOS_OPENCLAW_STATE_DIR="${RUNTIME_ROOT}/openclaw" \
AGENOS_WORKER_TOKEN_PATH="${RUNTIME_ROOT}/broker/worker-token" \
AGENOS_UI_TOKEN_PATH="${RUNTIME_ROOT}/broker/ui-token" \
"${INSTALLER_WRAPPER}" server >"${SERVER_LOG}" 2>&1 &
PID="$!"

for _ in $(seq 1 40); do
  if curl --silent --fail --max-time 1 http://127.0.0.1:4173/health >/dev/null 2>&1; then
    break
  fi
  if ! kill -0 "${PID}" 2>/dev/null; then
    echo "El broker empaquetado terminó antes de responder." >&2
    cat "${SERVER_LOG}" >&2
    exit 1
  fi
  sleep 0.25
done

curl --silent --fail --max-time 2 http://127.0.0.1:4173/health >/dev/null
curl --silent --max-time 2 http://127.0.0.1:4173/api/agent/admin/status >/dev/null || true
UI_TOKEN="$(tr -d '\n' < "${RUNTIME_ROOT}/broker/ui-token")"
curl --silent --fail --max-time 2 -H "Authorization: Bearer ${UI_TOKEN}" http://127.0.0.1:4173/api/agent/admin/status >/dev/null
curl --silent --fail --max-time 2 -H "Authorization: Bearer ${UI_TOKEN}" http://127.0.0.1:4173/api/agent/admin/policy >/dev/null
curl --silent --fail --max-time 2 -H "Authorization: Bearer ${UI_TOKEN}" http://127.0.0.1:4173/api/agent/confirmations >/dev/null
curl --silent --fail --max-time 15 -H "Authorization: Bearer ${UI_TOKEN}" http://127.0.0.1:4173/api/diagnostics/support-bundle >/dev/null

HOME="${RUNTIME_ROOT}/home" \
AGENOS_OPENCLAW_SYSTEM_CONFIG="${ROOT_DIR}/build/live-build/config/includes.chroot/etc/agenos/openclaw.json" \
AGENOS_OPENCLAW_USER_CONFIG="${RUNTIME_ROOT}/worker.json" \
AGENOS_OPENCLAW_STATE_DIR="${RUNTIME_ROOT}/openclaw" \
AGENOS_WORKER_TOKEN_PATH="${RUNTIME_ROOT}/broker/worker-token" \
"${INSTALLER_WRAPPER}" doctor >"${DOCTOR_JSON}"

grep --silent '"schemaVersion": 1' "${DOCTOR_JSON}"
grep --silent '"commands"' "${DOCTOR_JSON}"

kill "${PID}" 2>/dev/null || true
wait "${PID}" 2>/dev/null || true
PID=""

BLOCKED_PI_ROOT="${RUNTIME_ROOT}/blocked-pi"
BLOCKED_PI_STATUS="${RUNTIME_ROOT}/blocked-pi-status.json"
mkdir -p "${BLOCKED_PI_ROOT}"
chmod 0500 "${BLOCKED_PI_ROOT}"

HOME="${RUNTIME_ROOT}/home" \
AGENOS_PI_AGENT_DIR="${BLOCKED_PI_ROOT}/pi" \
AGENOS_OPENCLAW_SYSTEM_CONFIG="${ROOT_DIR}/build/live-build/config/includes.chroot/etc/agenos/openclaw.json" \
AGENOS_OPENCLAW_USER_CONFIG="${RUNTIME_ROOT}/worker.json" \
AGENOS_OPENCLAW_STATE_DIR="${RUNTIME_ROOT}/openclaw" \
AGENOS_WORKER_TOKEN_PATH="${RUNTIME_ROOT}/broker/worker-token" \
AGENOS_UI_TOKEN_PATH="${RUNTIME_ROOT}/broker/ui-token" \
"${INSTALLER_WRAPPER}" server >>"${SERVER_LOG}" 2>&1 &
PID="$!"

for _ in $(seq 1 40); do
  if curl --silent --fail --max-time 1 http://127.0.0.1:4173/health >/dev/null 2>&1; then
    break
  fi
  if ! kill -0 "${PID}" 2>/dev/null; then
    echo "El broker empaquetado terminó con AGENOS_PI_AGENT_DIR no escribible." >&2
    cat "${SERVER_LOG}" >&2
    exit 1
  fi
  sleep 0.25
done

curl --silent --fail --max-time 2 http://127.0.0.1:4173/health >/dev/null
UI_TOKEN="$(tr -d '\n' < "${RUNTIME_ROOT}/broker/ui-token")"
curl --silent --fail --max-time 2 -H "Authorization: Bearer ${UI_TOKEN}" http://127.0.0.1:4173/api/pi/status >"${BLOCKED_PI_STATUS}"
grep --silent '"authState"' "${BLOCKED_PI_STATUS}"

echo "agent runtime smoke ok"
