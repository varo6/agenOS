# USB live con persistencia

AgenOS puede guardar archivos, sesiones y redes Wi-Fi entre arranques. La ISO solicita persistencia al arrancar, pero una copia normal con `dd` no crea el espacio donde guardarla. El script del proyecto hace ambos pasos.

## Crear el USB desde Linux

Esta operación borra el USB completo. Primero identifica el enlace estable del dispositivo:

```bash
ls -l /dev/disk/by-id/usb-*
```

Haz una simulación. Sustituye el dispositivo del ejemplo por el tuyo:

```bash
./scripts/create-persistent-usb.sh --device /dev/disk/by-id/usb-FABRICANTE_MODELO
```

Revisa modelo, número de serie y tamaño. Si son correctos, ejecuta el mismo comando con permisos de administrador:

```bash
sudo ./scripts/create-persistent-usb.sh --device /dev/disk/by-id/usb-FABRICANTE_MODELO --apply
```

El perfil predeterminado conserva `/home` y las conexiones de NetworkManager. Esto incluye Descargas, la sesión de AgenOS y las contraseñas Wi-Fi. Los datos no están cifrados, así que cualquiera con acceso físico al USB puede leerlos desde otro Linux.

Existe un perfil experimental que conserva todo el sistema live:

```bash
sudo ./scripts/create-persistent-usb.sh --device /dev/disk/by-id/usb-FABRICANTE_MODELO --profile full --apply
```

No conviene usar `full` para datos importantes. Un overlay completo puede dejar de arrancar al cambiar la versión de la ISO.

## Uso y copias de seguridad

- Apaga AgenOS y espera a que el equipo termine antes de retirar el USB.
- Copia los archivos importantes a otro disco. La persistencia no sustituye una copia de seguridad.
- Volver a grabar una ISO con `dd`, Rufus, Etcher o este script borra la tabla de particiones y hace inaccesible la persistencia anterior. Copia tus datos antes de actualizar el USB.
- Si el USB se pierde, las sesiones y claves guardadas también quedan expuestas. El cifrado de la persistencia aún no está implementado.

Para comprobarlo, crea un archivo en `Descargas`, apaga el equipo por completo y arranca otra vez con el mismo USB. El archivo debe seguir allí.
