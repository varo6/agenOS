#!/usr/bin/env python3
import configparser
import json
import os
import re
import secrets
import shlex
import subprocess
import sys
import threading
import time
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlparse

sys.path.insert(0, "/usr/local/lib/agenos-installer")

from common import (  # noqa: E402
    HOST,
    PORT,
    discover_disks,
    ensure_runtime_dir,
    is_live_session,
    preflight_payload,
    profile_path_for_uid,
    validate_profile,
)

STATIC_DIR = Path("/usr/local/share/agenos-ui")
SHELL_CONFIG_PATH = Path("/etc/agenos/shell.json")
SYSTEM_APPLICATIONS_DIR = Path("/usr/share/applications")
USER_APPLICATIONS_DIR = Path.home() / ".local/share/applications"
APP_WORKSPACE = "2:app"
HOME_WORKSPACE = "1:home"
DESKTOP_FIELD_CODE_RE = re.compile(r"%[fFuUdDnNickvm]")
EXCLUDED_DESKTOP_IDS = {
    "agenos-installer.desktop",
    "agenos-classic-installer.desktop",
}
BOOT_MODES = {"installer", "home", "app"}
INTERNAL_APPS = [
    {
        "desktopId": "internal:terminal",
        "name": "Terminal de mantenimiento",
        "description": "Abre foot dentro de la sesión Wayland actual.",
        "iconName": "utilities-terminal",
        "exec": "maintenance:terminal",
        "categories": ["System"],
        "source": "internal",
        "hidden": True,
    },
    {
        "desktopId": "internal:classic-installer",
        "name": "Instalación avanzada con Calamares",
        "description": "Abre Calamares clásico con el flujo completo.",
        "iconName": "system-software-install",
        "exec": "maintenance:classic-installer",
        "categories": ["System"],
        "source": "internal",
        "hidden": True,
    },
    {
        "desktopId": "internal:reload-shell",
        "name": "Recargar shell",
        "description": "Reinicia el instalador sin reiniciar el sistema.",
        "iconName": "view-refresh",
        "exec": "maintenance:reload-shell",
        "categories": ["System"],
        "source": "internal",
        "hidden": True,
    },
]


def _parse_bool(value: str | None) -> bool:
    return str(value or "").strip().lower() in {"1", "true", "yes"}


def load_shell_config() -> dict[str, Any]:
    defaults = {
        "schemaVersion": 1,
        "bootMode": "installer" if is_live_session() else "home",
        "startupAppDesktopId": None,
        "maintenanceEnabled": True,
    }
    if not SHELL_CONFIG_PATH.exists():
        return defaults

    try:
        payload = json.loads(SHELL_CONFIG_PATH.read_text(encoding="utf-8"))
    except Exception:
        return defaults

    boot_mode = payload.get("bootMode")
    if boot_mode not in BOOT_MODES:
        boot_mode = defaults["bootMode"]

    startup_app = payload.get("startupAppDesktopId")
    if startup_app is not None:
        startup_app = str(startup_app)

    return {
        "schemaVersion": 1,
        "bootMode": boot_mode,
        "startupAppDesktopId": startup_app,
        "maintenanceEnabled": bool(payload.get("maintenanceEnabled", True)),
    }


def bootstrap_payload(session_token: str) -> dict[str, Any]:
    config = load_shell_config()
    live = is_live_session()
    boot_mode = config["bootMode"]
    if boot_mode == "installer" and not live:
        boot_mode = "home"
    return {
        "sessionToken": session_token,
        "bootMode": boot_mode,
        "isLiveSession": live,
        "maintenanceEnabled": config["maintenanceEnabled"],
        "startupAppDesktopId": config["startupAppDesktopId"],
        "installerEnabled": live,
    }


def parse_desktop_file(path: Path, source: str) -> dict[str, Any] | None:
    parser = configparser.ConfigParser(interpolation=None, strict=False)
    try:
        parser.read_string(path.read_text(encoding="utf-8", errors="ignore"))
    except Exception:
        return None

    if "Desktop Entry" not in parser:
        return None

    entry = parser["Desktop Entry"]
    if entry.get("Type") != "Application":
        return None

    desktop_id = path.name
    if desktop_id in EXCLUDED_DESKTOP_IDS:
        return None

    hidden = _parse_bool(entry.get("Hidden")) or _parse_bool(entry.get("NoDisplay"))
    categories = [item for item in (entry.get("Categories", "").split(";")) if item]

    return {
        "desktopId": desktop_id,
        "name": entry.get("Name", desktop_id.rsplit(".", 1)[0]),
        "description": entry.get("Comment", "").strip(),
        "iconName": entry.get("Icon") or None,
        "exec": entry.get("Exec", "").strip(),
        "categories": categories,
        "source": source,
        "hidden": hidden,
        "desktopPath": str(path),
    }


def discover_apps() -> list[dict[str, Any]]:
    apps: dict[str, dict[str, Any]] = {}

    for directory, source in ((SYSTEM_APPLICATIONS_DIR, "system"), (USER_APPLICATIONS_DIR, "user")):
        if not directory.exists():
            continue
        for path in sorted(directory.glob("*.desktop")):
            parsed = parse_desktop_file(path, source)
            if parsed is None:
                continue
            apps[parsed["desktopId"]] = parsed

    visible = []
    for app in apps.values():
        if app["hidden"]:
            continue
        visible.append({key: value for key, value in app.items() if key != "desktopPath"})

    visible.sort(key=lambda item: item["name"].lower())
    return visible + [item.copy() for item in INTERNAL_APPS]


def locate_app(desktop_id: str) -> dict[str, Any] | None:
    for candidate in discover_apps():
        if candidate["desktopId"] == desktop_id:
            return candidate

    for directory, source in ((SYSTEM_APPLICATIONS_DIR, "system"), (USER_APPLICATIONS_DIR, "user")):
        path = directory / desktop_id
        if path.exists():
            parsed = parse_desktop_file(path, source)
            if parsed is not None:
                return parsed
    return None


def sanitize_exec(exec_line: str) -> list[str]:
    protected = exec_line.replace("%%", "__PERCENT__")
    protected = DESKTOP_FIELD_CODE_RE.sub("", protected)
    protected = protected.replace("__PERCENT__", "%").strip()
    command = [part for part in shlex.split(protected) if part]
    if not command:
        raise ValueError("El Exec del .desktop no contiene ningún comando ejecutable.")
    return command


def sway_command(command: str) -> None:
    subprocess.run(["swaymsg", command], check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def _iter_tree(node: dict[str, Any]):
    yield node
    for child in node.get("nodes", []):
        yield from _iter_tree(child)
    for child in node.get("floating_nodes", []):
        yield from _iter_tree(child)


def workspace_window_count(workspace_name: str) -> int:
    completed = subprocess.run(
        ["swaymsg", "-t", "get_tree", "-r"],
        capture_output=True,
        text=True,
        check=False,
    )
    if completed.returncode != 0:
        return 0
    try:
        tree = json.loads(completed.stdout)
    except Exception:
        return 0

    target = None
    for node in _iter_tree(tree):
        if node.get("type") == "workspace" and node.get("name") == workspace_name:
            target = node
            break
    if target is None:
        return 0

    count = 0
    for node in _iter_tree(target):
        if node.get("type") not in {"con", "floating_con"}:
            continue
        if node.get("window") or node.get("app_id"):
            count += 1
    return count


class ShellRequestHandler(SimpleHTTPRequestHandler):
    server_version = "AgenOSShell/0.1"

    def __init__(self, *args, directory: str | None = None, **kwargs):
        super().__init__(*args, directory=str(STATIC_DIR), **kwargs)

    @property
    def state(self) -> "ShellHttpServer":
        return self.server  # type: ignore[return-value]

    def log_message(self, format: str, *args) -> None:
        print(f"[agenos-shell] {self.address_string()} - {format % args}")

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

    def _spawn_pkexec(self, command: list[str]) -> tuple[bool, str | None]:
        runtime_dir = ensure_runtime_dir()
        log_path = runtime_dir / "shell-helper.log"
        env = {
            "DISPLAY": os.environ.get("DISPLAY", ""),
            "XAUTHORITY": os.environ.get("XAUTHORITY", ""),
            "DBUS_SESSION_BUS_ADDRESS": os.environ.get("DBUS_SESSION_BUS_ADDRESS", ""),
            "WAYLAND_DISPLAY": os.environ.get("WAYLAND_DISPLAY", ""),
            "XDG_RUNTIME_DIR": os.environ.get("XDG_RUNTIME_DIR", ""),
            "XDG_SESSION_TYPE": os.environ.get("XDG_SESSION_TYPE", ""),
            "XDG_CURRENT_DESKTOP": os.environ.get("XDG_CURRENT_DESKTOP", "AgenOS"),
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
            return True, None

        if return_code != 0:
            return False, f"El helper salió con código {return_code}. Revisa {log_path}."
        return True, None

    def _spawn_installer_helper(self, args: list[str], cleanup_path: Path | None = None) -> tuple[bool, str | None]:
        ok, message = self._spawn_pkexec(["pkexec", "/usr/local/bin/agenos-installer-helper", *args])
        if cleanup_path is not None:
            if ok:
                def cleanup_watcher() -> None:
                    time.sleep(30)
                    cleanup_path.unlink(missing_ok=True)

                threading.Thread(target=cleanup_watcher, daemon=True).start()
            else:
                cleanup_path.unlink(missing_ok=True)
        return ok, message

    def _spawn_shell_helper(self, action: str) -> tuple[bool, str | None]:
        return self._spawn_pkexec(["pkexec", "/usr/bin/python3", "/usr/local/bin/agenos-shell-helper", action])

    def do_GET(self) -> None:
        parsed = urlparse(self.path)

        if parsed.path == "/health":
            self._send_json(HTTPStatus.OK, {"ok": True})
            return

        if parsed.path == "/api/bootstrap":
            self._send_json(HTTPStatus.OK, bootstrap_payload(self.state.session_token))
            return

        if parsed.path == "/api/apps":
            if not self._require_token():
                return
            self._send_json(HTTPStatus.OK, discover_apps())
            return

        if parsed.path == "/api/installer/preflight":
            self._send_json(HTTPStatus.OK, preflight_payload())
            return

        if parsed.path == "/api/installer/disks":
            self._send_json(HTTPStatus.OK, discover_disks())
            return

        self._serve_static(parsed.path)

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/") and not self._require_token():
            return

        if parsed.path == "/api/apps/open":
            payload = self._read_json_body()
            if not isinstance(payload, dict):
                self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "message": "Body JSON inválido."})
                return

            desktop_id = str(payload.get("desktopId") or "").strip()
            if not desktop_id:
                self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "message": "desktopId es obligatorio."})
                return

            app = locate_app(desktop_id)
            if app is None or app.get("source") == "internal":
                self._send_json(HTTPStatus.NOT_FOUND, {"ok": False, "message": "App no encontrada."})
                return

            try:
                command = sanitize_exec(str(app.get("exec") or ""))
            except ValueError as error:
                self._send_json(HTTPStatus.UNPROCESSABLE_ENTITY, {"ok": False, "message": str(error)})
                return

            sway_command(f'[workspace="{APP_WORKSPACE}"] kill')
            sway_command(f'workspace "{APP_WORKSPACE}"')
            try:
                subprocess.Popen(command, env=os.environ.copy(), start_new_session=True)
            except FileNotFoundError:
                self._send_json(
                    HTTPStatus.UNPROCESSABLE_ENTITY,
                    {"ok": False, "message": f"El binario {command[0]} no existe en esta sesión."},
                )
                return

            self._send_json(
                HTTPStatus.ACCEPTED,
                {"ok": True, "message": f"Abriendo {app['name']} en {APP_WORKSPACE}."},
            )
            return

        if parsed.path == "/api/system/poweroff":
            ok, message = self._spawn_shell_helper("poweroff")
            if not ok:
                self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "message": message})
                return
            self._send_json(HTTPStatus.ACCEPTED, {"ok": True, "message": "Apagando el sistema."})
            return

        if parsed.path == "/api/system/reboot":
            ok, message = self._spawn_shell_helper("reboot")
            if not ok:
                self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "message": message})
                return
            self._send_json(HTTPStatus.ACCEPTED, {"ok": True, "message": "Reiniciando el sistema."})
            return

        if parsed.path == "/api/system/maintenance":
            payload = self._read_json_body()
            action = ""
            if isinstance(payload, dict):
                action = str(payload.get("action") or "").strip()

            if action == "classic-installer":
                if not is_live_session():
                    self._send_json(
                        HTTPStatus.FORBIDDEN,
                        {"ok": False, "message": "Calamares clásico solo está disponible en la sesión live."},
                    )
                    return
                ok, message = self._spawn_installer_helper(["classic"])
            elif action in {"terminal", "reload-shell"}:
                ok, message = self._spawn_shell_helper(action)
            else:
                self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "message": "Acción de mantenimiento inválida."})
                return

            if not ok:
                self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "message": message})
                return

            self._send_json(HTTPStatus.ACCEPTED, {"ok": True, "message": f"Acción {action} lanzada."})
            return

        if parsed.path == "/api/installer/validate-profile":
            payload = self._read_json_body()
            normalized, errors = validate_profile(payload)
            self._send_json(
                HTTPStatus.OK,
                {"ok": not errors, "errors": errors, "normalizedProfile": normalized},
            )
            return

        if parsed.path == "/api/installer/start-guided":
            payload = self._read_json_body()
            normalized, errors = validate_profile(payload)
            if errors or normalized is None:
                self._send_json(HTTPStatus.UNPROCESSABLE_ENTITY, {"ok": False, "errors": errors})
                return

            profile_path = profile_path_for_uid()
            profile_path.write_text(json.dumps(normalized, indent=2), encoding="utf-8")
            os.chmod(profile_path, 0o600)
            launched, error_message = self._spawn_installer_helper(
                ["guided", "--profile", str(profile_path)],
                cleanup_path=profile_path,
            )
            if not launched:
                self._send_json(
                    HTTPStatus.INTERNAL_SERVER_ERROR,
                    {"ok": False, "message": error_message or "No se pudo abrir el Calamares guiado."},
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

        if parsed.path == "/api/installer/start-classic":
            if not is_live_session():
                self._send_json(
                    HTTPStatus.FORBIDDEN,
                    {"ok": False, "message": "Calamares clásico solo está disponible en la sesión live."},
                )
                return
            launched, error_message = self._spawn_installer_helper(["classic"])
            if not launched:
                self._send_json(
                    HTTPStatus.INTERNAL_SERVER_ERROR,
                    {"ok": False, "message": error_message or "No se pudo abrir el Calamares clásico."},
                )
                return
            self._send_json(
                HTTPStatus.ACCEPTED,
                {"ok": True, "launched": True, "message": "Se está abriendo la instalación avanzada con Calamares."},
            )
            return

        self._send_json(HTTPStatus.NOT_FOUND, {"ok": False, "message": "Ruta no encontrada."})

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
            "__AGENOS_SHELL_BOOTSTRAP__",
            json.dumps({"sessionToken": self.state.session_token}, separators=(",", ":")),
        )
        encoded = body.encode("utf-8")
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)


class ShellHttpServer(ThreadingHTTPServer):
    def __init__(self) -> None:
        self.session_token = secrets.token_urlsafe(32)
        ensure_runtime_dir()
        super().__init__((HOST, PORT), ShellRequestHandler)
        self._workspace_thread = threading.Thread(target=self._workspace_monitor, daemon=True)
        self._workspace_thread.start()

    def _workspace_monitor(self) -> None:
        while True:
            try:
                if workspace_window_count(APP_WORKSPACE) == 0:
                    sway_command(f'workspace "{HOME_WORKSPACE}"')
            except Exception:
                pass
            time.sleep(1.0)


def main() -> None:
    if not STATIC_DIR.exists():
        raise SystemExit(f"No existe el frontend compilado en {STATIC_DIR}")

    server = ShellHttpServer()
    print(f"[agenos-shell] listening on http://{HOST}:{PORT}")
    server.serve_forever()


if __name__ == "__main__":
    main()
