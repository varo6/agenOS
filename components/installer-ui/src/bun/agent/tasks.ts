import { homedir } from "node:os";
import { join } from "node:path";
import { createWorkerAdapter } from "./worker";
import type { CreateWorkerAdapterOptions, WorkerAdapter, WorkerTaskSource } from "./worker";

export type TaskQueueOptions = CreateWorkerAdapterOptions & {
  rootDir?: string;
  now?: () => Date;
  idFactory?: () => string;
  correlationIdFactory?: () => string;
  adapter?: WorkerAdapter;
};

export type EnqueueTaskInput = {
  message: string;
  source: WorkerTaskSource;
};

function defaultRootDir(): string {
  return join(homedir(), ".agenos", "openclaw");
}

export function createTaskQueue(options: TaskQueueOptions = {}) {
  const rootDir = options.rootDir ?? defaultRootDir();
  let adapter = options.adapter ?? createWorkerAdapter({ ...options, rootDir });

  return {
    async health() {
      return adapter.health();
    },
    async testConnection() {
      return adapter.testConnection();
    },
    async enqueue(input: EnqueueTaskInput) {
      return adapter.enqueue(input);
    },
    async status(taskId: string) {
      return adapter.status(taskId);
    },
    async events(taskId: string) {
      return adapter.events(taskId);
    },
    async list(limit?: number) {
      return adapter.list(limit);
    },
    async retry(taskId: string) {
      return adapter.retry(taskId);
    },
    async clear(taskId: string) {
      return adapter.clear(taskId);
    },
    async resolveConfirmation(taskId: string, result: { ok: boolean; message?: string }) {
      return adapter.resolveConfirmation(taskId, result);
    },
    async reload() {
      if (options.adapter) {
        return { ok: false, message: "No se puede recargar un adaptador inyectado externamente." };
      }
      adapter = createWorkerAdapter({ ...options, rootDir, config: undefined });
      const health = await adapter.health();
      return {
        ok: true,
        message: `Configuracion aplicada al broker en modo ${health.mode}.`,
        health,
      };
    },
  };
}
