import { openSync } from "node:fs";
import { spawn } from "node:child_process";

import type { ApiMessageResponse, MaintenanceAction } from "../../shared/installer-types";
import { appendHelperLog, currentUid, formatTimestamp, helperLogPathForUid } from "../installer/runtime";

type SpawnedHelper = {
  waitForExit: (timeoutMs: number) => Promise<number | null>;
};

export type MaintenanceDependencies = {
  uid: () => number;
  helperLogPath: (uid?: number) => string;
  spawnHelper: (action: MaintenanceAction, uid: number) => SpawnedHelper;
};

function buildHelperEnv(): NodeJS.ProcessEnv {
  return {
    DISPLAY: process.env.DISPLAY ?? "",
    XAUTHORITY: process.env.XAUTHORITY ?? "",
    DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS ?? "",
    WAYLAND_DISPLAY: process.env.WAYLAND_DISPLAY ?? "",
    XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR ?? "",
    XDG_SESSION_TYPE: process.env.XDG_SESSION_TYPE ?? "",
    XDG_CURRENT_DESKTOP: process.env.XDG_CURRENT_DESKTOP ?? "AgenOS",
    HOME: process.env.HOME ?? "",
    LANG: process.env.LANG ?? "C.UTF-8",
    PATH: process.env.PATH ?? "/usr/sbin:/usr/bin:/sbin:/bin",
    ...process.env,
  };
}

function defaultSpawnHelper(action: MaintenanceAction, uid: number): SpawnedHelper {
  const command = ["pkexec", "/usr/bin/python3", "/usr/local/bin/agenos-shell-helper", action];
  const logPath = helperLogPathForUid(uid);
  appendHelperLog(`\n[${formatTimestamp()}] launching: ${command.join(" ")}\n`, uid);

  const fd = openSync(logPath, "a");
  const child = spawn(command[0]!, command.slice(1), {
    env: buildHelperEnv(),
    detached: true,
    stdio: ["ignore", fd, fd],
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

        child.once("close", (code) => {
          if (settled) {
            return;
          }

          settled = true;
          clearTimeout(timer);
          resolve(code ?? 1);
        });

        child.once("error", (error) => {
          if (settled) {
            return;
          }

          settled = true;
          clearTimeout(timer);
          appendHelperLog(`[${formatTimestamp()}] spawn error: ${error.message}\n`, uid);
          resolve(127);
        });
      });
    },
  };
}

export function createMaintenanceService(dependencies: Partial<MaintenanceDependencies> = {}) {
  const deps: MaintenanceDependencies = {
    uid: dependencies.uid ?? currentUid,
    helperLogPath: dependencies.helperLogPath ?? helperLogPathForUid,
    spawnHelper: dependencies.spawnHelper ?? defaultSpawnHelper,
  };

  async function runMaintenance(action: MaintenanceAction): Promise<ApiMessageResponse> {
    const uid = deps.uid();
    const logPath = deps.helperLogPath(uid);

    try {
      const helper = deps.spawnHelper(action, uid);
      const returnCode = await helper.waitForExit(1000);
      if (returnCode !== null && returnCode !== 0) {
        return {
          ok: false,
          message: `El helper salió con código ${returnCode}. Revisa ${logPath} para el detalle.`,
        };
      }

      return {
        ok: true,
        message: `Acción ${action} lanzada.`,
      };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "No se pudo lanzar la acción de mantenimiento.",
      };
    }
  }

  return {
    runMaintenance,
  };
}

export const { runMaintenance } = createMaintenanceService();
