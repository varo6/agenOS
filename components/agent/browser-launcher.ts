import { accessSync, constants, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, isAbsolute, join } from "node:path";
import { spawn } from "node:child_process";
import { createWorkspaceService } from "./workspaces";
import { resolveGraphicalSessionEnv } from "./session-env";

type SpawnOptions = {
  env: NodeJS.ProcessEnv;
};

export type BrowserLauncherOptions = {
  commandExists?: (command: string) => boolean;
  spawnCommand?: (command: string, args: string[], options: SpawnOptions) => void;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  profileDir?: string;
  skipGraphicalSessionCheck?: boolean;
  workspace?: unknown;
  focus?: boolean;
};

export type BrowserLaunchResult = {
  command: string;
  args: string[];
  url: string;
};

const BROWSER_COMMANDS = [
  "google-chrome",
  "google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "chromium",
  "chromium-browser",
  "/snap/bin/chromium",
];

export function normalizeBrowserUrl(input: string): string {
  const raw = input.trim();
  if (!raw) {
    throw new Error("La URL es obligatoria.");
  }

  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  const url = new URL(withScheme);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Solo se permiten URLs http o https.");
  }

  return url.toString();
}

function defaultCommandExists(command: string): boolean {
  if (isAbsolute(command)) {
    try {
      accessSync(command, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }

  return (process.env.PATH ?? "")
    .split(delimiter)
    .filter(Boolean)
    .some((pathEntry) => {
      try {
        accessSync(join(pathEntry, command), constants.X_OK);
        return true;
      } catch {
        return false;
      }
    });
}

function defaultSpawnCommand(command: string, args: string[], options: SpawnOptions): void {
  const child = spawn(command, args, {
    detached: true,
    env: options.env,
    stdio: "ignore",
  });
  child.unref();
}

function hasGraphicalSession(env: NodeJS.ProcessEnv): boolean {
  return Boolean(env.WAYLAND_DISPLAY || env.DISPLAY || env.SWAYSOCK);
}

function resolveProfileDir(options: BrowserLauncherOptions, env: NodeJS.ProcessEnv): string {
  if (options.profileDir?.trim()) {
    return options.profileDir.trim();
  }

  if (env.AGENOS_BROWSER_PROFILE_DIR?.trim()) {
    return env.AGENOS_BROWSER_PROFILE_DIR.trim();
  }

  return join(options.homeDir ?? homedir(), ".agenos", "browser-profile");
}

function browserEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...env,
    GDK_BACKEND: env.GDK_BACKEND || "wayland,x11",
    MOZ_ENABLE_WAYLAND: env.MOZ_ENABLE_WAYLAND || "1",
    XDG_CURRENT_DESKTOP: env.XDG_CURRENT_DESKTOP || "AgenOS",
    XDG_SESSION_DESKTOP: env.XDG_SESSION_DESKTOP || "agenos",
    XDG_SESSION_TYPE: env.XDG_SESSION_TYPE || "wayland",
  };
}

function buildChromiumArgs(url: string, profileDir: string): string[] {
  return [
    "--new-window",
    "--no-first-run",
    "--no-default-browser-check",
    "--password-store=basic",
    "--ozone-platform-hint=auto",
    `--user-data-dir=${profileDir}`,
    url,
  ];
}

export function launchBrowserUrl(input: string, options: BrowserLauncherOptions = {}): BrowserLaunchResult {
  const env = browserEnv(resolveGraphicalSessionEnv(options.env ?? process.env));
  if (!options.skipGraphicalSessionCheck && !hasGraphicalSession(env)) {
    throw new Error("No hay una sesion grafica Wayland/X11 disponible para abrir el navegador.");
  }

  const commandExists = options.commandExists ?? defaultCommandExists;
  const spawnCommand = options.spawnCommand ?? defaultSpawnCommand;
  const command = BROWSER_COMMANDS.find((candidate) => commandExists(candidate));
  if (!command) {
    throw new Error("No encontre Chromium/Chrome instalado para abrir el navegador.");
  }

  const url = normalizeBrowserUrl(input);
  const profileDir = resolveProfileDir(options, env);
  mkdirSync(profileDir, { recursive: true });

  if (options.focus !== false) {
    createWorkspaceService({ commandExists, spawnCommand, env }).focusWorkspaceSync({
      workspace: options.workspace ?? 3,
      source: "system",
    });
  }

  const args = buildChromiumArgs(url, profileDir);
  spawnCommand(command, args, { env });

  return { command, args, url };
}
