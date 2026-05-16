import { mkdirSync } from "node:fs";
import { AGENT_PROTOCOL_SCHEMA_VERSION } from "./protocol";
import { createObservabilityState } from "./observability";
import { createWorkerTaskStore } from "./task-store";
import type { WorkerAdapter, WorkerTask, WorkerProgressEvent } from "./types";

export type LocalSimulatedWorkerAdapterOptions = {
  rootDir: string;
  now?: () => Date;
  idFactory?: () => string;
  correlationIdFactory?: () => string;
};

export function createLocalSimulatedWorkerAdapter(options: LocalSimulatedWorkerAdapterOptions): WorkerAdapter {
  const rootDir = options.rootDir;
  const now = options.now ?? (() => new Date());
  const idFactory = options.idFactory ?? (() => `task_${now().getTime().toString(36)}_${Math.random().toString(36).slice(2, 8)}`);
  const correlationIdFactory = options.correlationIdFactory ?? (() => `corr_${now().getTime().toString(36)}_${Math.random().toString(36).slice(2, 8)}`);
  const observability = createObservabilityState({ now });
  const store = createWorkerTaskStore(rootDir);

  mkdirSync(rootDir, { recursive: true });

  return {
    async health() {
      return {
        schemaVersion: AGENT_PROTOCOL_SCHEMA_VERSION,
        ok: true,
        mode: "local-simulated",
        serviceActive: false,
        version: "local-simulated",
        stateDir: rootDir,
        queueDepth: store.queueDepth(),
        ...observability.snapshot(),
      };
    },
    async enqueue(input) {
      const message = input.message.trim();
      if (!message) {
        return { ok: false, message: "La tarea no puede estar vacia." };
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
      const event: WorkerProgressEvent = {
        schemaVersion: AGENT_PROTOCOL_SCHEMA_VERSION,
        taskId,
        correlationId,
        timestamp,
        type: "queued",
        message: "Tarea encolada.",
      };

      store.appendTask(task);
      store.appendEvent(event);
      observability.increment("accepted");

      return { ok: true, taskId, message: "Tarea enviada al worker de fondo." };
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
