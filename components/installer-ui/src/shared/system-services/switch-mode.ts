import { spawn } from "node:child_process";

import type { ApiMessageResponse, ShellMode } from "../installer-types";
import {
  appendHelperLog,
  currentUid,
  formatTimestamp,
  removeFileIfPresent,
  writeShellModeOverride,
} from "./runtime";

type SpawnedSwitchHelper = {
  waitForExit: (timeoutMs: number) => Promise<number | null>;
};

export type SwitchModeDependencies = {
  uid: () => number;
  writeShellMode: (mode: ShellMode, uid?: number) => string;
  removeFile: (path: string) => void;
  appendLog: (message: string, uid?: number) => string;
  spawnHelper: (uid: number) => SpawnedSwitchHelper;
};

function defaultSpawnHelper(_uid: number): SpawnedSwitchHelper {
  const child = spawn(
    "pkexec",
    ["/usr/bin/python3", "/usr/local/bin/agenos-shell-helper", "reload-shell"],
    {
      detached: true,
      stdio: "ignore",
      env: {
        ...process.env,
        LANG: process.env.LANG ?? "C.UTF-8",
        PATH: process.env.PATH ?? "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
      },
    },
  );

  return {
    waitForExit(timeoutMs: number) {
      return new Promise((resolve) => {
        let settled = false;
        const timer = setTimeout(() => {
          settled = true;
          child.unref();
          resolve(null);
        }, timeoutMs);

        child.once("error", () => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timer);
          resolve(127);
        });

        child.once("close", (code) => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timer);
          resolve(code ?? 1);
        });
      });
    },
  };
}

export function createSwitchModeService(dependencies: Partial<SwitchModeDependencies> = {}) {
  const deps: SwitchModeDependencies = {
    uid: dependencies.uid ?? currentUid,
    writeShellMode: dependencies.writeShellMode ?? writeShellModeOverride,
    removeFile: dependencies.removeFile ?? removeFileIfPresent,
    appendLog: dependencies.appendLog ?? appendHelperLog,
    spawnHelper: dependencies.spawnHelper ?? defaultSpawnHelper,
  };

  async function switchMode(mode: ShellMode): Promise<ApiMessageResponse> {
    const uid = deps.uid();
    const modePath = deps.writeShellMode(mode, uid);
    deps.appendLog(`[${formatTimestamp()}] switching shell mode to ${mode}\n`, uid);

    const exitCode = await deps.spawnHelper(uid).waitForExit(1000);
    if (exitCode !== null && exitCode !== 0) {
      deps.removeFile(modePath);
      return {
        ok: false,
        message: `No se pudo recargar la shell para cambiar a ${mode}.`,
      };
    }

    return {
      ok: true,
      message: `Cambiando a ${mode}.`,
    };
  }

  return {
    switchMode,
  };
}

export const { switchMode } = createSwitchModeService();
