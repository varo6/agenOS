import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

import { createAgentAdminService } from "../agent/admin";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
type AgentAdminSnapshot = {
  status: () => Promise<unknown>;
  readConfig: () => Promise<unknown>;
};

export type SupportCommandOutput = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
  error?: string;
};

export type SupportCommandRunner = (
  command: string,
  args: string[],
  options: { timeoutMs: number; maxOutputBytes: number },
) => Promise<SupportCommandOutput>;

export type SupportCommandResult = {
  command: string;
  args: string[];
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut?: boolean;
  error?: string;
};

export type SupportHttpProbe = {
  name: string;
  url: string;
  ok: boolean;
  status?: number;
  payload?: unknown;
  error?: string;
};

export type SupportBundleOptions = {
  now?: () => Date;
  env?: Record<string, string | undefined>;
  cwd?: string;
  baseUrl?: string;
  fetch?: FetchLike;
  agentAdmin?: AgentAdminSnapshot;
  runCommand?: SupportCommandRunner;
  commandTimeoutMs?: number;
  maxOutputBytes?: number;
};

const DEFAULT_BASE_URL = "http://127.0.0.1:4173";
const DEFAULT_TIMEOUT_MS = 2_500;
const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024;

const COMMANDS = [
  ["systemctl", ["status", "agenos-agent-api.service", "--no-pager", "--full"]],
  ["systemctl", ["status", "agenos-openclaw.service", "--no-pager", "--full"]],
  ["journalctl", ["-u", "agenos-agent-api.service", "-n", "120", "--no-pager"]],
  ["journalctl", ["-u", "agenos-openclaw.service", "-n", "120", "--no-pager"]],
  // Estado que decide si lo que el usuario guarda sobrevive al apagado, y si su
  // reloj permite que una sesion iniciada siga siendo valida.
  ["findmnt", ["--noheadings", "--output", "TARGET,SOURCE,FSTYPE", "/home"]],
  ["ls", ["-A", "/run/live/persistence"]],
  ["timedatectl", ["show", "--property=NTPSynchronized", "--property=TimeUSec", "--property=Timezone"]],
] as const;

export async function createSupportBundle(options: SupportBundleOptions = {}) {
  const env = options.env ?? process.env;
  const now = options.now ?? (() => new Date());
  const commandTimeoutMs = options.commandTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const runCommand = options.runCommand ?? runCommandWithTimeout;
  const agentAdmin = options.agentAdmin ?? createAgentAdminService({ env });
  const packageDir = resolve(import.meta.dir, "..");
  const runtimePaths = resolveRuntimePaths(env, packageDir);
  const uiToken = readTextIfPresent(runtimePaths.uiTokenPath);
  const probeHeaders = uiToken ? { Authorization: `Bearer ${uiToken}` } : undefined;

  const [healthProbe, adminProbe, agentStatus, agentConfig, ...commands] = await Promise.all([
    readProbe(options.fetch ?? fetch, "health", "/health", options.baseUrl ?? DEFAULT_BASE_URL),
    readProbe(options.fetch ?? fetch, "agent admin status", "/api/agent/admin/status", options.baseUrl ?? DEFAULT_BASE_URL, probeHeaders),
    readSafe(() => agentAdmin.status()),
    readSafe(() => agentAdmin.readConfig()),
    ...COMMANDS.map(([command, args]) => captureCommand(command, [...args], runCommand, commandTimeoutMs, maxOutputBytes)),
  ]);

  return redactValue({
    schemaVersion: 1,
    generatedAt: now().toISOString(),
    runtime: {
      platform: process.platform,
      arch: process.arch,
      pid: process.pid,
      cwd: options.cwd ?? process.cwd(),
      bunVersion: Bun.version,
      nodeVersion: process.version,
      paths: runtimePaths,
    },
    build: readBuildMetadata(packageDir, runtimePaths.piPackageDir),
    http: {
      probes: [healthProbe, adminProbe],
    },
    agent: {
      status: agentStatus,
      config: agentConfig,
    },
    commands,
  });
}

export function resolveRuntimePaths(env: Record<string, string | undefined>, packageDir: string) {
  const home = env.HOME?.trim() || homedir();
  const runtimeDir = env.XDG_RUNTIME_DIR?.trim()
    ? join(env.XDG_RUNTIME_DIR.trim(), "agenos-installer")
    : join(home, ".cache", "agenos-installer", "runtime");

  return {
    home,
    runtimeDir,
    apiLog: join(runtimeDir, "api.log"),
    packageDir,
    piPackageDir: env.PI_PACKAGE_DIR ?? join(packageDir, "pi-coding-agent"),
    systemConfig: env.AGENOS_OPENCLAW_SYSTEM_CONFIG ?? "/etc/agenos/openclaw.json",
    userConfig: env.AGENOS_OPENCLAW_USER_CONFIG ?? join(home, ".agenos", "openclaw", "config.json"),
    stateDir: env.AGENOS_OPENCLAW_STATE_DIR ?? join(home, ".agenos", "openclaw"),
    workerTokenPath: env.AGENOS_WORKER_TOKEN_PATH ?? join(home, ".agenos", "broker", "worker-token"),
    uiTokenPath: env.AGENOS_UI_TOKEN_PATH ?? join(home, ".agenos", "broker", "ui-token"),
  };
}

async function readProbe(fetcher: FetchLike, name: string, path: string, baseUrl: string, headers?: Record<string, string>): Promise<SupportHttpProbe> {
  const url = new URL(path, `${baseUrl}/`).toString();
  try {
    const response = await fetcher(url, { headers: { Accept: "application/json", ...headers } });
    const text = await response.text();
    return {
      name,
      url,
      ok: response.ok,
      status: response.status,
      payload: text ? parseJsonOrText(text) : null,
    };
  } catch (error) {
    return {
      name,
      url,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function captureCommand(
  command: string,
  args: string[],
  runCommand: SupportCommandRunner,
  timeoutMs: number,
  maxOutputBytes: number,
): Promise<SupportCommandResult> {
  const startedAt = Date.now();
  try {
    const output = await runCommand(command, args, { timeoutMs, maxOutputBytes });
    return {
      command,
      args,
      ok: output.exitCode === 0 && !output.timedOut && !output.error,
      exitCode: output.exitCode,
      stdout: output.stdout,
      stderr: output.stderr,
      durationMs: Date.now() - startedAt,
      timedOut: output.timedOut,
      error: output.error,
    };
  } catch (error) {
    return {
      command,
      args,
      ok: false,
      exitCode: null,
      stdout: "",
      stderr: "",
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function runCommandWithTimeout(
  command: string,
  args: string[],
  options: { timeoutMs: number; maxOutputBytes: number },
): Promise<SupportCommandOutput> {
  return new Promise((resolveCommand) => {
    const child = spawn(command, args, {
      env: {
        ...process.env,
        LANG: process.env.LANG ?? "C.UTF-8",
        PATH: process.env.PATH ?? "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;

    const append = (current: string, chunk: unknown) => {
      const next = current + String(chunk);
      return next.length > options.maxOutputBytes ? next.slice(0, options.maxOutputBytes) : next;
    };

    const finish = (result: SupportCommandOutput) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolveCommand(result);
    };

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, options.timeoutMs);

    child.stdout?.on("data", (chunk) => {
      stdout = append(stdout, chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr = append(stderr, chunk);
    });
    child.once("error", (error) => {
      finish({ exitCode: null, stdout, stderr, error: error.message });
    });
    child.once("close", (code) => {
      finish({ exitCode: code, stdout, stderr, timedOut });
    });
  });
}

async function readSafe<T>(reader: () => Promise<T>): Promise<T | { ok: false; error: string }> {
  try {
    return await reader();
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function readBuildMetadata(packageDir: string, piPackageDir: string) {
  return {
    packageDir,
    buildInfo: readJsonIfPresent(join(packageDir, "build-info.json")),
    buildStamp: readTextIfPresent(join(packageDir, ".build-stamp")),
    piCodingAgent: readJsonIfPresent(join(piPackageDir, "package.json")),
  };
}

function readJsonIfPresent(path: string): unknown {
  if (!existsSync(path)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

function readTextIfPresent(path: string): string | null {
  if (!existsSync(path)) {
    return null;
  }

  return readFileSync(path, "utf8").trim() || null;
}

function parseJsonOrText(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text.trim();
  }
}

function redactValue(value: unknown, key = ""): unknown {
  if (typeof value === "string") {
    return isSensitiveKey(key) ? "[redacted]" : redactString(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item));
  }

  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [entryKey, entryValue] of Object.entries(value)) {
      output[entryKey] = redactValue(entryValue, entryKey);
    }
    return output;
  }

  return value;
}

function isSensitiveKey(key: string): boolean {
  return /^(apiKey|token|secret|password|authorization|accessToken|refreshToken)$/i.test(key);
}

function redactString(value: string): string {
  return value
    .replace(/sk-[A-Za-z0-9_-]{6,}/g, "[redacted]")
    .replace(/\bBearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/\b(api[_-]?key|token|secret|password|authorization)(\s*[:=]\s*)(["']?)[^"'\s,;]+/gi, "$1$2$3[redacted]");
}
