#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_DIR="${STATE_DIR:-${ROOT_DIR}/state/qemu}"
MODE="${1:-live}"

VM_NAME="${VM_NAME:-agenos-dev}"
VM_RAM_MB="${VM_RAM_MB:-4096}"
VM_CPUS="${VM_CPUS:-4}"
VM_DISK="${VM_DISK:-${STATE_DIR}/${VM_NAME}.qcow2}"
VM_DISK_SIZE="${VM_DISK_SIZE:-32G}"
VM_UEFI="${VM_UEFI:-auto}"
VM_DISPLAY="${VM_DISPLAY:-default}"
VM_NET="${VM_NET:-user}"
VM_EXTRA_ARGS="${VM_EXTRA_ARGS:-}"
ISO_PATH="${ISO_PATH:-}"

usage() {
  cat <<'EOF'
Uso:
  ./scripts/run-vm.sh live
  ./scripts/run-vm.sh disk
  ./scripts/run-vm.sh reset

Modos:
  live  Arranca la ISO mas reciente de dist/ con un disco persistente adjunto.
  disk  Arranca solo desde el disco persistente, pensado para probar la instalacion.
  reset Elimina el disco persistente y la NVRAM UEFI guardada para empezar desde cero.

Variables utiles:
  ISO_PATH=/ruta/a/agenos.iso
  VM_DISK=/ruta/a/agenos.qcow2
  VM_DISK_SIZE=48G
  VM_RAM_MB=8192
  VM_CPUS=8
  VM_UEFI=auto|1|0
  VM_DISPLAY=default|headless
  VM_EXTRA_ARGS="-usb -device usb-kbd"
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
  find "${ROOT_DIR}/dist" -maxdepth 1 -type f -name '*.iso' -printf '%T@ %p\n' 2>/dev/null \
    | sort -nr \
    | head -n 1 \
    | cut -d' ' -f2-
}

first_existing_file() {
  local candidate
  for candidate in "$@"; do
    if [[ -f "${candidate}" ]]; then
      printf '%s\n' "${candidate}"
      return 0
    fi
  done

  return 1
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
    echo "No se encontro ninguna ISO en ${ROOT_DIR}/dist. Ejecuta 'make build' o exporta ISO_PATH." >&2
    exit 1
  fi
}

resolve_ovmf() {
  local code vars_template vars_copy

  code="$(first_existing_file \
    /usr/share/edk2/x64/OVMF_CODE.4m.fd \
    /usr/share/edk2/x64/OVMF_CODE.fd \
    /usr/share/OVMF/x64/OVMF_CODE.4m.fd \
    /usr/share/OVMF/x64/OVMF_CODE.fd \
    /usr/share/edk2-ovmf/x64/OVMF_CODE.4m.fd \
    /usr/share/edk2-ovmf/x64/OVMF_CODE.fd || true)"

  vars_template="$(first_existing_file \
    /usr/share/edk2/x64/OVMF_VARS.4m.fd \
    /usr/share/edk2/x64/OVMF_VARS.fd \
    /usr/share/OVMF/x64/OVMF_VARS.4m.fd \
    /usr/share/OVMF/x64/OVMF_VARS.fd \
    /usr/share/edk2-ovmf/x64/OVMF_VARS.4m.fd \
    /usr/share/edk2-ovmf/x64/OVMF_VARS.fd || true)"

  if [[ -z "${code}" || -z "${vars_template}" ]]; then
    return 1
  fi

  vars_copy="${STATE_DIR}/${VM_NAME}.ovmf-vars.fd"
  if [[ ! -f "${vars_copy}" ]]; then
    cp "${vars_template}" "${vars_copy}"
  fi

  OVMF_CODE="${code}"
  OVMF_VARS="${vars_copy}"
  return 0
}

reset_vm_state() {
  local vars_copy="${STATE_DIR}/${VM_NAME}.ovmf-vars.fd"

  rm -f "${VM_DISK}" "${vars_copy}"
  echo "Estado de la VM eliminado:"
  echo "  - disco: ${VM_DISK}"
  echo "  - nvram: ${vars_copy}"
}

prepare_disk() {
  mkdir -p "${STATE_DIR}"
  mkdir -p "$(dirname "${VM_DISK}")"
  if [[ ! -f "${VM_DISK}" ]]; then
    qemu-img create -f qcow2 "${VM_DISK}" "${VM_DISK_SIZE}" >/dev/null
    echo "Disco creado en ${VM_DISK} (${VM_DISK_SIZE})"
  fi
}

append_extra_args() {
  if [[ -z "${VM_EXTRA_ARGS}" ]]; then
    return 0
  fi

  # shellcheck disable=SC2206
  local extra_args=( ${VM_EXTRA_ARGS} )
  QEMU_ARGS+=("${extra_args[@]}")
}

qemu_device_supported() {
  local device_name="$1"
  grep -Fq "name \"${device_name}\"" <<<"${QEMU_DEVICE_HELP}"
}

select_display_args() {
  if qemu_device_supported "virtio-vga"; then
    printf '%s\n' "-device" "virtio-vga"
    return 0
  fi

  if qemu_device_supported "bochs-display"; then
    printf '%s\n' "-device" "bochs-display"
    return 0
  fi

  if qemu_device_supported "VGA"; then
    printf '%s\n' "-device" "VGA"
    return 0
  fi

  printf '%s\n' "-vga" "std"
}

select_pointer_args() {
  if qemu_device_supported "virtio-tablet-pci"; then
    printf '%s\n' "-device" "virtio-tablet-pci"
    return 0
  fi

  if qemu_device_supported "qemu-xhci" && qemu_device_supported "usb-tablet"; then
    printf '%s\n' "-device" "qemu-xhci" "-device" "usb-tablet"
  fi
}

build_qemu_args() {
  local -a display_args pointer_args

  mapfile -t display_args < <(select_display_args)
  mapfile -t pointer_args < <(select_pointer_args)

  QEMU_ARGS=(
    -name "${VM_NAME}"
    -machine q35
    -m "${VM_RAM_MB}"
    -smp "${VM_CPUS}"
    "${display_args[@]}"
    "${pointer_args[@]}"
    -drive "if=virtio,format=qcow2,file=${VM_DISK}"
  )

  if [[ -w /dev/kvm ]]; then
    QEMU_ARGS+=(-enable-kvm -cpu host)
  else
    QEMU_ARGS+=(-accel tcg -cpu max)
    echo "Aviso: /dev/kvm no esta disponible; QEMU usara emulacion software." >&2
  fi

  case "${VM_NET}" in
    user)
      QEMU_ARGS+=(-netdev user,id=net0 -device virtio-net-pci,netdev=net0)
      ;;
    none)
      QEMU_ARGS+=(-nic none)
      ;;
    *)
      echo "VM_NET no soportado: ${VM_NET}. Usa 'user' o 'none'." >&2
      exit 1
      ;;
  esac

  case "${VM_DISPLAY}" in
    default)
      ;;
    headless)
      QEMU_ARGS+=(-display none -serial mon:stdio)
      ;;
    *)
      echo "VM_DISPLAY no soportado: ${VM_DISPLAY}. Usa 'default' o 'headless'." >&2
      exit 1
      ;;
  esac

  if [[ "${USE_UEFI}" == "1" ]]; then
    QEMU_ARGS+=(
      -drive "if=pflash,format=raw,readonly=on,file=${OVMF_CODE}"
      -drive "if=pflash,format=raw,file=${OVMF_VARS}"
    )
  fi

  if [[ "${MODE}" == "live" ]]; then
    QEMU_ARGS+=(
      -boot order=d,menu=on
      -drive "file=${ISO_PATH},media=cdrom,if=ide"
    )
  else
    QEMU_ARGS+=(-boot order=c)
  fi

  append_extra_args
}

if [[ "${MODE}" != "live" && "${MODE}" != "disk" && "${MODE}" != "reset" ]]; then
  usage >&2
  exit 1
fi

mkdir -p "${STATE_DIR}"

if [[ "${MODE}" == "reset" ]]; then
  reset_vm_state
  exit 0
fi

require_command qemu-system-x86_64
require_command qemu-img
QEMU_DEVICE_HELP="$(qemu-system-x86_64 -device help 2>/dev/null || true)"

if [[ "${MODE}" == "live" ]]; then
  resolve_iso
fi

USE_UEFI="0"
OVMF_CODE=""
OVMF_VARS=""

case "${VM_UEFI}" in
  auto)
    if resolve_ovmf; then
      USE_UEFI="1"
    fi
    ;;
  1|true|yes)
    if ! resolve_ovmf; then
      echo "No se encontro OVMF. En Arch instala 'edk2-ovmf' o usa VM_UEFI=0." >&2
      exit 1
    fi
    USE_UEFI="1"
    ;;
  0|false|no)
    ;;
  *)
    echo "VM_UEFI no soportado: ${VM_UEFI}. Usa auto, 1 o 0." >&2
    exit 1
    ;;
esac

if [[ "${MODE}" == "live" ]]; then
  prepare_disk
elif [[ ! -f "${VM_DISK}" ]]; then
  echo "No existe el disco persistente ${VM_DISK}. Primero ejecuta 'make vm-live' para instalar AgenOS." >&2
  exit 1
fi

build_qemu_args

if [[ "${MODE}" == "live" ]]; then
  echo "Arrancando ISO: ${ISO_PATH}"
else
  echo "Arrancando disco: ${VM_DISK}"
fi

if [[ "${USE_UEFI}" == "1" ]]; then
  echo "Firmware: UEFI (${OVMF_CODE})"
else
  echo "Firmware: BIOS"
fi

exec qemu-system-x86_64 "${QEMU_ARGS[@]}"
