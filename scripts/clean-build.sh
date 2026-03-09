#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE_NAME="${IMAGE_NAME:-agenos-live-build}"

docker run --rm --privileged \
  -e DEBIAN_FRONTEND=noninteractive \
  -v "${ROOT_DIR}:/workspace" \
  -w /workspace/build/live-build \
  "${IMAGE_NAME}" \
  bash -lc "./auto/clean --purge"

rm -rf "${ROOT_DIR}/dist"
