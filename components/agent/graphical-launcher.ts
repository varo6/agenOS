import { accessSync, constants } from "node:fs";
import { spawn } from "node:child_process";
import { basename, delimiter, isAbsolute, join } from "node:path";
import { workspaceNameFor } from "./workspaces";

const MAX_COMMAND_OUTPUT_BYTES = 24_000;
const DEFAULT_WINDOW_TIMEOUT_MS = 12_000;
const DEFAULT_POLL_INTERVAL_MS = 150;
const DEFAULT_COLD_START_MS = 1_500;
const DEFAULT_EXISTING_WINDOW_GRACE_MS = 750;

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

export type RunCommand = (
  command: string,
  args: string[],
  options?: CommandRunOptions,
) => Promise<CommandRunResult>;

type ProcessStderr = {
  on(event: "data", listener: (chunk: unknown) => void): unknown;
  removeListener?(event: "data", listener: (chunk: unknown) => void): unknown;
  unref?(): void;
};

export type SpawnedGraphicalProcess = {
  pid?: number;
  stderr?: ProcessStderr | null;
  on(event: "error", listener: (error: Error) => void): unknown;
  on(event: "exit", listener: (exitCode: number | null, signal: NodeJS.Signals | null) => void): unknown;
  unref?(): void;
};

export type SpawnGraphicalCommand = (
  command: string,
  args: string[],
  options: { env: NodeJS.ProcessEnv },
) => unknown;

type SwayNode = {
  id?: number;
  name?: string;
  app_id?: string | null;
  pid?: number | null;
  window?: number | null;
  focused?: boolean;
  window_properties?: {
    class?: string;
    instance?: string;
    title?: string;
  };
  nodes?: SwayNode[];
  floating_nodes?: SwayNode[];
};

export type GraphicalLaunchStatus = "mapped" | "unverified" | "failed" | "timed-out" | "aborted";

export type GraphicalLaunchResult = {
  ok: boolean;
  status: GraphicalLaunchStatus;
  command: string;
  args: string[];
  message: string;
  pid?: number;
  windowId?: number;
  exitCode?: number | null;
  signal?: NodeJS.Signals | null;
  stderr?: string;
};

export type GraphicalLaunchRequest = {
  command: string;
  args?: string[];
  env: NodeJS.ProcessEnv;
  label: string;
  workspace: unknown;
  focus: boolean;
  fullscreen?: boolean;
  windowTokens?: string[];
  acceptAnyNewWindow?: boolean;
  commandExists?: (command: string) => boolean;
  spawnCommand?: SpawnGraphicalCommand;
  runCommand?: RunCommand;
  windowTimeoutMs?: number;
  pollIntervalMs?: number;
  coldStartMs?: number;
  existingWindowGraceMs?: number;
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
};

export function executableExists(command: string, env: NodeJS.ProcessEnv): boolean {
  if (isAbsolute(command)) {
    try {
      accessSync(command, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }

  return (env.PATH ?? "")
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

export function resolveExecutable(
  candidates: string[],
  env: NodeJS.ProcessEnv,
  commandExists?: (command: string) => boolean,
): string | undefined {
  if (commandExists) {
    return candidates.find((candidate) => commandExists(candidate));
  }

  for (const candidate of candidates) {
    if (isAbsolute(candidate)) {
      if (executableExists(candidate, env)) {
        return candidate;
      }
      continue;
    }

    for (const pathEntry of (env.PATH ?? "").split(delimiter).filter(Boolean)) {
      const resolved = join(pathEntry, candidate);
      if (executableExists(resolved, env)) {
        return resolved;
      }
    }
  }

  return undefined;
}

export function defaultRunCommand(
  command: string,
  args: string[],
  options: CommandRunOptions = {},
): Promise<CommandRunResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    const append = (current: string, chunk: unknown) => (
      current + chunkToString(chunk)
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

function defaultSpawnCommand(
  command: string,
  args: string[],
  options: { env: NodeJS.ProcessEnv },
): SpawnedGraphicalProcess {
  const child = spawn(command, args, {
    detached: true,
    env: options.env,
    stdio: ["ignore", "ignore", "pipe"],
  });
  child.unref();
  return child;
}

function chunkToString(chunk: unknown): string {
  if (typeof chunk === "string") {
    return chunk;
  }
  if (Buffer.isBuffer(chunk)) {
    return chunk.toString("utf8");
  }
  return String(chunk ?? "");
}

function canUseSway(env: NodeJS.ProcessEnv, commandExists: (command: string) => boolean): boolean {
  return Boolean(env.SWAYSOCK) && commandExists("swaymsg");
}

function normalizeWindowToken(input: string | undefined): string {
  return (input ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\.desktop$/i, "")
    .replace(/\s+/g, " ");
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

function windowNodes(tree: SwayNode | undefined): SwayNode[] {
  return walkSwayTree(tree).filter((node) => (
    typeof node.id === "number" && Boolean(node.app_id || node.window || node.pid)
  ));
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

function tokenMatches(node: SwayNode, candidates: Set<string>): boolean {
  if (candidates.size === 0) {
    return false;
  }

  return nodeTokens(node).some((token) => (
    candidates.has(token)
    || [...candidates].some((candidate) => token.includes(candidate) || candidate.includes(token))
  ));
}

function findLaunchedWindow(input: {
  tree: SwayNode;
  baselineIds: Set<number>;
  baselineFocusedId?: number;
  pid?: number;
  windowTokens: Set<string>;
  acceptAnyNewWindow: boolean;
  allowExistingMatch: boolean;
}): SwayNode | undefined {
  const nodes = windowNodes(input.tree);
  const newNodes = nodes.filter((node) => !input.baselineIds.has(node.id ?? -1));
  const pidMatch = newNodes.find((node) => input.pid && node.pid === input.pid);
  if (pidMatch) {
    return pidMatch;
  }

  const tokenMatch = newNodes.find((node) => tokenMatches(node, input.windowTokens));
  if (tokenMatch) {
    return tokenMatch;
  }

  if (input.acceptAnyNewWindow && newNodes.length > 0) {
    return newNodes.find((node) => node.focused) ?? newNodes[0];
  }

  const changedFocus = nodes.find((node) => node.focused && node.id !== input.baselineFocusedId);
  if (input.acceptAnyNewWindow && changedFocus) {
    return changedFocus;
  }

  if (input.allowExistingMatch) {
    return nodes.find((node) => tokenMatches(node, input.windowTokens));
  }

  return undefined;
}

function parseSwayTree(result: CommandRunResult): SwayNode | undefined {
  if (result.exitCode !== 0 || !result.stdout.trim()) {
    return undefined;
  }

  try {
    return JSON.parse(result.stdout) as SwayNode;
  } catch {
    return undefined;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

function conciseDetail(value: string | undefined): string | undefined {
  const detail = value?.trim().replace(/\s+/g, " ");
  return detail ? detail.slice(-800) : undefined;
}

function failureMessage(label: string, state: {
  spawnError?: string;
  exitCode?: number | null;
  signal?: NodeJS.Signals | null;
  stderr?: string;
}): string {
  const detail = conciseDetail(state.stderr || state.spawnError);
  const termination = state.spawnError
    ? state.spawnError
    : state.signal
      ? `el proceso terminó por la señal ${state.signal}`
      : `el proceso terminó con código ${state.exitCode ?? "desconocido"}`;
  return `No pude abrir ${label}: ${termination}.${detail ? ` Detalle: ${detail}` : ""}`;
}

function finishChildCapture(
  child: SpawnedGraphicalProcess | undefined,
  stderrListener: ((chunk: unknown) => void) | undefined,
): void {
  if (child?.stderr && stderrListener) {
    child.stderr.removeListener?.("data", stderrListener);
    child.stderr.unref?.();
  }
  child?.unref?.();
}

function isSpawnedGraphicalProcess(value: unknown): value is SpawnedGraphicalProcess {
  return Boolean(value && typeof value === "object" && "on" in value && typeof value.on === "function");
}

export async function launchGraphicalApplication(
  request: GraphicalLaunchRequest,
): Promise<GraphicalLaunchResult> {
  const args = request.args ?? [];
  const commandExists = request.commandExists ?? ((command: string) => executableExists(command, request.env));
  const spawnCommand = request.spawnCommand ?? defaultSpawnCommand;
  const runCommand = request.runCommand ?? defaultRunCommand;
  const swayAvailable = canUseSway(request.env, commandExists);
  const timeoutMs = Math.max(0, request.windowTimeoutMs ?? DEFAULT_WINDOW_TIMEOUT_MS);
  const pollIntervalMs = Math.max(0, request.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS);
  const coldStartMs = Math.max(0, request.coldStartMs ?? DEFAULT_COLD_START_MS);
  const existingWindowGraceMs = Math.max(0, request.existingWindowGraceMs ?? DEFAULT_EXISTING_WINDOW_GRACE_MS);
  const startedAt = Date.now();
  let baselineIds = new Set<number>();
  let baselineFocusedId: number | undefined;
  let lastSwayError = "";

  request.onProgress?.(`Iniciando ${request.label}…`);
  if (request.signal?.aborted) {
    return {
      ok: false,
      status: "aborted",
      command: request.command,
      args,
      message: `Se canceló la apertura de ${request.label} antes de iniciar el proceso.`,
    };
  }

  if (swayAvailable) {
    const baselineResult = await runCommand("swaymsg", ["-t", "get_tree"], {
      env: request.env,
      timeoutMs: 1_000,
    });
    const baselineTree = parseSwayTree(baselineResult);
    const baselineNodes = windowNodes(baselineTree);
    baselineIds = new Set(baselineNodes.flatMap((node) => typeof node.id === "number" ? [node.id] : []));
    baselineFocusedId = baselineNodes.find((node) => node.focused)?.id;
    lastSwayError = baselineResult.stderr || baselineResult.error || "";
  }

  let child: SpawnedGraphicalProcess | undefined;
  let spawnError: string | undefined;
  let exitCode: number | null | undefined;
  let exitSignal: NodeJS.Signals | null | undefined;
  let stderr = "";
  const stderrListener = (chunk: unknown) => {
    stderr = (stderr + chunkToString(chunk)).slice(-MAX_COMMAND_OUTPUT_BYTES);
  };

  try {
    const spawned = spawnCommand(request.command, args, { env: request.env });
    child = isSpawnedGraphicalProcess(spawned) ? spawned : undefined;
  } catch (error) {
    spawnError = error instanceof Error ? error.message : String(error);
  }

  if (child) {
    child.stderr?.on("data", stderrListener);
    child.on("error", (error) => {
      spawnError = error.message;
    });
    child.on("exit", (code, signal) => {
      exitCode = code;
      exitSignal = signal;
    });
  }

  if (spawnError) {
    finishChildCapture(child, stderrListener);
    return {
      ok: false,
      status: "failed",
      command: request.command,
      args,
      pid: child?.pid,
      message: failureMessage(request.label, { spawnError, stderr }),
      stderr: conciseDetail(stderr),
    };
  }

  if (!swayAvailable) {
    await new Promise<void>((resolve) => setTimeout(resolve, child ? Math.min(coldStartMs, 1_500) : 0));
    if (spawnError || (exitCode !== undefined && (exitCode !== 0 || exitSignal))) {
      finishChildCapture(child, stderrListener);
      return {
        ok: false,
        status: "failed",
        command: request.command,
        args,
        pid: child?.pid,
        exitCode,
        signal: exitSignal,
        stderr: conciseDetail(stderr),
        message: failureMessage(request.label, { spawnError, exitCode, signal: exitSignal, stderr }),
      };
    }

    finishChildCapture(child, stderrListener);
    return {
      ok: true,
      status: "unverified",
      command: request.command,
      args,
      pid: child?.pid,
      exitCode,
      signal: exitSignal,
      stderr: conciseDetail(stderr),
      message: `Inicié ${request.label}, pero esta sesión no expone Sway; no puedo confirmar ni ubicar su ventana.`,
    };
  }

  const windowTokens = new Set([
    basename(request.command),
    ...(request.windowTokens ?? []),
  ].map(normalizeWindowToken).filter(Boolean));
  let coldStartReported = false;

  while (Date.now() - startedAt <= timeoutMs) {
    if (request.signal?.aborted) {
      finishChildCapture(child, stderrListener);
      return {
        ok: false,
        status: "aborted",
        command: request.command,
        args,
        pid: child?.pid,
        message: `Se canceló la espera de la ventana de ${request.label}; el proceso ya se había iniciado.`,
      };
    }

    if (spawnError || (exitCode !== undefined && (exitCode !== 0 || exitSignal))) {
      finishChildCapture(child, stderrListener);
      return {
        ok: false,
        status: "failed",
        command: request.command,
        args,
        pid: child?.pid,
        exitCode,
        signal: exitSignal,
        stderr: conciseDetail(stderr),
        message: failureMessage(request.label, { spawnError, exitCode, signal: exitSignal, stderr }),
      };
    }

    const elapsed = Date.now() - startedAt;
    if (!coldStartReported && elapsed >= coldStartMs) {
      coldStartReported = true;
      request.onProgress?.(`${request.label} está tardando en arrancar; sigo esperando a que aparezca la ventana…`);
    }

    const treeResult = await runCommand("swaymsg", ["-t", "get_tree"], {
      env: request.env,
      timeoutMs: 1_000,
    });
    const tree = parseSwayTree(treeResult);
    lastSwayError = treeResult.stderr || treeResult.error || lastSwayError;
    const window = tree ? findLaunchedWindow({
      tree,
      baselineIds,
      baselineFocusedId,
      pid: child?.pid,
      windowTokens,
      acceptAnyNewWindow: request.acceptAnyNewWindow === true,
      allowExistingMatch: elapsed >= existingWindowGraceMs,
    }) : undefined;

    if (window?.id) {
      const workspaceName = workspaceNameFor(request.workspace);
      const focusSuffix = request.focus ? ", focus" : "";
      const shouldFullscreen = request.fullscreen ?? workspaceName !== "1:home";
      const fullscreenSuffix = shouldFullscreen ? ", fullscreen enable" : "";
      const swayCommand = `[con_id=${window.id}] move to workspace "${workspaceName}"${fullscreenSuffix}${focusSuffix}`;
      const moveResult = await runCommand("swaymsg", [swayCommand], {
        env: request.env,
        timeoutMs: 1_000,
      });
      if (moveResult.exitCode !== 0) {
        finishChildCapture(child, stderrListener);
        const detail = conciseDetail(moveResult.stderr || moveResult.error);
        return {
          ok: false,
          status: "failed",
          command: request.command,
          args,
          pid: child?.pid,
          windowId: window.id,
          stderr: detail,
          message: `La ventana de ${request.label} apareció, pero no pude moverla al workspace ${workspaceName}.${detail ? ` Detalle: ${detail}` : ""}`,
        };
      }

      finishChildCapture(child, stderrListener);
      return {
        ok: true,
        status: "mapped",
        command: request.command,
        args,
        pid: child?.pid,
        windowId: window.id,
        exitCode,
        signal: exitSignal,
        stderr: conciseDetail(stderr),
        message: `${request.label} ya está visible en el workspace ${workspaceName}.`,
      };
    }

    await sleep(pollIntervalMs);
  }

  finishChildCapture(child, stderrListener);
  const detail = conciseDetail(stderr || lastSwayError);
  const seconds = Math.max(1, Math.round(timeoutMs / 1_000));
  return {
    ok: false,
    status: "timed-out",
    command: request.command,
    args,
    pid: child?.pid,
    exitCode,
    signal: exitSignal,
    stderr: detail,
    message: `Inicié ${request.label}, pero no apareció ninguna ventana en Sway tras ${seconds} s.${detail ? ` Detalle: ${detail}` : " Revisa el registro del lanzador y la compatibilidad Wayland/XWayland."}`,
  };
}
