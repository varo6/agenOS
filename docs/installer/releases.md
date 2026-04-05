# Releases en `releases/` + Google Drive

El flujo de release de AgenOS deja cada build publicada en una carpeta local `releases/` dentro de este repo y sube esa misma carpeta a Google Drive usando `rclone`.

## Objetivo

Cada release queda empaquetada en una carpeta local gitignored y en una carpeta homologa de Google Drive:

```text
releases/
  v0.1.0_2026-04-05/
    agenos-bookworm-amd64-v0.1.0.iso
    SHA256SUMS
    build-info.txt
```

```text
gdrive:/agenOS/
  v0.1.0_2026-04-05/
    agenos-bookworm-amd64-v0.1.0.iso
    SHA256SUMS
    build-info.txt
```

La carpeta `releases/` esta ignorada por git y no se sube al remoto del repositorio.

## Convencion de nombres

Cada release usa un `release_id` con este formato:

```text
<version>_<fecha>
```

Ejemplo:

```text
v0.1.0_2026-04-05
```

Este formato tiene dos ventajas:

- hace visible la version primero
- deja una fecha corta y legible para distinguir builds

La ISO publicada dentro de la release tambien se renombra con ese identificador:

```text
agenos-bookworm-amd64-v0.1.0.iso
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
- calcula `RELEASE_ID=<version>_<fecha>`
- crea `releases/<release_id>/`
- copia la ISO como `agenos-bookworm-amd64-<version>.iso`
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

Fijar manualmente la fecha o sufijo de release:

```bash
RELEASE_STAMP=2026-04-05 make release VERSION=v0.1.0
```

Si necesitas dos builds del mismo dia, puedes usar un sufijo corto:

```bash
RELEASE_STAMP=2026-04-05a make release VERSION=v0.1.0
```

Cambiar la etiqueta incluida en el nombre de la ISO:

```bash
RELEASE_LABEL=bookworm-amd64 make release VERSION=v0.1.0
```

Fijar manualmente el identificador completo:

```bash
RELEASE_ID=v0.1.0_2026-04-05 make release VERSION=v0.1.0
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
rclone copy gdrive:/agenOS/v0.1.0_2026-04-05 ./v0.1.0_2026-04-05 -P
```

Verificar la ISO descargada:

```bash
cd v0.1.0_2026-04-05
sha256sum -c SHA256SUMS
```
