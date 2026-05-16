import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { createObservabilityState } from "./observability";
import { AGENT_PROTOCOL_SCHEMA_VERSION } from "./protocol";
import { readWorkerConfig, type WorkerConfig, type WorkerConfiguredMode } from "./config";
import { createLocalSimulatedWorkerAdapter, type LocalSimulatedWorkerAdapterOptions } from "./local-simulated";
import type { WorkerAdapter, WorkerMode } from "./types";

export type CreateWorkerAdapterOptions = Partial<LocalSimulatedWorkerAdapterOptions> & {
  config?: WorkerConfig;
  configMode?: WorkerConfiguredMode;
  openClawBinaryPath?: string;
  bundledWorkerPath?: string;
};

export function createWorkerAdapter(options: CreateWorkerAdapterOptions = {}): WorkerAdapter {
  const config = options.config ?? readWorkerConfig();
  const configuredMode = options.configMode ?? config.mode;
  const rootDir = options.rootDir ?? config.stateDir;

  if (configuredMode === "local-simulated") {
    return createLocalSimulatedWorkerAdapter({ ...options, rootDir });
  }

  if (configuredMode === "auto") {
    if (openClawAvailable(options.openClawBinaryPath)) {
      return createUnavailableAdapter("openclaw-process", rootDir, null);
    }
    if (bundledWorkerAvailable(options.bundledWorkerPath)) {
      return createUnavailableAdapter("agenos-bun-worker", rootDir, null);
    }
    return createLocalSimulatedWorkerAdapter({ ...options, rootDir });
  }

  return createUnavailableAdapter(
    configuredMode,
    rootDir,
    `${configuredMode} worker adapter is not implemented yet.`,
  );
}

function openClawAvailable(binaryPath = "/usr/bin/openclaw"): boolean {
  return existsSync(binaryPath);
}

function bundledWorkerAvailable(workerPath = join(import.meta.dir, "agenos-worker-daemon.ts")): boolean {
  return existsSync(workerPath);
}

function createUnavailableAdapter(mode: Exclude<WorkerMode, "local-simulated">, stateDir: string, reason: string | null): WorkerAdapter {
  const observability = createObservabilityState();
  if (reason) {
    observability.setDegraded(reason, `corr_${Date.now().toString(36)}`);
  }

  return {
    async health() {
      return {
        schemaVersion: AGENT_PROTOCOL_SCHEMA_VERSION,
        ok: false,
        mode,
        serviceActive: false,
        version: "unavailable",
        stateDir: stateDir.replace(/^~(?=\/)/, homedir()),
        queueDepth: 0,
        ...observability.snapshot(),
      };
    },
    async enqueue() {
      return { ok: false, message: reason ?? `${mode} worker adapter is not available.` };
    },
    async status() {
      return null;
    },
    async events() {
      return [];
    },
    async list() {
      return [];
    },
  };
}

export { createLocalSimulatedWorkerAdapter };
export type { WorkerAdapter, WorkerHealth, WorkerMode, WorkerProgressEvent, WorkerTask, WorkerTaskSource, WorkerTaskStatus } from "./types";
