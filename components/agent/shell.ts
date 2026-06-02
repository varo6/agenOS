import { spawn } from "node:child_process";
import { homedir } from "node:os";

export type ShellExecInput = {
  command: string;
  cwd?: string;
  timeoutMs?: number;
};

export type ShellExecResult = {
  ok: boolean;
  command: string;
  cwd: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  message: string;
};

export type ShellExecOptions = {
  shellPath?: string;
  defaultCwd?: string;
  maxTimeoutMs?: number;
  maxOutputBytes?: number;
  env?: NodeJS.ProcessEnv;
};

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_BYTES = 64 * 1024;

function clampTimeout(timeoutMs: number | undefined, maxTimeoutMs: number): number {
  if (!Number.isFinite(timeoutMs) || !timeoutMs || timeoutMs <= 0) {
    return DEFAULT_TIMEOUT_MS;
  }

  return Math.min(Math.trunc(timeoutMs), maxTimeoutMs);
}

function appendLimited(current: string, chunk: Buffer, maxBytes: number): string {
  const next = current + chunk.toString("utf8");
  if (Buffer.byteLength(next, "utf8") <= maxBytes) {
    return next;
  }

  const truncated = Buffer.from(next, "utf8").subarray(0, maxBytes).toString("utf8");
  return `${truncated}\n[output truncated]`;
}

export function runShellCommand(input: ShellExecInput, options: ShellExecOptions = {}): Promise<ShellExecResult> {
  const command = input.command.trim();
  if (!command) {
    throw new Error("El comando shell es obligatorio.");
  }

  const cwd = input.cwd?.trim() || options.defaultCwd || process.cwd() || homedir();
  const shellPath = options.shellPath || process.env.SHELL || "/bin/bash";
  const maxTimeoutMs = options.maxTimeoutMs ?? MAX_TIMEOUT_MS;
  const timeoutMs = clampTimeout(input.timeoutMs, maxTimeoutMs);
  const maxOutputBytes = options.maxOutputBytes ?? MAX_OUTPUT_BYTES;
  const env = options.env ?? process.env;

  return new Promise<ShellExecResult>((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;

    const child = spawn(shellPath, ["-lc", command], {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    const settle = (callback: () => void) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      callback();
    };

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout = appendLimited(stdout, chunk, maxOutputBytes);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = appendLimited(stderr, chunk, maxOutputBytes);
    });
    child.on("error", (error) => {
      settle(() => reject(error));
    });
    child.on("exit", (exitCode, signal) => {
      settle(() => {
        const ok = exitCode === 0 && !timedOut;
        resolve({
          ok,
          command,
          cwd,
          exitCode,
          signal,
          stdout,
          stderr,
          timedOut,
          message: timedOut
            ? `Comando cancelado por timeout tras ${timeoutMs}ms.`
            : ok
              ? "Comando completado."
              : `Comando terminado con codigo ${exitCode ?? "desconocido"}.`,
        });
      });
    });
  });
}
