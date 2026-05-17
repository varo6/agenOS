import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
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
  const systemConfigPath = options.systemConfigPath ?? env.AGENOS_OPENCLAW_SYSTEM_CONFIG ?? "/etc/agenos/openclaw.json";
  const userConfigPath = options.userConfigPath ?? env.AGENOS_OPENCLAW_USER_CONFIG ?? join(homedir(), ".agenos", "openclaw", "config.json");
  const systemConfig = readConfigFile(systemConfigPath);
  const userConfig = readConfigFile(userConfigPath);

  const config = mergeWorkerConfig(mergeWorkerConfig(DEFAULT_WORKER_CONFIG, systemConfig), userConfig);
  if (env.AGENOS_OPENCLAW_STATE_DIR?.trim()) {
    config.stateDir = env.AGENOS_OPENCLAW_STATE_DIR.trim();
  }
  configEnv.set(config, env);
  return config;
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
