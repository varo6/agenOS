#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UI_DIR="${ROOT_DIR}/components/ui"
AGENT_DIR="${ROOT_DIR}/components/agent"
NETWORK_DIR="${ROOT_DIR}/components/network"
STT_DIR="${ROOT_DIR}/components/stt"
STATIC_OUTPUT_DIR="${ROOT_DIR}/build/live-build/config/includes.chroot/usr/local/share/agenos-ui"
PACKAGE_OUTPUT_DIR="${ROOT_DIR}/build/live-build/config/includes.chroot/opt/agenos/system"
ELECTRON_APP_DIR="${UI_DIR}/build/electron"
ELECTRON_DIST_DIR="${UI_DIR}/node_modules/electron/dist"
WHISPER_OUTPUT_DIR="${PACKAGE_OUTPUT_DIR}/whisper.cpp"
VAD_CAPTURE_SRC_DIR="${ROOT_DIR}/tools/whisper-vad-capture"
WHISPER_CPP_REF="${AGENOS_WHISPER_CPP_REF:-v1.7.6}"
VOXTYPE_REF="${AGENOS_VOXTYPE_REF:-v0.7.5}"
# Voxtype usa `small` multilingue Q5_1 con el idioma fijado a espanol. El
# proceso se carga mientras se graba y termina tras cada frase, por lo que sus
# aproximadamente 600-700 MiB no quedan residentes en reposo.
WHISPER_MODEL_FILE="${AGENOS_WHISPER_MODEL_FILE:-ggml-small-q5_1.bin}"
WHISPER_MODEL_URL="${AGENOS_WHISPER_MODEL_URL:-https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${WHISPER_MODEL_FILE}}"
WHISPER_MODEL_SHA1="${AGENOS_WHISPER_MODEL_SHA1:-6fe57ddcfdd1c6b07cdcc73aaf620810ce5fc771}"
# Silero VAD en formato ggml. Viaja en la ISO porque el STT tiene que funcionar
# sin Internet: sin este fichero no hay forma de saber cuando termina la frase
# ni de descartar el silencio antes de que Whisper se lo invente.
WHISPER_VAD_MODEL_FILE="${AGENOS_WHISPER_VAD_MODEL_FILE:-ggml-silero-v5.1.2.bin}"
WHISPER_VAD_MODEL_URL="${AGENOS_WHISPER_VAD_MODEL_URL:-https://huggingface.co/ggml-org/whisper-vad/resolve/main/${WHISPER_VAD_MODEL_FILE}}"
WHISPER_VAD_MODEL_SHA1="${AGENOS_WHISPER_VAD_MODEL_SHA1:-a372f48dcf0bd9e4330eef2802bc46e061c19634}"
WHISPER_BUILD_PROFILE="static-explicit-avx2-plus-x86-64-v1-server-vad"
VOXTYPE_BUILD_PROFILE="bookworm-explicit-avx2-plus-x86-64-v1"
STT_CACHE_DIR="${ROOT_DIR}/.cache/stt"
CARGO_TARGET_ROOT="${STT_CACHE_DIR}/cargo-target/voxtype/${VOXTYPE_REF}/${VOXTYPE_BUILD_PROFILE}"
CCACHE_DIR="${STT_CACHE_DIR}/ccache"
VOXTYPE_PREBUILT_URL="${AGENOS_VOXTYPE_PREBUILT_URL:-}"
VOXTYPE_PREBUILT_SHA256="${AGENOS_VOXTYPE_PREBUILT_SHA256:-}"
CODEX_BIN_PATH=""
STAMP_FILE="${PACKAGE_OUTPUT_DIR}/.build-stamp"

# Cada huella describe un artefacto independiente. Los modelos nunca invalidan
# binarios y cambiar Voxtype no obliga a recompilar whisper.cpp.
voxtype_fingerprint() {
  {
    printf '%s\n' \
      "ref=${VOXTYPE_REF}" \
      "profile=${VOXTYPE_BUILD_PROFILE}" \
      "rust_baseline=-C target-cpu=x86-64" \
      "rust_optimized=-C target-cpu=x86-64 +sse4.2,+avx,+avx2,+fma,+f16c,+bmi2" \
      "ggml_native=OFF" \
      "prebuilt_url=${VOXTYPE_PREBUILT_URL}" \
      "prebuilt_sha256=${VOXTYPE_PREBUILT_SHA256}"
    declare -f install_voxtype install_voxtype_from_prebuilt
  } | sha256sum | awk '{print $1}'
}

whisper_native_fingerprint() {
  {
    printf '%s\n' \
      "ref=${WHISPER_CPP_REF}" \
      "profile=${WHISPER_BUILD_PROFILE}" \
      "simd=sse4.2,avx,avx2,fma,f16c,bmi2" \
      "baseline=x86-64-v1" \
      "targets=whisper-server,agenos-vad-capture"
    find "${VAD_CAPTURE_SRC_DIR}" -type f -print 2>/dev/null | LC_ALL=C sort | xargs sha256sum
    declare -f install_whisper_native
  } | sha256sum | awk '{print $1}'
}

models_fingerprint() {
  {
    printf '%s\n' \
      "model=${WHISPER_MODEL_FILE}" \
      "model_url=${WHISPER_MODEL_URL}" \
      "model_sha1=${WHISPER_MODEL_SHA1}" \
      "vad_model=${WHISPER_VAD_MODEL_FILE}" \
      "vad_model_url=${WHISPER_VAD_MODEL_URL}" \
      "vad_model_sha1=${WHISPER_VAD_MODEL_SHA1}"
    declare -f download_verified_model install_stt_models
  } | sha256sum | awk '{print $1}'
}

manifest_has() {
  grep -q "^$1=$2$" "${WHISPER_OUTPUT_DIR}/stt.env" 2>/dev/null
}

voxtype_install_is_current() {
  manifest_has voxtype_fingerprint "$(voxtype_fingerprint)" \
    && [[ -x "${WHISPER_OUTPUT_DIR}/voxtype" && -x "${WHISPER_OUTPUT_DIR}/voxtype-baseline" ]] \
    && [[ -f "${WHISPER_OUTPUT_DIR}/LICENSE.voxtype" ]]
}

whisper_native_install_is_current() {
  manifest_has whisper_native_fingerprint "$(whisper_native_fingerprint)" \
    && [[ -x "${WHISPER_OUTPUT_DIR}/whisper-server" && -x "${WHISPER_OUTPUT_DIR}/whisper-server-baseline" ]] \
    && [[ -x "${WHISPER_OUTPUT_DIR}/agenos-vad-capture" && -x "${WHISPER_OUTPUT_DIR}/agenos-vad-capture-baseline" ]]
}

models_install_is_current() {
  manifest_has models_fingerprint "$(models_fingerprint)" \
    && printf '%s  %s\n' "${WHISPER_MODEL_SHA1}" "${WHISPER_OUTPUT_DIR}/models/${WHISPER_MODEL_FILE}" | sha1sum -c - >/dev/null 2>&1 \
    && printf '%s  %s\n' "${WHISPER_VAD_MODEL_SHA1}" "${WHISPER_OUTPUT_DIR}/models/${WHISPER_VAD_MODEL_FILE}" | sha1sum -c - >/dev/null 2>&1
}

stt_install_is_current() {
  voxtype_install_is_current && whisper_native_install_is_current && models_install_is_current
}

download_verified_model() {
  local url="$1" path="$2" sha1="$3" label="$4"

  if printf '%s  %s\n' "${sha1}" "${path}" | sha1sum -c - >/dev/null 2>&1; then
    return 0
  fi

  echo "Descargando ${label}..."
  curl -fL --retry 3 "${url}" -o "${path}.tmp"
  if ! printf '%s  %s\n' "${sha1}" "${path}.tmp" | sha1sum -c - >/dev/null; then
    echo "La suma SHA1 de ${label} no coincide." >&2
    rm -f "${path}.tmp"
    exit 1
  fi
  mv "${path}.tmp" "${path}"
}

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

# components/stt lo importan tanto el main de Electron como el servidor HTTP,
# asi que un cambio ahi tiene que invalidar el build empaquetado.
stt_source_hash() {
  (
    cd "${STT_DIR}"
    find . -type f -not -name '*.test.ts' -print 2>/dev/null \
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

install_whisper_native() {
  whisper_native_install_is_current && return 0
  local work_dir
  work_dir="$(mktemp -d)"
  trap 'rm -rf "${work_dir:-}"' EXIT

  mkdir -p "${WHISPER_OUTPUT_DIR}" "${CCACHE_DIR}"

  echo "Building whisper.cpp ${WHISPER_CPP_REF} (server + vad-capture)..."

  curl -fsSL --retry 3 "https://github.com/ggml-org/whisper.cpp/archive/refs/tags/${WHISPER_CPP_REF}.tar.gz" \
    -o "${work_dir}/whisper.cpp.tar.gz"
  tar -xzf "${work_dir}/whisper.cpp.tar.gz" -C "${work_dir}"

  local source_dir
  source_dir="$(find "${work_dir}" -maxdepth 1 -type d -name 'whisper.cpp-*' -print -quit)"
  if [[ -z "${source_dir}" ]]; then
    echo "No se pudo localizar el source extraido de whisper.cpp." >&2
    exit 1
  fi

  # El helper de VAD se compila dentro del arbol de whisper.cpp para enlazar
  # contra la misma libwhisper que el resto de binarios, con el mismo perfil de
  # instrucciones. Si no, un equipo sin AVX2 tendria un whisper baseline y un
  # VAD que revienta con SIGILL.
  cp -r "${VAD_CAPTURE_SRC_DIR}" "${source_dir}/examples/agenos-vad-capture"
  echo 'add_subdirectory(agenos-vad-capture)' >> "${source_dir}/examples/CMakeLists.txt"

  local targets=(whisper-server agenos-vad-capture)
  local ccache_args=()
  if command -v ccache >/dev/null 2>&1; then
    ccache_args=(-DGGML_CCACHE=ON -DCMAKE_C_COMPILER_LAUNCHER=ccache -DCMAKE_CXX_COMPILER_LAUNCHER=ccache)
  fi

  CCACHE_DIR="${CCACHE_DIR}" cmake -S "${source_dir}" -B "${work_dir}/build-simd" \
    -DCMAKE_BUILD_TYPE=Release \
    -DBUILD_SHARED_LIBS=OFF \
    -DGGML_NATIVE=OFF \
    -DGGML_SSE42=ON \
    -DGGML_AVX=ON \
    -DGGML_AVX2=ON \
    -DGGML_AVX_VNNI=OFF \
    -DGGML_FMA=ON \
    -DGGML_F16C=ON \
    -DGGML_BMI2=ON \
    -DGGML_AVX512=OFF \
    -DGGML_AVX512_VBMI=OFF \
    -DGGML_AVX512_VNNI=OFF \
    -DGGML_AVX512_BF16=OFF \
    -DGGML_OPENMP=OFF \
    -DWHISPER_BUILD_TESTS=OFF \
    -DWHISPER_SDL2=OFF \
    "${ccache_args[@]}"
  CCACHE_DIR="${CCACHE_DIR}" cmake --build "${work_dir}/build-simd" --target "${targets[@]}" -j"$(nproc)"

  CCACHE_DIR="${CCACHE_DIR}" cmake -S "${source_dir}" -B "${work_dir}/build-baseline" \
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
    -DWHISPER_SDL2=OFF \
    "${ccache_args[@]}"
  CCACHE_DIR="${CCACHE_DIR}" cmake --build "${work_dir}/build-baseline" --target "${targets[@]}" -j"$(nproc)"

  local target
  for target in "${targets[@]}"; do
    install -m 0755 "${work_dir}/build-simd/bin/${target}" "${WHISPER_OUTPUT_DIR}/${target}"
    install -m 0755 "${work_dir}/build-baseline/bin/${target}" "${WHISPER_OUTPUT_DIR}/${target}-baseline"
  done

  # Ya no hay ningun consumidor de estos binarios ni del antiguo lanzador.
  rm -f "${WHISPER_OUTPUT_DIR}/whisper-cli" \
    "${WHISPER_OUTPUT_DIR}/whisper-cli-baseline" \
    "${WHISPER_OUTPUT_DIR}/agenos-whisper-server"

  rm -rf "${work_dir}"
  trap - EXIT
}

install_voxtype_from_prebuilt() {
  local work_dir="$1"
  if [[ -z "${VOXTYPE_PREBUILT_URL}" && -z "${VOXTYPE_PREBUILT_SHA256}" ]]; then
    return 1
  fi
  if [[ -z "${VOXTYPE_PREBUILT_URL}" || ! "${VOXTYPE_PREBUILT_SHA256}" =~ ^[0-9a-fA-F]{64}$ ]]; then
    echo "AGENOS_VOXTYPE_PREBUILT_URL requiere AGENOS_VOXTYPE_PREBUILT_SHA256 valido." >&2
    exit 1
  fi

  local archive="${work_dir}/voxtype-bookworm.tar.gz"
  curl -fsSL --retry 3 "${VOXTYPE_PREBUILT_URL}" -o "${archive}"
  printf '%s  %s\n' "${VOXTYPE_PREBUILT_SHA256}" "${archive}" | sha256sum -c -
  if tar -tzf "${archive}" | grep -Eq '(^/|(^|/)\.\.(/|$))'; then
    echo "El artefacto de Voxtype contiene rutas no seguras." >&2
    exit 1
  fi
  mkdir -p "${work_dir}/prebuilt"
  tar -xzf "${archive}" -C "${work_dir}/prebuilt"

  local simd baseline license
  simd="$(find "${work_dir}/prebuilt" -type f -name voxtype -print -quit)"
  baseline="$(find "${work_dir}/prebuilt" -type f -name voxtype-baseline -print -quit)"
  license="$(find "${work_dir}/prebuilt" -type f -name LICENSE.voxtype -print -quit)"
  if [[ -z "${simd}" || -z "${baseline}" || -z "${license}" ]]; then
    echo "El artefacto verificado debe contener voxtype, voxtype-baseline y LICENSE.voxtype." >&2
    exit 1
  fi
  install -m 0755 "${simd}" "${WHISPER_OUTPUT_DIR}/voxtype"
  install -m 0755 "${baseline}" "${WHISPER_OUTPUT_DIR}/voxtype-baseline"
  install -m 0644 "${license}" "${WHISPER_OUTPUT_DIR}/LICENSE.voxtype"
  return 0
}

install_voxtype() {
  voxtype_install_is_current && return 0
  local work_dir
  work_dir="$(mktemp -d)"
  trap 'rm -rf "${work_dir:-}"' EXIT
  mkdir -p "${WHISPER_OUTPUT_DIR}" "${CARGO_TARGET_ROOT}/optimized" "${CARGO_TARGET_ROOT}/baseline"

  if install_voxtype_from_prebuilt "${work_dir}"; then
    echo "Installed verified Bookworm Voxtype artifact."
    rm -rf "${work_dir}"
    trap - EXIT
    return 0
  fi

  echo "Building Voxtype ${VOXTYPE_REF} for the Bookworm runtime..."
  curl -fsSL --retry 3 "https://github.com/peteonrails/voxtype/archive/refs/tags/${VOXTYPE_REF}.tar.gz" \
    -o "${work_dir}/voxtype.tar.gz"
  tar -xzf "${work_dir}/voxtype.tar.gz" -C "${work_dir}"
  local voxtype_source_dir
  voxtype_source_dir="$(find "${work_dir}" -maxdepth 1 -type d -name 'voxtype-*' -print -quit)"
  if [[ -z "${voxtype_source_dir}" ]]; then
    echo "No se pudo localizar el source extraido de Voxtype." >&2
    exit 1
  fi
  (
    cd "${voxtype_source_dir}"
    CARGO_TARGET_DIR="${CARGO_TARGET_ROOT}/optimized" \
      RUSTFLAGS='-C target-cpu=x86-64 -C target-feature=+sse4.2,+avx,+avx2,+fma,+f16c,+bmi2' \
      GGML_NATIVE=OFF GGML_SSE42=ON GGML_AVX=ON GGML_AVX2=ON GGML_AVX_VNNI=OFF \
      GGML_FMA=ON GGML_F16C=ON GGML_BMI2=ON GGML_AVX512=OFF GGML_OPENMP=OFF \
      cargo build --release --locked --bin voxtype
    CARGO_TARGET_DIR="${CARGO_TARGET_ROOT}/baseline" \
      RUSTFLAGS='-C target-cpu=x86-64' \
      GGML_NATIVE=OFF GGML_SSE42=OFF GGML_AVX=OFF GGML_AVX2=OFF GGML_AVX_VNNI=OFF \
      GGML_FMA=OFF GGML_F16C=OFF GGML_BMI2=OFF GGML_AVX512=OFF GGML_OPENMP=OFF \
      cargo build --release --locked --bin voxtype
  )
  install -m 0755 "${CARGO_TARGET_ROOT}/optimized/release/voxtype" "${WHISPER_OUTPUT_DIR}/voxtype"
  install -m 0755 "${CARGO_TARGET_ROOT}/baseline/release/voxtype" "${WHISPER_OUTPUT_DIR}/voxtype-baseline"
  install -m 0644 "${voxtype_source_dir}/LICENSE" "${WHISPER_OUTPUT_DIR}/LICENSE.voxtype"

  rm -rf "${work_dir}"
  trap - EXIT
}

install_stt_models() {
  models_install_is_current && return 0
  mkdir -p "${WHISPER_OUTPUT_DIR}/models"

  download_verified_model \
    "${WHISPER_MODEL_URL}" \
    "${WHISPER_OUTPUT_DIR}/models/${WHISPER_MODEL_FILE}" \
    "${WHISPER_MODEL_SHA1}" \
    "el modelo ${WHISPER_MODEL_FILE} (multilingue)"

  download_verified_model \
    "${WHISPER_VAD_MODEL_URL}" \
    "${WHISPER_OUTPUT_DIR}/models/${WHISPER_VAD_MODEL_FILE}" \
    "${WHISPER_VAD_MODEL_SHA1}" \
    "el modelo de Silero VAD ${WHISPER_VAD_MODEL_FILE}"

  # Un cambio de talla dejaria el modelo viejo en includes.chroot y la ISO
  # cargaria con los dos. Aqui no hay rsync --delete que lo limpie por nosotros.
  find "${WHISPER_OUTPUT_DIR}/models" -maxdepth 1 -type f -name 'ggml-*.bin' \
    ! -name "${WHISPER_MODEL_FILE}" ! -name "${WHISPER_VAD_MODEL_FILE}" -delete
}

write_stt_manifest() {
  printf '%s\n' \
    "engine=voxtype" \
    "ref=${WHISPER_CPP_REF}" \
    "voxtype_ref=${VOXTYPE_REF}" \
    "build_profile=${WHISPER_BUILD_PROFILE};${VOXTYPE_BUILD_PROFILE}" \
    "voxtype_fingerprint=$(voxtype_fingerprint)" \
    "whisper_native_fingerprint=$(whisper_native_fingerprint)" \
    "models_fingerprint=$(models_fingerprint)" \
    "model=${WHISPER_MODEL_FILE}" \
    "model_sha1=${WHISPER_MODEL_SHA1}" \
    "vad_model=${WHISPER_VAD_MODEL_FILE}" \
    "vad_model_sha1=${WHISPER_VAD_MODEL_SHA1}" \
    "language=es" \
    "note=${WHISPER_MODEL_FILE} is multilingual; the .en variants are intentionally not installed." \
    > "${WHISPER_OUTPUT_DIR}/stt.env"
}

install_local_stt() {
  install_whisper_native
  install_voxtype
  install_stt_models
  write_stt_manifest
}

# Permite probar las huellas sin ejecutar la compilacion de la aplicacion.
if [[ "${BASH_SOURCE[0]}" != "$0" ]]; then
  return 0
fi

cd "${UI_DIR}"

CURRENT_HASH="$(
  {
    source_hash
    agent_source_hash
    network_source_hash
    stt_source_hash
    sha256sum "${ROOT_DIR}/scripts/build-ui.sh"
  } | sha256sum | awk '{print $1}'
)"
CURRENT_STAMP=""

if [[ -f "${STAMP_FILE}" ]]; then
  CURRENT_STAMP="$(cat "${STAMP_FILE}")"
fi

if [[ "${CURRENT_STAMP}" == "${CURRENT_HASH}" && -f "${STATIC_OUTPUT_DIR}/index.html" && -x "${PACKAGE_OUTPUT_DIR}/agenos-system-ui" && -x "${PACKAGE_OUTPUT_DIR}/electron-dist/electron" && -f "${PACKAGE_OUTPUT_DIR}/electron-app/pi-system-context.md" ]] \
  && stt_install_is_current; then
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
install_local_stt

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
  'export AGENOS_WHISPER_DIR="${AGENOS_WHISPER_DIR:-${SCRIPT_DIR}/whisper.cpp}"' \
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
