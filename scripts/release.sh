#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="${ROOT_DIR}/dist"
RELEASES_DIR="${RELEASES_DIR:-${ROOT_DIR}/releases}"
DRIVE_REMOTE="${DRIVE_REMOTE:-gdrive:/agenOS}"
VERSION="${VERSION:-${1:-}}"
ISO_PATH="${ISO_PATH:-}"
RELEASE_STAMP="${RELEASE_STAMP:-$(date -u +"%Y-%m-%d")}"
RELEASE_LABEL="${RELEASE_LABEL:-bookworm-amd64}"
RELEASE_ID="${RELEASE_ID:-}"
UPLOAD_RELEASE="${UPLOAD_RELEASE:-1}"
OVERWRITE_RELEASE="${OVERWRITE_RELEASE:-0}"

usage() {
  cat <<'EOF'
Uso:
  VERSION=v0.1.0 ./scripts/release.sh
  ./scripts/release.sh v0.1.0

Variables utiles:
  ISO_PATH=/ruta/a/agenos.iso
  RELEASES_DIR=./releases
  DRIVE_REMOTE=gdrive:/agenOS
  RELEASE_STAMP=2026-04-05
  RELEASE_LABEL=bookworm-amd64
  RELEASE_ID=v0.1.0_2026-04-05
  UPLOAD_RELEASE=1
  OVERWRITE_RELEASE=0

Comportamiento:
  - publica la ISO mas reciente de dist/ si no se define ISO_PATH
  - crea RELEASES_DIR/RELEASE_ID/
  - copia la ISO como agenos-RELEASE_LABEL-VERSION.iso
  - genera SHA256SUMS y build-info.txt
  - sube la release a DRIVE_REMOTE/RELEASE_ID/ usando rclone
EOF
}

require_command() {
  local cmd="$1"
  if ! command -v "${cmd}" >/dev/null 2>&1; then
    echo "Falta el comando requerido: ${cmd}" >&2
    exit 1
  fi
}

find_latest_iso() {
  find "${DIST_DIR}" -maxdepth 1 -type f -name '*.iso' -printf '%T@ %p\n' 2>/dev/null \
    | sort -nr \
    | head -n 1 \
    | cut -d' ' -f2-
}

resolve_iso() {
  if [[ -n "${ISO_PATH}" ]]; then
    if [[ ! -f "${ISO_PATH}" ]]; then
      echo "La ISO indicada en ISO_PATH no existe: ${ISO_PATH}" >&2
      exit 1
    fi
    return 0
  fi

  ISO_PATH="$(find_latest_iso)"
  if [[ -z "${ISO_PATH}" ]]; then
    echo "No se encontro ninguna ISO en ${DIST_DIR}. Ejecuta 'make build' o exporta ISO_PATH." >&2
    exit 1
  fi
}

validate_version() {
  if [[ -z "${VERSION}" ]]; then
    usage >&2
    echo "Debes indicar VERSION, por ejemplo VERSION=v0.1.0 make release" >&2
    exit 1
  fi

  if [[ ! "${VERSION}" =~ ^[A-Za-z0-9._-]+$ ]]; then
    echo "VERSION contiene caracteres no soportados: ${VERSION}" >&2
    exit 1
  fi

  if [[ ! "${RELEASE_STAMP}" =~ ^[A-Za-z0-9._-]+$ ]]; then
    echo "RELEASE_STAMP contiene caracteres no soportados: ${RELEASE_STAMP}" >&2
    exit 1
  fi

  if [[ ! "${RELEASE_LABEL}" =~ ^[A-Za-z0-9._-]+$ ]]; then
    echo "RELEASE_LABEL contiene caracteres no soportados: ${RELEASE_LABEL}" >&2
    exit 1
  fi

  if [[ -z "${RELEASE_ID}" ]]; then
    RELEASE_ID="${VERSION}_${RELEASE_STAMP}"
  fi

  if [[ ! "${RELEASE_ID}" =~ ^[A-Za-z0-9._-]+$ ]]; then
    echo "RELEASE_ID contiene caracteres no soportados: ${RELEASE_ID}" >&2
    exit 1
  fi
}

ensure_release_dir() {
  if ! mkdir -p "${RELEASES_DIR}" 2>/dev/null; then
    echo "No se pudo crear ${RELEASES_DIR}. Ajusta permisos o exporta RELEASES_DIR." >&2
    exit 1
  fi

  if [[ ! -w "${RELEASES_DIR}" ]]; then
    echo "No tienes permisos de escritura en ${RELEASES_DIR}. Ajusta permisos o usa RELEASES_DIR." >&2
    exit 1
  fi
}

publish_release() {
  local release_dir="${RELEASES_DIR}/${RELEASE_ID}"
  local iso_name="agenos-${RELEASE_LABEL}-${VERSION}.iso"
  local release_iso
  local git_commit
  local git_branch

  release_iso="${release_dir}/${iso_name}"

  if [[ -e "${release_dir}" && "${OVERWRITE_RELEASE}" != "1" ]]; then
    echo "La release ${release_dir} ya existe. Usa OVERWRITE_RELEASE=1 si quieres regenerarla." >&2
    exit 1
  fi

  rm -rf "${release_dir}"
  mkdir -p "${release_dir}"

  install -m 0644 "${ISO_PATH}" "${release_iso}"

  (
    cd "${release_dir}"
    sha256sum "${iso_name}" > SHA256SUMS
  )

  git_commit="$(git -C "${ROOT_DIR}" rev-parse HEAD 2>/dev/null || printf 'unknown')"
  git_branch="$(git -C "${ROOT_DIR}" branch --show-current 2>/dev/null || printf 'unknown')"

  cat > "${release_dir}/build-info.txt" <<EOF
version=${VERSION}
release_id=${RELEASE_ID}
release_stamp=${RELEASE_STAMP}
release_label=${RELEASE_LABEL}
created_at_utc=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
git_branch=${git_branch}
git_commit=${git_commit}
source_iso=${ISO_PATH}
published_iso=${release_iso}
drive_remote=${DRIVE_REMOTE}/${RELEASE_ID}
iso_size_bytes=$(stat -c '%s' "${release_iso}")
EOF

  echo "Release publicada en ${release_dir}"
  echo "ISO: ${release_iso}"
  echo "Checksum: ${release_dir}/SHA256SUMS"
}

upload_release() {
  local release_dir="${RELEASES_DIR}/${RELEASE_ID}"
  local remote_release_dir="${DRIVE_REMOTE}/${RELEASE_ID}"

  if [[ "${UPLOAD_RELEASE}" != "1" ]]; then
    echo "Upload omitido: UPLOAD_RELEASE=${UPLOAD_RELEASE}"
    return 0
  fi

  if rclone lsf "${remote_release_dir}" >/dev/null 2>&1; then
    if [[ "${OVERWRITE_RELEASE}" != "1" ]]; then
      echo "La release remota ${remote_release_dir} ya existe. Usa OVERWRITE_RELEASE=1 si quieres regenerarla." >&2
      exit 1
    fi
    rclone purge "${remote_release_dir}"
  fi

  rclone copy "${release_dir}" "${remote_release_dir}" -P
  echo "Upload completado en ${remote_release_dir}"
}

validate_version
require_command sha256sum
require_command install
require_command stat
require_command date
if [[ "${UPLOAD_RELEASE}" == "1" ]]; then
  require_command rclone
fi
resolve_iso
ensure_release_dir
publish_release
upload_release
