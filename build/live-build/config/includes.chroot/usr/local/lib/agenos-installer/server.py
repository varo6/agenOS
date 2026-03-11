#!/usr/bin/env python3
import json
import os
import secrets
import subprocess
import threading
import time
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

from common import (
    HOST,
    PORT,
    STATIC_DIR,
    discover_disks,
    ensure_runtime_dir,
    preflight_payload,
    profile_path_for_uid,
    validate_profile,
)


def bootstrap_payload(session_token: str) -> bytes:
    return json.dumps({"sessionToken": session_token}, separators=(",", ":")).encode("utf-8")


class InstallerRequestHandler(SimpleHTTPRequestHandler):
    server_version = "AgenOSInstaller/0.1"

    def __init__(self, *args, directory: str | None = None, **kwargs):
        super().__init__(*args, directory=str(STATIC_DIR), **kwargs)

    @property
    def state(self) -> "InstallerHttpServer":
        return self.server  # type: ignore[return-value]

    def log_message(self, format: str, *args) -> None:
        print(f"[agenos-installer] {self.address_string()} - {format % args}")

    def _send_json(self, status: int, payload: object) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _require_token(self) -> bool:
        if self.headers.get("X-Session-Token", "") != self.state.session_token:
            self._send_json(HTTPStatus.FORBIDDEN, {"ok": False, "message": "Token de sesión inválido."})
            return False
        return True

    def _read_json_body(self) -> object:
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length) if length > 0 else b"{}"
        return json.loads(raw.decode("utf-8"))

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/health":
            self._send_json(HTTPStatus.OK, {"ok": True})
            return
        if parsed.path == "/api/preflight":
            self._send_json(HTTPStatus.OK, preflight_payload())
            return
        if parsed.path == "/api/disks":
            self._send_json(HTTPStatus.OK, discover_disks())
            return
        self._serve_static(parsed.path)

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/") and not self._require_token():
            return

        if parsed.path == "/api/validate-profile":
            payload = self._read_json_body()
            normalized, errors = validate_profile(payload)
            self._send_json(
                HTTPStatus.OK,
                {"ok": not errors, "errors": errors, "normalizedProfile": normalized},
            )
            return

        if parsed.path == "/api/start-guided":
            payload = self._read_json_body()
            normalized, errors = validate_profile(payload)
            if errors or normalized is None:
                self._send_json(HTTPStatus.UNPROCESSABLE_ENTITY, {"ok": False, "errors": errors})
                return

            profile_path = profile_path_for_uid()
            profile_path.write_text(json.dumps(normalized, indent=2), encoding="utf-8")
            os.chmod(profile_path, 0o600)
            launched, error_message = self._spawn_helper(
                ["guided", "--profile", str(profile_path)], cleanup_path=profile_path
            )
            if not launched:
                self._send_json(
                    HTTPStatus.INTERNAL_SERVER_ERROR,
                    {
                        "ok": False,
                        "message": error_message or "No se pudo abrir el Calamares guiado.",
                    },
                )
                return
            self._send_json(
                HTTPStatus.ACCEPTED,
                {
                    "ok": True,
                    "launched": True,
                    "message": "Perfil guiado validado. Calamares se abrirá con el tramo final mínimo.",
                },
            )
            return

        if parsed.path == "/api/start-classic":
            launched, error_message = self._spawn_helper(["classic"])
            if not launched:
                self._send_json(
                    HTTPStatus.INTERNAL_SERVER_ERROR,
                    {
                        "ok": False,
                        "message": error_message or "No se pudo abrir el Calamares clásico.",
                    },
                )
                return
            self._send_json(
                HTTPStatus.ACCEPTED,
                {
                    "ok": True,
                    "launched": True,
                    "message": "Se está abriendo la instalación avanzada con Calamares.",
                },
            )
            return

        self._send_json(HTTPStatus.NOT_FOUND, {"ok": False, "message": "Ruta no encontrada."})

    def _spawn_helper(self, args: list[str], cleanup_path: Path | None = None) -> tuple[bool, str | None]:
        command = ["pkexec", "/usr/local/bin/agenos-installer-helper", *args]
        runtime_dir = ensure_runtime_dir()
        log_path = runtime_dir / "helper.log"
        env = {
            "DISPLAY": os.environ.get("DISPLAY", ""),
            "XAUTHORITY": os.environ.get("XAUTHORITY", ""),
            "DBUS_SESSION_BUS_ADDRESS": os.environ.get("DBUS_SESSION_BUS_ADDRESS", ""),
            "WAYLAND_DISPLAY": os.environ.get("WAYLAND_DISPLAY", ""),
            "XDG_RUNTIME_DIR": os.environ.get("XDG_RUNTIME_DIR", ""),
            "XDG_SESSION_TYPE": os.environ.get("XDG_SESSION_TYPE", ""),
            "HOME": os.environ.get("HOME", ""),
            "LANG": os.environ.get("LANG", "C.UTF-8"),
            "PATH": os.environ.get("PATH", "/usr/sbin:/usr/bin:/sbin:/bin"),
        }
        with log_path.open("ab") as log_file:
            log_file.write(
                f"\n[{time.strftime('%Y-%m-%d %H:%M:%S')}] launching: {' '.join(command)}\n".encode("utf-8")
            )
            process = subprocess.Popen(
                command,
                env=env,
                stdout=log_file,
                stderr=subprocess.STDOUT,
                start_new_session=True,
            )

        try:
            return_code = process.wait(timeout=1.0)
        except subprocess.TimeoutExpired:
            return_code = None

        if cleanup_path is not None:
            def cleanup_watcher() -> None:
                watched_code = process.wait()
                if watched_code != 0 and cleanup_path.exists():
                    cleanup_path.unlink(missing_ok=True)

            threading.Thread(target=cleanup_watcher, daemon=True).start()

        if return_code is not None:
            if cleanup_path is not None and cleanup_path.exists():
                cleanup_path.unlink(missing_ok=True)
            return (
                False,
                f"El helper salió con código {return_code}. Revisa {log_path} para el detalle.",
            )

        return True, None

    def _serve_static(self, raw_path: str) -> None:
        requested_path = unquote(raw_path).lstrip("/")
        candidate = STATIC_DIR / requested_path

        if raw_path in {"/", "", "/index.html"} or not candidate.exists() or candidate.is_dir():
            self._serve_index()
            return

        return super().do_GET()

    def _serve_index(self) -> None:
        index_path = STATIC_DIR / "index.html"
        body = index_path.read_text(encoding="utf-8")
        body = body.replace(
            "__AGENOS_INSTALLER_BOOTSTRAP__",
            bootstrap_payload(self.state.session_token).decode("utf-8"),
        )
        encoded = body.encode("utf-8")
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)


class InstallerHttpServer(ThreadingHTTPServer):
    def __init__(self) -> None:
        self.session_token = secrets.token_urlsafe(32)
        ensure_runtime_dir()
        super().__init__((HOST, PORT), InstallerRequestHandler)


def main() -> None:
    if not STATIC_DIR.exists():
        raise SystemExit(f"No existe el frontend compilado en {STATIC_DIR}")

    server = InstallerHttpServer()
    print(f"[agenos-installer] listening on http://{HOST}:{PORT}")
    server.serve_forever()


if __name__ == "__main__":
    main()
