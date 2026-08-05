import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { migrateWorkerConfigRecord } from "./migrations";

export type WorkerConfiguredMode = "auto" | "openclaw-process" | "agenos-bun-worker" | "local-simulated";
export type ChannelConfig = { email: boolean; telegram: boolean; whatsapp: boolean };
export type PolicyDefaults = { memoryWrite: "confirm"; outboundSend: "confirm" };
export type WorkerAuthConfig = { type: "none" } | { type: "env"; envVar: string };

export type WorkerConfig = {
  schemaVersion: 1;
  mode: WorkerConfiguredMode;
  provider: string;
  model: string;
  apiAuth: WorkerAuthConfig;
  stateDir: string;
  channels: ChannelConfig;
  policyDefaults: PolicyDefaults;
};

export type RedactedWorkerConfig = Omit<WorkerConfig, "apiAuth"> & {
  apiAuth: WorkerAuthConfig & { configured: boolean };
};

export type ReadWorkerConfigOptions = {
  systemConfigPath?: string;
  userConfigPath?: string;
  env?: Record<string, string | undefined>;
};

export type WriteWorkerConfigOptions = ReadWorkerConfigOptions & {
  current?: WorkerConfig;
};

const DEFAULT_WORKER_CONFIG: WorkerConfig = {
  schemaVersion: 1,
  mode: "auto",
  provider: "none",
  model: "none",
  apiAuth: { type: "env", envVar: "AGENOS_OPENCLAW_API_KEY" },
  stateDir: "~/.agenos/openclaw",
  channels: { email: false, telegram: false, whatsapp: false },
  policyDefaults: { memoryWrite: "confirm", outboundSend: "confirm" },
};

const configEnv = new WeakMap<WorkerConfig, Record<string, string | undefined>>();

export function readWorkerConfig(options: ReadWorkerConfigOptions = {}): WorkerConfig {
  const env = options.env ?? process.env;
  const { systemConfigPath, userConfigPath } = workerConfigPaths(options);
  const systemConfig = readConfigFile(systemConfigPath);
  const userConfig = readConfigFile(userConfigPath);

  const config = mergeWorkerConfig(mergeWorkerConfig(DEFAULT_WORKER_CONFIG, systemConfig), userConfig);
  if (env.AGENOS_OPENCLAW_STATE_DIR?.trim()) {
    config.stateDir = env.AGENOS_OPENCLAW_STATE_DIR.trim();
  }
  configEnv.set(config, env);
  return config;
}

export function writeWorkerConfig(
  patch: Partial<WorkerConfig>,
  options: WriteWorkerConfigOptions = {},
): WorkerConfig {
  const env = options.env ?? process.env;
  const current = options.current ?? readWorkerConfig(options);
  const validatedPatch = validateWorkerConfigPatch(patch, current);
  const next = mergeWorkerConfig(current, validatedPatch);
  const { userConfigPath } = workerConfigPaths(options);
  const directory = dirname(userConfigPath);
  const temporaryPath = `${userConfigPath}.tmp-${process.pid}`;

  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  writeFileSync(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  chmodSync(temporaryPath, 0o600);
  renameSync(temporaryPath, userConfigPath);
  chmodSync(userConfigPath, 0o600);
  configEnv.set(next, env);
  return next;
}

export function redactWorkerConfig(
  config: WorkerConfig,
  env: Record<string, string | undefined> = configEnv.get(config) ?? process.env,
): RedactedWorkerConfig {
  if (config.apiAuth.type === "none") {
    return { ...config, apiAuth: { type: "none", configured: false } };
  }

  return {
    ...config,
    apiAuth: {
      type: "env",
      envVar: config.apiAuth.envVar,
      configured: Boolean(env[config.apiAuth.envVar]),
    },
  };
}

function readConfigFile(path: string): Partial<WorkerConfig> {
  if (!existsSync(path)) {
    return {};
  }

  const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  const migrated = migrateWorkerConfigRecord(parsed);
  if (!migrated.ok) {
    return {};
  }
  return migrated.value as Partial<WorkerConfig>;
}

function workerConfigPaths(options: ReadWorkerConfigOptions): { systemConfigPath: string; userConfigPath: string } {
  const env = options.env ?? process.env;
  return {
    systemConfigPath: options.systemConfigPath ?? env.AGENOS_OPENCLAW_SYSTEM_CONFIG ?? "/etc/agenos/openclaw.json",
    userConfigPath: options.userConfigPath ?? env.AGENOS_OPENCLAW_USER_CONFIG ?? join(homedir(), ".agenos", "openclaw", "config.json"),
  };
}

function validateWorkerConfigPatch(patch: Partial<WorkerConfig>, current: WorkerConfig): Partial<WorkerConfig> {
  const input = patch as Record<string, unknown>;
  const validated: Partial<WorkerConfig> = {};

  if (input.mode !== undefined) {
    if (!isWorkerConfiguredMode(input.mode)) {
      throw new Error("El modo del worker no es valido.");
    }
    validated.mode = input.mode;
  }
  if (input.provider !== undefined) {
    validated.provider = requiredString(input.provider, "provider");
  }
  if (input.model !== undefined) {
    validated.model = requiredString(input.model, "model");
  }
  if (input.stateDir !== undefined) {
    validated.stateDir = requiredString(input.stateDir, "stateDir");
  }
  if (input.apiAuth !== undefined) {
    validated.apiAuth = validateAuth(input.apiAuth);
  }
  if (input.channels !== undefined) {
    if (!input.channels || typeof input.channels !== "object") {
      throw new Error("La configuracion de canales no es valida.");
    }
    const channels = input.channels as Record<string, unknown>;
    validated.channels = {
      email: optionalBoolean(channels.email, "channels.email", current.channels.email),
      telegram: optionalBoolean(channels.telegram, "channels.telegram", current.channels.telegram),
      whatsapp: optionalBoolean(channels.whatsapp, "channels.whatsapp", current.channels.whatsapp),
    } as ChannelConfig;
  }
  if (input.policyDefaults !== undefined) {
    if (!input.policyDefaults || typeof input.policyDefaults !== "object") {
      throw new Error("La politica por defecto no es valida.");
    }
    const defaults = input.policyDefaults as Record<string, unknown>;
    if ((defaults.memoryWrite !== undefined && defaults.memoryWrite !== "confirm")
      || (defaults.outboundSend !== undefined && defaults.outboundSend !== "confirm")) {
      throw new Error("Las acciones sensibles deben conservar la politica confirm.");
    }
    validated.policyDefaults = {
      memoryWrite: "confirm",
      outboundSend: "confirm",
    };
  }

  return validated;
}

function isWorkerConfiguredMode(value: unknown): value is WorkerConfiguredMode {
  return value === "auto"
    || value === "openclaw-process"
    || value === "agenos-bun-worker"
    || value === "local-simulated";
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`El campo ${field} debe ser texto no vacio.`);
  }
  return value.trim();
}

function optionalBoolean(value: unknown, field: string, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== "boolean") {
    throw new Error(`El campo ${field} debe ser booleano.`);
  }
  return value;
}

function validateAuth(value: unknown): WorkerAuthConfig {
  if (!value || typeof value !== "object") {
    throw new Error("La configuracion apiAuth no es valida.");
  }
  const auth = value as Record<string, unknown>;
  if (auth.type === "none") {
    return { type: "none" };
  }
  if (auth.type !== "env" || typeof auth.envVar !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(auth.envVar)) {
    throw new Error("apiAuth.envVar debe ser el nombre valido de una variable de entorno.");
  }
  return { type: "env", envVar: auth.envVar };
}

function mergeWorkerConfig(base: WorkerConfig, override: Partial<WorkerConfig>): WorkerConfig {
  return {
    ...base,
    ...override,
    schemaVersion: 1,
    channels: {
      ...base.channels,
      ...override.channels,
    },
    policyDefaults: {
      ...base.policyDefaults,
      ...override.policyDefaults,
    },
    apiAuth: override.apiAuth ?? base.apiAuth,
  };
}
