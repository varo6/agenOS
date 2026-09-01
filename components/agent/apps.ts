import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import {
  launchBrowserUrl,
  type BrowserLauncherOptions,
  type BrowserLaunchResult,
} from "./browser-launcher";
import {
  defaultRunCommand,
  executableExists,
  launchGraphicalApplication,
  type CommandRunOptions,
  type CommandRunResult,
  type GraphicalLaunchStatus,
  type RunCommand,
  type SpawnGraphicalCommand,
} from "./graphical-launcher";
import { resolveGraphicalSessionEnv } from "./session-env";
import { resolveDefaultWorkspaceForApp } from "./workspaces";

const DESKTOP_FIELD_CODE_RE = /%[fFuUdDnNickvm]/g;

type AppCommand = {
  command: string;
  args?: string[];
};

type AppDefinition = {
  appId: string;
  displayName: string;
  aliases: string[];
  commands: AppCommand[];
  desktopId?: string;
  desktopPath?: string;
};

export type AppOpenResponse = {
  ok: boolean;
  appId?: string;
  displayName?: string;
  message?: string;
  status?: GraphicalLaunchStatus;
};

export type AppOpenInput = string | {
  app?: unknown;
  workspace?: unknown;
  focus?: unknown;
};

export type AppListResponse = {
  ok: true;
  apps: Array<{
    appId: string;
    displayName: string;
    desktopId?: string;
  }>;
};

export type { CommandRunOptions, CommandRunResult } from "./graphical-launcher";

export type AppLaunchOptions = {
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
};

export type AppToolOptions = {
  commandExists?: (command: string) => boolean;
  spawnCommand?: SpawnGraphicalCommand;
  runCommand?: RunCommand;
  browserLauncher?: (
    url: string,
    options?: BrowserLauncherOptions,
  ) => BrowserLaunchResult | Promise<BrowserLaunchResult> | void;
  env?: NodeJS.ProcessEnv;
  resolveSessionEnv?: (env: NodeJS.ProcessEnv) => NodeJS.ProcessEnv;
  homeDir?: string;
  desktopDirs?: string[];
  windowTimeoutMs?: number;
  pollIntervalMs?: number;
  coldStartMs?: number;
  existingWindowGraceMs?: number;
};

const KNOWN_APPS: AppDefinition[] = [
  {
    appId: "browser",
    displayName: "Chrome",
    aliases: ["chrome", "google chrome", "google-chrome", "chromium", "navegador", "browser"],
    commands: [],
  },
  {
    appId: "terminal",
    displayName: "Terminal",
    aliases: ["terminal", "consola", "shell"],
    commands: [
      // app-id propio: la regla for_window de Sway para "foot" enruta el atajo
      // Ctrl+Alt+Return, que no pasa por este launcher. Al distinguirlos, el
      // launcher decide el workspace de las terminales que abre Pi sin que la
      // regla declarativa se lo sobreescriba.
      { command: "foot", args: ["--app-id=agenos-terminal"] },
      { command: "x-terminal-emulator" },
      { command: "gnome-terminal" },
      { command: "konsole" },
      { command: "xfce4-terminal" },
    ],
  },
  {
    appId: "files",
    displayName: "Archivos",
    aliases: ["archivos", "ficheros", "files", "carpeta", "explorador de archivos"],
    commands: [
      { command: "xdg-open", args: [homedir()] },
      { command: "nautilus" },
      { command: "dolphin" },
      { command: "thunar" },
    ],
  },
];

export function sanitizeDesktopExec(execLine: string): string[] {
  const protectedPercent = execLine.replace(/%%/g, "__PERCENT__");
  const cleaned = protectedPercent
    .replace(DESKTOP_FIELD_CODE_RE, "")
    .replace(/__PERCENT__/g, "%")
    .trim();

  const command = (cleaned.match(/"([^"]*)"|'([^']*)'|\S+/g) ?? [])
    ?.map((part) => part.replace(/^["']|["']$/g, ""))
    .filter(Boolean);

  if (command.length === 0) {
    throw new Error("El Exec del .desktop no contiene ningun comando ejecutable.");
  }

  return command;
}

function parseDesktopBoolean(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}

function parseDesktopEntry(content: string, desktopPath: string): AppDefinition | null {
  let inDesktopEntry = false;
  const fields = new Map<string, string>();
  const localizedNames: string[] = [];

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    if (line.startsWith("[") && line.endsWith("]")) {
      inDesktopEntry = line === "[Desktop Entry]";
      continue;
    }

    if (!inDesktopEntry) {
      continue;
    }

    const separator = line.indexOf("=");
    if (separator <= 0) {
      continue;
    }

    const key = line.slice(0, separator);
    const value = line.slice(separator + 1);
    if (key === "Name" || key.startsWith("Name[")) {
      localizedNames.push(value);
    }
    if (!fields.has(key)) {
      fields.set(key, value);
    }
  }

  if (fields.get("Type") !== "Application" || !fields.get("Exec")) {
    return null;
  }

  if (parseDesktopBoolean(fields.get("Hidden")) || parseDesktopBoolean(fields.get("NoDisplay"))) {
    return null;
  }

  let commandParts: string[];
  try {
    commandParts = sanitizeDesktopExec(fields.get("Exec") ?? "");
  } catch {
    return null;
  }

  const desktopId = basename(desktopPath);
  const displayName = fields.get("Name[es_ES]")
    ?? fields.get("Name[es]")
    ?? fields.get("Name")
    ?? desktopId.replace(/\.desktop$/i, "");
  const genericName = fields.get("GenericName[es_ES]")
    ?? fields.get("GenericName[es]")
    ?? fields.get("GenericName");

  return {
    appId: desktopId.replace(/\.desktop$/i, ""),
    displayName,
    aliases: [
      displayName,
      desktopId,
      desktopId.replace(/\.desktop$/i, ""),
      commandParts[0] ?? "",
      genericName ?? "",
      ...localizedNames,
    ].filter(Boolean),
    commands: [{ command: commandParts[0] ?? "", args: commandParts.slice(1) }],
    desktopId,
    desktopPath,
  };
}

function defaultDesktopDirs(options: AppToolOptions, env: NodeJS.ProcessEnv): string[] {
  const homeDir = options.homeDir ?? homedir();
  const xdgDataDirs = (env.XDG_DATA_DIRS || "/usr/local/share:/usr/share")
    .split(":")
    .filter(Boolean)
    .map((entry) => join(entry, "applications"));

  return [...new Set([
    join(homeDir, ".local", "share", "applications"),
    ...xdgDataDirs,
  ])];
}

function discoverDesktopApps(options: AppToolOptions, commandExists: (command: string) => boolean): AppDefinition[] {
  const env = resolveGraphicalSessionEnv(options.env ?? process.env);
  const desktopDirs = options.desktopDirs ?? defaultDesktopDirs(options, env);
  const apps: AppDefinition[] = [];
  const seen = new Set<string>();

  for (const dir of desktopDirs) {
    if (!existsSync(dir)) {
      continue;
    }

    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.endsWith(".desktop") || seen.has(entry)) {
        continue;
      }

      const desktopPath = join(dir, entry);
      let parsed: AppDefinition | null = null;
      try {
        parsed = parseDesktopEntry(readFileSync(desktopPath, "utf8"), desktopPath);
      } catch {
        parsed = null;
      }

      if (!parsed) {
        continue;
      }

      const command = parsed.commands[0]?.command;
      if (!command || (!commandExists(command) && !commandExists("gtk-launch") && !commandExists("gio"))) {
        continue;
      }

      seen.add(entry);
      apps.push(parsed);
    }
  }

  return apps.sort((left, right) => left.displayName.localeCompare(right.displayName));
}

export function normalizeAppName(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/^(?:el|la|los|las|mi)\s+/, "")
    .replace(/\s+/g, " ");
}

function resolveApp(input: string, apps: AppDefinition[]): AppDefinition | null {
  const normalized = normalizeAppName(input);
  const exact = apps.find((app) => app.aliases.some((alias) => normalizeAppName(alias) === normalized));
  if (exact) {
    return exact;
  }

  const partialMatches = apps.filter((app) => app.aliases.some((alias) => {
    const normalizedAlias = normalizeAppName(alias);
    return normalizedAlias.includes(normalized) || normalized.includes(normalizedAlias);
  }));

  return partialMatches.length === 1 ? partialMatches[0] ?? null : null;
}

function availableAppsMessage(apps: AppDefinition[]): string {
  const names = apps
    .slice(0, 8)
    .map((app) => app.displayName)
    .join(", ");
  return names ? ` Apps disponibles: ${names}.` : "";
}

function parseAppOpenInput(input: AppOpenInput): { app: string; workspace?: unknown; focus: boolean } {
  if (typeof input === "string") {
    return { app: input, focus: true };
  }

  return {
    app: typeof input.app === "string" ? input.app : "",
    workspace: input.workspace,
    focus: typeof input.focus === "boolean" ? input.focus : true,
  };
}

function normalizeWindowToken(input: string | undefined): string {
  return normalizeAppName(input ?? "").replace(/\.desktop$/i, "");
}

function appWindowCandidates(app: AppDefinition): Set<string> {
  const commandNames = app.commands
    .map((command) => basename(command.command))
    .filter(Boolean);
  return new Set([
    app.appId,
    app.desktopId,
    app.desktopId?.replace(/\.desktop$/i, ""),
    app.displayName,
    ...app.aliases,
    ...commandNames,
  ].map(normalizeWindowToken).filter(Boolean));
}

export function createAppTool(options: AppToolOptions = {}) {
  const baseEnv = options.env ?? process.env;
  const resolveSessionEnv = options.resolveSessionEnv ?? resolveGraphicalSessionEnv;
  const currentEnv = () => resolveSessionEnv(baseEnv);
  const commandExists = options.commandExists ?? ((command: string) => executableExists(command, currentEnv()));
  const spawnCommand = options.spawnCommand;
  const runCommand = options.runCommand ?? defaultRunCommand;

  async function launchCommand(
    app: AppDefinition,
    command: string,
    args: string[],
    workspace: unknown,
    focus: boolean,
    launchOptions: AppLaunchOptions,
  ): Promise<AppOpenResponse> {
    const env = currentEnv();
    const result = await launchGraphicalApplication({
      command,
      args,
      label: app.displayName,
      workspace,
      focus,
      env,
      windowTokens: [...appWindowCandidates(app)],
      commandExists,
      spawnCommand,
      runCommand,
      windowTimeoutMs: options.windowTimeoutMs,
      pollIntervalMs: options.pollIntervalMs,
      coldStartMs: options.coldStartMs,
      existingWindowGraceMs: options.existingWindowGraceMs,
      signal: launchOptions.signal,
      onProgress: launchOptions.onProgress,
    });
    return {
      ok: result.ok,
      appId: app.appId,
      displayName: app.displayName,
      status: result.status,
      message: result.message,
    };
  }

  return {
    listApps(): AppListResponse {
      const apps = [...KNOWN_APPS, ...discoverDesktopApps(options, commandExists)];
      return {
        ok: true,
        apps: apps.map((app) => ({
          appId: app.appId,
          displayName: app.displayName,
          desktopId: app.desktopId,
        })),
      };
    },

    async openApp(input: AppOpenInput, launchOptions: AppLaunchOptions = {}): Promise<AppOpenResponse> {
      const launchInput = parseAppOpenInput(input);
      const apps = [...KNOWN_APPS, ...discoverDesktopApps(options, commandExists)];
      const app = resolveApp(launchInput.app, apps);
      if (!app) {
        return {
          ok: false,
          message: `No encontre una aplicacion instalada llamada "${launchInput.app.trim()}".${availableAppsMessage(apps)}`,
        };
      }

      const workspace = launchInput.workspace ?? resolveDefaultWorkspaceForApp(app.appId);

      if (app.appId === "browser") {
        try {
          const env = currentEnv();
          const browserLauncher = options.browserLauncher ?? launchBrowserUrl;
          const result = await browserLauncher("https://www.google.com", {
            commandExists,
            env,
            homeDir: options.homeDir,
            workspace,
            focus: launchInput.focus,
            spawnCommand,
            runCommand,
            windowTimeoutMs: options.windowTimeoutMs,
            pollIntervalMs: options.pollIntervalMs,
            coldStartMs: options.coldStartMs,
            existingWindowGraceMs: options.existingWindowGraceMs,
            signal: launchOptions.signal,
            onProgress: launchOptions.onProgress,
          });
          if (result) {
            return {
              ok: result.ok,
              appId: app.appId,
              displayName: app.displayName,
              status: result.status,
              message: result.message,
            };
          }
          return {
            ok: true,
            appId: app.appId,
            displayName: app.displayName,
            message: `Abriendo ${app.displayName}.`,
          };
        } catch (error) {
          return {
            ok: false,
            appId: app.appId,
            displayName: app.displayName,
            message: error instanceof Error ? error.message : `No encontre un comando instalado para abrir ${app.displayName}.`,
          };
        }
      }

      if (app.desktopId && commandExists("gtk-launch")) {
        return launchCommand(
          app,
          "gtk-launch",
          [app.desktopId.replace(/\.desktop$/i, "")],
          workspace,
          launchInput.focus,
          launchOptions,
        );
      }

      if (app.desktopPath && commandExists("gio")) {
        return launchCommand(
          app,
          "gio",
          ["launch", app.desktopPath],
          workspace,
          launchInput.focus,
          launchOptions,
        );
      }

      const command = app.commands.find((candidate) => commandExists(candidate.command));
      if (!command) {
        return {
          ok: false,
          appId: app.appId,
          displayName: app.displayName,
          message: `No encontre un comando instalado para abrir ${app.displayName}.`,
        };
      }

      return launchCommand(
        app,
        command.command,
        command.args ?? [],
        workspace,
        launchInput.focus,
        launchOptions,
      );
    },
  };
}
