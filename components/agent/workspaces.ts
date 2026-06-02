import { accessSync, constants } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";
import { spawn } from "node:child_process";

export type WorkspaceNumber = 1 | 2 | 3 | 4 | 5;
export type WorkspaceSource = "ui" | "openclaw" | "system";

export type WorkspaceDefinition = {
  number: WorkspaceNumber;
  name: string;
  label: string;
};

export type WorkspaceFocusRequest = {
  workspace: unknown;
  source?: WorkspaceSource;
};

export type WorkspaceListResponse = {
  ok: true;
  workspaces: WorkspaceDefinition[];
  activeWorkspace?: WorkspaceNumber;
};

export type WorkspaceFocusResponse = {
  ok: boolean;
  message?: string;
  workspaces: WorkspaceDefinition[];
  activeWorkspace?: WorkspaceNumber;
};

type SpawnOptions = {
  env: NodeJS.ProcessEnv;
};

export type WorkspaceServiceOptions = {
  env?: NodeJS.ProcessEnv;
  commandExists?: (command: string) => boolean;
  spawnCommand?: (command: string, args: string[], options: SpawnOptions) => void;
};

export const WORKSPACES: WorkspaceDefinition[] = [
  { number: 1, name: "1:agent", label: "Agent" },
  { number: 2, name: "2:app", label: "Apps" },
  { number: 3, name: "3:web", label: "Web" },
  { number: 4, name: "4:media", label: "Media" },
  { number: 5, name: "5:work", label: "Work" },
];

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

export function normalizeWorkspaceNumber(input: unknown): WorkspaceNumber {
  const value = typeof input === "string" && input.trim() !== "" ? Number(input) : input;
  if (value === 1 || value === 2 || value === 3 || value === 4 || value === 5) {
    return value;
  }

  throw new Error("Workspace invalido.");
}

export function workspaceNameFor(workspace: unknown): string {
  const number = normalizeWorkspaceNumber(workspace);
  const definition = WORKSPACES.find((candidate) => candidate.number === number);
  if (!definition) {
    throw new Error("Workspace invalido.");
  }

  return definition.name;
}

export function resolveDefaultWorkspaceForApp(appId: string | undefined): WorkspaceNumber {
  const normalized = (appId ?? "").trim().toLowerCase();
  if (normalized === "terminal" || normalized.includes("terminal") || normalized === "foot") {
    return 5;
  }

  if (normalized === "agent" || normalized === "agenos") {
    return 1;
  }

  return 2;
}

function canUseSway(env: NodeJS.ProcessEnv, commandExists: (command: string) => boolean): boolean {
  return Boolean(env.SWAYSOCK) && commandExists("swaymsg");
}

export function createWorkspaceService(options: WorkspaceServiceOptions = {}) {
  const env = options.env ?? process.env;
  const commandExists = options.commandExists ?? defaultCommandExists;
  const spawnCommand = options.spawnCommand ?? defaultSpawnCommand;

  function listWorkspaces(activeWorkspace?: WorkspaceNumber): WorkspaceListResponse {
    return {
      ok: true,
      workspaces: WORKSPACES,
      activeWorkspace,
    };
  }

  function focusWorkspaceSync(request: WorkspaceFocusRequest): WorkspaceFocusResponse {
    const workspace = normalizeWorkspaceNumber(request.workspace);
    if (!canUseSway(env, commandExists)) {
      return {
        ok: false,
        message: "No hay una sesion Sway disponible para cambiar de workspace.",
        workspaces: WORKSPACES,
      };
    }

    spawnCommand("swaymsg", ["workspace", workspaceNameFor(workspace)], { env });
    return {
      ok: true,
      message: `Workspace ${workspace} activo.`,
      workspaces: WORKSPACES,
      activeWorkspace: workspace,
    };
  }

  return {
    listWorkspaces,
    focusWorkspaceSync,
    async focusWorkspace(request: WorkspaceFocusRequest): Promise<WorkspaceFocusResponse> {
      return focusWorkspaceSync(request);
    },
  };
}
