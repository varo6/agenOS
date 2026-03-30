import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import type { ShellMode } from "../../shared/installer-types";

export const INSTALLER_RUNTIME_DIRNAME = "agenos-installer";
export const DEFAULT_INSTALLER_BINARY_PATH = "/opt/agenos/installer/agenos-installer";
export const DEFAULT_SHELL_MODE: ShellMode = "installer";

export function currentUid(): number {
  if (typeof process.getuid === "function") {
    return process.getuid();
  }

  const fallback = Number.parseInt(process.env.UID ?? "0", 10);
  return Number.isFinite(fallback) ? fallback : 0;
}

export function runtimeDirForUid(uid: number = currentUid()): string {
  return `/run/user/${uid}/${INSTALLER_RUNTIME_DIRNAME}`;
}

export function ensureRuntimeDir(uid: number = currentUid()): string {
  const directory = runtimeDirForUid(uid);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  return directory;
}

export function profilePathForUid(uid: number = currentUid()): string {
  return join(ensureRuntimeDir(uid), "profile.json");
}

export function helperLogPathForUid(uid: number = currentUid()): string {
  return join(ensureRuntimeDir(uid), "helper.log");
}

export function guiLockPathForUid(uid: number = currentUid()): string {
  return join(ensureRuntimeDir(uid), "gui.lock");
}

export function shellModePathForUid(uid: number = currentUid()): string {
  return join(ensureRuntimeDir(uid), "shell-mode");
}

export function resolveInstallerBinaryPath(): string {
  const configuredPath = process.env.AGENOS_INSTALLER_BINARY?.trim();
  return configuredPath || DEFAULT_INSTALLER_BINARY_PATH;
}

export function formatTimestamp(date: Date = new Date()): string {
  const parts = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ];
  const time = [
    String(date.getHours()).padStart(2, "0"),
    String(date.getMinutes()).padStart(2, "0"),
    String(date.getSeconds()).padStart(2, "0"),
  ];
  return `${parts.join("-")} ${time.join(":")}`;
}

export function appendHelperLog(message: string, uid: number = currentUid()): string {
  const logPath = helperLogPathForUid(uid);
  appendFileSync(logPath, message, "utf8");
  return logPath;
}

export function writeSecureTextFile(path: string, contents: string, mode: number): void {
  writeFileSync(path, contents, { encoding: "utf8", mode });
  chmodSync(path, mode);
}

export function removeFileIfPresent(path: string): void {
  if (existsSync(path)) {
    rmSync(path, { force: true });
  }
}

export function isShellMode(value: unknown): value is ShellMode {
  return value === "installer" || value === "system";
}

export function readShellModeOverride(uid: number = currentUid()): ShellMode | null {
  const path = shellModePathForUid(uid);
  if (!existsSync(path)) {
    return null;
  }

  const rawValue = readFileSync(path, "utf8").trim();
  return isShellMode(rawValue) ? rawValue : null;
}

export function writeShellModeOverride(mode: ShellMode, uid: number = currentUid()): string {
  const path = shellModePathForUid(uid);
  writeSecureTextFile(path, `${mode}\n`, 0o600);
  return path;
}

export function processIsRunning(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function acquireSingleInstanceLock(uid: number = currentUid()): { acquired: boolean; release: () => void } {
  const lockPath = guiLockPathForUid(uid);
  let existingPid = 0;

  if (existsSync(lockPath)) {
    const rawValue = readFileSync(lockPath, "utf8").trim();
    existingPid = Number.parseInt(rawValue, 10);
  }

  if (existingPid && existingPid !== process.pid && processIsRunning(existingPid)) {
    return {
      acquired: false,
      release: () => {},
    };
  }

  writeSecureTextFile(lockPath, `${process.pid}\n`, 0o600);

  return {
    acquired: true,
    release: () => {
      if (!existsSync(lockPath)) {
        return;
      }

      const rawValue = readFileSync(lockPath, "utf8").trim();
      const ownerPid = Number.parseInt(rawValue, 10);
      if (ownerPid === process.pid) {
        removeFileIfPresent(lockPath);
      }
    },
  };
}
