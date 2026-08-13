# WS15 — aplicaciones base y apertura real de ficheros

## Resultado

El diagnóstico era correcto. `components/agent/files.ts` abre rutas mediante
`xdg-open` (o `gio` como respaldo), pero la imagen no incluía aplicaciones que
registrasen los MIME de usuario. A la vez, el catálogo conocido de
`components/agent/apps.ts` ya intentaba `xdg-open $HOME`/Thunar para
«archivos», aunque Thunar no estaba instalado.

Esta rama añade una capa de aplicaciones de escritorio independiente en
`desktop-apps.list.chroot` y fija los handlers de todo el sistema en
`/etc/xdg/mimeapps.list` (fuente live-build:
`config/includes.chroot/etc/xdg/mimeapps.list`). No se ha construido una ISO ni
se ha instalado ningún paquete en el host.

Las versiones, tamaños, dependencias, traducciones y entradas `.desktop` se
comprobaron descargando y extrayendo, sin instalar, los paquetes indicados por
el índice oficial `bookworm/main/binary-amd64/Packages.xz` de Debian. La
estimación incluye `Recommends`, porque la configuración actual declara
`LB_APT_RECOMMENDS="true"`.

## Selección y coste

Los costes son incrementales en el orden de la tabla frente a la imagen
actual; por eso reflejan dependencias compartidas. «Descarga» es la suma de
`Size` de los `.deb` y «instalado» la suma de `Installed-Size`, no el incremento
final de la ISO. SquashFS lo comprimirá más. El conjunto completo estima
**56,4 MiB de `.deb` / 206,5 MiB instalado** (154 paquetes contando
dependencias).

| Categoría | Paquetes raíz | Elección y descarte de alternativas | Coste incremental aprox. | Wayland/Sway |
|---|---|---|---:|---|
| Archivos | `thunar`, `gvfs`, `tumbler`, `udisks2`, `xdg-user-dirs` | Thunar ya es el último fallback del catálogo, tiene MIME de directorio y da archivos locales, papelera, discos y miniaturas sin instalar XFCE completo. Nautilus arrastraría más GNOME; PCManFM no mejora la integración ya codificada. | 10,8 MiB / 53,8 MiB | GTK 3 nativo por `GDK_BACKEND=wayland,x11`; `thunar.desktop`, `Exec=thunar %U`. |
| Imágenes | `ristretto`, `webp-pixbuf-loader`, `heif-gdk-pixbuf` | Ristretto es pequeño, está localizado y comparte bibliotecas XFCE con Thunar. Se descartó `imv`: aunque es Wayland nativo, los dos `.desktop` de Bookworm llevan `NoDisplay=true` y `apps.ts` los excluye. Los loaders cubren WebP y HEIF/HEIC/AVIF de navegador/teléfono. | 0,7 MiB / 2,5 MiB después de Archivos | GTK 3 nativo; `org.xfce.ristretto.desktop`, `Name[es]=Visor de imágenes Ristretto`, `Exec=ristretto %U`. |
| Música y vídeo | `mpv` | Un solo reproductor fiable reutiliza FFmpeg, PipeWire y VA-API ya presentes. VLC añade una pila mayor; dos reproductores separados duplicarían UI/codecs. El perfil pseudo-GUI de su `.desktop` permite abrir también el reproductor sin fichero. | 6,7 MiB / 26,9 MiB | Backend Wayland directo y `libva-wayland`; XWayland queda como respaldo. `mpv.desktop`, `Exec=mpv --player-operation-mode=pseudo-gui -- %U`. |
| PDF | `zathura` (depende de `zathura-pdf-poppler`) | Visor GTK compacto y especialmente adecuado para un WM en mosaico. Evince suma integración GNOME. qpdfview parecía barato por compartir Qt con Calamares, pero con los `Recommends` actuales acaba en unos 73 MiB instalados al traer plugins PS/DjVu y Ghostscript; Zathura aislado son unos 18,8 MiB y, después de Tumbler/Poppler, solo añade lo mostrado. | 0,3 MiB / 1,1 MiB después de Archivos | GTK 3 nativo. App visible: `org.pwmt.zathura.desktop`, `Exec=zathura %U`. Handler PDF: `org.pwmt.zathura-pdf-poppler.desktop` (`NoDisplay=true`, válido para MIME). |
| Notas/texto | `mousepad` | Editor GTK con búsqueda, pestañas y resaltado, mucho más apropiado para una nota que un editor de terminal y sin una suite completa. | 1,7 MiB / 8,1 MiB | GTK 3 nativo; `org.xfce.mousepad.desktop`, `Name[es]=Mousepad`, `GenericName[es]=Editor de texto`, `Exec=mousepad %U`. |
| Correo | `claws-mail`, `claws-mail-i18n`, `aspell-es` | Cliente IMAP/POP/SMTP GTK maduro y ligero. Thunderbird ofrece más web compatibility, pero penaliza mucho una live ISO; Geary arrastra una fracción mayor de GNOME. Se fija diccionario español para satisfacer el recomendador de diccionario y no acabar con inglés. | 7,2 MiB / 18,1 MiB | GTK 3 nativo; `claws-mail.desktop`, `GenericName[es]=Cliente de correo electrónico`, `Exec=claws-mail %u`. |
| Documentos ofimáticos | `abiword` | Permite leer/escribir DOC, DOCX, RTF y ODT con plugins incluidos. No sustituye una suite para hojas/presentaciones, pero cubre documentos de texto por bastante menos que LibreOffice. Es el bloque más caro de esta selección debido a filtros, fuentes y gramática recomendados. | 24,0 MiB / 77,4 MiB | GTK 3 sobre Wayland; `abiword.desktop`, `GenericName[es]=Procesador de textos`, `Exec=abiword %U`. |
| Juego | `gnome-2048` | Juego local, offline, reconocible y muy pequeño. Se descartó AisleRiot: su `guile-3.0-libs` ocupa por sí solo unos 52 MiB instalados. | 1,9 MiB / 8,3 MiB | GTK 3 + Clutter-GTK sobre GDK Wayland; XWayland disponible como fallback. `org.gnome.TwentyFortyEight.desktop`, `Name[es]=2048`, `Exec=gnome-2048`. |
| Comprimidos (extra esperable) | `xarchiver`, `thunar-archive-plugin`, `p7zip-full`, `unzip` | Añade abrir/crear/extractar ZIP, 7z, TAR y RAR desde Thunar. File Roller arrastra más GNOME. | 3,0 MiB / 10,3 MiB después de Archivos | Xarchiver y el plugin usan GTK 3; `xarchiver.desktop`, `GenericName[es]=Gestor de archivos comprimidos`. |
| Integración Qt | `qtwayland5` | Se hace explícito el plugin que corresponde a `QT_QPA_PLATFORM=wayland;xcb`; Calamares y sus dependencias ya lo introducen hoy, por lo que el coste marginal calculado es cero. Evita depender de una relación transitiva para aplicaciones Qt. | ~0 marginal | Wayland nativo con fallback XCB/XWayland. |

## Idioma español

No existe un único metapaquete de idiomas para estas aplicaciones:

- Ristretto, Mousepad, Zathura, GNOME 2048 y Xarchiver incluyen sus catálogos
  `es` en el propio paquete.
- `thunar` depende de `thunar-data`, que contiene `es/LC_MESSAGES/thunar.mo`.
- `abiword` depende de `abiword-common`, que contiene `es-ES.strings`.
- Claws separa todas las traducciones: por eso `claws-mail-i18n` es explícito.
- `aspell-es` da corrección ortográfica española a las aplicaciones que usan
  Enchant/Aspell.
- mpv no ofrece una UI tradicional que requiera un paquete de idioma; su
  `.desktop` sí contiene el comentario español «Reproduzca vídeos y
  canciones» y su control principal es OSD/teclado.

El arranque ya solicita `locales=es_ES.UTF-8`, exporta GDK/Qt Wayland y configura
el teclado español. No hace falta otro paquete regional.

## Asociaciones MIME instaladas

El fichero se coloca en `/etc/xdg/mimeapps.list`, ubicación de configuración
global de la especificación XDG. Se incluyen `Default Applications` y `Added
Associations`: esto último es importante para formatos como WebP/HEIF y DOCX
que la aplicación abre aunque su `.desktop` de Bookworm no los anuncie todos.

| Uso | MIME | `.desktop` predeterminado |
|---|---|---|
| Fotos | JPEG, PNG, GIF, BMP, TIFF, WebP, SVG, HEIF/HEIC y AVIF | `org.xfce.ristretto.desktop` |
| Audio | MP3/MPEG, Ogg, FLAC, WAV, MP4/M4A, AAC, Opus y WebM | `mpv.desktop` |
| Vídeo | MP4, Matroska/MKV, WebM, QuickTime/MOV, AVI, MPEG y Ogg | `mpv.desktop` |
| PDF | `application/pdf`, `application/x-pdf` | `org.pwmt.zathura-pdf-poppler.desktop` |
| Texto/nota | `text/plain`, `text/markdown` | `org.xfce.mousepad.desktop` |
| Directorio | `inode/directory` | `thunar.desktop` |
| Documento | DOC, DOCX, RTF y ODT | `abiword.desktop` |
| Correo | `x-scheme-handler/mailto` | `claws-mail.desktop` |
| Web | HTTP, HTTPS y HTML | `chromium.desktop` |
| Comprimido | ZIP, 7z, RAR, TAR y GZip | `xarchiver.desktop` |

Con `libglib2.0-bin` y `xdg-utils` ya explícitos en la imagen, la cadena es:

`files_open` → `xdg-open /ruta` → configuración XDG global → `.desktop` →
aplicación → detección de ventana de `graphical-launcher` → movimiento/foco en
Sway.

## Descubrimiento real por `apps.ts`

`apps.ts` recorre `$XDG_DATA_DIRS/applications` (por defecto
`/usr/local/share/applications` y `/usr/share/applications`), exige
`Type=Application` y `Exec`, descarta `Hidden`/`NoDisplay`, elimina los códigos
`%U/%F/%u/%f` y añade como alias `Name[es_ES]`, `Name[es]`, `Name`,
`GenericName[es]`, el ID y el comando.

| Aplicación | Resultado actual del descubrimiento |
|---|---|
| Ristretto | Descubrible y ejecutable como `ristretto`, «Visor de imágenes» o su nombre completo. «foto/fotos/galería» no aparece en los campos que lee el agente. |
| mpv | Descubrible como `mpv`, `mpv.desktop`, «mpv Media Player» o «Multimedia player». `Comment[es]` y `Keywords` no se leen; «música/vídeo» no resuelve de forma fiable. |
| Zathura | La entrada principal visible es descubrible. La entrada PDF específica tiene `NoDisplay=true`, por lo que solo actúa como handler MIME; «PDF/documento» no es alias de la entrada principal. |
| Mousepad | Descubrible como «Editor de texto»; «nota/notas» no es alias. |
| Thunar | Descubrible dinámicamente y, además, la definición conocida `files` ya resuelve «archivos/ficheros/carpeta». Ahora su primer comando, `xdg-open $HOME`, sí termina en Thunar. |
| Claws Mail | Descubrible; «correo» suele ser match parcial único de «Cliente de correo electrónico», pero conviene hacerlo determinista. |
| AbiWord | Descubrible como AbiWord/«Procesador de textos»; DOC/DOCX se abren de forma determinista por MIME. |
| GNOME 2048 | Descubrible como `2048`/`gnome-2048`; «juego» no existe como alias. |
| Xarchiver | Descubrible como Xarchiver/«Gestor de archivos comprimidos». |

### Entradas listas para integrar en `KNOWN_APPS`

Estas cuatro cubren exactamente las frases de aceptación «foto», «música»,
«correo» y «juego». `desktopId` hace que el flujo prefiera `gtk-launch`, igual
que para las entradas descubiertas.

```ts
{
  appId: "photos",
  displayName: "Fotos",
  aliases: [
    "foto", "fotos", "imagen", "imagenes", "imágenes",
    "galeria", "galería", "visor de imagenes", "visor de imágenes",
  ],
  commands: [{ command: "ristretto" }],
  desktopId: "org.xfce.ristretto.desktop",
},
{
  appId: "media",
  displayName: "Música y vídeo",
  aliases: [
    "musica", "música", "audio", "video", "vídeo", "videos", "vídeos",
    "pelicula", "película", "peliculas", "películas", "reproductor",
    "reproductor multimedia", "mpv",
  ],
  commands: [{ command: "mpv", args: ["--player-operation-mode=pseudo-gui"] }],
  desktopId: "mpv.desktop",
},
{
  appId: "mail",
  displayName: "Correo",
  aliases: [
    "correo", "correo electronico", "correo electrónico", "email", "e-mail",
    "mail", "cliente de correo", "claws", "claws mail",
  ],
  commands: [{ command: "claws-mail" }],
  desktopId: "claws-mail.desktop",
},
{
  appId: "game",
  displayName: "Juego 2048",
  aliases: ["juego", "juegos", "jugar", "2048", "veinte cuarenta y ocho"],
  commands: [{ command: "gnome-2048" }],
  desktopId: "org.gnome.TwentyFortyEight.desktop",
},
```

Entradas adicionales recomendadas para lenguaje natural:

```ts
{
  appId: "pdf",
  displayName: "Documentos PDF",
  aliases: ["pdf", "lector pdf", "lector de pdf", "documento pdf", "zathura"],
  commands: [{ command: "zathura" }],
  desktopId: "org.pwmt.zathura.desktop",
},
{
  appId: "notes",
  displayName: "Notas",
  aliases: ["nota", "notas", "bloc de notas", "editor", "editor de texto", "mousepad"],
  commands: [{ command: "mousepad" }],
  desktopId: "org.xfce.mousepad.desktop",
},
{
  appId: "writer",
  displayName: "Documentos",
  aliases: ["documento", "documentos", "word", "procesador de textos", "abiword"],
  commands: [{ command: "abiword" }],
  desktopId: "abiword.desktop",
},
```

### Workspace y colocación

No hace falta añadir reglas `for_window` a Sway. El launcher ya espera la
ventana, la mueve al workspace solicitado y la enfoca; una regla paralela
volvería a crear dos autoridades compitiendo, justo lo que el comentario de la
configuración evita.

Sí hacen falta dos ajustes en el código que integra el otro agente:

1. En `resolveDefaultWorkspaceForApp`, devolver workspace **4** para `photos`,
   `media`, `ristretto`, `org.xfce.ristretto` y `mpv`. Correo, juego, PDF,
   notas, documentos y archivos pueden conservar workspace **2**.
2. `MEDIA_EXTENSIONS` de `components/agent/files.ts` ya manda JPG/PNG/GIF/WebP,
   MP4/MOV/MKV y MP3/WAV/FLAC a workspace 4. Añadir:
   `.bmp`, `.tif`, `.tiff`, `.svg`, `.heif`, `.heic`, `.avif`, `.webm`,
   `.avi`, `.mpeg`, `.mpg`, `.ogg`, `.opus`, `.m4a` y `.aac`. Esto no afecta a
   la apertura MIME, pero evita colocar esos medios en workspace 2.

Por tanto, el bloque Sway listo para pegar es deliberadamente **ninguno**.

## Verificación ejecutada en el worktree

- Los 21 paquetes raíz de `desktop-apps.list.chroot` existen en el índice
  oficial amd64 de Debian 12 Bookworm.
- Se extrajeron los `.deb` sin instalarlos y las diez entradas `.desktop`
  relevantes pasaron `desktop-file-validate`.
- Una jerarquía XDG temporal, con esas entradas y ejecutables simulados,
  confirmó mediante `gio mime` y `xdg-mime query default` los valores de
  JPEG, WebP, HEIC, MP3, MP4, PDF, texto plano, directorio, DOCX, `mailto:` y
  ZIP definidos en `/etc/xdg/mimeapps.list`.
- `make test` terminó correctamente: 144 tests Bun + 109 Vitest de UI, 238
  Bun + 20 Vitest del instalador, 11 del agente y 9 Python; **531 tests, 0
  fallos**.
- No se ejecutó ningún build, quick-test, release ni arranque de ISO.

## Plan de prueba en la imagen real

Estas pruebas requieren arrancar la futura imagen; no se han ejecutado en este
worktree por la prohibición explícita de construir la ISO.

1. **Inventario en live e instalado.** En ambos entornos ejecutar
   `dpkg-query -W thunar ristretto mpv zathura mousepad abiword claws-mail
   gnome-2048 xarchiver qtwayland5` y comprobar que no falta ninguno.
2. **Entradas válidas.** Ejecutar `desktop-file-validate` sobre
   `thunar.desktop`, `org.xfce.ristretto.desktop`, `mpv.desktop`,
   `org.pwmt.zathura.desktop`, `org.pwmt.zathura-pdf-poppler.desktop`,
   `org.xfce.mousepad.desktop`, `abiword.desktop`, `claws-mail.desktop`,
   `org.gnome.TwentyFortyEight.desktop` y `xarchiver.desktop` bajo
   `/usr/share/applications`.
3. **Defaults efectivos.** Como el usuario de sesión, verificar al menos:

   ```sh
   xdg-mime query default image/jpeg
   xdg-mime query default image/webp
   xdg-mime query default audio/mpeg
   xdg-mime query default video/mp4
   xdg-mime query default application/pdf
   xdg-mime query default text/plain
   xdg-mime query default inode/directory
   xdg-mime query default x-scheme-handler/mailto
   ```

   Deben devolver, respectivamente, Ristretto, Ristretto, mpv, mpv, el
   handler PDF de Zathura, Mousepad, Thunar y Claws Mail.
4. **Apertura por ruta.** Preparar ficheros válidos JPEG, WebP, HEIC/AVIF, MP3,
   Ogg/Opus, MP4, MKV, PDF, TXT, DOCX, ODT y ZIP. Probar `xdg-open` con cada uno
   y `xdg-open "$HOME"`. Repetir desde voz con «abre esta foto», «reproduce
   este audio», «abre este vídeo», «lee este PDF», «abre este documento» y
   «abre mis archivos».
5. **Apertura por nombre.** Tras integrar las entradas conocidas, probar «abre
   fotos», «abre música», «abre el correo», «abre un juego», «abre el lector
   de PDF», «escribe una nota» y «abre documentos». Comprobar respuesta `ok`,
   ventana mapeada y ausencia de salida inmediata del proceso.
6. **Sway.** Con `swaymsg -t get_tree`, comprobar que foto/audio/vídeo abiertos
   como fichero aparecen a pantalla completa en `4:media`; las demás apps en
   `2:app`; la UI principal sigue en `1:home`. Confirmar foco y volver a probar
   con una instancia ya abierta.
7. **Español.** Con `LANG=es_ES.UTF-8`, abrir todas las aplicaciones y revisar
   menús/diálogos. En Claws y AbiWord escribir una palabra mal escrita en
   español y confirmar que el diccionario ofrecido es español.
8. **Archivos reales.** Montar una memoria USB desde Thunar, abrir su carpeta,
   previsualizar miniaturas y extraer/crear un ZIP. Comprobar papelera. Las
   ubicaciones SMB/MTP no son criterio de aceptación de este bloque porque no
   se añadió `gvfs-backends` para evitar su pila de red/cuentas.
9. **Correo.** Configurar una cuenta de prueba IMAP/SMTP, recibir un mensaje,
   abrir un enlace HTTPS (Chromium) y un `mailto:` (Claws). No usar credenciales
   personales en la imagen live.
10. **Persistencia tras Calamares.** Repetir defaults, voz y apertura de una
    muestra de cada tipo tras instalar y reiniciar, para demostrar que no era
    comportamiento exclusivo del live system.

## Riesgos residuales explícitos

- AbiWord cubre documentos de texto comunes pero no hojas de cálculo ni
  presentaciones. Añadir LibreOffice debe ser una decisión separada basada en
  presupuesto de ISO.
- mpv prioriza ligereza y codecs sobre una biblioteca musical tradicional.
- `gvfs-backends` quedó fuera conscientemente: acceso local, discos y papelera
  sí están; SMB, MTP y algunos servicios remotos requieren medir ese paquete
  en una futura ampliación.
- Los costes son resolución estática del repositorio Bookworm actual; la única
  cifra autoritativa de ISO será la que se mida en un build autorizado futuro.
