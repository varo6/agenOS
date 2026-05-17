import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { readWorkerConfig, type WorkerConfig } from "./config";
import { createObservabilityState } from "./observability";
import { createPlannerAdapter, PROVIDER_AUTH_MISSING, type PlannerAdapter } from "./planner";
import { AGENT_PROTOCOL_SCHEMA_VERSION } from "./protocol";
import { createWorkerTaskStore } from "./task-store";
import type { WorkerAdapter, WorkerProgressEvent, WorkerTask } from "./types";

export type WorkerToolCall = {
  correlationId: string;
  taskId: string;
  tool: string;
  input: unknown;
};

export type AgenosWorkerDaemonAdapterOptions = {
  stateDir: string;
  now?: () => Date;
  idFactory?: () => string;
  correlationIdFactory?: () => string;
  config?: WorkerConfig;
  env?: Record<string, string | undefined>;
  planner?: PlannerAdapter;
  runToolCall?: (call: WorkerToolCall) => Promise<unknown>;
};

export function createAgenosWorkerDaemonAdapter(options: AgenosWorkerDaemonAdapterOptions): WorkerAdapter {
  const stateDir = expandHomeDir(options.stateDir);
  const taskDir = join(stateDir, "tasks");
  const now = options.now ?? (() => new Date());
  const idFactory = options.idFactory ?? (() => `task_${now().getTime().toString(36)}_${Math.random().toString(36).slice(2, 8)}`);
  const correlationIdFactory = options.correlationIdFactory ?? (() => `corr_${now().getTime().toString(36)}_${Math.random().toString(36).slice(2, 8)}`);
  const config = options.config ?? readWorkerConfig();
  const env = options.env ?? process.env;
  const degradedReason = providerAuthConfigured(config, env) ? null : PROVIDER_AUTH_MISSING;
  const planner = options.planner ?? createPlannerAdapter({ mode: degradedReason ? "disabled" : "model-backed" });
  const observability = createObservabilityState({ now });
  const store = createWorkerTaskStore(taskDir);

  mkdirSync(taskDir, { recursive: true });
  if (degradedReason) {
    observability.setDegraded(degradedReason, correlationIdFactory());
  }

  return {
    async health() {
      return {
        schemaVersion: AGENT_PROTOCOL_SCHEMA_VERSION,
        ok: true,
        mode: "agenos-bun-worker",
        serviceActive: true,
        version: "agenos-bun-worker",
        stateDir,
        queueDepth: store.queueDepth(),
        ...observability.snapshot(),
      };
    },
    async enqueue(input) {
      const message = input.message.trim();
      if (!message) {
        return { ok: false, message: "Task cannot be empty." };
      }

      const taskId = idFactory();
      const correlationId = input.correlationId ?? correlationIdFactory();
      const timestamp = now().toISOString();
      const task: WorkerTask = {
        schemaVersion: AGENT_PROTOCOL_SCHEMA_VERSION,
        taskId,
        correlationId,
        timestamp,
        source: input.source,
        message,
        status: "queued",
        progress: 0,
        lastError: null,
      };
      const queuedEvent: WorkerProgressEvent = {
        schemaVersion: AGENT_PROTOCOL_SCHEMA_VERSION,
        taskId,
        correlationId,
        timestamp,
        type: "queued",
        message: "Task accepted by AgenOS worker daemon.",
      };

      store.appendTask(task);
      store.appendEvent(queuedEvent);
      observability.increment("accepted");

      const plan = await planner.plan({ correlationId, taskId, message });
      if (!plan.ok && plan.degradedReason) {
        store.appendEvent({
          schemaVersion: AGENT_PROTOCOL_SCHEMA_VERSION,
          taskId,
          correlationId,
          timestamp: now().toISOString(),
          type: "progress",
          message: `${plan.degradedReason} Configure provider/auth in the admin UI.`,
          progress: 0,
        });
      }

      return {
        ok: true,
        taskId,
        correlationId,
        message: "Task accepted by AgenOS worker daemon.",
      };
    },
    async status(taskId) {
      return store.getTask(taskId);
    },
    async events(taskId) {
      return store.getEvents(taskId);
    },
    async list(limit) {
      return store.list(limit);
    },
  };
}

function providerAuthConfigured(config: WorkerConfig, env: Record<string, string | undefined>): boolean {
  if (config.provider === "none" || config.model === "none") {
    return false;
  }

  if (config.apiAuth.type === "none") {
    return true;
  }

  return Boolean(env[config.apiAuth.envVar]);
}

function expandHomeDir(path: string): string {
  return path.replace(/^~(?=\/)/, homedir());
}
