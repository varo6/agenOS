#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UI_DIR="${ROOT_DIR}/components/installer-ui"
OUTPUT_DIR="${ROOT_DIR}/build/live-build/config/includes.chroot/usr/local/share/agenos-installer-ui"

cd "${UI_DIR}"

if [[ -f package-lock.json ]]; then
  npm ci
else
  npm install
fi

npm run build

mkdir -p "${OUTPUT_DIR}"
rsync -a --delete "${UI_DIR}/dist/" "${OUTPUT_DIR}/"
