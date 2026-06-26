import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

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
};

export type OpenClawSetupService = ReturnType<typeof createOpenClawSetupService>;

const DEFAULT_BINARY_PATH = "/usr/bin/openclaw";
const TELEGRAM_TOKEN_KEY = "OPENCLAW_TELEGRAM_BOT_TOKEN";

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

  async function status(): Promise<OpenClawSetupState> {
    const saved = readState(statePath);
    if (saved) {
      return withCurrentSecretFlags(saved);
    }

    return buildState({
      correlationId: correlationIdFactory(),
      message: "OpenClaw setup has not run yet.",
      openclawInstalled: existsSync(binaryPath),
      bundledWorkerAvailable: existsSync(bundledWorkerPath),
    });
  }

  async function run(): Promise<OpenClawSetupState> {
    const openclawInstalled = existsSync(binaryPath);
    const bundledAvailable = existsSync(bundledWorkerPath);
    let message: string;
    if (openclawInstalled) {
      message = "OpenClaw runtime detected. Backend auth and channels may still need setup.";
    } else if (bundledAvailable) {
      message = "Using bundled backend worker. Backend auth and channels may still need setup.";
    } else {
      message = `No backend worker available. OpenClaw binary not found: ${binaryPath}`;
    }
    const state = buildState({
      correlationId: correlationIdFactory(),
      message,
      openclawInstalled,
      bundledWorkerAvailable: bundledAvailable,
    });
    persistState(statePath, state);
    return state;
  }

  async function startCodexLogin(): Promise<OpenClawSetupState & { command: string[] }> {
    const base = await run();
    const canLogin = base.openclaw.installed || base.workerMode === "bundled";
    const state: OpenClawSetupState = {
      ...base,
      phase: canLogin ? "needs_auth" : "degraded",
      ok: false,
      message: canLogin
        ? "Run backend Codex login and complete the browser/device flow."
        : "No backend worker available, so Codex login cannot start yet.",
      codex: {
        ...base.codex,
        loginAvailable: canLogin,
      },
      actions: actionsFor({
        openclawInstalled: base.openclaw.installed,
        bundledWorkerAvailable: base.workerMode === "bundled",
        codexConfigured: false,
        telegramTokenConfigured: hasTelegramToken(),
        telegramEnabled: base.telegram.enabled,
        telegramLastTestOk: base.telegram.lastTestOk,
      }),
    };
    persistState(statePath, state);
    return { ...state, command: [binaryPath, "models", "auth", "login", "--provider", "openai-codex"] };
  }

  async function configureTelegram(token: string): Promise<OpenClawSetupState> {
    const normalized = token.trim();
    if (!normalized) {
      const state = buildState({
        correlationId: correlationIdFactory(),
        message: "Telegram bot token is empty.",
        openclawInstalled: existsSync(binaryPath),
        telegramLastError: "Telegram bot token is empty.",
      });
      persistState(statePath, state);
      return state;
    }

    writeSecret(TELEGRAM_TOKEN_KEY, normalized);
    const state = buildState({
      correlationId: correlationIdFactory(),
      message: "Telegram token stored. Test the bot before enabling the channel.",
      openclawInstalled: existsSync(binaryPath),
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
        openclawInstalled: existsSync(binaryPath),
        telegramLastError: "Telegram bot token is not configured.",
      });
      persistState(statePath, state);
      return state;
    }

    const probe = await telegramProbe(token);
    const state = buildState({
      correlationId: correlationIdFactory(),
      message: probe.message ?? (probe.ok ? "Telegram bot reachable." : "Telegram bot test failed."),
      openclawInstalled: existsSync(binaryPath),
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
      openclawInstalled: existsSync(binaryPath),
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
    const openclawHealthy = input.openclawInstalled;
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
        binaryPath,
        version: input.openclawInstalled ? "detected" : null,
        gatewayUrl: input.openclawInstalled ? "http://127.0.0.1:18789" : null,
        lastError: hasBackend ? null : `No backend worker available. OpenClaw binary not found: ${binaryPath}`,
      },
      codex: {
        configured: codexConfigured,
        profile: input.codexProfile ?? null,
        loginAvailable: hasBackend,
        lastError: codexConfigured ? null : "Backend Codex auth is not configured.",
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

  function withCurrentSecretFlags(state: OpenClawSetupState): OpenClawSetupState {
    return {
      ...state,
      telegram: {
        ...state.telegram,
        tokenConfigured: hasTelegramToken(),
      },
    };
  }

  function isCodexConfigured(): boolean {
    return Boolean(env.OPENCLAW_CODEX_AUTH_CONFIGURED === "1" || env.OPENCLAW_CODEX_AUTH_CONFIGURED === "true");
  }

  return {
    status,
    run,
    startCodexLogin,
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
