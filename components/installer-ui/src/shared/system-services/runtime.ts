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

import type {
  GpuState,
  MaintenanceAction,
  ShellMode,
  SystemBridgeMode,
} from "../installer-types";

export const INSTALLER_RUNTIME_DIRNAME = "agenos-installer";
export const DEFAULT_INSTALLER_BINARY_PATH = "/opt/agenos/installer/agenos-installer";
export const DEFAULT_SHELL_MODE: ShellMode = "system";
export const DEFAULT_ELECTRON_GPU_MODE = "auto" as const;
export const DEFAULT_SYSTEM_BRIDGE_MODE = "ipc" as const;

export const SYSTEM_IPC_CHANNELS = {
  getPreflight: "agenos-system:get-preflight",
  runMaintenance: "agenos-system:run-maintenance",
  switchMode: "agenos-system:switch-mode",
  getRuntimeInfo: "agenos-system:get-runtime-info",
} as const;

export type ElectronGpuMode = typeof DEFAULT_ELECTRON_GPU_MODE | GpuState;

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

export function electronGpuModePathForUid(uid: number = currentUid()): string {
  return join(ensureRuntimeDir(uid), "electron-gpu-mode");
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

export function isMaintenanceAction(value: unknown): value is MaintenanceAction {
  return value === "terminal";
}

export function normalizeBridgeMode(value: string | undefined): SystemBridgeMode {
  return value?.trim().toLowerCase() === "http" ? "http" : DEFAULT_SYSTEM_BRIDGE_MODE;
}

export function normalizeElectronGpuMode(value: string | undefined): ElectronGpuMode {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "on" || normalized === "off" || normalized === "auto") {
    return normalized;
  }

  return DEFAULT_ELECTRON_GPU_MODE;
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

export function readPersistedElectronGpuState(uid: number = currentUid()): GpuState | null {
  const path = electronGpuModePathForUid(uid);
  if (!existsSync(path)) {
    return null;
  }

  const rawValue = readFileSync(path, "utf8").trim();
  return rawValue === "on" || rawValue === "off" ? rawValue : null;
}

export function writePersistedElectronGpuState(state: GpuState, uid: number = currentUid()): string {
  const path = electronGpuModePathForUid(uid);
  writeSecureTextFile(path, `${state}\n`, 0o600);
  return path;
}

export function resolveElectronGpuState(input: {
  appKind: ShellMode;
  requestedMode: ElectronGpuMode;
  persistedState: GpuState | null;
}): GpuState {
  if (input.appKind === "installer") {
    return "off";
  }

  if (input.requestedMode === "off") {
    return "off";
  }

  if (input.requestedMode === "on") {
    return "on";
  }

  return input.persistedState === "off" ? "off" : "on";
}

export function shouldTrackGpuFallback(input: {
  appKind: ShellMode;
  requestedMode: ElectronGpuMode;
  effectiveState: GpuState;
}): boolean {
  return input.appKind === "system" && input.requestedMode === "auto" && input.effectiveState === "on";
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
