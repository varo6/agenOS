# Releases en `releases/` + Google Drive

El flujo de release de AgenOS deja cada build publicada en una carpeta local `releases/` dentro de este repo y sube esa misma carpeta a Google Drive usando `rclone`.

## Objetivo

Cada release queda empaquetada en una carpeta local gitignored y en una carpeta homologa de Google Drive:

```text
releases/
  20260405T173359Z_v0.1.0/
    agenos-20260405T173359Z_v0.1.0.iso
    SHA256SUMS
    build-info.txt
```

```text
gdrive:/agenOS/
  20260405T173359Z_v0.1.0/
    agenos-20260405T173359Z_v0.1.0.iso
    SHA256SUMS
    build-info.txt
```

La carpeta `releases/` esta ignorada por git y no se sube al remoto del repositorio.

## Convencion de nombres

Cada release usa un `release_id` con este formato:

```text
YYYYMMDDTHHMMSSZ_<version>
```

Ejemplo:

```text
20260405T173359Z_v0.1.0
```

Este formato tiene dos ventajas:

- ordena bien por fecha al listar carpetas
- mantiene visible la version funcional junto al timestamp UTC exacto

La ISO publicada dentro de la release tambien se renombra con ese identificador:

```text
agenos-20260405T173359Z_v0.1.0.iso
```

## Preparacion inicial

Una sola vez, asegurate de tener `rclone` configurado con un remoto llamado `gdrive` que apunte a tu Google Drive.

El script sube por defecto a:

```text
gdrive:/agenOS
```

Si quieres usar otro remoto o carpeta, puedes cambiarlo con `DRIVE_REMOTE`.

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
- calcula `RELEASE_ID=YYYYMMDDTHHMMSSZ_<version>`
- crea `releases/<release_id>/`
- copia la ISO como `agenos-<release_id>.iso`
- genera `SHA256SUMS`
- genera `build-info.txt` con commit, rama, fecha y tamano
- sube el contenido a `gdrive:/agenOS/<release_id>/`

## Variables utiles

Publicar una ISO concreta:

```bash
ISO_PATH=dist/agenos-bookworm-amd64.hybrid.iso make release VERSION=v0.1.0
```

Usar otro directorio local para empaquetar releases:

```bash
RELEASES_DIR="$HOME/agenos-releases" make release VERSION=v0.1.0
```

Usar otra ruta remota de Google Drive:

```bash
DRIVE_REMOTE="gdrive:/agenOS-dev" make release VERSION=v0.1.0
```

Fijar manualmente el timestamp de la release:

```bash
RELEASE_TIMESTAMP=20260405T173359Z make release VERSION=v0.1.0
```

Fijar manualmente el identificador completo:

```bash
RELEASE_ID=20260405T173359Z_v0.1.0 make release VERSION=v0.1.0
```

Empaquetar solo en local sin subir a Drive:

```bash
UPLOAD_RELEASE=0 make release VERSION=v0.1.0
```

Recrear una release existente, local y remota:

```bash
OVERWRITE_RELEASE=1 make release VERSION=v0.1.0
```

## Descargar o verificar una release

Descargar una release concreta desde Google Drive:

```bash
rclone copy gdrive:/agenOS/20260405T173359Z_v0.1.0 ./20260405T173359Z_v0.1.0 -P
```

Verificar la ISO descargada:

```bash
cd 20260405T173359Z_v0.1.0
sha256sum -c SHA256SUMS
```
