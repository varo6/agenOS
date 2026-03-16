import { openSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";

import type { InstallerProfilePayload, LaunchResponse } from "../../shared/installer-types";
import { currentUid, appendHelperLog, formatTimestamp, helperLogPathForUid, profilePathForUid, removeFileIfPresent, resolveInstallerBinaryPath, writeSecureTextFile } from "./runtime";
import { validateProfile } from "./validate-profile";

type SpawnedHelper = {
  waitForExit: (timeoutMs: number) => Promise<number | null>;
  onExit: (listener: (code: number) => void) => void;
};

export type LaunchDependencies = {
  uid: () => number;
  profilePath: (uid?: number) => string;
  helperLogPath: (uid?: number) => string;
  writeProfile: (path: string, contents: string) => void;
  removeFile: (path: string) => void;
  validateProfile: typeof validateProfile;
  spawnHelper: (args: string[], uid: number) => SpawnedHelper;
};

function buildHelperEnv(): NodeJS.ProcessEnv {
  return {
    DISPLAY: process.env.DISPLAY ?? "",
    XAUTHORITY: process.env.XAUTHORITY ?? "",
    DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS ?? "",
    WAYLAND_DISPLAY: process.env.WAYLAND_DISPLAY ?? "",
    XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR ?? "",
    XDG_SESSION_TYPE: process.env.XDG_SESSION_TYPE ?? "",
    HOME: process.env.HOME ?? "",
    LANG: process.env.LANG ?? "C.UTF-8",
    PATH: process.env.PATH ?? "/usr/sbin:/usr/bin:/sbin:/bin",
    ...process.env,
  };
}

function defaultSpawnHelper(args: string[], uid: number): SpawnedHelper {
  const command = ["pkexec", resolveInstallerBinaryPath(), "helper", ...args];
  const logPath = helperLogPathForUid(uid);
  appendHelperLog(`\n[${formatTimestamp()}] launching: ${command.join(" ")}\n`, uid);

  const fd = openSync(logPath, "a");
  const child = spawn(command[0]!, command.slice(1), {
    env: buildHelperEnv(),
    detached: true,
    stdio: ["ignore", fd, fd],
  });

  const listeners = new Set<(code: number) => void>();
  const notify = (code: number) => {
    for (const listener of listeners) {
      listener(code);
    }
  };

  child.once("close", (code) => {
    notify(code ?? 1);
  });
  child.once("error", (error) => {
    appendHelperLog(`[${formatTimestamp()}] spawn error: ${error.message}\n`, uid);
    notify(127);
  });

  return {
    waitForExit(timeoutMs: number) {
      return new Promise((resolve) => {
        let settled = false;

        const timer = setTimeout(() => {
          settled = true;
          child.unref();
          resolve(null);
        }, timeoutMs);

        const listener = (code: number) => {
          if (settled) {
            return;
          }

          settled = true;
          clearTimeout(timer);
          resolve(code);
        };

        listeners.add(listener);
      });
    },
    onExit(listener: (code: number) => void) {
      listeners.add(listener);
    },
  };
}

export function createLaunchService(dependencies: Partial<LaunchDependencies> = {}) {
  const deps: LaunchDependencies = {
    uid: dependencies.uid ?? currentUid,
    profilePath: dependencies.profilePath ?? profilePathForUid,
    helperLogPath: dependencies.helperLogPath ?? helperLogPathForUid,
    writeProfile: dependencies.writeProfile ?? ((path, contents) => writeSecureTextFile(path, contents, 0o600)),
    removeFile: dependencies.removeFile ?? removeFileIfPresent,
    validateProfile: dependencies.validateProfile ?? validateProfile,
    spawnHelper: dependencies.spawnHelper ?? defaultSpawnHelper,
  };

  async function launchGuided(profile: InstallerProfilePayload): Promise<LaunchResponse> {
    const validation = deps.validateProfile(profile);
    if (Object.keys(validation.errors).length > 0 || !validation.normalizedProfile) {
      return {
        ok: false,
        errors: validation.errors,
      };
    }

    const uid = deps.uid();
    const profilePath = deps.profilePath(uid);
    const logPath = deps.helperLogPath(uid);
    deps.writeProfile(profilePath, JSON.stringify(validation.normalizedProfile, null, 2));

    try {
      const helper = deps.spawnHelper(["guided", "--profile", profilePath], uid);
      helper.onExit(() => {
        deps.removeFile(profilePath);
      });

      const returnCode = await helper.waitForExit(1000);
      if (returnCode !== null) {
        deps.removeFile(profilePath);
        return {
          ok: false,
          message: `El helper salió con código ${returnCode}. Revisa ${logPath} para el detalle.`,
        };
      }

      return {
        ok: true,
        launched: true,
        message: "Perfil guiado validado. Calamares se abrirá con el tramo final mínimo.",
      };
    } catch (error) {
      deps.removeFile(profilePath);
      return {
        ok: false,
        message: error instanceof Error ? error.message : "No se pudo abrir el Calamares guiado.",
      };
    }
  }

  async function launchClassic(): Promise<LaunchResponse> {
    const uid = deps.uid();
    const logPath = deps.helperLogPath(uid);

    try {
      const helper = deps.spawnHelper(["classic"], uid);
      const returnCode = await helper.waitForExit(1000);
      if (returnCode !== null) {
        return {
          ok: false,
          message: `El helper salió con código ${returnCode}. Revisa ${logPath} para el detalle.`,
        };
      }

      return {
        ok: true,
        launched: true,
        message: "Se está abriendo la instalación avanzada con Calamares.",
      };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "No se pudo abrir el Calamares clásico.",
      };
    }
  }

  return {
    launchGuided,
    launchClassic,
  };
}

export const { launchGuided, launchClassic } = createLaunchService();

export function loadLaunchProfile(path: string): InstallerProfilePayload {
  const payload = JSON.parse(readFileSync(path, "utf8")) as InstallerProfilePayload & {
    user?: InstallerProfilePayload["user"];
  };

  return {
    ...payload,
    user: {
      fullName: payload.user?.fullName ?? "",
      username: payload.user?.username ?? "",
      hostname: payload.user?.hostname ?? "",
      password: payload.user?.password ?? "",
      passwordConfirmation: payload.user?.passwordConfirmation ?? payload.user?.password ?? "",
    },
  };
}
