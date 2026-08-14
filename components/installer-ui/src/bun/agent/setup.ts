import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { createOpenClawRuntime, type OpenClawRuntime } from "./worker/openclaw-runtime";

const BUNDLED_WORKER_PATHS = [
  join(dirname(fileURLToPath(import.meta.url)), "worker", "agenos-worker-daemon.ts"),
  "/usr/local/bin/agenos-openclaw-worker",
];

export type OpenClawSetupPhase = "ready" | "needs_auth" | "needs_channel" | "degraded" | "failed";

export type OpenClawSetupAction =
  | "setup.rerun"
  | "codex.login"
  | "telegram.configure"
  | "telegram.test"
  | "telegram.enable"
  | "diagnostics.export";

export type OpenClawWorkerMode = "openclaw" | "bundled" | "simulated";

export type OpenClawCodexLoginStatus = "idle" | "pending" | "success" | "error";

export type OpenClawCodexLoginState = {
  status: OpenClawCodexLoginStatus;
  url: string | null;
  userCode: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
};

export type OpenClawSetupState = {
  schemaVersion: 1;
  ok: boolean;
  phase: OpenClawSetupPhase;
  message: string;
  workerMode: OpenClawWorkerMode;
  openclaw: {
    installed: boolean;
    healthy: boolean;
    binaryPath: string;
    version: string | null;
    gatewayUrl: string | null;
    lastError: string | null;
  };
  codex: {
    configured: boolean;
    profile: string | null;
    loginAvailable: boolean;
    lastError: string | null;
    login: OpenClawCodexLoginState;
  };
  telegram: {
    enabled: boolean;
    tokenConfigured: boolean;
    botUsername: string | null;
    lastTestOk: boolean | null;
    lastError: string | null;
  };
  actions: OpenClawSetupAction[];
  updatedAt: string;
  correlationId: string;
};

export type OpenClawSetupServiceOptions = {
  stateDir?: string;
  openClawBinaryPath?: string;
  bundledWorkerPath?: string;
  env?: Record<string, string | undefined>;
  now?: () => Date;
  correlationIdFactory?: () => string;
  telegramProbe?: (token: string) => Promise<{ ok: boolean; botUsername?: string | null; message?: string }>;
  runtime?: OpenClawRuntime;
  codexLoginSpawn?: (command: string, args: string[], env: Record<string, string>) => ChildProcess;
  /** How long startCodexLogin waits for the auth URL before returning anyway. */
  codexLoginWaitMs?: number;
  /** Hard limit for the whole login flow before the child is killed. */
  codexLoginTtlMs?: number;
};

export type OpenClawSetupService = ReturnType<typeof createOpenClawSetupService>;

const DEFAULT_BINARY_PATH = "/usr/bin/openclaw";
const TELEGRAM_TOKEN_KEY = "OPENCLAW_TELEGRAM_BOT_TOKEN";
const CODEX_CONFIGURED_KEY = "OPENCLAW_CODEX_AUTH_CONFIGURED";
const CODEX_LOGIN_WAIT_MS = 25_000;
const CODEX_LOGIN_TTL_MS = 15 * 60 * 1000;

export function createOpenClawSetupService(options: OpenClawSetupServiceOptions = {}) {
  const env = options.env ?? process.env;
  const stateDir = expandHome(options.stateDir ?? env.AGENOS_OPENCLAW_STATE_DIR ?? join(homedir(), ".agenos", "openclaw"));
  const binaryPath = options.openClawBinaryPath ?? env.AGENOS_OPENCLAW_BIN ?? DEFAULT_BINARY_PATH;
  const bundledWorkerPath = options.bundledWorkerPath ?? firstExistingPath(BUNDLED_WORKER_PATHS) ?? BUNDLED_WORKER_PATHS[0];
  const now = options.now ?? (() => new Date());
  const correlationIdFactory = options.correlationIdFactory ?? (() => `corr_${Date.now().toString(36)}`);
  const telegramProbe = options.telegramProbe ?? defaultTelegramProbe;
  const statePath = join(stateDir, "setup-state.json");
  const secretsPath = join(stateDir, "secrets.env");
  const runtime = options.runtime ?? createOpenClawRuntime({
    stateDir,
    binaryPath: options.openClawBinaryPath ?? env.AGENOS_OPENCLAW_BIN,
    env,
  });
  const codexLoginSpawn = options.codexLoginSpawn ?? defaultCodexLoginSpawn;
  const codexLoginWaitMs = options.codexLoginWaitMs ?? CODEX_LOGIN_WAIT_MS;
  const codexLoginTtlMs = options.codexLoginTtlMs ?? CODEX_LOGIN_TTL_MS;
  const codexHomeDir = join(stateDir, "codex-home");
  let codexLogin: OpenClawCodexLoginState = idleCodexLogin();
  let codexLoginChild: ChildProcess | null = null;

  function openClawInstalled(): boolean {
    return runtime.resolveBinary() !== null || existsSync(binaryPath);
  }

  async function status(): Promise<OpenClawSetupState> {
    const saved = readState(statePath);
    if (saved) {
      // Rebuild from the saved snapshot so secret-derived flags (Codex auth,
      // Telegram token) and the resulting phase/actions reflect current state.
      return buildState({
        correlationId: saved.correlationId,
        message: saved.message,
        openclawInstalled: saved.openclaw.installed,
        bundledWorkerAvailable: existsSync(bundledWorkerPath),
        openclawVersion: saved.openclaw.version,
        gatewayHealthy: saved.openclaw.healthy,
        telegramEnabled: saved.telegram.enabled,
        telegramBotUsername: saved.telegram.botUsername,
        telegramLastTestOk: saved.telegram.lastTestOk,
        telegramLastError: saved.telegram.lastError,
      });
    }

    return buildState({
      correlationId: correlationIdFactory(),
      message: "OpenClaw setup has not run yet.",
      openclawInstalled: openClawInstalled(),
      bundledWorkerAvailable: existsSync(bundledWorkerPath),
    });
  }

  async function run(): Promise<OpenClawSetupState> {
    let installMessage: string | null = null;
    if (!openClawInstalled() && env.AGENOS_OPENCLAW_AUTO_INSTALL === "1") {
      const install = await runtime.installRuntime();
      installMessage = install.message;
    }

    const openclawInstalled = openClawInstalled();
    const bundledAvailable = existsSync(bundledWorkerPath);
    let openclawVersion: string | null = null;
    let gatewayHealthy = false;

    if (openclawInstalled) {
      runtime.ensureConfig();
      openclawVersion = await runtime.version();
      gatewayHealthy = (await runtime.probeGateway()).ok;
    }

    let message: string;
    if (openclawInstalled && gatewayHealthy) {
      message = "OpenClaw runtime and gateway detected. Backend auth and channels may still need setup.";
    } else if (openclawInstalled) {
      message = "OpenClaw runtime detected. The gateway will start with the backend worker service.";
    } else if (bundledAvailable) {
      message = installMessage
        ? `Using bundled backend worker. ${installMessage}`
        : "Using bundled backend worker. Backend auth and channels may still need setup.";
    } else {
      message = `No backend worker available. OpenClaw binary not found: ${binaryPath}`;
    }
    const state = buildState({
      correlationId: correlationIdFactory(),
      message,
      openclawInstalled,
      bundledWorkerAvailable: bundledAvailable,
      openclawVersion,
      gatewayHealthy,
    });
    persistState(statePath, state);
    return state;
  }

  function resolveCodexLoginCommand(): { command: string; args: string[]; env: Record<string, string> } | null {
    const inherited: Record<string, string> = {};
    for (const [key, value] of Object.entries(env)) {
      if (typeof value === "string") {
        inherited[key] = value;
      }
    }

    const openclawBinary = runtime.resolveBinary();
    if (openclawBinary) {
      return {
        command: openclawBinary,
        args: ["models", "auth", "login", "--provider", "openai-codex"],
        env: {
          ...inherited,
          OPENCLAW_CONFIG_PATH: runtime.configPath,
          OPENCLAW_STATE_DIR: join(stateDir, "state"),
          NO_COLOR: "1",
        },
      };
    }

    const codexBinary = env.AGENOS_CODEX_BIN?.trim() || lookupOnPath("codex", env.PATH);
    if (codexBinary) {
      return {
        command: codexBinary,
        args: ["login", "--device-auth"],
        env: {
          ...inherited,
          CODEX_HOME: codexHomeDir,
          NO_COLOR: "1",
        },
      };
    }

    return null;
  }

  function markCodexLoginFinished(update: Partial<OpenClawCodexLoginState>): void {
    codexLogin = {
      ...codexLogin,
      ...update,
      finishedAt: now().toISOString(),
    };
    codexLoginChild = null;
  }

  async function startCodexLogin(): Promise<OpenClawSetupState> {
    const base = await run();

    if (isCodexConfigured()) {
      return buildAndPersist({
        message: "Backend Codex auth is already configured.",
        openclawInstalled: base.openclaw.installed,
        openclawVersion: base.openclaw.version,
        gatewayHealthy: base.openclaw.healthy,
      });
    }

    if (codexLogin.status === "pending" && codexLoginChild) {
      return buildAndPersist({
        message: "Backend Codex login is already in progress. Share the URL and code with the user.",
        openclawInstalled: base.openclaw.installed,
        openclawVersion: base.openclaw.version,
        gatewayHealthy: base.openclaw.healthy,
      });
    }

    const resolved = resolveCodexLoginCommand();
    if (!resolved) {
      codexLogin = {
        ...idleCodexLogin(),
        status: "error",
        error: "No openclaw or codex binary available to run the login flow.",
      };
      return buildAndPersist({
        message: "No backend worker binary available, so Codex login cannot start.",
        openclawInstalled: base.openclaw.installed,
        openclawVersion: base.openclaw.version,
        gatewayHealthy: base.openclaw.healthy,
      });
    }

    mkdirSync(codexHomeDir, { recursive: true });
    codexLogin = {
      ...idleCodexLogin(),
      status: "pending",
      startedAt: now().toISOString(),
    };

    let output = "";
    const authInfoReady = createSignal();
    const exited = createSignal();
    const child = codexLoginSpawn(resolved.command, resolved.args, resolved.env);
    codexLoginChild = child;

    const ttlTimer = setTimeout(() => {
      if (codexLogin.status === "pending" && codexLoginChild === child) {
        child.kill("SIGTERM");
        markCodexLoginFinished({ status: "error", error: "Codex login expired before it was completed." });
      }
    }, codexLoginTtlMs);

    const consume = (chunk: Buffer | string) => {
      output += chunk.toString();
      const info = parseCodexLoginOutput(output);
      if (codexLogin.status !== "pending" || codexLoginChild !== child) {
        return;
      }
      codexLogin = {
        ...codexLogin,
        url: info.url ?? codexLogin.url,
        userCode: info.userCode ?? codexLogin.userCode,
      };
      if (codexLogin.url) {
        authInfoReady.resolve();
      }
    };

    child.stdout?.on("data", consume);
    child.stderr?.on("data", consume);
    child.once("error", (error) => {
      if (codexLoginChild === child && codexLogin.status === "pending") {
        markCodexLoginFinished({ status: "error", error: `Could not run Codex login: ${error.message}` });
      }
      clearTimeout(ttlTimer);
      exited.resolve();
    });
    child.once("exit", (code) => {
      clearTimeout(ttlTimer);
      if (codexLoginChild === child && codexLogin.status === "pending") {
        if (code === 0) {
          markCodexLoginFinished({ status: "success", error: null });
          writeSecret(CODEX_CONFIGURED_KEY, "1");
          persistState(statePath, buildState({
            correlationId: correlationIdFactory(),
            message: "Backend Codex auth completed.",
            openclawInstalled: openClawInstalled(),
            bundledWorkerAvailable: existsSync(bundledWorkerPath),
          }));
        } else {
          const tail = output.trim().split(/\r?\n/).slice(-3).join(" ").slice(0, 300);
          markCodexLoginFinished({
            status: "error",
            error: `Codex login exited with code ${code ?? "unknown"}${tail ? `: ${tail}` : "."}`,
          });
        }
      }
      exited.resolve();
    });

    await Promise.race([
      authInfoReady.promise,
      exited.promise,
      delay(codexLoginWaitMs),
    ]);

    const message = codexLogin.status === "success"
      ? "Backend Codex auth completed."
      : codexLogin.status === "error"
        ? `Codex login failed: ${codexLogin.error ?? "unknown error"}`
        : codexLogin.url
          ? "Codex login started. Share the URL and user code with the user, then check codex login status."
          : "Codex login started but no auth URL was captured yet. Check codex login status shortly.";

    return buildAndPersist({
      message,
      openclawInstalled: base.openclaw.installed,
      openclawVersion: base.openclaw.version,
      gatewayHealthy: base.openclaw.healthy,
    });
  }

  async function codexLoginStatus(): Promise<OpenClawSetupState> {
    const message = codexLogin.status === "success" || isCodexConfigured()
      ? "Backend Codex auth is configured."
      : codexLogin.status === "pending"
        ? "Codex login is still waiting for the user to finish the browser flow."
        : codexLogin.status === "error"
          ? `Codex login failed: ${codexLogin.error ?? "unknown error"}`
          : "Codex login has not started yet.";

    return buildAndPersist({
      message,
      openclawInstalled: openClawInstalled(),
    });
  }

  function buildAndPersist(input: {
    message: string;
    openclawInstalled: boolean;
    openclawVersion?: string | null;
    gatewayHealthy?: boolean;
  }): OpenClawSetupState {
    const state = buildState({
      correlationId: correlationIdFactory(),
      message: input.message,
      openclawInstalled: input.openclawInstalled,
      bundledWorkerAvailable: existsSync(bundledWorkerPath),
      openclawVersion: input.openclawVersion,
      gatewayHealthy: input.gatewayHealthy,
    });
    persistState(statePath, state);
    return state;
  }

  async function configureTelegram(token: string): Promise<OpenClawSetupState> {
    const normalized = token.trim();
    if (!normalized) {
      const state = buildState({
        correlationId: correlationIdFactory(),
        message: "Telegram bot token is empty.",
        openclawInstalled: openClawInstalled(),
        telegramLastError: "Telegram bot token is empty.",
      });
      persistState(statePath, state);
      return state;
    }

    writeSecret(TELEGRAM_TOKEN_KEY, normalized);
    const state = buildState({
      correlationId: correlationIdFactory(),
      message: "Telegram token stored. Test the bot before enabling the channel.",
      openclawInstalled: openClawInstalled(),
      bundledWorkerAvailable: existsSync(bundledWorkerPath),
      telegramTokenConfigured: true,
    });
    persistState(statePath, state);
    return state;
  }

  async function testTelegram(): Promise<OpenClawSetupState> {
    const token = readTelegramToken();
    if (!token) {
      const state = buildState({
        correlationId: correlationIdFactory(),
        message: "Telegram bot token is not configured.",
        openclawInstalled: openClawInstalled(),
        telegramLastError: "Telegram bot token is not configured.",
      });
      persistState(statePath, state);
      return state;
    }

    const probe = await telegramProbe(token);
    const state = buildState({
      correlationId: correlationIdFactory(),
      message: probe.message ?? (probe.ok ? "Telegram bot reachable." : "Telegram bot test failed."),
      openclawInstalled: openClawInstalled(),
      telegramTokenConfigured: true,
      telegramBotUsername: probe.botUsername ?? null,
      telegramLastTestOk: probe.ok,
      telegramLastError: probe.ok ? null : probe.message ?? "Telegram bot test failed.",
    });
    persistState(statePath, state);
    return state;
  }

  async function enableTelegram(): Promise<OpenClawSetupState> {
    const current = await status();
    const state = buildState({
      correlationId: correlationIdFactory(),
      message: current.telegram.lastTestOk
        ? "Telegram channel enabled."
        : "Test Telegram successfully before enabling the channel.",
      openclawInstalled: openClawInstalled(),
      telegramTokenConfigured: hasTelegramToken(),
      telegramBotUsername: current.telegram.botUsername,
      telegramLastTestOk: current.telegram.lastTestOk,
      telegramLastError: current.telegram.lastTestOk ? null : "Telegram test has not passed.",
      telegramEnabled: current.telegram.lastTestOk === true,
    });
    persistState(statePath, state);
    return state;
  }

  function buildState(input: {
    correlationId: string;
    message: string;
    openclawInstalled: boolean;
    bundledWorkerAvailable?: boolean;
    openclawVersion?: string | null;
    gatewayHealthy?: boolean;
    codexConfigured?: boolean;
    codexProfile?: string | null;
    telegramTokenConfigured?: boolean;
    telegramEnabled?: boolean;
    telegramBotUsername?: string | null;
    telegramLastTestOk?: boolean | null;
    telegramLastError?: string | null;
  }): OpenClawSetupState {
    const telegramTokenConfigured = input.telegramTokenConfigured ?? hasTelegramToken();
    const codexConfigured = input.codexConfigured ?? isCodexConfigured();
    const openclawHealthy = input.gatewayHealthy ?? input.openclawInstalled;
    const telegramEnabled = input.telegramEnabled ?? false;
    const telegramNeedsSetup = telegramEnabled && (!telegramTokenConfigured || input.telegramLastTestOk === false);
    const bundledAvailable = input.bundledWorkerAvailable ?? existsSync(bundledWorkerPath);
    const hasBackend = input.openclawInstalled || bundledAvailable;
    const workerMode: OpenClawWorkerMode = input.openclawInstalled
      ? "openclaw"
      : bundledAvailable
        ? "bundled"
        : "simulated";
    const phase: OpenClawSetupPhase = !hasBackend
      ? "degraded"
      : !codexConfigured
        ? "needs_auth"
        : telegramNeedsSetup
          ? "needs_channel"
          : "ready";

    return {
      schemaVersion: 1,
      ok: phase === "ready",
      phase,
      message: input.message,
      workerMode,
      openclaw: {
        installed: input.openclawInstalled,
        healthy: openclawHealthy,
        binaryPath: runtime.resolveBinary() ?? binaryPath,
        version: input.openclawVersion ?? (input.openclawInstalled ? "detected" : null),
        gatewayUrl: input.openclawInstalled ? runtime.gatewayUrl : null,
        lastError: hasBackend ? null : `No backend worker available. OpenClaw binary not found: ${binaryPath}`,
      },
      codex: {
        configured: codexConfigured,
        profile: input.codexProfile ?? null,
        loginAvailable: hasBackend,
        lastError: codexConfigured ? null : "Backend Codex auth is not configured.",
        login: { ...codexLogin },
      },
      telegram: {
        enabled: telegramEnabled,
        tokenConfigured: telegramTokenConfigured,
        botUsername: input.telegramBotUsername ?? null,
        lastTestOk: input.telegramLastTestOk ?? null,
        lastError: input.telegramLastError ?? null,
      },
      actions: actionsFor({
        openclawInstalled: input.openclawInstalled,
        bundledWorkerAvailable: bundledAvailable,
        codexConfigured,
        telegramTokenConfigured,
        telegramEnabled,
        telegramLastTestOk: input.telegramLastTestOk ?? null,
      }),
      updatedAt: now().toISOString(),
      correlationId: input.correlationId,
    };
  }

  function hasTelegramToken(): boolean {
    return Boolean(readTelegramToken());
  }

  function readTelegramToken(): string | null {
    if (env[TELEGRAM_TOKEN_KEY]?.trim()) {
      return env[TELEGRAM_TOKEN_KEY]!.trim();
    }
    const secrets = readSecrets(secretsPath);
    return secrets[TELEGRAM_TOKEN_KEY]?.trim() || null;
  }

  function writeSecret(key: string, value: string): void {
    mkdirSync(dirname(secretsPath), { recursive: true });
    const secrets = readSecrets(secretsPath);
    secrets[key] = value;
    const body = Object.entries(secrets).map(([secretKey, secretValue]) => `${secretKey}=${secretValue}`).join("\n") + "\n";
    writeFileSync(secretsPath, body, { mode: 0o600 });
  }

  function isCodexConfigured(): boolean {
    if (env[CODEX_CONFIGURED_KEY] === "1" || env[CODEX_CONFIGURED_KEY] === "true") {
      return true;
    }
    if (codexLogin.status === "success") {
      return true;
    }
    return readSecrets(secretsPath)[CODEX_CONFIGURED_KEY] === "1";
  }

  return {
    status,
    run,
    startCodexLogin,
    codexLoginStatus,
    configureTelegram,
    testTelegram,
    enableTelegram,
  };
}

function actionsFor(input: {
  openclawInstalled: boolean;
  bundledWorkerAvailable?: boolean;
  codexConfigured: boolean;
  telegramTokenConfigured: boolean;
  telegramEnabled: boolean;
  telegramLastTestOk: boolean | null;
}): OpenClawSetupAction[] {
  const actions: OpenClawSetupAction[] = ["setup.rerun", "diagnostics.export"];
  const hasBackend = input.openclawInstalled || Boolean(input.bundledWorkerAvailable);
  if (hasBackend && !input.codexConfigured) {
    actions.push("codex.login");
  }
  if (!input.telegramTokenConfigured) {
    actions.push("telegram.configure");
  } else if (input.telegramLastTestOk !== true) {
    actions.push("telegram.test");
  } else if (!input.telegramEnabled) {
    actions.push("telegram.enable");
  }
  return actions;
}

function readState(path: string): OpenClawSetupState | null {
  if (!existsSync(path)) {
    return null;
  }
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<OpenClawSetupState>;
    if (parsed.schemaVersion !== 1 || typeof parsed.phase !== "string") {
      return null;
    }
    return parsed as OpenClawSetupState;
  } catch {
    return null;
  }
}

function persistState(path: string, state: OpenClawSetupState): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
}

function readSecrets(path: string): Record<string, string> {
  if (!existsSync(path)) {
    return {};
  }
  const result: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const separator = trimmed.indexOf("=");
    if (separator === -1) {
      continue;
    }
    result[trimmed.slice(0, separator)] = trimmed.slice(separator + 1);
  }
  return result;
}

function idleCodexLogin(): OpenClawCodexLoginState {
  return {
    status: "idle",
    url: null,
    userCode: null,
    startedAt: null,
    finishedAt: null,
    error: null,
  };
}

function stripAnsi(value: string): string {
  return value.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\))/g, "");
}

export function parseCodexLoginOutput(rawOutput: string): { url?: string; userCode?: string } {
  const output = stripAnsi(rawOutput);
  const url = output.match(/https:\/\/auth\.openai\.com\/[^\s"'`)\]]*/)?.[0]
    ?? output.match(/https:\/\/[^\s"'`)\]]+/)?.[0];
  const codeMatches = [...output.matchAll(/\b[A-Z0-9]{4,}(?:-[A-Z0-9]{4,})+\b/g)];
  const userCode = codeMatches.length > 0 ? codeMatches[codeMatches.length - 1]?.[0] : undefined;
  return { url, userCode };
}

function defaultCodexLoginSpawn(command: string, args: string[], env: Record<string, string>): ChildProcess {
  return spawn(command, args, { env, stdio: ["ignore", "pipe", "pipe"] });
}

function createSignal(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function lookupOnPath(binary: string, pathValue: string | undefined): string | null {
  for (const dir of (pathValue ?? "").split(":")) {
    if (!dir) {
      continue;
    }
    const candidate = join(dir, binary);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

async function defaultTelegramProbe(token: string): Promise<{ ok: boolean; botUsername?: string | null; message?: string }> {
  if (!/^\d+:[A-Za-z0-9_-]+$/.test(token)) {
    return { ok: false, message: "Telegram bot token format is invalid." };
  }
  return { ok: true, botUsername: null, message: "Telegram token format looks valid." };
}

function expandHome(path: string): string {
  return path.replace(/^~(?=\/)/, homedir());
}

function firstExistingPath(paths: string[]): string | null {
  return paths.find((path) => existsSync(path)) ?? null;
}
