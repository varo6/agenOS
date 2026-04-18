# AgenOS UI

Proyecto React de la shell principal del sistema. Aquí vive el micro, el comando local y la entrada mínima al mantenimiento.

## Desarrollo local

```bash
cd components/ui
bun install
bun dev
```

Eso levanta Vite en `http://127.0.0.1:4174` con un backend mock solo para desarrollo. Por defecto simula una sesión instalada para que la shell quede aislada del instalador.

Si quieres forzar también el acceso discreto al instalador, usa:

```bash
cd components/ui
bun run dev:live
```

## Separación con `components/installer-ui`

- `components/ui`: shell del sistema.
- `components/installer-ui`: instalador guiado.

En la VM se empaquetan ambos en el mismo runtime compartido, pero cada uno mantiene su propio build y su propia carpeta.
