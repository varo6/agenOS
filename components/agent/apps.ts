import { accessSync, constants, existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, delimiter, isAbsolute, join } from "node:path";
import { spawn } from "node:child_process";
import { launchBrowserUrl, type BrowserLauncherOptions } from "./browser-launcher";
import { resolveGraphicalSessionEnv } from "./session-env";
import { createWorkspaceService, resolveDefaultWorkspaceForApp, workspaceNameFor } from "./workspaces";

const DESKTOP_FIELD_CODE_RE = /%[fFuUdDnNickvm]/g;
const MAX_COMMAND_OUTPUT_BYTES = 24_000;

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
};

export type AppOpenInput = string | {
  app?: unknown;
  workspace?: unknown;
  focus?: unknown;
};

export type AppInstallResponse = {
  ok: boolean;
  packageName?: string;
  message?: string;
  opened?: AppOpenResponse;
  stdout?: string;
  stderr?: string;
};

export type AppListResponse = {
  ok: true;
  apps: Array<{
    appId: string;
    displayName: string;
    desktopId?: string;
  }>;
};

export type CommandRunResult = {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  error?: string;
};

export type CommandRunOptions = {
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
};

type SwayNode = {
  id?: number;
  name?: string;
  app_id?: string | null;
  pid?: number | null;
  window?: number | null;
  window_properties?: {
    class?: string;
    instance?: string;
    title?: string;
  };
  nodes?: SwayNode[];
  floating_nodes?: SwayNode[];
};

export type AppToolOptions = {
  commandExists?: (command: string) => boolean;
  spawnCommand?: (command: string, args: string[]) => void;
  runCommand?: (command: string, args: string[], options?: CommandRunOptions) => Promise<CommandRunResult>;
  browserLauncher?: (url: string, options?: BrowserLauncherOptions) => void;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  desktopDirs?: string[];
  installTimeoutMs?: number;
  skipAptUpdate?: boolean;
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
      { command: "foot" },
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

const DEFAULT_INSTALL_TIMEOUT_MS = 20 * 60 * 1000;

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

function defaultRunCommand(command: string, args: string[], options: CommandRunOptions = {}): Promise<CommandRunResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    const append = (current: string, chunk: Buffer) => (
      current + chunk.toString("utf8")
    ).slice(-MAX_COMMAND_OUTPUT_BYTES);

    const settle = (result: CommandRunResult) => {
      if (settled) {
        return;
      }

      settled = true;
      if (timeout) {
        clearTimeout(timeout);
      }
      resolve(result);
    };

    if (options.timeoutMs && options.timeoutMs > 0) {
      timeout = setTimeout(() => {
        child.kill("SIGTERM");
        settle({
          exitCode: null,
          signal: "SIGTERM",
          stdout,
          stderr,
          error: "Comando agotado por timeout.",
        });
      }, options.timeoutMs);
    }

    child.stdout?.on("data", (chunk) => {
      stdout = append(stdout, chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr = append(stderr, chunk);
    });
    child.on("error", (error) => {
      settle({
        exitCode: null,
        signal: null,
        stdout,
        stderr,
        error: error.message,
      });
    });
    child.on("exit", (exitCode, signal) => {
      settle({ exitCode, signal, stdout, stderr });
    });
  });
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

function normalizePackageName(input: string): string {
  const packageName = input.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9+.-]*$/.test(packageName)) {
    throw new Error("El paquete debe ser un nombre Debian simple, por ejemplo vlc o gimp.");
  }

  return packageName;
}

function commandsWithPrivileges(
  command: string,
  args: string[],
  commandExists: (command: string) => boolean,
): AppCommand[] {
  if (typeof process.getuid === "function" && process.getuid() === 0) {
    return [{ command, args }];
  }

  const commands: AppCommand[] = [];
  if (commandExists("sudo")) {
    commands.push({ command: "sudo", args: ["-n", command, ...args] });
  }
  if (commandExists("pkexec")) {
    commands.push({ command: "pkexec", args: [command, ...args] });
  }

  return commands;
}

function shouldTryNextPrivilegeCommand(command: AppCommand, result: CommandRunResult): boolean {
  if (command.command !== "sudo" || result.exitCode === 0) {
    return false;
  }

  const output = `${result.stderr}\n${result.stdout}\n${result.error ?? ""}`.toLowerCase();
  return output.includes("password")
    || output.includes("tty")
    || output.includes("sudoers")
    || output.includes("authentication");
}

function conciseCommandFailure(result: CommandRunResult): string {
  return (result.stderr || result.stdout || result.error || "El comando no devolvio detalles.").trim();
}

function canUseSway(env: NodeJS.ProcessEnv, commandExists: (command: string) => boolean): boolean {
  return Boolean(env.SWAYSOCK) && commandExists("swaymsg");
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

function walkSwayTree(node: SwayNode | undefined): SwayNode[] {
  if (!node) {
    return [];
  }

  return [
    node,
    ...(node.nodes ?? []).flatMap(walkSwayTree),
    ...(node.floating_nodes ?? []).flatMap(walkSwayTree),
  ];
}

function nodeTokens(node: SwayNode): string[] {
  return [
    node.app_id ?? undefined,
    node.name,
    node.window_properties?.class,
    node.window_properties?.instance,
    node.window_properties?.title,
  ].map(normalizeWindowToken).filter(Boolean);
}

function findMatchingWindow(tree: SwayNode, app: AppDefinition): SwayNode | null {
  const candidates = appWindowCandidates(app);
  for (const node of walkSwayTree(tree)) {
    if (!node.id || (!node.app_id && !node.window && !node.pid)) {
      continue;
    }

    const tokens = nodeTokens(node);
    if (tokens.some((token) => candidates.has(token))) {
      return node;
    }

    if (tokens.some((token) => [...candidates].some((candidate) => token.includes(candidate) || candidate.includes(token)))) {
      return node;
    }
  }

  return null;
}

async function settleLaunchedWindow(input: {
  app: AppDefinition;
  workspace: unknown;
  focus: boolean;
  env: NodeJS.ProcessEnv;
  commandExists: (command: string) => boolean;
  runCommand: (command: string, args: string[], options?: CommandRunOptions) => Promise<CommandRunResult>;
}): Promise<"confirmed" | "unsupported" | "not-found"> {
  if (!canUseSway(input.env, input.commandExists)) {
    return "unsupported";
  }

  const workspaceName = workspaceNameFor(input.workspace);
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const treeResult = await input.runCommand("swaymsg", ["-t", "get_tree"], {
      env: input.env,
      timeoutMs: 1000,
    });
    if (treeResult.exitCode !== 0 || !treeResult.stdout.trim()) {
      return "not-found";
    }

    if (treeResult.exitCode === 0 && treeResult.stdout.trim()) {
      try {
        const tree = JSON.parse(treeResult.stdout) as SwayNode;
        const window = findMatchingWindow(tree, input.app);
        if (window?.id) {
          const focusSuffix = input.focus ? ", focus" : "";
          const command = `[con_id=${window.id}] move to workspace "${workspaceName}"${focusSuffix}`;
          const moveResult = await input.runCommand("swaymsg", [command], {
            env: input.env,
            timeoutMs: 1000,
          });
          return moveResult.exitCode === 0 ? "confirmed" : "not-found";
        }
      } catch {
        return "not-found";
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  return "not-found";
}

async function runPrivilegedCommand(
  command: string,
  args: string[],
  commandExists: (command: string) => boolean,
  runCommand: (command: string, args: string[], options?: CommandRunOptions) => Promise<CommandRunResult>,
  options: CommandRunOptions,
): Promise<{ result?: CommandRunResult; missingPrivileges?: true }> {
  const commands = commandsWithPrivileges(command, args, commandExists);
  if (commands.length === 0) {
    return { missingPrivileges: true };
  }

  let lastResult: CommandRunResult | undefined;
  for (const candidate of commands) {
    const result = await runCommand(candidate.command, candidate.args ?? [], options);
    if (result.exitCode === 0) {
      return { result };
    }

    lastResult = result;
    if (!shouldTryNextPrivilegeCommand(candidate, result)) {
      return { result };
    }
  }

  return { result: lastResult };
}

export function createAppTool(options: AppToolOptions = {}) {
  const commandExists = options.commandExists ?? defaultCommandExists;
  const spawnCommand = options.spawnCommand ?? ((command: string, args: string[]) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
  });
  const runCommand = options.runCommand ?? defaultRunCommand;
  const env = options.env ?? process.env;

  async function completeLaunch(app: AppDefinition, workspace: unknown, focus: boolean): Promise<AppOpenResponse> {
    const status = await settleLaunchedWindow({
      app,
      workspace,
      focus,
      env,
      commandExists,
      runCommand,
    });
    return {
      ok: true,
      appId: app.appId,
      displayName: app.displayName,
      message: status === "not-found"
        ? `Lance ${app.displayName}, pero no pude confirmar ni enfocar su ventana.`
        : `Abriendo ${app.displayName}.`,
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

    async openApp(input: AppOpenInput): Promise<AppOpenResponse> {
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
      const focusWorkspace = () => {
        if (!launchInput.focus) {
          return;
        }

        createWorkspaceService({
          commandExists,
          env,
          spawnCommand: (command, args) => spawnCommand(command, args),
        }).focusWorkspaceSync({ workspace, source: "system" });
      };

      if (app.appId === "browser") {
        try {
          const browserLauncher = options.browserLauncher ?? ((url: string, browserOptions?: BrowserLauncherOptions) => {
            launchBrowserUrl(url, browserOptions);
          });
          browserLauncher("https://www.google.com", {
            commandExists,
            env,
            workspace,
            focus: launchInput.focus,
            spawnCommand: (command, args) => spawnCommand(command, args),
          });
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
        focusWorkspace();
        spawnCommand("gtk-launch", [app.desktopId.replace(/\.desktop$/i, "")]);
        return completeLaunch(app, workspace, launchInput.focus);
      }

      if (app.desktopPath && commandExists("gio")) {
        focusWorkspace();
        spawnCommand("gio", ["launch", app.desktopPath]);
        return completeLaunch(app, workspace, launchInput.focus);
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

      focusWorkspace();
      spawnCommand(command.command, command.args ?? []);
      return completeLaunch(app, workspace, launchInput.focus);
    },

    async installApp(input: string, installOptions: { openAfterInstall?: boolean; openAs?: string } = {}): Promise<AppInstallResponse> {
      let packageName = "";
      try {
        packageName = normalizePackageName(input);
      } catch (error) {
        return {
          ok: false,
          message: error instanceof Error ? error.message : "Nombre de paquete no valido.",
        };
      }

      if (!commandExists("apt-get")) {
        return {
          ok: false,
          packageName,
          message: "No encontre apt-get para instalar paquetes en este sistema.",
        };
      }

      const installEnv = {
        ...env,
        DEBIAN_FRONTEND: "noninteractive",
      };
      const timeoutMs = options.installTimeoutMs ?? DEFAULT_INSTALL_TIMEOUT_MS;

      if (!options.skipAptUpdate) {
        const update = await runPrivilegedCommand(
          "apt-get",
          ["update"],
          commandExists,
          runCommand,
          { env: installEnv, timeoutMs },
        );
        if (update.missingPrivileges || !update.result) {
          return {
            ok: false,
            packageName,
            message: "No hay permisos para instalar paquetes: falta sudo o pkexec.",
          };
        }

        if (update.result.exitCode !== 0) {
          return {
            ok: false,
            packageName,
            stdout: update.result.stdout,
            stderr: update.result.stderr,
            message: `No se pudo actualizar el indice de paquetes: ${conciseCommandFailure(update.result)}`,
          };
        }
      }

      const install = await runPrivilegedCommand(
        "apt-get",
        ["install", "-y", "--", packageName],
        commandExists,
        runCommand,
        { env: installEnv, timeoutMs },
      );
      if (install.missingPrivileges || !install.result) {
        return {
          ok: false,
          packageName,
          message: "No hay permisos para instalar paquetes: falta sudo o pkexec.",
        };
      }

      if (install.result.exitCode !== 0) {
        return {
          ok: false,
          packageName,
          stdout: install.result.stdout,
          stderr: install.result.stderr,
          message: `No se pudo instalar ${packageName}: ${conciseCommandFailure(install.result)}`,
        };
      }

      const openAfterInstall = installOptions.openAfterInstall ?? true;
      const opened = openAfterInstall ? await this.openApp(installOptions.openAs ?? packageName) : undefined;
      return {
        ok: true,
        packageName,
        opened,
        stdout: install.result.stdout,
        stderr: install.result.stderr,
        message: opened
          ? `Instalado ${packageName}. ${opened.message ?? ""}`.trim()
          : `Instalado ${packageName}.`,
      };
    },
  };
}
