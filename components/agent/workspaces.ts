import { accessSync, constants } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { resolveGraphicalSessionEnv } from "./session-env";

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

export type WorkspaceStateChange = WorkspaceListResponse;

type SpawnOptions = {
  env: NodeJS.ProcessEnv;
};

type WorkspaceStateListener = (state: WorkspaceStateChange) => void;
type SubscribeCommand = (onLine: (line: string) => void, onExit: () => void) => () => void;

const ASYNC_FOCUS_CONFIRM_ATTEMPTS = 8;
const ASYNC_FOCUS_CONFIRM_INTERVAL_MS = 20;

export type WorkspaceServiceOptions = {
  env?: NodeJS.ProcessEnv;
  commandExists?: (command: string) => boolean;
  spawnCommand?: (command: string, args: string[], options: SpawnOptions) => void;
  runCommandSync?: (command: string, args: string[], options: SpawnOptions) => string;
  queryCommandSync?: (command: string, args: string[], options: SpawnOptions) => string;
  subscribeCommand?: SubscribeCommand;
};

export const WORKSPACES: WorkspaceDefinition[] = [
  { number: 1, name: "1:home", label: "Home" },
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

function defaultRunCommandSync(command: string, args: string[], options: SpawnOptions): string {
  return execFileSync(command, args, {
    env: options.env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 1000,
  });
}

function createSwaySubscription(env: NodeJS.ProcessEnv): SubscribeCommand {
  return (onLine, onExit) => {
    const child = spawn("swaymsg", ["-t", "subscribe", '["workspace"]'], {
      env,
      stdio: ["ignore", "pipe", "ignore"],
    });
    let buffer = "";
    let exited = false;

    const finish = () => {
      if (exited) {
        return;
      }
      exited = true;
      onExit();
    };

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      while (true) {
        const newline = buffer.indexOf("\n");
        if (newline === -1) {
          break;
        }
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) {
          onLine(line);
        }
      }
    });
    child.once("error", finish);
    child.once("close", finish);

    return () => {
      if (!child.killed) {
        child.kill();
      }
    };
  };
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
  if (normalized === "browser" || normalized.includes("chrome") || normalized.includes("chromium") || normalized.includes("firefox")) {
    return 3;
  }

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

function parseWorkspaceName(name: string | undefined): WorkspaceNumber | undefined {
  const match = name?.match(/^([1-5])(?::|$)/);
  if (!match) {
    return undefined;
  }

  return normalizeWorkspaceNumber(Number(match[1]));
}

export function parseWorkspaceFocusEvent(line: string): WorkspaceNumber | undefined {
  try {
    const event = JSON.parse(line) as { change?: unknown; current?: { name?: unknown } };
    if (event.change !== "focus" || typeof event.current?.name !== "string") {
      return undefined;
    }
    return parseWorkspaceName(event.current.name);
  } catch {
    return undefined;
  }
}

function commandSucceeded(output: string): boolean {
  try {
    const results = JSON.parse(output) as Array<{ success?: unknown }>;
    return Array.isArray(results) && results.length > 0 && results.every((result) => result.success === true);
  } catch {
    return false;
  }
}

export function createWorkspaceService(options: WorkspaceServiceOptions = {}) {
  const env = resolveGraphicalSessionEnv(options.env ?? process.env);
  const commandExists = options.commandExists ?? defaultCommandExists;
  const runCommandSync = options.runCommandSync ?? defaultRunCommandSync;
  const queryCommandSync = options.queryCommandSync ?? runCommandSync;
  const subscribeCommand = options.subscribeCommand ?? createSwaySubscription(env);
  const listeners = new Set<WorkspaceStateListener>();
  let stopSubscription: (() => void) | undefined;
  let activeSubscription: object | undefined;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

  function readActiveWorkspace(): WorkspaceNumber | undefined {
    if (!canUseSway(env, commandExists)) {
      return undefined;
    }

    try {
      const output = queryCommandSync("swaymsg", ["-t", "get_workspaces"], { env });
      const workspaces = JSON.parse(output) as Array<{ name?: string; focused?: boolean }>;
      return parseWorkspaceName(workspaces.find((workspace) => workspace.focused)?.name);
    } catch {
      return undefined;
    }
  }

  function confirmActiveWorkspace(workspace: WorkspaceNumber, attempts: number): WorkspaceNumber | undefined {
    let activeWorkspace: WorkspaceNumber | undefined;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      activeWorkspace = readActiveWorkspace();
      if (activeWorkspace === workspace) {
        return activeWorkspace;
      }
      if (attempt + 1 < attempts) {
        Atomics.wait(
          new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)),
          0,
          0,
          ASYNC_FOCUS_CONFIRM_INTERVAL_MS,
        );
      }
    }
    return activeWorkspace;
  }

  function listWorkspaces(activeWorkspace: WorkspaceNumber | undefined = readActiveWorkspace()): WorkspaceListResponse {
    return {
      ok: true,
      workspaces: WORKSPACES,
      activeWorkspace,
    };
  }

  function publishActiveWorkspace(activeWorkspace: WorkspaceNumber): void {
    const state = listWorkspaces(activeWorkspace);
    for (const listener of listeners) {
      listener(state);
    }
  }

  function startWorkspaceSubscription(): void {
    if (stopSubscription || listeners.size === 0 || !canUseSway(env, commandExists)) {
      return;
    }

    const subscription = {};
    activeSubscription = subscription;
    stopSubscription = subscribeCommand(
      (line) => {
        const activeWorkspace = parseWorkspaceFocusEvent(line);
        if (activeWorkspace) {
          publishActiveWorkspace(activeWorkspace);
        }
      },
      () => {
        if (activeSubscription !== subscription) {
          return;
        }
        activeSubscription = undefined;
        stopSubscription = undefined;
        if (listeners.size > 0 && !reconnectTimer) {
          reconnectTimer = setTimeout(() => {
            reconnectTimer = undefined;
            startWorkspaceSubscription();
          }, 500);
        }
      },
    );
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

    try {
      let output: string;
      if (options.spawnCommand && !options.runCommandSync) {
        // Compatibility for launchers that inject their existing process spawner.
        options.spawnCommand("swaymsg", ["workspace", workspaceNameFor(workspace)], { env });
        output = '[{"success":true}]';
      } else {
        output = runCommandSync("swaymsg", ["workspace", workspaceNameFor(workspace)], { env });
      }

      if (!commandSucceeded(output)) {
        return {
          ok: false,
          message: `Sway rechazo el cambio al workspace ${workspace}.`,
          workspaces: WORKSPACES,
          activeWorkspace: readActiveWorkspace(),
        };
      }
    } catch {
      return {
        ok: false,
        message: `No se pudo solicitar el workspace ${workspace} a Sway.`,
        workspaces: WORKSPACES,
        activeWorkspace: readActiveWorkspace(),
      };
    }

    const activeWorkspace = confirmActiveWorkspace(
      workspace,
      options.spawnCommand && !options.runCommandSync ? ASYNC_FOCUS_CONFIRM_ATTEMPTS : 1,
    );
    if (activeWorkspace !== workspace) {
      return {
        ok: false,
        message: `Sway no confirmo el cambio al workspace ${workspace}.`,
        workspaces: WORKSPACES,
        activeWorkspace,
      };
    }

    return {
      ok: true,
      message: `Workspace ${workspace} activo.`,
      workspaces: WORKSPACES,
      activeWorkspace,
    };
  }

  function subscribeWorkspaceChanges(listener: WorkspaceStateListener): () => void {
    listeners.add(listener);
    listener(listWorkspaces());
    startWorkspaceSubscription();

    return () => {
      listeners.delete(listener);
      if (listeners.size > 0) {
        return;
      }
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = undefined;
      }
      activeSubscription = undefined;
      stopSubscription?.();
      stopSubscription = undefined;
    };
  }

  return {
    listWorkspaces,
    focusWorkspaceSync,
    subscribeWorkspaceChanges,
    async focusWorkspace(request: WorkspaceFocusRequest): Promise<WorkspaceFocusResponse> {
      return focusWorkspaceSync(request);
    },
  };
}
