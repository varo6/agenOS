#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UI_DIR="${ROOT_DIR}/components/ui"
AGENT_DIR="${ROOT_DIR}/components/agent"
NETWORK_DIR="${ROOT_DIR}/components/network"
STATIC_OUTPUT_DIR="${ROOT_DIR}/build/live-build/config/includes.chroot/usr/local/share/agenos-ui"
PACKAGE_OUTPUT_DIR="${ROOT_DIR}/build/live-build/config/includes.chroot/opt/agenos/system"
ELECTRON_APP_DIR="${UI_DIR}/build/electron"
ELECTRON_DIST_DIR="${UI_DIR}/node_modules/electron/dist"
WHISPER_OUTPUT_DIR="${PACKAGE_OUTPUT_DIR}/whisper.cpp"
WHISPER_CPP_REF="${AGENOS_WHISPER_CPP_REF:-v1.7.6}"
# Talla del modelo Whisper que viaja en la ISO. `base` transcribia lo bastante mal
# en espanol como para arruinar la experiencia voice-first; `small` es el salto
# util sin irse a `medium`, que en un portatil modesto ya no da latencia usable.
WHISPER_MODEL_FILE="${AGENOS_WHISPER_MODEL_FILE:-ggml-small.bin}"
WHISPER_MODEL_URL="${AGENOS_WHISPER_MODEL_URL:-https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${WHISPER_MODEL_FILE}}"
WHISPER_MODEL_SHA1="${AGENOS_WHISPER_MODEL_SHA1:-55356645c2b361a969dfd0ef2c5a50d530afd8d5}"
WHISPER_BUILD_PROFILE="static-simd-plus-baseline-x86_64-v1"
CODEX_BIN_PATH=""
STAMP_FILE="${PACKAGE_OUTPUT_DIR}/.build-stamp"

source_hash() {
  (
    cd "${UI_DIR}"
    local inputs=()

    for path in src dev public package.json bun.lock bun.lockb index.html vite.config.ts tsconfig.json tsconfig.node.json; do
      [[ -e "${path}" ]] && inputs+=("${path}")
    done

    find "${inputs[@]}" -type f -not -name '*.test.ts' -not -name '*.test.tsx' -print 2>/dev/null \
      | LC_ALL=C sort \
      | xargs sha256sum
  )
}

# Los tests quedan fuera del hash a proposito: no se empaquetan ni se importan
# desde el codigo que se compila, asi que editarlos solo disparaba un rebuild
# completo cuyo resultado era byte a byte identico.
agent_source_hash() {
  (
    cd "${AGENT_DIR}"
    find . -type f -not -name '*.test.ts' -not -name '*.test.tsx' -print 2>/dev/null \
      | LC_ALL=C sort \
      | xargs sha256sum
  )
}

network_source_hash() {
  (
    cd "${NETWORK_DIR}"
    find package.json bun.lock bun.lockb types.ts client.ts node react -type f -print 2>/dev/null \
      | LC_ALL=C sort \
      | xargs sha256sum
  )
}

install_whisper_cpp() {
  local cli_path="${WHISPER_OUTPUT_DIR}/whisper-cli"
  local baseline_cli_path="${WHISPER_OUTPUT_DIR}/whisper-cli-baseline"
  local model_path="${WHISPER_OUTPUT_DIR}/models/${WHISPER_MODEL_FILE}"
  local metadata_path="${WHISPER_OUTPUT_DIR}/stt.env"

  local binaries_ready=0
  if [[ -x "${cli_path}" && -x "${baseline_cli_path}" ]] \
    && grep -q "^build_profile=${WHISPER_BUILD_PROFILE}$" "${metadata_path}" 2>/dev/null; then
    binaries_ready=1
  fi

  if [[ "${binaries_ready}" == "1" && -f "${model_path}" ]] \
    && grep -q "^model=${WHISPER_MODEL_FILE}$" "${metadata_path}" 2>/dev/null \
    && printf '%s  %s\n' "${WHISPER_MODEL_SHA1}" "${model_path}" | sha1sum -c - >/dev/null 2>&1; then
    return 0
  fi

  local work_dir
  work_dir="$(mktemp -d)"
  trap 'rm -rf "${work_dir:-}"' EXIT

  mkdir -p "${WHISPER_OUTPUT_DIR}/models" "${WHISPER_OUTPUT_DIR}/lib"

  # Cambiar de talla de modelo no obliga a recompilar: los binarios no dependen
  # del modelo. Solo se reconstruyen si faltan o si cambia el perfil de build.
  if [[ "${binaries_ready}" == "1" ]]; then
    echo "Reusing whisper.cpp ${WHISPER_CPP_REF} binaries; installing ${WHISPER_MODEL_FILE} (multilingual)..."
  else
    echo "Building whisper.cpp ${WHISPER_CPP_REF} and installing ${WHISPER_MODEL_FILE} (multilingual)..."

    curl -fsSL --retry 3 "https://github.com/ggml-org/whisper.cpp/archive/refs/tags/${WHISPER_CPP_REF}.tar.gz" \
      -o "${work_dir}/whisper.cpp.tar.gz"
    tar -xzf "${work_dir}/whisper.cpp.tar.gz" -C "${work_dir}"

    local source_dir
    source_dir="$(find "${work_dir}" -maxdepth 1 -type d -name 'whisper.cpp-*' -print -quit)"
    if [[ -z "${source_dir}" ]]; then
      echo "No se pudo localizar el source extraido de whisper.cpp." >&2
      exit 1
    fi

    cmake -S "${source_dir}" -B "${work_dir}/build-simd" \
      -DCMAKE_BUILD_TYPE=Release \
      -DBUILD_SHARED_LIBS=OFF \
      -DGGML_NATIVE=OFF \
      -DGGML_OPENMP=OFF \
      -DWHISPER_BUILD_TESTS=OFF \
      -DWHISPER_SDL2=OFF
    cmake --build "${work_dir}/build-simd" --target whisper-cli -j"$(nproc)"
    install -m 0755 "${work_dir}/build-simd/bin/whisper-cli" "${cli_path}"

    cmake -S "${source_dir}" -B "${work_dir}/build-baseline" \
      -DCMAKE_BUILD_TYPE=Release \
      -DBUILD_SHARED_LIBS=OFF \
      -DGGML_NATIVE=OFF \
      -DGGML_OPENMP=OFF \
      -DGGML_SSE42=OFF \
      -DGGML_AVX=OFF \
      -DGGML_AVX2=OFF \
      -DGGML_AVX_VNNI=OFF \
      -DGGML_FMA=OFF \
      -DGGML_F16C=OFF \
      -DGGML_BMI2=OFF \
      -DGGML_AVX512=OFF \
      -DGGML_AVX512_VBMI=OFF \
      -DGGML_AVX512_VNNI=OFF \
      -DGGML_AVX512_BF16=OFF \
      -DWHISPER_BUILD_TESTS=OFF \
      -DWHISPER_SDL2=OFF
    cmake --build "${work_dir}/build-baseline" --target whisper-cli -j"$(nproc)"
    install -m 0755 "${work_dir}/build-baseline/bin/whisper-cli" "${baseline_cli_path}"
  fi

  if ! printf '%s  %s\n' "${WHISPER_MODEL_SHA1}" "${model_path}" | sha1sum -c - >/dev/null 2>&1; then
    curl -fL --retry 3 "${WHISPER_MODEL_URL}" -o "${model_path}.tmp"
    if ! printf '%s  %s\n' "${WHISPER_MODEL_SHA1}" "${model_path}.tmp" | sha1sum -c - >/dev/null; then
      echo "La suma SHA1 del modelo ${WHISPER_MODEL_FILE} no coincide." >&2
      rm -f "${model_path}.tmp"
      exit 1
    fi
    mv "${model_path}.tmp" "${model_path}"
  fi

  # Un cambio de talla dejaria el modelo viejo en includes.chroot y la ISO
  # cargaria con los dos. Aqui no hay rsync --delete que lo limpie por nosotros.
  find "${WHISPER_OUTPUT_DIR}/models" -maxdepth 1 -type f -name 'ggml-*.bin' \
    ! -name "${WHISPER_MODEL_FILE}" -delete

  printf '%s\n' \
    "engine=whisper.cpp" \
    "ref=${WHISPER_CPP_REF}" \
    "build_profile=${WHISPER_BUILD_PROFILE}" \
    "model=${WHISPER_MODEL_FILE}" \
    "language=es" \
    "note=${WHISPER_MODEL_FILE} is multilingual; the .en variants are intentionally not installed." \
    > "${WHISPER_OUTPUT_DIR}/stt.env"

  rm -rf "${work_dir}"
  trap - EXIT
}

cd "${UI_DIR}"

CURRENT_HASH="$(
  {
    source_hash
    agent_source_hash
    network_source_hash
    sha256sum "${ROOT_DIR}/scripts/build-ui.sh"
  } | sha256sum | awk '{print $1}'
)"
CURRENT_STAMP=""

if [[ -f "${STAMP_FILE}" ]]; then
  CURRENT_STAMP="$(cat "${STAMP_FILE}")"
fi

if [[ "${CURRENT_STAMP}" == "${CURRENT_HASH}" && -f "${STATIC_OUTPUT_DIR}/index.html" && -x "${PACKAGE_OUTPUT_DIR}/agenos-system-ui" && -x "${PACKAGE_OUTPUT_DIR}/electron-dist/electron" && -f "${PACKAGE_OUTPUT_DIR}/electron-app/pi-system-context.md" && -x "${WHISPER_OUTPUT_DIR}/whisper-cli" && -x "${WHISPER_OUTPUT_DIR}/whisper-cli-baseline" && -f "${WHISPER_OUTPUT_DIR}/models/${WHISPER_MODEL_FILE}" ]] \
  && grep -q "^build_profile=${WHISPER_BUILD_PROFILE}$" "${WHISPER_OUTPUT_DIR}/stt.env" 2>/dev/null \
  && grep -q "^model=${WHISPER_MODEL_FILE}$" "${WHISPER_OUTPUT_DIR}/stt.env" 2>/dev/null \
  && printf '%s  %s\n' "${WHISPER_MODEL_SHA1}" "${WHISPER_OUTPUT_DIR}/models/${WHISPER_MODEL_FILE}" | sha1sum -c - >/dev/null 2>&1; then
  echo "components/ui sin cambios; se reutiliza el build empaquetado."
  exit 0
fi

if [[ -f bun.lock || -f bun.lockb ]]; then
  bun install --frozen-lockfile
else
  bun install
fi

if [[ -f "${NETWORK_DIR}/bun.lock" || -f "${NETWORK_DIR}/bun.lockb" ]]; then
  (cd "${NETWORK_DIR}" && bun install --frozen-lockfile)
else
  (cd "${NETWORK_DIR}" && bun install)
fi

bun run build
install_whisper_cpp

if [[ ! -f "${UI_DIR}/dist/index.html" ]]; then
  echo "No se encontró la vista compilada en ${UI_DIR}/dist/index.html" >&2
  exit 1
fi

if [[ ! -x "${ELECTRON_DIST_DIR}/electron" ]]; then
  echo "No se encontró el runtime de Electron en ${ELECTRON_DIST_DIR}/electron" >&2
  exit 1
fi

CODEX_BIN_PATH="$(
  find "${UI_DIR}/node_modules/@openai" -path '*/vendor/*/codex/codex' -type f -perm -111 -print -quit 2>/dev/null || true
)"
if [[ -z "${CODEX_BIN_PATH}" ]]; then
  echo "No se encontró el binario empaquetado de Codex." >&2
  exit 1
fi

mkdir -p \
  "${STATIC_OUTPUT_DIR}" \
  "${PACKAGE_OUTPUT_DIR}/dist" \
  "${PACKAGE_OUTPUT_DIR}/electron-app" \
  "${PACKAGE_OUTPUT_DIR}/electron-dist" \
  "${PACKAGE_OUTPUT_DIR}/codex-bin"

rsync -a --delete "${UI_DIR}/dist/" "${STATIC_OUTPUT_DIR}/"
rsync -a --delete "${UI_DIR}/dist/" "${PACKAGE_OUTPUT_DIR}/dist/"
rsync -a --delete "${ELECTRON_APP_DIR}/" "${PACKAGE_OUTPUT_DIR}/electron-app/"
rsync -a --delete "${ELECTRON_DIST_DIR}/" "${PACKAGE_OUTPUT_DIR}/electron-dist/"
install -m 0755 "${CODEX_BIN_PATH}" "${PACKAGE_OUTPUT_DIR}/codex-bin/codex"
install -m 0644 "${AGENT_DIR}/pi-system-context.md" "${PACKAGE_OUTPUT_DIR}/electron-app/pi-system-context.md"

if [[ -f "${PACKAGE_OUTPUT_DIR}/electron-dist/chrome-sandbox" ]]; then
  chmod 0755 "${PACKAGE_OUTPUT_DIR}/electron-dist/chrome-sandbox"
fi

printf '%s\n' \
  '#!/bin/sh' \
  'set -eu' \
  'SCRIPT_DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"' \
  'if [ -n "${XDG_RUNTIME_DIR:-}" ]; then' \
  '  RUNTIME_DIR="${XDG_RUNTIME_DIR}/agenos-system"' \
  'else' \
  '  RUNTIME_DIR="${HOME:-/tmp}/.cache/agenos-system/runtime"' \
  'fi' \
  'PROFILE_DIR="${RUNTIME_DIR}/electron-profile"' \
  'LOCK_FILE="${RUNTIME_DIR}/electron.lock"' \
  'API_URL="http://127.0.0.1:4173/health"' \
  'API_PID_FILE="${RUNTIME_DIR}/api.pid"' \
  'API_LOG="${RUNTIME_DIR}/api.log"' \
  'ELECTRON_BIN="${AGENOS_SYSTEM_ELECTRON_BIN:-${SCRIPT_DIR}/electron-dist/electron}"' \
  'ELECTRON_APP="${AGENOS_SYSTEM_ELECTRON_APP:-${SCRIPT_DIR}/electron-app}"' \
  'INSTALLER_BIN="${AGENOS_INSTALLER_BIN:-/opt/agenos/installer/agenos-installer}"' \
  '' \
  'mkdir -p "${RUNTIME_DIR}" "${PROFILE_DIR}"' \
  'if [ ! -x "${ELECTRON_BIN}" ]; then' \
  '  echo "No se encontró el binario empaquetado de Electron." >&2' \
  '  exit 1' \
  'fi' \
  '' \
  'export AGENOS_UI_DIST_DIR="${SCRIPT_DIR}/dist"' \
  'export AGENOS_SYSTEM_BRIDGE_MODE="${AGENOS_SYSTEM_BRIDGE_MODE:-ipc}"' \
  'export AGENOS_ELECTRON_GPU_MODE="${AGENOS_ELECTRON_GPU_MODE:-auto}"' \
  'export AGENOS_CODEX_BIN="${SCRIPT_DIR}/codex-bin/codex"' \
  'export AGENOS_WHISPER_CPP_BIN="${AGENOS_WHISPER_CPP_BIN:-${SCRIPT_DIR}/whisper.cpp/whisper-cli}"' \
  "export AGENOS_WHISPER_MODEL=\"\${AGENOS_WHISPER_MODEL:-\${SCRIPT_DIR}/whisper.cpp/models/${WHISPER_MODEL_FILE}}\"" \
  'export AGENOS_STT_RECORD_SECONDS="${AGENOS_STT_RECORD_SECONDS:-4}"' \
  'export AGENOS_PI_AGENT_DIR="${AGENOS_PI_AGENT_DIR:-${HOME:-/tmp}/.agenos/ui-dev/pi}"' \
  'export AGENOS_OPENCLAW_SYSTEM_CONFIG="${AGENOS_OPENCLAW_SYSTEM_CONFIG:-/etc/agenos/openclaw.json}"' \
  'export AGENOS_OPENCLAW_USER_CONFIG="${AGENOS_OPENCLAW_USER_CONFIG:-${HOME:-/tmp}/.agenos/openclaw/config.json}"' \
  'export AGENOS_OPENCLAW_STATE_DIR="${AGENOS_OPENCLAW_STATE_DIR:-${HOME:-/tmp}/.agenos/openclaw}"' \
  'export AGENOS_WORKER_TOKEN_PATH="${AGENOS_WORKER_TOKEN_PATH:-${HOME:-/tmp}/.agenos/broker/worker-token}"' \
  'export ELECTRON_IS_DEV=0' \
  'export ELECTRON_OZONE_PLATFORM_HINT=auto' \
  'export TMPDIR="${RUNTIME_DIR}"' \
  '' \
  'start_api() {' \
  '  # Da prioridad al broker supervisado por systemd, pero no presupongas que' \
  '  # estar habilitado significa que haya arrancado correctamente.' \
  '  if command -v systemctl >/dev/null 2>&1 && systemctl is-enabled --quiet agenos-agent-api.service 2>/dev/null; then' \
  '    attempts=0' \
  '    while [ "${attempts}" -lt 12 ]; do' \
  '      if curl --silent --fail --max-time 1 "${API_URL}" >/dev/null 2>&1; then' \
  '        return 0' \
  '      fi' \
  '      if systemctl is-failed --quiet agenos-agent-api.service 2>/dev/null; then' \
  '        break' \
  '      fi' \
  '      attempts=$((attempts + 1))' \
  '      sleep 0.25' \
  '    done' \
  '  fi' \
  '' \
  '  if curl --silent --fail --max-time 1 "${API_URL}" >/dev/null 2>&1; then' \
  '    return 0' \
  '  fi' \
  '' \
  '  if [ ! -x "${INSTALLER_BIN}" ]; then' \
  '    echo "No se encontró el broker empaquetado en ${INSTALLER_BIN}." >&2' \
  '    return 1' \
  '  fi' \
  '' \
  '  if [ -f "${API_PID_FILE}" ]; then' \
  '    pid="$(cat "${API_PID_FILE}" 2>/dev/null || true)"' \
  '    if [ -n "${pid}" ] && kill -0 "${pid}" 2>/dev/null; then' \
  '      :' \
  '    else' \
  '      rm -f "${API_PID_FILE}"' \
  '    fi' \
  '  fi' \
  '' \
  '  if [ ! -f "${API_PID_FILE}" ]; then' \
  '    "${INSTALLER_BIN}" server >>"${API_LOG}" 2>&1 &' \
  '    echo "$!" > "${API_PID_FILE}"' \
  '  fi' \
  '}' \
  '' \
  '# El broker de desarrollo no forma parte de la ruta crítica al primer frame.' \
  'start_api &' \
  'exec flock -n "${LOCK_FILE}" "${ELECTRON_BIN}" "${ELECTRON_APP}" \' \
  '  --no-sandbox \' \
  '  --disable-dev-shm-usage \' \
  '  "--user-data-dir=${PROFILE_DIR}"' \
  > "${PACKAGE_OUTPUT_DIR}/agenos-system-ui"

chmod +x "${PACKAGE_OUTPUT_DIR}/agenos-system-ui"
printf '%s\n' "${CURRENT_HASH}" > "${STAMP_FILE}"
