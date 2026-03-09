# Pruebas rapidas en Arch

Si ya tienes la ISO compilada, el flujo mas corto para probar cambios es arrancarla en una VM local con `qemu`.

## Dependencias del host

Instala como minimo:

```bash
sudo pacman -S --needed qemu-desktop edk2-ovmf
```

Para aceleracion hardware, comprueba que `/dev/kvm` existe y que tu usuario puede usarlo.

## Bucle rapido recomendado

```bash
make build
make vm-live
```

`make vm-live`:

- usa la ISO mas reciente de `dist/`
- crea un disco persistente en `state/qemu/agenos-dev.qcow2` si no existe
- intenta arrancar con UEFI si encuentra OVMF
- cae a BIOS automaticamente si OVMF no esta instalado

Despues de instalar AgenOS dentro de la VM:

```bash
make vm-disk
```

Ese segundo comando arranca solo desde el disco persistente, sin volver a entrar por la ISO.

Si quieres rehacer la instalacion desde cero:

```bash
make vm-reset
make vm-live
```

## Atajos utiles

Build + arranque en un solo paso:

```bash
make quick-test
```

Cambiar recursos de la VM:

```bash
VM_RAM_MB=8192 VM_CPUS=8 make vm-live
```

Forzar una ISO concreta:

```bash
ISO_PATH=dist/agenos-bookworm-amd64.hybrid.iso make vm-live
```

Arranque sin interfaz grafica:

```bash
VM_DISPLAY=headless make vm-live
```

## Notas

- El disco de la VM se mantiene entre ejecuciones para que el ciclo `instalar -> reiniciar -> validar` sea rapido.
- `make vm-reset` elimina tanto el disco persistente como la NVRAM UEFI guardada para evitar residuos entre instalaciones.
