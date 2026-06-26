import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { extname, resolve } from "node:path";
import { spawn } from "node:child_process";
import { resolveGraphicalSessionEnv } from "./session-env";
import { createWorkspaceService } from "./workspaces";

export type FileOpenInput = string | {
  path?: unknown;
  workspace?: unknown;
  focus?: unknown;
};

export type FileOpenResponse = {
  ok: boolean;
  path?: string;
  message?: string;
};

export type FileToolOptions = {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  spawnCommand?: (command: string, args: string[], options: { env: NodeJS.ProcessEnv }) => void;
};

const MEDIA_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".mp4", ".mov", ".mkv", ".mp3", ".wav", ".flac"]);

export function createFileTool(options: FileToolOptions = {}) {
  const env = resolveGraphicalSessionEnv(options.env ?? process.env);
  const homeDir = options.homeDir ?? homedir();
  const spawnCommand = options.spawnCommand ?? defaultSpawnCommand;

  return {
    async openPath(input: FileOpenInput): Promise<FileOpenResponse> {
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

      if (parsed.focus !== false) {
        const workspace = parsed.workspace ?? defaultWorkspaceForPath(parsed.path);
        createWorkspaceService({ env }).focusWorkspaceSync({ workspace, source: "system" });
      }

      spawnCommand("xdg-open", [parsed.path], { env });
      return { ok: true, path: parsed.path, message: `Abriendo ${parsed.path}.` };
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

function defaultSpawnCommand(command: string, args: string[], options: { env: NodeJS.ProcessEnv }): void {
  const child = spawn(command, args, {
    detached: true,
    env: options.env,
    stdio: "ignore",
  });
  child.unref();
}
