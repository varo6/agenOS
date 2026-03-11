#!/usr/bin/env python3
import json
import subprocess
import time
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HOST = "127.0.0.1"
PORT = 4174
MAIN_URL = "http://127.0.0.1:4173/health"
HTML = """<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>AgenOS Shell Error</title>
    <style>
      :root {
        color-scheme: dark;
        font-family: "IBM Plex Sans", sans-serif;
        background:
          radial-gradient(circle at top left, rgba(227, 154, 85, 0.28), transparent 30%),
          linear-gradient(135deg, #120e0b 0%, #1c1511 55%, #0f1815 100%);
        color: #f8eee2;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 24px;
      }
      main {
        width: min(540px, 100%);
        border: 1px solid rgba(255,255,255,0.12);
        border-radius: 28px;
        padding: 32px;
        background: rgba(20, 15, 11, 0.72);
        backdrop-filter: blur(18px);
      }
      h1 {
        margin: 0 0 12px;
        font-family: "Space Grotesk", sans-serif;
      }
      p { color: rgba(248, 238, 226, 0.78); }
      .actions { display: flex; gap: 12px; margin-top: 28px; flex-wrap: wrap; }
      button {
        border: none;
        border-radius: 999px;
        padding: 14px 20px;
        font: inherit;
        cursor: pointer;
      }
      .primary {
        background: linear-gradient(135deg, #f39d52, #f1c87b);
        color: #20140e;
        font-weight: 700;
      }
      .secondary {
        background: rgba(255,255,255,0.08);
        color: #f8eee2;
      }
      #status { min-height: 1.4em; margin-top: 16px; color: #ffd7b2; }
    </style>
  </head>
  <body>
    <main>
      <div>Fallback local</div>
      <h1>La shell principal no ha arrancado.</h1>
      <p>Esta pantalla es local a la sesión. Puedes reintentar el backend o abrir un terminal de mantenimiento sin reiniciar el equipo.</p>
      <div class="actions">
        <button class="primary" id="retry">Reintentar shell</button>
        <button class="secondary" id="terminal">Abrir terminal de mantenimiento</button>
      </div>
      <div id="status"></div>
    </main>
    <script>
      const status = document.getElementById("status");
      async function send(path) {
        status.textContent = "Trabajando...";
        const response = await fetch(path, { method: "POST" });
        const payload = await response.json();
        if (!response.ok || !payload.ok) {
          throw new Error(payload.message || "La operación ha fallado.");
        }
        status.textContent = payload.message || "Operación completada.";
        return payload;
      }
      document.getElementById("retry").addEventListener("click", async () => {
        try {
          await send("/retry-shell");
          window.location.href = "http://127.0.0.1:4173";
        } catch (error) {
          status.textContent = error instanceof Error ? error.message : "No se pudo reintentar la shell.";
        }
      });
      document.getElementById("terminal").addEventListener("click", async () => {
        try {
          await send("/open-terminal");
        } catch (error) {
          status.textContent = error instanceof Error ? error.message : "No se pudo abrir el terminal.";
        }
      });
    </script>
  </body>
</html>
"""


def backend_healthy() -> bool:
    result = subprocess.run(["curl", "--silent", "--fail", MAIN_URL], check=False)
    return result.returncode == 0


class EmergencyHandler(BaseHTTPRequestHandler):
    server_version = "AgenOSEmergency/0.1"

    def log_message(self, format: str, *args) -> None:
        print(f"[agenos-emergency] {self.address_string()} - {format % args}")

    def _send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if self.path == "/health":
            self._send_json(HTTPStatus.OK, {"ok": True})
            return

        body = HTML.encode("utf-8")
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self) -> None:
        if self.path == "/retry-shell":
            if not backend_healthy():
                subprocess.Popen(
                    ["/usr/bin/python3", "/usr/local/lib/agenos-shell/server.py"],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    start_new_session=True,
                )
            for _ in range(40):
                if backend_healthy():
                    self._send_json(HTTPStatus.OK, {"ok": True, "message": "La shell principal ha vuelto a responder."})
                    return
                time.sleep(0.25)
            self._send_json(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                {"ok": False, "message": "La shell sigue sin responder en http://127.0.0.1:4173."},
            )
            return

        if self.path == "/open-terminal":
            result = subprocess.run(["/usr/bin/python3", "/usr/local/bin/agenos-shell-helper", "terminal"], check=False)
            if result.returncode != 0:
                self._send_json(
                    HTTPStatus.INTERNAL_SERVER_ERROR,
                    {"ok": False, "message": "No se pudo abrir el terminal de mantenimiento."},
                )
                return
            self._send_json(HTTPStatus.ACCEPTED, {"ok": True, "message": "Terminal abierto."})
            return

        self._send_json(HTTPStatus.NOT_FOUND, {"ok": False, "message": "Ruta no encontrada."})


def main() -> None:
    server = ThreadingHTTPServer((HOST, PORT), EmergencyHandler)
    print(f"[agenos-emergency] listening on http://{HOST}:{PORT}")
    server.serve_forever()


if __name__ == "__main__":
    main()
