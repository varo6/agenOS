import { existsSync, chmodSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";

export type GuiEnvContext = {
  env: NodeJS.ProcessEnv;
  originalUserHome: string;
  originalRuntimeDir: string;
  rootRuntimeDir: string;
  busExists: boolean;
  waylandSocketPath: string | null;
  xauthorityExists: boolean;
};

export function originalUid(env: NodeJS.ProcessEnv = process.env): number {
  const value = env.PKEXEC_UID;
  return value ? Number.parseInt(value, 10) : 0;
}

export function originalRuntimeDir(uid: number = originalUid()): string {
  return `/run/user/${uid}`;
}

export function allowedRuntimeDir(uid: number = originalUid()): string {
  return `${originalRuntimeDir(uid)}/agenos-installer`;
}

export function ensureRootRuntimeDir(uid: number = typeof process.getuid === "function" ? process.getuid() : 0): string {
  const runtimeDir = `/run/user/${uid}`;
  mkdirSync(runtimeDir, { recursive: true, mode: 0o700 });
  chmodSync(runtimeDir, 0o700);
  return runtimeDir;
}

function lookupPasswdHome(uid: number): string {
  const getent = spawnSync("getent", ["passwd", String(uid)], { encoding: "utf8" });
  const line = getent.status === 0 ? getent.stdout.trim() : "";
  if (line) {
    const fields = line.split(":");
    if (fields[5]) {
      return fields[5];
    }
  }

  const passwd = readFileSync("/etc/passwd", "utf8");
  for (const entry of passwd.split(/\r?\n/)) {
    if (!entry) {
      continue;
    }

    const fields = entry.split(":");
    if (Number.parseInt(fields[2] ?? "", 10) === uid && fields[5]) {
      return fields[5];
    }
  }

  return uid === 0 ? "/root" : `/home/${uid}`;
}

export function getOriginalUserHome(uid: number = originalUid()): string {
  return lookupPasswdHome(uid);
}

export function detectWaylandSocketFromState(input: {
  configuredWaylandDisplay?: string;
  originalRuntimeDir: string;
  existingPaths: Set<string>;
  socketPaths: Set<string>;
}): string | null {
  const candidates: string[] = [];
  const configured = input.configuredWaylandDisplay?.trim();

  if (configured) {
    candidates.push(configured.includes("/") ? configured : join(input.originalRuntimeDir, configured));
  }

  for (const path of Array.from(input.existingPaths).sort()) {
    if (path.startsWith(`${input.originalRuntimeDir}${sep}wayland-`)) {
      candidates.push(path);
    }
  }

  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (seen.has(candidate)) {
      continue;
    }
    seen.add(candidate);
    if (input.existingPaths.has(candidate) && input.socketPaths.has(candidate)) {
      return candidate;
    }
  }

  return null;
}

export function detectWaylandSocket(env: NodeJS.ProcessEnv = process.env, runtimeDir: string = originalRuntimeDir()): string | null {
  const candidates: string[] = [];
  const configured = env.WAYLAND_DISPLAY?.trim();

  if (configured) {
    candidates.push(configured.includes("/") ? configured : join(runtimeDir, configured));
  }

  if (existsSync(runtimeDir)) {
    for (const entry of readdirSync(runtimeDir)) {
      if (entry.startsWith("wayland-")) {
        candidates.push(join(runtimeDir, entry));
      }
    }
  }

  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (seen.has(candidate)) {
      continue;
    }
    seen.add(candidate);

    try {
      if (existsSync(candidate) && statSync(candidate).isSocket()) {
        return candidate;
      }
    } catch {
      continue;
    }
  }

  return null;
}

export function buildGuiEnvFromContext(context: GuiEnvContext): Record<string, string> {
  const env: Record<string, string> = {};

  for (const [key, value] of Object.entries(context.env)) {
    if (typeof value === "string") {
      env[key] = value;
    }
  }

  env.QT_AUTO_SCREEN_SCALE_FACTOR = "1";
  env.LANG ||= "C.UTF-8";
  env.PATH ||= "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";
  env.XDG_CURRENT_DESKTOP ||= "AgenOS";
  env.XDG_SESSION_DESKTOP ||= "agenos";

  if (!env.DBUS_SESSION_BUS_ADDRESS && context.busExists) {
    env.DBUS_SESSION_BUS_ADDRESS = `unix:path=${join(context.originalRuntimeDir, "bus")}`;
  }

  if (context.waylandSocketPath) {
    env.WAYLAND_DISPLAY = context.waylandSocketPath;
    env.XDG_SESSION_TYPE = "wayland";
    env.XDG_RUNTIME_DIR = context.rootRuntimeDir;
    env.QT_QPA_PLATFORM ||= "wayland;xcb";
    return env;
  }

  if (env.DISPLAY) {
    env.XDG_SESSION_TYPE ||= "x11";
    env.QT_QPA_PLATFORM ||= "xcb";
    if (!env.XAUTHORITY && context.xauthorityExists) {
      env.XAUTHORITY = join(context.originalUserHome, ".Xauthority");
    }
  }

  return env;
}

export function buildGuiEnv(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const uid = originalUid(env);
  const runtimeDir = originalRuntimeDir(uid);
  const home = getOriginalUserHome(uid);

  return buildGuiEnvFromContext({
    env,
    originalUserHome: home,
    originalRuntimeDir: runtimeDir,
    rootRuntimeDir: ensureRootRuntimeDir(),
    busExists: existsSync(join(runtimeDir, "bus")),
    waylandSocketPath: detectWaylandSocket(env, runtimeDir),
    xauthorityExists: existsSync(join(home, ".Xauthority")),
  });
}

export function validateProfilePath(path: string, runtimeDir: string = allowedRuntimeDir()): string {
  const candidate = resolve(path);
  const resolvedRuntimeDir = resolve(runtimeDir);

  if (candidate !== resolvedRuntimeDir && !candidate.startsWith(`${resolvedRuntimeDir}${sep}`)) {
    throw new Error("La ruta del perfil no está dentro de /run/user/<uid>/agenos-installer/");
  }

  return candidate;
}
