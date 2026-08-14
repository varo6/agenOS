import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { extname, resolve } from "node:path";
import {
  executableExists,
  launchGraphicalApplication,
  type GraphicalLaunchStatus,
  type RunCommand,
  type SpawnGraphicalCommand,
} from "./graphical-launcher";
import { resolveGraphicalSessionEnv } from "./session-env";

export type FileOpenInput = string | {
  path?: unknown;
  workspace?: unknown;
  focus?: unknown;
};

export type FileOpenResponse = {
  ok: boolean;
  path?: string;
  message?: string;
  status?: GraphicalLaunchStatus;
};

export type FileToolOptions = {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  commandExists?: (command: string) => boolean;
  spawnCommand?: SpawnGraphicalCommand;
  runCommand?: RunCommand;
  windowTimeoutMs?: number;
  pollIntervalMs?: number;
  coldStartMs?: number;
  existingWindowGraceMs?: number;
};

export type FileLaunchOptions = {
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
};

const MEDIA_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".mp4", ".mov", ".mkv", ".mp3", ".wav", ".flac"]);

export function createFileTool(options: FileToolOptions = {}) {
  const env = resolveGraphicalSessionEnv(options.env ?? process.env);
  const homeDir = options.homeDir ?? homedir();
  const commandExists = options.commandExists ?? ((command: string) => executableExists(command, env));

  return {
    async openPath(input: FileOpenInput, launchOptions: FileLaunchOptions = {}): Promise<FileOpenResponse> {
      const parsed = parseFileOpenInput(input, homeDir);
      if (!parsed.path) {
        return { ok: false, message: "La ruta del archivo es obligatoria." };
      }

      if (!existsSync(parsed.path)) {
        return { ok: false, path: parsed.path, message: `No encontre ${parsed.path}.` };
      }

      if (!env.WAYLAND_DISPLAY && !env.DISPLAY && !env.SWAYSOCK) {
        return { ok: false, path: parsed.path, message: "No hay una sesion grafica disponible para abrir archivos." };
      }

      const opener = commandExists("xdg-open")
        ? { command: "xdg-open", args: [parsed.path] }
        : commandExists("gio")
          ? { command: "gio", args: ["open", parsed.path] }
          : undefined;
      if (!opener) {
        return {
          ok: false,
          path: parsed.path,
          message: "No encontré xdg-open ni gio para abrir el archivo. Instala xdg-utils o libglib2.0-bin.",
        };
      }

      const workspace = parsed.workspace ?? defaultWorkspaceForPath(parsed.path);
      const result = await launchGraphicalApplication({
        ...opener,
        env,
        label: parsed.path,
        workspace,
        focus: parsed.focus !== false,
        acceptAnyNewWindow: true,
        commandExists,
        spawnCommand: options.spawnCommand,
        runCommand: options.runCommand,
        windowTimeoutMs: options.windowTimeoutMs,
        pollIntervalMs: options.pollIntervalMs,
        coldStartMs: options.coldStartMs,
        existingWindowGraceMs: options.existingWindowGraceMs,
        signal: launchOptions.signal,
        onProgress: launchOptions.onProgress,
      });
      return {
        ok: result.ok,
        path: parsed.path,
        status: result.status,
        message: result.message,
      };
    },
  };
}

function parseFileOpenInput(input: FileOpenInput, homeDir: string): { path: string; workspace?: unknown; focus: boolean } {
  if (typeof input === "string") {
    return { path: normalizePath(input, homeDir), focus: true };
  }

  const rawPath = input && typeof input === "object" ? input.path : "";
  return {
    path: typeof rawPath === "string" ? normalizePath(rawPath, homeDir) : "",
    workspace: input && typeof input === "object" ? input.workspace : undefined,
    focus: input && typeof input === "object" && typeof input.focus === "boolean" ? input.focus : true,
  };
}

function normalizePath(path: string, homeDir: string): string {
  const trimmed = path.trim();
  if (trimmed === "~") {
    return homeDir;
  }
  if (trimmed.startsWith("~/")) {
    return resolve(homeDir, trimmed.slice(2));
  }
  return resolve(trimmed);
}

function defaultWorkspaceForPath(path: string): 2 | 4 {
  return MEDIA_EXTENSIONS.has(extname(path).toLowerCase()) ? 4 : 2;
}
