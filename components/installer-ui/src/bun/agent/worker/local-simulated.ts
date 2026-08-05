import { mkdirSync } from "node:fs";
import { AGENT_PROTOCOL_SCHEMA_VERSION } from "./protocol";
import { createObservabilityState } from "./observability";
import { createWorkerTaskStore } from "./task-store";
import type { WorkerAdapter } from "./types";

export type LocalSimulatedWorkerAdapterOptions = {
  rootDir: string;
  now?: () => Date;
  idFactory?: () => string;
  correlationIdFactory?: () => string;
};

export const LOCAL_SIMULATED_UNAVAILABLE = "No hay un worker real disponible. Configura OpenClaw desde el panel de administracion o ejecuta la tarea en la conversacion local.";

export function createLocalSimulatedWorkerAdapter(options: LocalSimulatedWorkerAdapterOptions): WorkerAdapter {
  const rootDir = options.rootDir;
  const now = options.now ?? (() => new Date());
  const correlationIdFactory = options.correlationIdFactory ?? (() => `corr_${now().getTime().toString(36)}_${Math.random().toString(36).slice(2, 8)}`);
  const observability = createObservabilityState({ now });
  const store = createWorkerTaskStore(rootDir);

  mkdirSync(rootDir, { recursive: true });
  observability.setDegraded(LOCAL_SIMULATED_UNAVAILABLE, correlationIdFactory());

  return {
    async health() {
      return {
        schemaVersion: AGENT_PROTOCOL_SCHEMA_VERSION,
        ok: false,
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
      return { ok: false, message: LOCAL_SIMULATED_UNAVAILABLE };
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
    async retry(taskId) {
      return { ok: false, taskId, message: LOCAL_SIMULATED_UNAVAILABLE };
    },
    async clear(taskId) {
      const task = store.getTask(taskId);
      if (task && task.status !== "succeeded" && task.status !== "failed" && task.status !== "cancelled") {
        return { ok: false, taskId, message: `La tarea heredada ${taskId} sigue activa y no se puede limpiar sin resolverla.` };
      }
      const cleared = store.clearTask(taskId);
      return {
        ok: cleared,
        taskId,
        message: cleared ? `Tarea ${taskId} eliminada.` : `No existe la tarea ${taskId}.`,
      };
    },
    async resolveConfirmation(taskId) {
      return { ok: false, taskId, message: `La tarea ${taskId} no puede reanudarse porque el worker simulado no ejecuta tareas.` };
    },
  };
}
