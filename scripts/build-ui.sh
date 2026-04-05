#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UI_DIR="${ROOT_DIR}/components/ui"
OUTPUT_DIR="${ROOT_DIR}/build/live-build/config/includes.chroot/usr/local/share/agenos-ui"
STAMP_FILE="${OUTPUT_DIR}/.build-stamp"

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

CURRENT_HASH="$(source_hash | sha256sum | awk '{print $1}')"
CURRENT_STAMP=""

if [[ -f "${STAMP_FILE}" ]]; then
  CURRENT_STAMP="$(cat "${STAMP_FILE}")"
fi

if [[ "${CURRENT_STAMP}" == "${CURRENT_HASH}" && -f "${OUTPUT_DIR}/index.html" ]]; then
  echo "components/ui sin cambios; se reutiliza el build empaquetado."
  exit 0
fi

if [[ -f bun.lock || -f bun.lockb ]]; then
  bun install --frozen-lockfile
else
  bun install
fi

bun run build

mkdir -p "${OUTPUT_DIR}"
rsync -a --delete "${UI_DIR}/dist/" "${OUTPUT_DIR}/"
printf '%s\n' "${CURRENT_HASH}" > "${STAMP_FILE}"
