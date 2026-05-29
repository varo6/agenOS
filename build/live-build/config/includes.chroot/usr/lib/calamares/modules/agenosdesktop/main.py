#!/usr/bin/env python3
import json
import os
from pathlib import Path

import libcalamares

import gettext
_ = gettext.translation(
    "calamares-python",
    localedir=libcalamares.utils.gettext_path(),
    languages=libcalamares.utils.gettext_languages(),
    fallback=True,
).gettext

USER_HOME_DIRS = ["Documentos", "Fotos", "Musica", "Trabajo"]


def pretty_name():
    return _("Configurando shell gráfica de AgenOS.")


def _target_root() -> Path:
    root = libcalamares.globalstorage.value("rootMountPoint")
    if not root:
        raise RuntimeError("rootMountPoint no está disponible en Calamares.")
    return Path(root)


def _ensure_service_link(
    target_root: Path,
    relative_dir: str,
    service_name: str,
    service_dir: str = "/lib/systemd/system",
) -> None:
    wants_dir = target_root / relative_dir
    wants_dir.mkdir(parents=True, exist_ok=True)
    link = wants_dir / service_name
    if link.exists() or link.is_symlink():
        link.unlink()
    link.symlink_to(Path(service_dir) / service_name)


def _target_user_ids(target_root: Path, username: str) -> tuple[int, int] | None:
    passwd_path = target_root / "etc/passwd"
    if not passwd_path.exists():
        return None

    for line in passwd_path.read_text(encoding="utf-8").splitlines():
        parts = line.split(":")
        if len(parts) >= 4 and parts[0] == username:
            return (int(parts[2]), int(parts[3]))

    return None


def _ensure_user_state_dirs(target_root: Path, username: str) -> None:
    home_dir = target_root / "home" / username
    state_root = home_dir / ".agenos"
    user_ids = _target_user_ids(target_root, username)
    state_dirs = [
        state_root,
        state_root / "ui-dev",
        state_root / "ui-dev" / "pi",
        state_root / "openclaw",
        state_root / "memory",
        state_root / "broker",
    ]

    for directory in state_dirs:
        directory.mkdir(parents=True, exist_ok=True)
        directory.chmod(0o700)
        if user_ids is not None:
            os.chown(directory, user_ids[0], user_ids[1])


def _ensure_user_home_dirs(target_root: Path, username: str) -> None:
    home_dir = target_root / "home" / username
    user_ids = _target_user_ids(target_root, username)

    for name in USER_HOME_DIRS:
        directory = home_dir / name
        directory.mkdir(parents=True, exist_ok=True)
        directory.chmod(0o755)
        if user_ids is not None:
            os.chown(directory, user_ids[0], user_ids[1])

    config_dir = home_dir / ".config"
    config_dir.mkdir(parents=True, exist_ok=True)
    config_dir.chmod(0o700)
    user_dirs = config_dir / "user-dirs.dirs"
    user_dirs.write_text(
        "\n".join(
            [
                'XDG_DESKTOP_DIR="$HOME/Trabajo"',
                'XDG_DOCUMENTS_DIR="$HOME/Documentos"',
                'XDG_DOWNLOAD_DIR="$HOME/Documentos"',
                'XDG_MUSIC_DIR="$HOME/Musica"',
                'XDG_PICTURES_DIR="$HOME/Fotos"',
                'XDG_PUBLICSHARE_DIR="$HOME/Documentos"',
                'XDG_TEMPLATES_DIR="$HOME/Documentos"',
                'XDG_VIDEOS_DIR="$HOME/Fotos"',
                "",
            ]
        ),
        encoding="utf-8",
    )
    user_dirs.chmod(0o600)
    if user_ids is not None:
        os.chown(config_dir, user_ids[0], user_ids[1])
        os.chown(user_dirs, user_ids[0], user_ids[1])


def _write_shell_config(target_root: Path) -> None:
    shell_dir = target_root / "etc/agenos"
    shell_dir.mkdir(parents=True, exist_ok=True)
    payload = {
        "schemaVersion": 1,
        "bootMode": "home",
        "startupAppDesktopId": None,
        "maintenanceEnabled": True,
    }
    (shell_dir / "shell.json").write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def _write_greetd_config(target_root: Path, username: str) -> None:
    greetd_dir = target_root / "etc/greetd"
    greetd_dir.mkdir(parents=True, exist_ok=True)
    (greetd_dir / "config.toml").write_text(
        "\n".join(
            [
                "[terminal]",
                "vt = 7",
                "switch = true",
                "",
                "[default_session]",
                'command = "/usr/sbin/agreety --cmd /bin/sh"',
                'user = "_greetd"',
                "",
                "[initial_session]",
                'command = "sh /usr/local/bin/agenos-session"',
                f'user = "{username}"',
                "",
            ]
        ),
        encoding="utf-8",
    )


def _configure_services(target_root: Path) -> None:
    display_manager = target_root / "etc/systemd/system/display-manager.service"
    display_manager.parent.mkdir(parents=True, exist_ok=True)
    for stale in [
        target_root / "etc/systemd/system/graphical.target.wants/lightdm.service",
        target_root / "etc/systemd/system/display-manager.service",
    ]:
        if stale.is_symlink() and "lightdm" in str(stale.resolve(strict=False)):
            stale.unlink()

    if display_manager.exists() or display_manager.is_symlink():
        display_manager.unlink()
    display_manager.symlink_to("/lib/systemd/system/greetd.service")

    _ensure_service_link(target_root, "etc/systemd/system/graphical.target.wants", "greetd.service")
    _ensure_service_link(target_root, "etc/systemd/system/multi-user.target.wants", "seatd.service")
    _ensure_service_link(
        target_root,
        "etc/systemd/system/graphical.target.wants",
        "agenos-agent-api.service",
        "/etc/systemd/system",
    )
    _ensure_service_link(
        target_root,
        "etc/systemd/system/graphical.target.wants",
        "agenos-openclaw.service",
        "/etc/systemd/system",
    )

    x11_dm = target_root / "etc/X11/default-display-manager"
    if x11_dm.exists():
        x11_dm.write_text("/usr/sbin/greetd\n", encoding="utf-8")


def run():
    target_root = _target_root()
    username = libcalamares.globalstorage.value("username")
    if not username:
        return (_("Configuración inválida"), _("No se ha encontrado el usuario final del sistema."))

    _ensure_user_home_dirs(target_root, str(username))
    _ensure_user_state_dirs(target_root, str(username))
    _write_shell_config(target_root)
    _write_greetd_config(target_root, str(username))
    _configure_services(target_root)
    libcalamares.utils.debug(f"AgenOS desktop shell configured for user={username}")
    return None
