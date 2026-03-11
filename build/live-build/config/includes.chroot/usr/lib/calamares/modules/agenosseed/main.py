#!/usr/bin/env python3
import json
from pathlib import Path

import libcalamares

import gettext
_ = gettext.translation(
    "calamares-python",
    localedir=libcalamares.utils.gettext_path(),
    languages=libcalamares.utils.gettext_languages(),
    fallback=True,
).gettext


def pretty_name():
    return _("Aplicando perfil guiado de AgenOS.")


def _insert_timezone(profile: dict) -> None:
    timezone = profile["timezone"]
    parts = timezone.split("/", 1)
    region = parts[0]
    zone = parts[1] if len(parts) > 1 else parts[0]
    libcalamares.globalstorage.insert("region", region)
    libcalamares.globalstorage.insert("zone", zone)
    libcalamares.globalstorage.insert("regionzone", timezone)
    libcalamares.globalstorage.insert("currentTimezoneCode", region)
    libcalamares.globalstorage.insert("currentTimezoneName", zone)


def run():
    profile_path = libcalamares.job.configuration.get("profilePath")
    if not profile_path:
        return (_("Configuración inválida"), _("agenosseed necesita profilePath."))

    payload = json.loads(Path(profile_path).read_text(encoding="utf-8"))
    user = payload["user"]
    locale_code = payload.get("localeCode", payload["locale"].split(".", 1)[0])
    locale_conf = payload.get("localeConf", {"LANG": payload["locale"]})

    libcalamares.globalstorage.insert("locale", locale_code)
    libcalamares.globalstorage.insert("language", locale_code)
    libcalamares.globalstorage.insert("localeConf", locale_conf)
    _insert_timezone(payload)

    libcalamares.globalstorage.insert("keyboardLayout", payload["keyboardLayout"])
    libcalamares.globalstorage.insert("keyboardModel", "pc105")
    libcalamares.globalstorage.insert("keyboardVariant", payload.get("keyboardVariant", ""))
    libcalamares.globalstorage.insert("keyboardAdditionalLayout", "")
    libcalamares.globalstorage.insert("keyboardAdditionalVariant", "")
    libcalamares.globalstorage.insert("keyboardGroupSwitcher", "")
    libcalamares.globalstorage.insert("keyboardVConsoleKeymap", payload["keyboardLayout"])

    libcalamares.globalstorage.insert("fullName", user["fullName"])
    libcalamares.globalstorage.insert("fullname", user["fullName"])
    libcalamares.globalstorage.insert("username", user["username"])
    libcalamares.globalstorage.insert("hostname", user["hostname"])
    libcalamares.globalstorage.insert("userPassword", user["password"])
    libcalamares.globalstorage.insert("userPasswordSecondary", user["password"])
    libcalamares.globalstorage.insert("password", user["password"])
    libcalamares.globalstorage.insert("rootPassword", user["password"])
    libcalamares.globalstorage.insert("rootPasswordSecondary", user["password"])
    libcalamares.globalstorage.insert("reuseRootPassword", True)
    libcalamares.globalstorage.insert("autologin", False)
    libcalamares.globalstorage.insert("sudoersConfigureWithGroup", True)
    libcalamares.globalstorage.insert("targetDisk", payload["targetDisk"])
    libcalamares.utils.debug(
        "AgenOS seed profile applied for user={} hostname={} disk={}".format(
            user["username"], user["hostname"], payload["targetDisk"]
        )
    )
    return None
