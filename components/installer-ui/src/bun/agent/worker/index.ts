import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { createObservabilityState } from "./observability";
import { AGENT_PROTOCOL_SCHEMA_VERSION } from "./protocol";
import { readWorkerConfig, type WorkerConfig, type WorkerConfiguredMode } from "./config";
import { createAgenosWorkerDaemonAdapter, type WorkerToolCall } from "./agenos-worker-daemon";
import { createLocalSimulatedWorkerAdapter, type LocalSimulatedWorkerAdapterOptions } from "./local-simulated";
import { createOpenClawProcessAdapter } from "./openclaw-process";
import { createOpenClawRuntime } from "./openclaw-runtime";
import type { WorkerAdapter, WorkerMode } from "./types";

export type CreateWorkerAdapterOptions = Partial<LocalSimulatedWorkerAdapterOptions> & {
  config?: WorkerConfig;
  configMode?: WorkerConfiguredMode;
  openClawBinaryPath?: string;
  bundledWorkerPath?: string;
  runToolCall?: (call: WorkerToolCall) => Promise<unknown>;
  learnedContextProvider?: (query: string) => Promise<string> | string;
};

export function createWorkerAdapter(options: CreateWorkerAdapterOptions = {}): WorkerAdapter {
  const config = options.config ?? readWorkerConfig();
  const configuredMode = options.configMode ?? config.mode;
  const rootDir = options.rootDir ?? config.stateDir;

  if (configuredMode === "local-simulated") {
    return createLocalSimulatedWorkerAdapter({ ...options, rootDir });
  }

  if (configuredMode === "openclaw-process") {
    return createOpenClawProcessAdapter({ binaryPath: options.openClawBinaryPath, stateDir: rootDir, now: options.now, learnedContextProvider: options.learnedContextProvider });
  }

  if (configuredMode === "agenos-bun-worker") {
    return createAgenosWorkerDaemonAdapter({
      stateDir: rootDir,
      now: options.now,
      idFactory: options.idFactory,
      correlationIdFactory: options.correlationIdFactory,
      config,
      runToolCall: options.runToolCall,
      learnedContextProvider: options.learnedContextProvider,
    });
  }

  if (configuredMode === "auto") {
    if (openClawAvailable(options.openClawBinaryPath)) {
      return createOpenClawProcessAdapter({ binaryPath: options.openClawBinaryPath, stateDir: rootDir, now: options.now, learnedContextProvider: options.learnedContextProvider });
    }
    if (bundledWorkerAvailable(options.bundledWorkerPath)) {
      return createAgenosWorkerDaemonAdapter({
        stateDir: rootDir,
        now: options.now,
        idFactory: options.idFactory,
        correlationIdFactory: options.correlationIdFactory,
        config,
        runToolCall: options.runToolCall,
        learnedContextProvider: options.learnedContextProvider,
      });
    }
    return createLocalSimulatedWorkerAdapter({ ...options, rootDir });
  }

  return createUnavailableAdapter(
    configuredMode,
    rootDir,
    `${configuredMode} worker adapter is not implemented yet.`,
  );
}

function openClawAvailable(binaryPath?: string): boolean {
  return createOpenClawRuntime({ binaryPath }).resolveBinary() !== null;
}

function bundledWorkerAvailable(workerPath?: string): boolean {
  const candidates = [
    workerPath,
    join(import.meta.dir, "agenos-worker-daemon.ts"),
    "/usr/local/bin/agenos-openclaw-worker",
  ].filter((candidate): candidate is string => Boolean(candidate));
  return candidates.some((candidate) => existsSync(candidate));
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
