#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE_NAME="${IMAGE_NAME:-agenos-live-build}"
LB_DIR="${ROOT_DIR}/build/live-build"
DIST_DIR="${ROOT_DIR}/dist"

mkdir -p "${DIST_DIR}"

docker build -t "${IMAGE_NAME}" "${ROOT_DIR}/tools/live-build"

docker run --rm --privileged \
  -e DEBIAN_FRONTEND=noninteractive \
  -v "${ROOT_DIR}:/workspace" \
  -w /workspace/build/live-build \
  "${IMAGE_NAME}" \
  bash -lc "./auto/clean --purge && ./auto/config && lb build"

ISO_PATH="$(find "${LB_DIR}" -maxdepth 1 -type f -name '*.iso' | head -n 1)"

if [[ -z "${ISO_PATH}" ]]; then
  echo "No se encontro ninguna ISO en ${LB_DIR}" >&2
  exit 1
fi

cp "${ISO_PATH}" "${DIST_DIR}/$(basename "${ISO_PATH}")"
echo "ISO generada en ${DIST_DIR}/$(basename "${ISO_PATH}")"
