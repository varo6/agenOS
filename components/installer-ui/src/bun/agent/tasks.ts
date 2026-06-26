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
  const adapter = options.adapter ?? createWorkerAdapter({ ...options, rootDir });

  return {
    async health() {
      return adapter.health();
    },
    async enqueue(input: EnqueueTaskInput) {
      return adapter.enqueue(input);
    },
    status: adapter.status,
    events: adapter.events,
    list: adapter.list,
  };
}
