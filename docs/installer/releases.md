# Releases por SSH y rsync

El flujo de release de AgenOS esta pensado para un servidor Linux que compila la ISO y la deja lista para descargar desde tu portatil por `rsync` sobre `SSH`.

## Objetivo

Cada release queda publicada en una carpeta versionada:

```text
/srv/agenos/releases/
  v0.1.0/
    agenos-bookworm-amd64.hybrid.iso
    SHA256SUMS
    build-info.txt
  latest -> v0.1.0
```

No se sube ningun artefacto a git.

## Preparacion inicial del servidor

Una sola vez, crea el directorio base y deja permisos a tu usuario:

```bash
sudo mkdir -p /srv/agenos/releases
sudo chown -R "$USER:$USER" /srv/agenos
```

Si prefieres otro directorio, puedes usar `RELEASES_DIR=/ruta/custom`.

## Publicar una release

Si la ISO ya existe en `dist/`:

```bash
make release VERSION=v0.1.0
```

Si quieres compilar y publicar en el mismo paso:

```bash
make release-build VERSION=v0.1.0
```

El script hace esto:

- toma la ISO mas reciente de `dist/` si no defines `ISO_PATH`
- crea `/srv/agenos/releases/<version>/`
- copia la ISO
- genera `SHA256SUMS`
- genera `build-info.txt` con commit, rama, fecha y tamano
- actualiza `latest -> <version>`

## Variables utiles

Publicar una ISO concreta:

```bash
ISO_PATH=dist/agenos-bookworm-amd64.hybrid.iso make release VERSION=v0.1.0
```

Usar otro directorio de releases:

```bash
RELEASES_DIR="$HOME/agenos-releases" make release VERSION=v0.1.0
```

Recrear una release existente:

```bash
OVERWRITE_RELEASE=1 make release VERSION=v0.1.0
```

No mover el symlink `latest`:

```bash
UPDATE_LATEST=0 make release VERSION=v0.1.0
```

## Descargar desde tu portatil Arch

Traer la ultima release:

```bash
rsync -avP usuario@tu-servidor:/srv/agenos/releases/latest/ .
```

Traer una release concreta:

```bash
rsync -avP usuario@tu-servidor:/srv/agenos/releases/v0.1.0/ .
```

Verificar la ISO descargada:

```bash
cd v0.1.0
sha256sum -c SHA256SUMS
```
