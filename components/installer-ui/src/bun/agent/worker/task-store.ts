import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { migrateEventRecord, migrateTaskRecord } from "./migrations";
import type { WorkerProgressEvent, WorkerTask, WorkerTaskStatus } from "./types";

const TERMINAL_STATUSES = new Set<WorkerTaskStatus>(["succeeded", "failed", "cancelled"]);

export type WorkerTaskStore = ReturnType<typeof createWorkerTaskStore>;

export function createWorkerTaskStore(rootDir: string) {
  mkdirSync(rootDir, { recursive: true });

  const outboxPath = join(rootDir, "outbox.ndjson");
  const eventsPath = join(rootDir, "events.ndjson");

  return {
    appendTask(task: WorkerTask): void {
      appendJsonLine(outboxPath, task);
    },
    appendEvent(event: WorkerProgressEvent): void {
      appendJsonLine(eventsPath, event);
    },
    getTask(taskId: string): WorkerTask | null {
      return readTasks(outboxPath).filter((task) => task.taskId === taskId).at(-1) ?? null;
    },
    getEvents(taskId: string): WorkerProgressEvent[] {
      return readEvents(eventsPath).filter((event) => event.taskId === taskId);
    },
    list(limit = 50): WorkerTask[] {
      const latest = new Map<string, WorkerTask>();
      for (const task of readTasks(outboxPath)) {
        latest.set(task.taskId, task);
      }
      return Array.from(latest.values()).slice(-limit).reverse();
    },
    queueDepth(): number {
      return this.list(Number.MAX_SAFE_INTEGER).filter((task) => !TERMINAL_STATUSES.has(task.status)).length;
    },
  };
}

function appendJsonLine(path: string, record: unknown): void {
  appendFileSync(path, `${JSON.stringify(record)}\n`, { encoding: "utf8" });
}

function readTasks(path: string): WorkerTask[] {
  return readJsonLines(path).map((record) => migrateTaskRecord(record) as WorkerTask);
}

function readEvents(path: string): WorkerProgressEvent[] {
  return readJsonLines(path).map((record) => migrateEventRecord(record) as WorkerProgressEvent);
}

function readJsonLines(path: string): Record<string, unknown>[] {
  if (!existsSync(path)) {
    return [];
  }

  return readFileSync(path, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}
