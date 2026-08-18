# Conectar AgenOS con Google

El usuario final **nunca** debe ver una consola de Google ni crear credenciales.
Lo único que ve es la pantalla de siempre: elegir su cuenta y aceptar permisos.

Para que eso sea así, la credencial de aplicación se registra **una sola vez, por
quien monta la imagen**, y se instala dentro de la ISO.

## Pasos (una vez, no por usuario)

1. Entra en <https://console.cloud.google.com/> y crea un proyecto, por ejemplo `agenos`.
2. En *APIs y servicios* activa la **Gmail API** y la **Google Calendar API**.
3. En *Pantalla de consentimiento de OAuth*, rellena nombre de la aplicación,
   correo de soporte y logo. Este es el texto que leerá el usuario al entrar.
4. En *Credenciales* → *Crear credenciales* → *ID de cliente de OAuth*, elige
   tipo **Aplicación de escritorio**.
5. Descarga el JSON y colócalo en la imagen como
   `build/live-build/config/includes.chroot/etc/agenos/google-client.json`.
   Se acepta tal cual lo entrega Google (`{"installed": {"client_id": ...}}`) o
   el formato corto `{"clientId": "...", "clientSecret": "..."}`.

En un sistema ya instalado la ruta es `/etc/agenos/google-client.json`. Se puede
sobrescribir con `AGENOS_GOOGLE_SYSTEM_CLIENT`, y un usuario avanzado puede poner
la suya en `~/.agenos/google/client.json`, que tiene prioridad.

## Sobre el "secreto" de cliente

En una aplicación instalada el `client_secret` **no es un secreto**: va dentro del
binario que se distribuye, y Google lo contempla así para este tipo de cliente
(RFC 8252). La seguridad la da PKCE y el redirect a `127.0.0.1`, que es lo que
implementa `components/agent/google-auth.ts`. Aun así, no lo publiques en un
repositorio público: rota la credencial si el repo se hace público.

## Lo que hay que saber antes de distribuir

Los scopes de Gmail que permiten **leer el contenido** de los correos
(`gmail.modify`, `gmail.readonly`) están clasificados por Google como
*restricted*. Consecuencias reales:

- Mientras la app esté en modo **Testing**, funciona sin verificar, pero solo
  para las cuentas que añadas como usuarios de prueba (límite de 100) y Google
  muestra un aviso de "aplicación no verificada" que hay que sortear a mano. Para
  un TFG o un piloto es suficiente; para un abuelo sin ayuda, ese aviso es
  fricción real.
- Para publicarla a cualquiera hace falta pasar la **verificación** de Google y,
  por ser scope restringido, una evaluación de seguridad anual. Es un trámite
  largo y con coste.
- Si el despliegue es dentro de una organización con Google Workspace, el tipo
  **Internal** evita todo lo anterior.

Si esa fricción no compensa, la alternativa sin credenciales es dejar que el
agente maneje Gmail por `web_control` sobre la sesión que el usuario ya tenga
abierta en el navegador. Es menos fiable, pero no exige registrar nada.
