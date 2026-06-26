import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

export function resolveGraphicalSessionEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const resolved: NodeJS.ProcessEnv = { ...env };
  const runtimeDir = resolved.XDG_RUNTIME_DIR?.trim() || defaultRuntimeDir();

  if (runtimeDir && existsSync(runtimeDir)) {
    resolved.XDG_RUNTIME_DIR = runtimeDir;
    resolved.DBUS_SESSION_BUS_ADDRESS ||= socketAddress(join(runtimeDir, "bus"));
    resolved.WAYLAND_DISPLAY ||= firstRuntimeEntry(runtimeDir, /^wayland-\d+$/);
    resolved.SWAYSOCK ||= firstRuntimeEntry(runtimeDir, /^sway-ipc\..+\.sock$/, true);
  }

  resolved.XDG_CURRENT_DESKTOP ||= "AgenOS";
  resolved.XDG_SESSION_DESKTOP ||= "agenos";
  resolved.XDG_SESSION_TYPE ||= "wayland";

  return resolved;
}

function defaultRuntimeDir(): string {
  const uid = typeof process.getuid === "function" ? process.getuid() : undefined;
  return typeof uid === "number" ? `/run/user/${uid}` : "";
}

function socketAddress(path: string): string | undefined {
  return existsSync(path) ? `unix:path=${path}` : undefined;
}

function firstRuntimeEntry(runtimeDir: string, pattern: RegExp, absolute = false): string | undefined {
  try {
    const entry = readdirSync(runtimeDir).find((candidate) => pattern.test(candidate));
    return entry ? (absolute ? join(runtimeDir, entry) : entry) : undefined;
  } catch {
    return undefined;
  }
}
