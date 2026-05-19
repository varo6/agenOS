import { accessSync, constants } from "node:fs";
import { homedir } from "node:os";
import { delimiter, isAbsolute, join } from "node:path";
import { spawn } from "node:child_process";

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
};

export type AppOpenResponse = {
  ok: boolean;
  appId?: string;
  message?: string;
};

export type AppToolOptions = {
  commandExists?: (command: string) => boolean;
  spawnCommand?: (command: string, args: string[]) => void;
};

const KNOWN_APPS: AppDefinition[] = [
  {
    appId: "browser",
    displayName: "Chrome",
    aliases: ["chrome", "google chrome", "google-chrome", "chromium", "navegador", "browser"],
    commands: [
      { command: "google-chrome" },
      { command: "google-chrome-stable" },
      { command: "/usr/bin/chromium" },
      { command: "/usr/bin/chromium-browser" },
      { command: "chromium" },
      { command: "chromium-browser" },
      { command: "/snap/bin/chromium" },
      { command: "/usr/bin/xdg-open", args: ["https://www.google.com"] },
      { command: "xdg-open", args: ["https://www.google.com"] },
      { command: "/usr/bin/sensible-browser", args: ["https://www.google.com"] },
    ],
  },
  {
    appId: "terminal",
    displayName: "Terminal",
    aliases: ["terminal", "consola", "shell"],
    commands: [
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

const UNKNOWN_APP_MESSAGE = "No conozco esa aplicacion. Prueba con Chrome, navegador, terminal o archivos.";

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

function resolveApp(input: string): AppDefinition | null {
  const normalized = normalizeAppName(input);
  return KNOWN_APPS.find((app) => app.aliases.some((alias) => normalizeAppName(alias) === normalized)) ?? null;
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

  return {
    async openApp(input: string): Promise<AppOpenResponse> {
      const app = resolveApp(input);
      if (!app) {
        return {
          ok: false,
          message: UNKNOWN_APP_MESSAGE,
        };
      }

      const command = app.commands.find((candidate) => commandExists(candidate.command));
      if (!command) {
        return {
          ok: false,
          appId: app.appId,
          message: `No encontre un comando instalado para abrir ${app.displayName}.`,
        };
      }

      spawnCommand(command.command, command.args ?? []);
      return {
        ok: true,
        appId: app.appId,
        message: `Abriendo ${app.displayName}.`,
      };
    },
  };
}
