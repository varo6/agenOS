#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE_NAME="${IMAGE_NAME:-agenos-live-build}"
LB_DIR="${ROOT_DIR}/build/live-build"
DIST_DIR="${ROOT_DIR}/dist"
SKIP_DOCKER_BUILD="${SKIP_DOCKER_BUILD:-0}"
LB_PURGE="${LB_PURGE:-0}"
REBUILD_DOCKER_IMAGE="${REBUILD_DOCKER_IMAGE:-0}"
DOCKERFILE_PATH="${ROOT_DIR}/tools/live-build/Dockerfile"
DOCKERFILE_HASH="$(sha256sum "${DOCKERFILE_PATH}" | awk '{print $1}')"

mkdir -p "${DIST_DIR}"

if [[ "${SKIP_DOCKER_BUILD}" != "1" ]]; then
  CURRENT_IMAGE_HASH="$(docker image inspect --format '{{ index .Config.Labels "agenos.livebuild.hash" }}' "${IMAGE_NAME}" 2>/dev/null || true)"
  if [[ "${REBUILD_DOCKER_IMAGE}" == "1" || "${CURRENT_IMAGE_HASH}" != "${DOCKERFILE_HASH}" ]]; then
    docker build \
      --label "agenos.livebuild.hash=${DOCKERFILE_HASH}" \
      -t "${IMAGE_NAME}" \
      "${ROOT_DIR}/tools/live-build"
  else
    echo "Reutilizando la imagen Docker ${IMAGE_NAME}."
  fi
fi

docker run --rm \
  -e DEBIAN_FRONTEND=noninteractive \
  -e HOME=/tmp \
  -u "$(id -u):$(id -g)" \
  -v "${ROOT_DIR}:/workspace" \
  -w /workspace \
  "${IMAGE_NAME}" \
  bash -lc "bash ./scripts/build-ui.sh && bash ./scripts/build-installer-ui.sh"

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
