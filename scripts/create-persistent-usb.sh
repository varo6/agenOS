#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ISO_PATH="${ROOT_DIR}/dist/agenos-bookworm-amd64.hybrid.iso"
DEVICE=""
PROFILE="home"
APPLY=0
PERSISTENCE_LABEL="agenos-persist"

usage() {
  echo "Uso: $0 --device /dev/disk/by-id/usb-... [--iso ruta.iso] [--profile home|full] [--apply]"
  echo
  echo "Sin --apply solo muestra y valida el plan. --apply BORRA por completo el USB indicado."
}

while (($#)); do
  case "$1" in
    --device) DEVICE="${2:-}"; shift 2 ;;
    --iso) ISO_PATH="${2:-}"; shift 2 ;;
    --profile) PROFILE="${2:-}"; shift 2 ;;
    --apply) APPLY=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Opción desconocida: $1" >&2; usage >&2; exit 2 ;;
  esac
done

[[ -n "${DEVICE}" ]] || { echo "Falta --device." >&2; usage >&2; exit 2; }
[[ -f "${ISO_PATH}" ]] || { echo "No existe la ISO: ${ISO_PATH}" >&2; exit 2; }
[[ "${PROFILE}" == "home" || "${PROFILE}" == "full" ]] || { echo "--profile debe ser home o full." >&2; exit 2; }

for command in lsblk blockdev sha256sum dd sfdisk partprobe udevadm mkfs.ext4 mount mountpoint umount findmnt; do
  command -v "${command}" >/dev/null || { echo "Falta el comando ${command}." >&2; exit 2; }
done

RESOLVED_DEVICE="$(readlink -f "${DEVICE}")"
[[ -b "${RESOLVED_DEVICE}" ]] || { echo "No es un dispositivo de bloques: ${DEVICE}" >&2; exit 2; }
[[ "$(lsblk -dnro TYPE "${RESOLVED_DEVICE}")" == "disk" ]] || { echo "Indica el disco USB completo, no una partición." >&2; exit 2; }
[[ "$(lsblk -dnro TRAN "${RESOLVED_DEVICE}")" == "usb" ]] || { echo "El dispositivo no figura como USB. Operación cancelada." >&2; exit 2; }

if lsblk -nrpo MOUNTPOINT "${RESOLVED_DEVICE}" | grep -qE '^/'; then
  echo "El USB tiene particiones montadas. Desmóntalas antes de continuar." >&2
  exit 2
fi

ROOT_SOURCE="$(findmnt -nro SOURCE / || true)"
ROOT_PARENT="$(lsblk -ndo PKNAME "${ROOT_SOURCE}" 2>/dev/null || true)"
if [[ "${ROOT_SOURCE}" == "${RESOLVED_DEVICE}" || -n "${ROOT_PARENT}" && "/dev/${ROOT_PARENT}" == "${RESOLVED_DEVICE}" ]]; then
  echo "El dispositivo contiene el sistema raíz en uso. Operación cancelada." >&2
  exit 2
fi

ISO_BYTES="$(stat -c %s "${ISO_PATH}")"
DEVICE_BYTES="$(blockdev --getsize64 "${RESOLVED_DEVICE}")"
MIN_FREE=$((1024 * 1024 * 1024))
((DEVICE_BYTES > ISO_BYTES + MIN_FREE)) || { echo "El USB necesita al menos 1 GiB libre después de la ISO." >&2; exit 2; }

echo "ISO:        ${ISO_PATH}"
echo "SHA-256:    $(sha256sum "${ISO_PATH}" | awk '{print $1}')"
echo "Destino:    ${DEVICE} -> ${RESOLVED_DEVICE}"
echo "Dispositivo: $(lsblk -dnro MODEL,SERIAL,SIZE "${RESOLVED_DEVICE}" | xargs)"
echo "Perfil:     ${PROFILE}"
echo "Persistencia disponible: $(((DEVICE_BYTES - ISO_BYTES) / 1024 / 1024 / 1024)) GiB aprox."

if ((APPLY == 0)); then
  echo
  echo "Simulación terminada. Repite con --apply para escribir el USB."
  exit 0
fi

((EUID == 0)) || { echo "--apply necesita root. Ejecuta el mismo comando con sudo." >&2; exit 2; }
echo
echo "Se borrará TODO el contenido de ${RESOLVED_DEVICE}."
read -r -p "Escribe exactamente ${RESOLVED_DEVICE} para continuar: " confirmation
[[ "${confirmation}" == "${RESOLVED_DEVICE}" ]] || { echo "Confirmación incorrecta. No se ha escrito nada." >&2; exit 2; }

dd if="${ISO_PATH}" of="${RESOLVED_DEVICE}" bs=16M status=progress conv=fsync
sync
partprobe "${RESOLVED_DEVICE}"
udevadm settle

[[ "$(lsblk -dnro PTTYPE "${RESOLVED_DEVICE}")" == "dos" ]] || {
  echo "La tabla generada por la ISO no es MBR/DOS. No se tocará su geometría." >&2
  exit 1
}

SECTOR_SIZE="$(blockdev --getss "${RESOLVED_DEVICE}")"
MAX_END=0
while read -r start size type; do
  [[ "${type}" == "part" ]] || continue
  end=$((start + (size + SECTOR_SIZE - 1) / SECTOR_SIZE))
  ((end > MAX_END)) && MAX_END="${end}"
done < <(lsblk -bnro START,SIZE,TYPE "${RESOLVED_DEVICE}")
ALIGN_SECTORS=$((1024 * 1024 / SECTOR_SIZE))
PERSIST_START=$((((MAX_END + ALIGN_SECTORS - 1) / ALIGN_SECTORS) * ALIGN_SECTORS))

printf '%s,,83\n' "${PERSIST_START}" | sfdisk --append "${RESOLVED_DEVICE}"
partprobe "${RESOLVED_DEVICE}"
udevadm settle

PERSIST_PART="$(lsblk -bnrpo NAME,START,TYPE "${RESOLVED_DEVICE}" | awk -v start="${PERSIST_START}" '$2 == start && $3 == "part" { print $1; exit }')"
[[ -n "${PERSIST_PART}" ]] || { echo "No se pudo localizar la nueva partición. No se formateará nada." >&2; exit 1; }

mkfs.ext4 -F -L "${PERSISTENCE_LABEL}" "${PERSIST_PART}"
MOUNT_DIR="$(mktemp -d)"
cleanup() {
  mountpoint -q "${MOUNT_DIR}" && umount "${MOUNT_DIR}" || true
  rmdir "${MOUNT_DIR}" 2>/dev/null || true
}
trap cleanup EXIT
mount "${PERSIST_PART}" "${MOUNT_DIR}"

if [[ "${PROFILE}" == "full" ]]; then
  printf '/ union\n' >"${MOUNT_DIR}/persistence.conf"
else
  printf '/home union\n/etc/NetworkManager/system-connections union\n' >"${MOUNT_DIR}/persistence.conf"
fi
sync
umount "${MOUNT_DIR}"

echo
echo "USB listo: ${RESOLVED_DEVICE}"
echo "Los datos persistentes no están cifrados. Apaga AgenOS antes de retirar el USB."
