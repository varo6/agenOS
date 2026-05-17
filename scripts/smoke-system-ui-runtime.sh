#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SYSTEM_WRAPPER="${ROOT_DIR}/build/live-build/config/includes.chroot/opt/agenos/system/agenos-system-ui"
INSTALLER_WRAPPER="${ROOT_DIR}/build/live-build/config/includes.chroot/opt/agenos/installer/agenos-installer"
RUNTIME_ROOT="$(mktemp -d)"
FAKE_ELECTRON="${RUNTIME_ROOT}/fake-electron"
PID_FILE="${RUNTIME_ROOT}/xdg/agenos-system/api.pid"

cleanup() {
  if [[ -f "${PID_FILE}" ]]; then
    pid="$(cat "${PID_FILE}" 2>/dev/null || true)"
    if [[ -n "${pid}" ]] && kill -0 "${pid}" 2>/dev/null; then
      kill "${pid}" 2>/dev/null || true
      wait "${pid}" 2>/dev/null || true
    fi
  fi
  rm -rf "${RUNTIME_ROOT}"
}
trap cleanup EXIT

if [[ ! -x "${SYSTEM_WRAPPER}" ]]; then
  echo "No se encontró el wrapper de sistema en ${SYSTEM_WRAPPER}" >&2
  exit 1
fi

if [[ ! -x "${INSTALLER_WRAPPER}" ]]; then
  echo "No se encontró el wrapper del broker en ${INSTALLER_WRAPPER}" >&2
  exit 1
fi

if curl --silent --fail --max-time 1 http://127.0.0.1:4173/health >/dev/null 2>&1; then
  echo "El puerto 4173 ya está ocupado; detén el broker local antes del smoke de sistema." >&2
  exit 1
fi

cat >"${FAKE_ELECTRON}" <<'EOF'
#!/bin/sh
set -eu

for _ in $(seq 1 20); do
  if curl --silent --fail --max-time 1 http://127.0.0.1:4173/health >/dev/null 2>&1; then
    exit 0
  fi
  sleep 0.25
done

echo "El wrapper de sistema no levantó el broker antes de lanzar Electron." >&2
exit 42
EOF
chmod +x "${FAKE_ELECTRON}"

mkdir -p "${RUNTIME_ROOT}/home" "${RUNTIME_ROOT}/xdg"

HOME="${RUNTIME_ROOT}/home" \
XDG_RUNTIME_DIR="${RUNTIME_ROOT}/xdg" \
AGENOS_SYSTEM_ELECTRON_BIN="${FAKE_ELECTRON}" \
AGENOS_INSTALLER_BIN="${INSTALLER_WRAPPER}" \
AGENOS_OPENCLAW_SYSTEM_CONFIG="${ROOT_DIR}/build/live-build/config/includes.chroot/etc/agenos/openclaw.json" \
AGENOS_OPENCLAW_USER_CONFIG="${RUNTIME_ROOT}/worker.json" \
AGENOS_OPENCLAW_STATE_DIR="${RUNTIME_ROOT}/openclaw" \
AGENOS_WORKER_TOKEN_PATH="${RUNTIME_ROOT}/broker/worker-token" \
"${SYSTEM_WRAPPER}" >/dev/null

echo "system ui runtime smoke ok"
