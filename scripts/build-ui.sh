#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UI_DIR="${ROOT_DIR}/components/ui"
OUTPUT_DIR="${ROOT_DIR}/build/live-build/config/includes.chroot/usr/local/share/agenos-ui"

cd "${UI_DIR}"

if [[ -f bun.lock || -f bun.lockb ]]; then
  bun install --frozen-lockfile
else
  bun install
fi

bun run build

mkdir -p "${OUTPUT_DIR}"
rsync -a --delete "${UI_DIR}/dist/" "${OUTPUT_DIR}/"
