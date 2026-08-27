#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=build-ui.sh
source "${ROOT_DIR}/scripts/build-ui.sh"

original_voxtype="$(voxtype_fingerprint)"
original_whisper="$(whisper_native_fingerprint)"
original_models="$(models_fingerprint)"
original_voxtype_ref="${VOXTYPE_REF}"
original_model_file="${WHISPER_MODEL_FILE}"
original_model_url="${WHISPER_MODEL_URL}"
original_model_sha1="${WHISPER_MODEL_SHA1}"

VOXTYPE_REF="v-test-only"
[[ "$(voxtype_fingerprint)" != "${original_voxtype}" ]]
[[ "$(whisper_native_fingerprint)" == "${original_whisper}" ]]
[[ "$(models_fingerprint)" == "${original_models}" ]]

VOXTYPE_REF="${original_voxtype_ref}"
WHISPER_MODEL_FILE="candidate.bin"
WHISPER_MODEL_URL="file:///candidate.bin"
WHISPER_MODEL_SHA1="0000000000000000000000000000000000000000"
[[ "$(models_fingerprint)" != "${original_models}" ]]
[[ "$(voxtype_fingerprint)" == "${original_voxtype}" ]]
[[ "$(whisper_native_fingerprint)" == "${original_whisper}" ]]

[[ "${CARGO_TARGET_ROOT}" == *"/.cache/stt/cargo-target/voxtype/${AGENOS_VOXTYPE_REF:-v0.7.5}/${VOXTYPE_BUILD_PROFILE}" ]]

test_dir="$(mktemp -d)"
WHISPER_OUTPUT_DIR="${test_dir}/package"
WHISPER_MODEL_FILE="${original_model_file}"
WHISPER_MODEL_URL="${original_model_url}"
WHISPER_VAD_MODEL_FILE="vad.bin"
mkdir -p "${WHISPER_OUTPUT_DIR}/models"
printf 'model' > "${WHISPER_OUTPUT_DIR}/models/${WHISPER_MODEL_FILE}"
printf 'vad' > "${WHISPER_OUTPUT_DIR}/models/${WHISPER_VAD_MODEL_FILE}"
WHISPER_MODEL_SHA1="$(sha1sum "${WHISPER_OUTPUT_DIR}/models/${WHISPER_MODEL_FILE}" | awk '{print $1}')"
WHISPER_VAD_MODEL_SHA1="$(sha1sum "${WHISPER_OUTPUT_DIR}/models/${WHISPER_VAD_MODEL_FILE}" | awk '{print $1}')"
for binary in voxtype voxtype-baseline whisper-server whisper-server-baseline agenos-vad-capture agenos-vad-capture-baseline; do
  printf '#!/bin/sh\n' > "${WHISPER_OUTPUT_DIR}/${binary}"
  chmod +x "${WHISPER_OUTPUT_DIR}/${binary}"
done
printf 'MIT\n' > "${WHISPER_OUTPUT_DIR}/LICENSE.voxtype"
write_stt_manifest
stt_install_is_current

VOXTYPE_REF="v-cache-test"
! voxtype_install_is_current
whisper_native_install_is_current
models_install_is_current

VOXTYPE_REF="${original_voxtype_ref}"
WHISPER_MODEL_FILE="changed.bin"
WHISPER_MODEL_URL="file:///changed.bin"
WHISPER_MODEL_SHA1="${original_model_sha1}"
voxtype_install_is_current
whisper_native_install_is_current
! models_install_is_current

if (
  VOXTYPE_PREBUILT_URL="https://artifacts.invalid/voxtype.tar.gz"
  VOXTYPE_PREBUILT_SHA256=""
  install_voxtype_from_prebuilt "${test_dir}"
) >/dev/null 2>&1; then
  echo "A prebuilt URL without SHA-256 was accepted." >&2
  exit 1
fi
rm -rf "${test_dir}"

echo "STT build fingerprints are independent."
