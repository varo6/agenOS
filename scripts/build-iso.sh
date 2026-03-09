#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE_NAME="${IMAGE_NAME:-agenos-live-build}"
LB_DIR="${ROOT_DIR}/build/live-build"
DIST_DIR="${ROOT_DIR}/dist"
SKIP_DOCKER_BUILD="${SKIP_DOCKER_BUILD:-0}"
LB_PURGE="${LB_PURGE:-0}"

mkdir -p "${DIST_DIR}"

if [[ "${SKIP_DOCKER_BUILD}" != "1" ]]; then
  docker build -t "${IMAGE_NAME}" "${ROOT_DIR}/tools/live-build"
fi

if [[ "${LB_PURGE}" == "1" ]]; then
  BUILD_CMD="./auto/clean --purge && ./auto/config && lb build"
else
  BUILD_CMD="./auto/clean && ./auto/config && lb build"
fi

docker run --rm --privileged \
  -e DEBIAN_FRONTEND=noninteractive \
  -e LB_PURGE="${LB_PURGE}" \
  -v "${ROOT_DIR}:/workspace" \
  -w /workspace/build/live-build \
  "${IMAGE_NAME}" \
  bash -lc "${BUILD_CMD}"

ISO_PATH="$(find "${LB_DIR}" -maxdepth 1 -type f -name '*.iso' | head -n 1)"

if [[ -z "${ISO_PATH}" ]]; then
  echo "No se encontro ninguna ISO en ${LB_DIR}" >&2
  exit 1
fi

cp "${ISO_PATH}" "${DIST_DIR}/$(basename "${ISO_PATH}")"
echo "ISO generada en ${DIST_DIR}/$(basename "${ISO_PATH}")"
