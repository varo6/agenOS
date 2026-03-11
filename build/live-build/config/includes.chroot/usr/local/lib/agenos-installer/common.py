#!/usr/bin/env python3
import json
import os
import re
import subprocess
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

HOST = "127.0.0.1"
PORT = 4173
INSTALLER_RUNTIME_DIRNAME = "agenos-installer"
STATIC_DIR = Path("/usr/local/share/agenos-installer-ui")
ALLOWED_INSTALL_MODES = {"erase-disk"}
ALLOWED_ROOT_MODES = {"same-as-user"}
USERNAME_RE = re.compile(r"^[a-z_][a-z0-9_-]{0,31}$")
HOSTNAME_RE = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$")
KEYBOARD_RE = re.compile(r"^[A-Za-z0-9_,+-]+$")
RESERVED_USERNAMES = {"root", "daemon", "bin", "sys", "sync", "shutdown", "halt", "nobody"}
RESERVED_HOSTNAMES = {"localhost"}
LIVE_MOUNTPOINTS = {"/run/live/medium", "/cdrom"}


def run_command(*args: str) -> str:
    completed = subprocess.run(
        list(args),
        check=True,
        capture_output=True,
        text=True,
    )
    return completed.stdout


def run_command_json(*args: str) -> Any:
    return json.loads(run_command(*args))


def current_uid() -> int:
    return os.getuid()


def runtime_dir_for_uid(uid: int | None = None) -> Path:
    resolved_uid = current_uid() if uid is None else uid
    return Path(f"/run/user/{resolved_uid}/{INSTALLER_RUNTIME_DIRNAME}")


def ensure_runtime_dir(uid: int | None = None) -> Path:
    directory = runtime_dir_for_uid(uid)
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(directory, 0o700)
    return directory


def profile_path_for_uid(uid: int | None = None) -> Path:
    return ensure_runtime_dir(uid) / "profile.json"


def is_live_session() -> bool:
    cmdline = Path("/proc/cmdline").read_text(encoding="utf-8")
    return "boot=live" in cmdline or "components" in cmdline or Path("/run/live/medium").exists()


def firmware_type() -> str:
    return "UEFI" if Path("/sys/firmware/efi").exists() else "BIOS"


def total_ram_bytes() -> int:
    for line in Path("/proc/meminfo").read_text(encoding="utf-8").splitlines():
        if line.startswith("MemTotal:"):
            parts = line.split()
            return int(parts[1]) * 1024
    return 0


def _node_mountpoints(node: dict[str, Any]) -> list[str]:
    mountpoints: list[str] = []
    for mountpoint in node.get("mountpoints") or []:
        if mountpoint:
            mountpoints.append(mountpoint)
    if node.get("mountpoint"):
        mountpoints.append(node["mountpoint"])
    for child in node.get("children") or []:
        mountpoints.extend(_node_mountpoints(child))
    return mountpoints


def _disk_is_live_medium(node: dict[str, Any]) -> bool:
    return any(mountpoint in LIVE_MOUNTPOINTS for mountpoint in _node_mountpoints(node))


def _disk_summary(node: dict[str, Any]) -> dict[str, Any]:
    vendor = (node.get("vendor") or "").strip()
    model = (node.get("model") or "").strip()
    size_bytes = int(node.get("size") or 0)
    transport = (node.get("tran") or "").strip()
    return {
        "path": node.get("path") or f"/dev/{node['name']}",
        "vendor": vendor,
        "model": model,
        "transport": transport,
        "sizeBytes": size_bytes,
        "sizeLabel": format_bytes(size_bytes),
        "systemDisk": _disk_is_live_medium(node),
    }


def discover_disks() -> list[dict[str, Any]]:
    payload = run_command_json(
        "lsblk",
        "-J",
        "-b",
        "-o",
        "NAME,PATH,TYPE,SIZE,MODEL,VENDOR,TRAN,RO,RM,HOTPLUG,MOUNTPOINT,MOUNTPOINTS",
    )
    disks: list[dict[str, Any]] = []
    for node in payload.get("blockdevices", []):
        if node.get("type") != "disk":
            continue
        if int(node.get("ro") or 0) == 1:
            continue
        if int(node.get("rm") or 0) == 1 and _disk_is_live_medium(node):
            continue
        if int(node.get("size") or 0) < 8 * 1024 * 1024 * 1024:
            continue
        summary = _disk_summary(node)
        if summary["systemDisk"]:
            continue
        disks.append(summary)
    disks.sort(key=lambda disk: disk["path"])
    return disks


def format_bytes(value: int) -> str:
    size = float(value)
    units = ["B", "KB", "MB", "GB", "TB"]
    index = 0
    while size >= 1024 and index < len(units) - 1:
        size /= 1024
        index += 1
    precision = 0 if size >= 10 or index == 0 else 1
    return f"{size:.{precision}f} {units[index]}"


def preflight_payload() -> dict[str, Any]:
    disks = discover_disks()
    ram = total_ram_bytes()
    is_live = is_live_session()
    firmware = firmware_type()
    total_installable_disk_bytes = sum(disk["sizeBytes"] for disk in disks)
    checks = [
        {
            "id": "ram",
            "label": "Memoria RAM",
            "status": "ok" if ram >= 4 * 1024 * 1024 * 1024 else "warning",
            "detail": f"Detectados {format_bytes(ram)}. El wrapper v1 recomienda 4 GB o más.",
        },
        {
            "id": "storage",
            "label": "Almacenamiento instalable",
            "status": "ok" if total_installable_disk_bytes >= 32 * 1024 * 1024 * 1024 else "warning",
            "detail": f"Se han detectado {len(disks)} discos válidos con {format_bytes(total_installable_disk_bytes)} en total.",
        },
        {
            "id": "firmware",
            "label": "Modo de firmware",
            "status": "ok",
            "detail": f"El sistema live ha arrancado en modo {firmware}.",
        },
        {
            "id": "live",
            "label": "Sesión live",
            "status": "ok" if is_live else "error",
            "detail": "Se ha detectado una sesión live válida." if is_live else "No parece una sesión live soportada por el wrapper.",
        },
    ]
    return {
        "firmware": firmware,
        "isLiveSession": is_live,
        "totalRamBytes": ram,
        "installableDiskBytes": total_installable_disk_bytes,
        "checks": checks,
    }


def _normalize_locale(value: Any) -> str:
    locale = str(value or "").strip()
    if not locale:
        return ""
    return locale


def _short_locale(locale: str) -> str:
    return locale.split(".", 1)[0].replace("-", "_")


def _locale_conf(locale: str) -> dict[str, str]:
    return {
        "LANG": locale,
        "LC_NUMERIC": locale,
        "LC_TIME": locale,
        "LC_MONETARY": locale,
        "LC_PAPER": locale,
        "LC_NAME": locale,
        "LC_ADDRESS": locale,
        "LC_TELEPHONE": locale,
        "LC_MEASUREMENT": locale,
        "LC_IDENTIFICATION": locale,
    }


def validate_profile(payload: Any) -> tuple[dict[str, Any] | None, dict[str, str]]:
    errors: dict[str, str] = {}
    if not isinstance(payload, dict):
        return None, {"profile": "El body debe ser un objeto JSON."}

    locale = _normalize_locale(payload.get("locale"))
    timezone = str(payload.get("timezone") or "").strip()
    keyboard_layout = str(payload.get("keyboardLayout") or "").strip()
    keyboard_variant = str(payload.get("keyboardVariant") or "").strip()
    target_disk = str(payload.get("targetDisk") or "").strip()
    install_mode = str(payload.get("installMode") or "").strip()
    root_mode = str(payload.get("rootMode") or "").strip()
    schema_version = payload.get("schemaVersion")
    user = payload.get("user")

    if schema_version != 1:
        errors["schemaVersion"] = "El esquema soportado es la versión 1."

    if not locale:
        errors["locale"] = "El locale es obligatorio."

    if timezone:
        try:
            ZoneInfo(timezone)
        except Exception:
            errors["timezone"] = "La zona horaria no es válida."
    else:
        errors["timezone"] = "La zona horaria es obligatoria."

    if not keyboard_layout or not KEYBOARD_RE.match(keyboard_layout):
        errors["keyboardLayout"] = "El layout de teclado no es válido."

    if keyboard_variant and not KEYBOARD_RE.match(keyboard_variant):
        errors["keyboardVariant"] = "La variante de teclado no es válida."

    available_disk_paths = {disk["path"] for disk in discover_disks()}
    if target_disk not in available_disk_paths:
        errors["targetDisk"] = "El disco objetivo no está disponible en esta sesión live."

    if install_mode not in ALLOWED_INSTALL_MODES:
        errors["installMode"] = "Solo se soporta erase-disk en la v1."

    if root_mode not in ALLOWED_ROOT_MODES:
        errors["rootMode"] = "Solo se soporta same-as-user en la v1."

    if not isinstance(user, dict):
        errors["user"] = "El bloque de usuario es obligatorio."
        return None, errors

    full_name = str(user.get("fullName") or "").strip()
    username = str(user.get("username") or "").strip()
    hostname = str(user.get("hostname") or "").strip()
    password = str(user.get("password") or "")
    password_confirmation = str(
        user.get("passwordConfirmation")
        or payload.get("passwordConfirmation")
        or ""
    )

    if not full_name:
        errors["fullName"] = "El nombre completo es obligatorio."

    if not USERNAME_RE.match(username) or username in RESERVED_USERNAMES:
        errors["username"] = "El username no es válido."

    if not HOSTNAME_RE.match(hostname) or hostname in RESERVED_HOSTNAMES:
        errors["hostname"] = "El hostname no es válido."

    if not password:
        errors["password"] = "La contraseña es obligatoria."

    if password != password_confirmation:
        errors["passwordConfirmation"] = "Las contraseñas no coinciden."

    if errors:
        return None, errors

    normalized = {
        "schemaVersion": 1,
        "locale": locale,
        "localeCode": _short_locale(locale),
        "localeConf": _locale_conf(locale),
        "timezone": timezone,
        "keyboardLayout": keyboard_layout,
        "keyboardVariant": keyboard_variant,
        "targetDisk": target_disk,
        "user": {
            "fullName": full_name,
            "username": username,
            "hostname": hostname,
            "password": password,
        },
        "installMode": install_mode,
        "rootMode": root_mode,
    }
    return normalized, {}
